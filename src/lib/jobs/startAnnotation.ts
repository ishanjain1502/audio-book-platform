import { sectionIsComplete } from "@/lib/annotate/sectionReady";
import { canConfirm } from "@/lib/book/confirmRules";
import { getBook, normalizeAuthor, updateBookMeta } from "@/lib/book/meta";
import { getDb } from "@/lib/db/client";
import { readJobStatus, writeJobStatus } from "@/lib/jobs/statusFile";
import { spawnJobRunner } from "@/lib/jobs/spawnRunner";
import { splitIntoParagraphs } from "@/lib/pdf/chapters";

function setAnnotating(jobId: number): void {
  getDb().prepare("UPDATE jobs SET status = 'annotating', error = NULL WHERE id = ?").run(jobId);
  const current = readJobStatus(jobId);
  if (current) writeJobStatus({ ...current, status: "annotating", error: null });
}

function deleteSegmentsForIncompleteChapters(jobId: number): void {
  const chapters = getDb()
    .prepare("SELECT idx, text FROM chapters WHERE job_id = ? ORDER BY idx")
    .all(jobId) as { idx: number; text: string }[];

  const segmentCountStmt = getDb().prepare(
    "SELECT COUNT(*) AS c FROM segments WHERE job_id = ? AND chapter_idx = ?",
  );
  const deleteStmt = getDb().prepare(
    "DELETE FROM segments WHERE job_id = ? AND chapter_idx = ?",
  );

  for (const chapter of chapters) {
    const paragraphCount = splitIntoParagraphs(chapter.text).length;
    const segmentCount = (segmentCountStmt.get(jobId, chapter.idx) as { c: number }).c;
    if (!sectionIsComplete(paragraphCount, segmentCount)) {
      deleteStmt.run(jobId, chapter.idx);
    }
  }
}

export function startAnnotation(
  jobId: number,
  input: { title: string; author: string | null; pageCount: number },
  spawn: (jobId: number, mode: "annotate") => void = spawnJobRunner,
): { ok: true } | { ok: false; status: number; error: string } {
  const job = getDb()
    .prepare("SELECT book_id, status FROM jobs WHERE id = ?")
    .get(jobId) as { book_id: number | null; status: string } | undefined;
  if (!job?.book_id) return { ok: false, status: 404, error: "Job not found" };
  const book = getBook(job.book_id);
  if (!book) return { ok: false, status: 404, error: "Book not found" };

  if (job.status === "annotating" || job.status === "awaiting_annotation") {
    return { ok: false, status: 409, error: "Annotation already started" };
  }

  const current = readJobStatus(jobId);

  if (job.status === "awaiting_review") {
    const gate = canConfirm({
      jobStatus: job.status,
      researchedAt: book.researchedAt,
      title: input.title,
      author: input.author,
      pageCount: input.pageCount,
    });
    if (!gate.ok) {
      const status =
        gate.reason === "Job is not awaiting review" ||
        gate.reason === "Book research is not ready"
          ? 409
          : 400;
      return { ok: false, status, error: gate.reason };
    }
    updateBookMeta(job.book_id, gate);
    setAnnotating(jobId);
    try {
      spawn(jobId, "annotate");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getDb().prepare("UPDATE jobs SET status = 'failed', error = ? WHERE id = ?").run(message, jobId);
      if (current) writeJobStatus({ ...current, status: "failed", error: message });
      return { ok: false, status: 500, error: message };
    }
    return { ok: true };
  }

  if (job.status === "failed") {
    if (!book.researchedAt) {
      return { ok: false, status: 409, error: "Book research is not ready" };
    }
    const title = input.title.trim();
    if (!title) return { ok: false, status: 400, error: "Title is required" };
    if (!Number.isInteger(input.pageCount) || input.pageCount < 1) {
      return { ok: false, status: 400, error: "Page count must be a positive integer" };
    }
    updateBookMeta(job.book_id, {
      title,
      author: normalizeAuthor(input.author),
      pageCount: input.pageCount,
    });
    deleteSegmentsForIncompleteChapters(jobId);
    setAnnotating(jobId);
    try {
      spawn(jobId, "annotate");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getDb().prepare("UPDATE jobs SET status = 'failed', error = ? WHERE id = ?").run(message, jobId);
      if (current) writeJobStatus({ ...current, status: "failed", error: message });
      return { ok: false, status: 500, error: message };
    }
    return { ok: true };
  }

  return { ok: false, status: 409, error: "Annotation cannot start" };
}
