import { getDb } from "@/lib/db/client";

export function jobIsPrepared(jobId: number): boolean {
  const db = getDb();
  const job = db
    .prepare("SELECT book_id FROM jobs WHERE id = ?")
    .get(jobId) as { book_id: number | null } | undefined;
  if (!job?.book_id) return false;
  const chapters = db
    .prepare("SELECT COUNT(*) AS n FROM chapters WHERE job_id = ?")
    .get(jobId) as { n: number };
  return chapters.n > 0;
}
