import { extractPdfText } from "@/lib/pdf/extract";
import { upsertBook, computeFingerprint } from "@/lib/book/fingerprint";
import { splitChapters } from "@/lib/pdf/chapters";
import { getDb } from "@/lib/db/client";

export async function prepareJobFromUpload(input: {
  jobId: number;
  pdfBuffer: Buffer;
  email: string;
  voicePath: string | null;
  title: string;
  author: string | null;
}): Promise<number> {
  const extracted = await extractPdfText(input.pdfBuffer);
  const title = input.title || extracted.metadata.title || "Untitled";
  const author = input.author ?? extracted.metadata.author ?? null;
  const fingerprint = computeFingerprint(title, extracted.text);

  const bookId = upsertBook({
    title,
    author,
    fingerprint,
    wordCount: extracted.wordCount,
    pageCount: extracted.metadata.pages,
  });

  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO jobs (id, book_id, email, custom_voice_path, status)
     VALUES (?, ?, ?, ?, 'queued')`,
  ).run(input.jobId, bookId, input.email, input.voicePath);

  const chapters = splitChapters(extracted.text);
  db.prepare("DELETE FROM chapters WHERE job_id = ?").run(input.jobId);
  const insertChapter = db.prepare(
    `INSERT INTO chapters (job_id, idx, title, text) VALUES (?, ?, ?, ?)`,
  );
  chapters.forEach((ch, idx) => {
    insertChapter.run(input.jobId, idx, ch.title, ch.rawText);
  });

  return input.jobId;
}
