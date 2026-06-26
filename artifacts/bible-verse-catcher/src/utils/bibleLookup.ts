import bibleNiv from "../data/bible_niv.json";

type BibleData = Record<string, Record<string, Record<string, string>>>;

const localData: Record<string, BibleData> = {
  NIV: bibleNiv as BibleData,
};

export type Translation = "NIV" | "KJV" | "WEB";

export const TRANSLATION_LABELS: Record<Translation, string> = {
  NIV: "NIV",
  KJV: "KJV",
  WEB: "WEB",
};

// bible-api.com translation codes
const API_CODES: Record<Translation, string> = {
  NIV: "web", // NIV is copyrighted so we use local; fallback to WEB for display
  KJV: "kjv",
  WEB: "web",
};

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function cacheKey(translation: Translation, book: string, chapter: number, verse: number) {
  return `vc:${translation}:${book}:${chapter}:${verse}`;
}

function readCache(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { text, ts } = JSON.parse(raw) as { text: string; ts: number };
    if (Date.now() - ts > CACHE_TTL_MS) { localStorage.removeItem(key); return null; }
    return text;
  } catch { return null; }
}

function writeCache(key: string, text: string) {
  try { localStorage.setItem(key, JSON.stringify({ text, ts: Date.now() })); } catch {}
}

// ── Local NIV lookup ──────────────────────────────────────────────────────────

export function getVerseText(
  book: string, chapter: number, verse: number, translation: Translation = "NIV"
): string | null {
  const bible = localData[translation];
  if (!bible) return null;
  return bible[book]?.[String(chapter)]?.[String(verse)] ?? null;
}

export function getChapterVerses(
  book: string, chapter: number, translation: Translation = "NIV"
): Array<{ verse: number; text: string }> {
  const bible = localData[translation];
  if (!bible) return [];
  const chapterData = bible[book]?.[String(chapter)];
  if (!chapterData) return [];
  return Object.entries(chapterData)
    .map(([v, text]) => ({ verse: parseInt(v, 10), text }))
    .sort((a, b) => a.verse - b.verse);
}

export function getSuggestedVerses(
  book: string, chapter: number, translation: Translation = "NIV", count = 5
): Array<{ verse: number; text: string; reference: string }> {
  return getChapterVerses(book, chapter, translation)
    .slice(0, count)
    .map((v) => ({ ...v, reference: `${book} ${chapter}:${v.verse}` }));
}

export function isBookAvailable(book: string, translation: Translation = "NIV"): boolean {
  return !!(localData[translation]?.[book]);
}

export function isValidRef(
  book: string, chapter: number, verse: number | null, translation: Translation = "NIV"
): boolean {
  const bible = localData[translation];
  if (!bible) return false;
  const chapterData = bible[book]?.[String(chapter)];
  if (!chapterData) return false;
  if (verse === null) return true;
  return !!chapterData[String(verse)];
}

// ── Remote verse fetch (KJV / WEB via bible-api.com) ─────────────────────────

export async function fetchRemoteVerseText(
  book: string, chapter: number, verse: number, translation: Translation
): Promise<string | null> {
  if (translation === "NIV") return getVerseText(book, chapter, verse, "NIV");

  const key = cacheKey(translation, book, chapter, verse);
  const cached = readCache(key);
  if (cached) return cached;

  try {
    const ref = encodeURIComponent(`${book} ${chapter}:${verse}`);
    const res = await fetch(
      `https://bible-api.com/${ref}?translation=${API_CODES[translation]}`
    );
    if (!res.ok) return null;
    const data = await res.json() as { verses?: Array<{ text?: string }> };
    const text = data.verses?.[0]?.text?.trim().replace(/\n/g, ' ') ?? null;
    if (text) writeCache(key, text);
    return text;
  } catch {
    return null;
  }
}

/** Fetch text for a verse range (e.g. John 4:5-8). Returns combined text. */
export async function fetchRemoteVerseRange(
  book: string, chapter: number, verseStart: number, verseEnd: number, translation: Translation
): Promise<string | null> {
  if (translation === "NIV") {
    const parts: string[] = [];
    for (let v = verseStart; v <= verseEnd; v++) {
      const t = getVerseText(book, chapter, v, "NIV");
      if (t) parts.push(`[${v}] ${t}`);
    }
    return parts.length ? parts.join(' ') : null;
  }

  const key = cacheKey(translation, book, chapter, verseStart) + `-${verseEnd}`;
  const cached = readCache(key);
  if (cached) return cached;

  try {
    const ref = encodeURIComponent(`${book} ${chapter}:${verseStart}-${verseEnd}`);
    const res = await fetch(
      `https://bible-api.com/${ref}?translation=${API_CODES[translation]}`
    );
    if (!res.ok) return null;
    const data = await res.json() as { verses?: Array<{ verse?: number; text?: string }> };
    const text = data.verses
      ?.map((v) => `[${v.verse}] ${v.text?.trim()}`)
      .join(' ')
      .replace(/\n/g, ' ') ?? null;
    if (text) writeCache(key, text);
    return text;
  } catch {
    return null;
  }
}
