import { Router, type IRouter } from "express";
import { extractVersesWithAI } from "../lib/groq";
import { DetectVersesBody, DetectVersesResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/verses/detect", async (req, res): Promise<void> => {
  const parsed = DetectVersesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { transcript, knownRefs = [] } = parsed.data;

  if (!transcript.trim()) {
    res.json(DetectVersesResponse.parse({ verses: [], latencyMs: 0 }));
    return;
  }

  const start = Date.now();

  try {
    const verses = await extractVersesWithAI(transcript, knownRefs);
    const latencyMs = Date.now() - start;

    req.log.info({ count: verses.length, latencyMs }, "Verses detected");

    res.json(
      DetectVersesResponse.parse({
        verses: verses.map((v) => ({
          book: v.book,
          chapter: v.chapter,
          verse: v.verse ?? null,
          reference: v.reference,
          verseText: null,
          isPartial: v.isPartial,
        })),
        latencyMs,
      })
    );
  } catch (err) {
    req.log.error({ err }, "Verse detection failed");
    res.status(500).json({ error: "Verse detection failed" });
  }
});

export default router;
