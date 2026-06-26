import Groq from "groq-sdk";
import { logger } from "./logger";

let _client: Groq | null = null;

export function getGroqClient(): Groq {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY environment variable is not set");
  }
  if (!_client) {
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
}

export interface ExtractedRef {
  book: string;
  chapter: number;
  verse: number | null;
  reference: string;
  isPartial: boolean;
}

const SYSTEM_PROMPT = `You are a Bible verse reference extractor. Your ONLY job is to find Bible verse references in speech transcripts.

Extract ALL Bible verse references from the text. Handle:
- Standard format: "John 3:16", "Ephesians 3:1"
- Spoken format: "John chapter 3 verse 16", "Ephesians chapter 3 verse 1"
- Abbreviated: "Rev 21:4", "Ps 23:1", "1 Cor 13:4"
- Misspelled: "Jeramy" → Jeremiah, "Efesians" → Ephesians, "Revelations" → Revelation
- Partial: "Ephesians 3" (chapter only, no verse)

Normalize book names to standard English (e.g. "Ps" → "Psalms", "Rev" → "Revelation", "1 Cor" → "1 Corinthians").

Return ONLY a JSON array. No explanation. No markdown. No extra text.

Format:
[{"book":"Ephesians","chapter":3,"verse":1,"reference":"Ephesians 3:1","isPartial":false}]

For chapter-only references: {"book":"Ephesians","chapter":3,"verse":null,"reference":"Ephesians 3","isPartial":true}

If no verses found, return: []`;

export async function extractVersesWithAI(
  transcript: string,
  knownRefs: string[] = []
): Promise<ExtractedRef[]> {
  const client = getGroqClient();

  const userContent =
    knownRefs.length > 0
      ? `Already found (skip these): ${knownRefs.join(", ")}\n\nTranscript: ${transcript}`
      : `Transcript: ${transcript}`;

  const start = Date.now();

  const completion = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    temperature: 0,
    max_tokens: 512,
    response_format: { type: "json_object" },
  });

  const elapsed = Date.now() - start;
  logger.debug({ elapsed }, "Groq verse extraction completed");

  const raw = completion.choices[0]?.message?.content ?? "[]";

  try {
    // Groq json_object mode wraps in an object — handle both array and {verses:[]} shapes
    const parsed = JSON.parse(raw);
    const arr: ExtractedRef[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.verses)
        ? parsed.verses
        : Array.isArray(parsed.references)
          ? parsed.references
          : [];

    return arr.filter(
      (r) =>
        r &&
        typeof r.book === "string" &&
        typeof r.chapter === "number" &&
        typeof r.reference === "string"
    );
  } catch (e) {
    logger.warn({ raw, error: e }, "Failed to parse Groq verse extraction response");
    return [];
  }
}
