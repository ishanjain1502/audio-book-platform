import { getBook, parseBookMeta, updateBookMeta, BookMetaError } from "@/lib/book/meta";
import { getDb } from "@/lib/db/client";

export function updateJobBook(
  jobId: number,
  input: { title: string; author: string | null; pageCount: number },
): { ok: true } | { ok: false; status: number; error: string } {
  try {
    const meta = parseBookMeta(input);
    const job = getDb()
      .prepare("SELECT book_id, status FROM jobs WHERE id = ?")
      .get(jobId) as { book_id: number | null; status: string } | undefined;
    if (!job?.book_id) return { ok: false, status: 404, error: "Job not found" };
    if (job.status !== "awaiting_review") {
      return { ok: false, status: 409, error: "Job is not awaiting review" };
    }
    if (!getBook(job.book_id)) return { ok: false, status: 404, error: "Book not found" };
    updateBookMeta(job.book_id, meta);
    return { ok: true };
  } catch (err) {
    if (err instanceof BookMetaError) {
      return { ok: false, status: err.statusCode, error: err.message };
    }
    throw err;
  }
}
