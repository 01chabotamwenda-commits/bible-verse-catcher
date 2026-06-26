import bookAliases from "../data/book_aliases.json";

export interface DetectedVerse {
  book: string;
  chapter: number;
  verse: number | null;
  verseEnd?: number;        // set for ranges like "verse 5 to 8"
  reference: string;
  isPartial: boolean;
  rawMatch: string;
}

const aliasMap: Record<string, string> = bookAliases as Record<string, string>;

export function normalizeBookName(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  if (aliasMap[lower]) return aliasMap[lower];
  const allValues = Object.values(aliasMap);
  const directMatch = allValues.find((v) => v.toLowerCase() === lower);
  if (directMatch) return directMatch;
  return null;
}

const allAliases = Object.keys(aliasMap)
  .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .sort((a, b) => b.length - a.length);

const BOOK_PATTERN = allAliases.join("|");

/**
 * Detects Bible verse references including ranges.
 * Handles: "John 3:16", "John 3:16-18", "John chapter 3 verse 16 to 18",
 *          "Ps 23:1", "Ephesians 3", etc.
 */
export function detectVerseReferences(transcript: string): DetectedVerse[] {
  const results: DetectedVerse[] = [];
  const seen = new Set<string>();

  // Full reference patterns WITH optional range end
  const fullPatterns: Array<{ re: RegExp; groups: 'bvchv' | 'bchv' | 'bvsv' }> = [
    // "Book Chapter:Verse[-to Verse2]"  e.g. "John 3:16" or "John 3:16-18" or "John 3:16 to 18"
    {
      re: new RegExp(
        `(${BOOK_PATTERN})\\s+(\\d+)\\s*:\\s*(\\d+)(?:\\s*[-–]\\s*(\\d+)|\\s+to\\s+(\\d+))?`,
        "gi"
      ),
      groups: 'bvchv',
    },
    // "Book chapter N verse M [to P]"
    {
      re: new RegExp(
        `(${BOOK_PATTERN})\\s+chapter\\s+(\\d+)[,\\s]+verses?\\s+(\\d+)(?:\\s*[-–]\\s*(\\d+)|\\s+to\\s+(\\d+))?`,
        "gi"
      ),
      groups: 'bchv',
    },
    // "Book N vs M [to P]"
    {
      re: new RegExp(
        `(${BOOK_PATTERN})\\s+(\\d+)\\s+vs\\.?\\s+(\\d+)(?:\\s*[-–]\\s*(\\d+)|\\s+to\\s+(\\d+))?`,
        "gi"
      ),
      groups: 'bvchv',
    },
    // "Book N v M"
    {
      re: new RegExp(
        `(${BOOK_PATTERN})\\s+(\\d+)\\s+v\\s+(\\d+)`,
        "gi"
      ),
      groups: 'bvchv',
    },
  ];

  for (const { re } of fullPatterns) {
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(transcript)) !== null) {
      const rawBook = match[1];
      const normalizedBook = normalizeBookName(rawBook);
      if (!normalizedBook) continue;

      const chapter = parseInt(match[2], 10);
      const verse   = parseInt(match[3], 10);
      // Range end may appear in group 4 OR group 5 depending on which alt matched
      const rangeEnd = match[4] ? parseInt(match[4], 10)
                     : match[5] ? parseInt(match[5], 10)
                     : undefined;

      const reference = rangeEnd
        ? `${normalizedBook} ${chapter}:${verse}-${rangeEnd}`
        : `${normalizedBook} ${chapter}:${verse}`;

      if (seen.has(reference)) continue;
      seen.add(reference);
      results.push({
        book: normalizedBook, chapter, verse, verseEnd: rangeEnd,
        reference, isPartial: false, rawMatch: match[0],
      });
    }
  }

  // Partial patterns (chapter only)
  const partialPatterns = [
    new RegExp(`(${BOOK_PATTERN})\\s+chapter\\s+(\\d+)`, "gi"),
    new RegExp(`(${BOOK_PATTERN})\\s+(\\d+)(?!\\s*[:\\d])`, "gi"),
  ];

  for (const pattern of partialPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(transcript)) !== null) {
      const rawBook = match[1];
      const chapter = parseInt(match[2], 10);
      const normalizedBook = normalizeBookName(rawBook);
      if (!normalizedBook) continue;
      const alreadyCovered = results.some(
        (r) => r.book === normalizedBook && r.chapter === chapter && !r.isPartial
      );
      if (alreadyCovered) continue;
      const reference = `${normalizedBook} ${chapter}`;
      if (seen.has(reference)) continue;
      seen.add(reference);
      results.push({
        book: normalizedBook, chapter, verse: null,
        reference, isPartial: true, rawMatch: match[0],
      });
    }
  }

  return results;
}
