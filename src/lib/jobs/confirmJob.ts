import { canConfirm } from "@/lib/book/confirmRules";
import { getBook, updateBookMeta } from "@/lib/book/meta";
import { getDb } from "@/lib/db/client";
import { readJobStatus, writeJobStatus } from "@/lib/jobs/statusFile";
import { spawnJobRunner } from "@/lib/jobs/spawnRunner";

export function confirmJob(
  jobId: number,
  input: { title: string; author: string | null; pageCount: number },
  spawn: (jobId: number) => void = spawnJobRunner,
): { ok: true } | { ok: false; status: number; error: string } {
  const job = getDb()
    .prepare("SELECT book_id, status FROM jobs WHERE id = ?")
    .get(jobId) as { book_id: number | null; status: string } | undefined;
  if (!job?.book_id) return { ok: false, status: 404, error: "Job not found" };
  const book = getBook(job.book_id);
  if (!book) return { ok: false, status: 404, error: "Book not found" };
  const gate = canConfirm({
    jobStatus: job.status,
    researchedAt: book.researchedAt,
    title: input.title,
    author: input.author,
    pageCount: input.pageCount,
  });
  if (!gate.ok) {
    const status = gate.reason === "Job is not awaiting review" || gate.reason === "Book research is not ready" ? 409 : 400;
    return { ok: false, status, error: gate.reason };
  }
  updateBookMeta(job.book_id, gate);
  getDb().prepare("UPDATE jobs SET status = 'queued', error = NULL WHERE id = ?").run(jobId);
  const current = readJobStatus(jobId);
  if (current) writeJobStatus({ ...current, status: "queued", error: null });
  try {
    spawn(jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    getDb().prepare("UPDATE jobs SET status = 'failed', error = ? WHERE id = ?").run(message, jobId);
    if (current) writeJobStatus({ ...current, status: "failed", error: message });
    return { ok: false, status: 500, error: message };
  }
  return { ok: true };
}
