import { canGenerateAudiobook } from "@/lib/book/confirmRules";
import { sectionIsComplete } from "@/lib/annotate/sectionReady";
import { getBook, updateBookMeta } from "@/lib/book/meta";
import { getDb } from "@/lib/db/client";
import { readJobStatus, writeJobStatus } from "@/lib/jobs/statusFile";
import { spawnJobRunner } from "@/lib/jobs/spawnRunner";
import { splitIntoParagraphs } from "@/lib/pdf/chapters";

function annotationReadiness(jobId: number): {
  sectionsComplete: boolean;
  allReviewed: boolean;
} {
  const chapters = getDb()
    .prepare("SELECT idx, text, reviewed FROM chapters WHERE job_id = ? ORDER BY idx")
    .all(jobId) as { idx: number; text: string; reviewed: number }[];

  if (chapters.length === 0) {
    return { sectionsComplete: false, allReviewed: false };
  }

  const segmentCountStmt = getDb().prepare(
    "SELECT COUNT(*) AS c FROM segments WHERE job_id = ? AND chapter_idx = ?",
  );

  let sectionsComplete = true;
  let allReviewed = true;
  for (const chapter of chapters) {
    const paragraphCount = splitIntoParagraphs(chapter.text).length;
    const segmentCount = (segmentCountStmt.get(jobId, chapter.idx) as { c: number }).c;
    if (!sectionIsComplete(paragraphCount, segmentCount)) {
      sectionsComplete = false;
    }
    if (chapter.reviewed !== 1) {
      allReviewed = false;
    }
  }
  return { sectionsComplete, allReviewed };
}

export function confirmJob(
  jobId: number,
  input: { title: string; author: string | null; pageCount: number },
  spawn: (jobId: number, mode: "synthesize") => void = spawnJobRunner,
): { ok: true } | { ok: false; status: number; error: string } {
  const job = getDb()
    .prepare("SELECT book_id, status FROM jobs WHERE id = ?")
    .get(jobId) as { book_id: number | null; status: string } | undefined;
  if (!job?.book_id) return { ok: false, status: 404, error: "Job not found" };
  const book = getBook(job.book_id);
  if (!book) return { ok: false, status: 404, error: "Book not found" };

  const { sectionsComplete, allReviewed } = annotationReadiness(jobId);
  const gate = canGenerateAudiobook({
    jobStatus: job.status,
    title: input.title,
    author: input.author,
    pageCount: input.pageCount,
    sectionsComplete,
    allReviewed,
  });
  if (!gate.ok) {
    const status =
      gate.reason === "Annotation is not ready" ||
      gate.reason === "Every section must be checked"
        ? 409
        : 400;
    return { ok: false, status, error: gate.reason };
  }
  updateBookMeta(job.book_id, gate);
  getDb().prepare("UPDATE jobs SET status = 'queued', error = NULL WHERE id = ?").run(jobId);
  const current = readJobStatus(jobId);
  if (current) writeJobStatus({ ...current, status: "queued", error: null });
  try {
    spawn(jobId, "synthesize");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    getDb().prepare("UPDATE jobs SET status = 'failed', error = ? WHERE id = ?").run(message, jobId);
    if (current) writeJobStatus({ ...current, status: "failed", error: message });
    return { ok: false, status: 500, error: message };
  }
  return { ok: true };
}
