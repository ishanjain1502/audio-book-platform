import { getBook } from "@/lib/book/meta";
import { deriveResearchStatus, RESEARCH_LOCK_MS } from "@/lib/book/researchStatus";
import { loadCharacterMaps, saveCharacterMaps } from "@/lib/book/characterMapsDb";
import { getDb } from "@/lib/db/client";
import { buildCharacterMap } from "@/lib/research/characterMap";
import { toCharacterSummaries, type CharacterSummary } from "@/lib/research/summary";
import { assignVoices } from "@/lib/voices/assign";

export type EnsureResearchResult =
  | { status: "ready"; characters: CharacterSummary[]; researchMode: string | null }
  | { status: "running" }
  | { status: "failed"; error: string };

function readyResult(bookId: number, researchMode: string | null): EnsureResearchResult {
  const saved = loadCharacterMaps(bookId) ?? [];
  return {
    status: "ready",
    characters: toCharacterSummaries(saved),
    researchMode,
  };
}

export async function ensureBookResearch(
  jobId: number,
  now: Date = new Date(),
): Promise<EnsureResearchResult> {
  const db = getDb();
  const job = db
    .prepare("SELECT book_id FROM jobs WHERE id = ?")
    .get(jobId) as { book_id: number | null } | undefined;
  if (!job?.book_id) return { status: "failed", error: "Missing book" };
  const book = getBook(job.book_id);
  if (!book) return { status: "failed", error: "Missing book" };

  const status = deriveResearchStatus(book, now);
  if (status === "ready") return readyResult(book.id, book.researchMode);
  if (status === "running") return { status: "running" };

  const staleBefore = new Date(now.getTime() - RESEARCH_LOCK_MS).toISOString();
  const lock = db
    .prepare(
      `UPDATE books
       SET research_started_at = ?, research_error = NULL
       WHERE id = ?
         AND researched_at IS NULL
         AND (research_started_at IS NULL OR research_started_at <= ?)`,
    )
    .run(now.toISOString(), book.id, staleBefore);
  if (lock.changes === 0) return { status: "running" };

  try {
    const chapters = db
      .prepare("SELECT text FROM chapters WHERE job_id = ? ORDER BY idx")
      .all(jobId) as { text: string }[];
    const map = await buildCharacterMap({
      title: book.title ?? "Untitled",
      author: book.author ?? "Unknown",
      fullText: chapters.map((chapter) => chapter.text).join("\n\n"),
    });
    const assigned = assignVoices(map.characters, null);
    saveCharacterMaps(book.id, assigned, map.mode);
    db.prepare(
      `UPDATE books
       SET researched_at = ?, research_mode = ?, research_started_at = NULL, research_error = NULL
       WHERE id = ?`,
    ).run(now.toISOString(), map.mode, book.id);
    return readyResult(book.id, map.mode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE books SET research_started_at = NULL, research_error = ? WHERE id = ?`,
    ).run(message, book.id);
    return { status: "failed", error: message };
  }
}
