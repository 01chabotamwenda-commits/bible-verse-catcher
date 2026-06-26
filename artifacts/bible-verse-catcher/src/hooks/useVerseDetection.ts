/**
 * Dual-track verse detection:
 * 1. LOCAL (instant): Regex runs on every interim + final transcript update → zero latency
 * 2. AI (smart): Groq LLM runs on each finalized speech chunk → catches anything regex misses
 *
 * Both tracks deduplicate against the shared seen-refs set.
 * Partial refs are upgraded to full refs when AI confirms the verse number.
 */
import { useState, useRef, useCallback } from 'react';
import { detectVerseReferences, DetectedVerse } from '@/utils/verseDetector';
import { getVerseText, getSuggestedVerses, isBookAvailable, isValidRef } from '@/utils/bibleLookup';

export interface EnrichedVerse extends DetectedVerse {
  verseText: string | null;
  suggestions: Array<{ verse: number; text: string; reference: string }>;
  source: 'local' | 'ai';
  detectedAt: number;
  /** True if the verse was found in local NIV data — confirms it's a real, valid reference */
  verified: boolean;
}

type VerseRef = { book: string; chapter: number; verse: number | null; reference: string; isPartial: boolean };

const GROQ_SYSTEM_PROMPT = `You are a Bible verse reference extractor for a live sermon transcription app. Your ONLY job is to find Bible verse references in speech transcripts.

CRITICAL: Preachers often give a reference in pieces across multiple sentences. You MUST assemble these into a complete reference.

Examples of fragmented delivery — treat each block as ONE reference:
- "let's turn to the book of John ... chapter 4 ... verse 5" → John 4:5
- "open your bibles to Ephesians ... we're looking at chapter 3, verses 1 through 4" → Ephesians 3:1
- "go to first Corinthians ... chapter 13 ... verse 4 to 8" → 1 Corinthians 13:4
- "the book of Psalms, chapter 23, verse 1" → Psalms 23:1
- "let's read from Romans ... chapter 8 ... starting at verse 28" → Romans 8:28

Also handle:
- Standard format: "John 3:16", "Ephesians 3:1"
- Spoken format: "John chapter 3 verse 16"
- Abbreviated: "Rev 21:4", "Ps 23:1", "1 Cor 13:4"
- Misspelled: "Jeramy" → Jeremiah, "Efesians" → Ephesians, "Revelations" → Revelation
- Partial (chapter only, no verse): "Ephesians 3"
- Verse ranges: "verse 5 to 8" → use the first verse (5)

Normalize book names to standard English (e.g. "Ps" → "Psalms", "Rev" → "Revelation", "1 Cor" → "1 Corinthians").

Return ONLY a JSON array. No explanation. No markdown. No extra text.

Format:
[{"book":"Ephesians","chapter":3,"verse":1,"reference":"Ephesians 3:1","isPartial":false}]

For chapter-only references: {"book":"Ephesians","chapter":3,"verse":null,"reference":"Ephesians 3","isPartial":true}

If no verses found, return: []`;

async function callDetectApi(
  transcript: string,
  knownRefs: string[]
): Promise<VerseRef[]> {
  const embeddedKey = import.meta.env.VITE_GROQ_API_KEY as string | undefined;

  if (embeddedKey) {
    const userContent = knownRefs.length > 0
      ? `Already found (skip these): ${knownRefs.join(', ')}\n\nTranscript: ${transcript}`
      : `Transcript: ${transcript}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${embeddedKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: GROQ_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0,
        max_tokens: 512,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) throw new Error(`Groq API error ${res.status}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? '[]';
    const parsed: unknown = JSON.parse(raw);
    const arr: unknown[] = Array.isArray(parsed) ? parsed
      : Array.isArray((parsed as Record<string, unknown>).verses) ? (parsed as Record<string, unknown[]>).verses
      : Array.isArray((parsed as Record<string, unknown>).references) ? (parsed as Record<string, unknown[]>).references
      : [];

    return arr.filter((r): r is VerseRef =>
      r !== null && typeof r === 'object' &&
      typeof (r as Record<string, unknown>).book === 'string' &&
      typeof (r as Record<string, unknown>).chapter === 'number' &&
      typeof (r as Record<string, unknown>).reference === 'string'
    );
  }

  const apiBase = window.electronAPI?.apiBaseUrl;
  const apiUrl = apiBase ? `${apiBase}/api/verses/detect` : '/api/verses/detect';
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, knownRefs }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json() as { verses?: VerseRef[] };
  return data.verses ?? [];
}

function enrichVerse(
  v: DetectedVerse,
  source: 'local' | 'ai'
): EnrichedVerse {
  let verseText: string | null = null;

  if (!v.isPartial && v.verse != null && isBookAvailable(v.book)) {
    if (v.verseEnd != null) {
      // Verse range — concatenate all NIV verses
      const parts: string[] = [];
      for (let vn = v.verse; vn <= v.verseEnd; vn++) {
        const t = getVerseText(v.book, v.chapter, vn);
        if (t) parts.push(`[${vn}] ${t}`);
      }
      verseText = parts.length ? parts.join(' ') : null;
    } else {
      verseText = getVerseText(v.book, v.chapter, v.verse);
    }
  }

  const suggestions = v.isPartial && isBookAvailable(v.book)
    ? getSuggestedVerses(v.book, v.chapter)
    : [];

  const verified =
    verseText !== null ||
    (v.isPartial && suggestions.length > 0) ||
    isValidRef(v.book, v.chapter, v.verse);

  return {
    ...v,
    rawMatch: v.reference,
    verseText,
    suggestions,
    source,
    detectedAt: Date.now(),
    verified,
  };
}

const ROLLING_CONTEXT_CHUNKS = 20;

export function useVerseDetection() {
  const [verses, setVerses] = useState<EnrichedVerse[]>([]);
  const [isAiProcessing, setIsAiProcessing] = useState(false);

  const seenRefsRef = useRef<Set<string>>(new Set());
  const aiInFlightRef = useRef(false);
  const pendingChunksRef = useRef<string[]>([]);
  const rollingContextRef = useRef<string[]>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const addVerses = useCallback(
    (
      candidates: Array<DetectedVerse | { book: string; chapter: number; verse: number | null; reference: string; isPartial: boolean }>,
      source: 'local' | 'ai'
    ) => {
      const newOnes: typeof candidates = [];
      const upgrades: string[] = [];

      for (const v of candidates) {
        if (seenRefsRef.current.has(v.reference)) continue;
        if (!v.isPartial) {
          const partialRef = `${v.book} ${v.chapter}`;
          if (seenRefsRef.current.has(partialRef)) {
            upgrades.push(partialRef);
            seenRefsRef.current.delete(partialRef);
          }
        }
        seenRefsRef.current.add(v.reference);
        newOnes.push(v);
      }

      if (newOnes.length === 0 && upgrades.length === 0) return;

      const enriched = newOnes.map((v) => enrichVerse(v as DetectedVerse, source));

      setVerses((prev) => {
        const filtered = upgrades.length > 0
          ? prev.filter((v) => !upgrades.includes(v.reference))
          : prev;
        return [...enriched, ...filtered];
      });
    },
    []
  );

  flushRef.current = async () => {
    if (aiInFlightRef.current || pendingChunksRef.current.length === 0) return;
    aiInFlightRef.current = true;
    setIsAiProcessing(true);
    try {
      while (pendingChunksRef.current.length > 0) {
        pendingChunksRef.current.splice(0);
        const context = rollingContextRef.current.join(' ');
        const knownRefs = Array.from(seenRefsRef.current);
        const results = await callDetectApi(context, knownRefs);
        addVerses(results, 'ai');
      }
    } catch {
      // AI failed silently — regex already caught what it could
    } finally {
      aiInFlightRef.current = false;
      setIsAiProcessing(false);
      if (pendingChunksRef.current.length > 0) flushRef.current?.();
    }
  };

  const processLocalDetection = useCallback(
    (fullText: string) => {
      if (!fullText.trim()) return;
      addVerses(detectVerseReferences(fullText), 'local');
    },
    [addVerses]
  );

  const processAIChunk = useCallback(
    (chunk: string) => {
      rollingContextRef.current.push(chunk);
      if (rollingContextRef.current.length > ROLLING_CONTEXT_CHUNKS) {
        rollingContextRef.current.shift();
      }
      pendingChunksRef.current.push(chunk);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => flushRef.current?.(), 250);
    },
    []
  );

  const exportAll = useCallback((): string => {
    return verses
      .map((v) => v.verseText ? `${v.reference} — ${v.verseText}` : v.reference)
      .join('\n');
  }, [verses]);

  /** Load a saved set of verses (e.g. from session history) into the current view. */
  const loadVerses = useCallback((saved: EnrichedVerse[]) => {
    seenRefsRef.current = new Set(saved.map((v) => v.reference));
    setVerses(saved);
  }, []);

  const reset = useCallback(() => {
    setVerses([]);
    setIsAiProcessing(false);
    seenRefsRef.current.clear();
    pendingChunksRef.current = [];
    rollingContextRef.current = [];
    aiInFlightRef.current = false;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, []);

  return { verses, isAiProcessing, processLocalDetection, processAIChunk, exportAll, loadVerses, reset };
}
