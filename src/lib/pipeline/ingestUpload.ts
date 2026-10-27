import fs from "fs";
import path from "path";
import { computeFingerprint, upsertBook } from "@/lib/book/fingerprint";
import { getDb } from "@/lib/db/client";
import { allocateJobId, jobDir, writeJobStatus } from "@/lib/jobs/statusFile";
import { storeBookPdf } from "@/lib/pipeline/storeBookPdf";
import type { Storage } from "@/lib/storage/types";

export async function ingestUploadedBook(input: {
  pdfBuffer: Buffer;
  email: string;
  voice: { buffer: Buffer; extension: ".wav" | ".mp3" } | null;
  title: string;
  author: string | null;
  fullText: string;
  wordCount: number;
  pageCount: number;
  chapters: { title: string; rawText: string }[];
  storage: Storage;
}): Promise<{ jobId: number; bookId: number }> {
  const fingerprint = computeFingerprint(input.title, input.fullText);
  const bookId = upsertBook({
    title: input.title,
    author: input.author,
    fingerprint,
    wordCount: input.wordCount,
    pageCount: input.pageCount,
  });
  await storeBookPdf(bookId, input.pdfBuffer, input.storage);

  const jobId = allocateJobId();
  const dir = jobDir(jobId);
  fs.mkdirSync(dir, { recursive: true });
  let voicePath: string | null = null;
  if (input.voice) {
    voicePath = path.join(dir, `voice${input.voice.extension}`);
    fs.writeFileSync(voicePath, input.voice.buffer);
  }

  const db = getDb();
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO jobs (id, book_id, email, custom_voice_path, status)
       VALUES (?, ?, ?, ?, 'awaiting_review')`,
    ).run(jobId, bookId, input.email, voicePath);
    const insertChapter = db.prepare(
      "INSERT INTO chapters (job_id, idx, title, text) VALUES (?, ?, ?, ?)",
    );
    input.chapters.forEach((chapter, idx) => {
      insertChapter.run(jobId, idx, chapter.title, chapter.rawText);
    });
  });
  write();

  writeJobStatus({
    id: jobId,
    status: "awaiting_review",
    email: input.email,
    progress: 0,
    chapters: input.chapters.map((chapter, idx) => ({
      idx,
      title: chapter.title,
      ready: false,
    })),
  });

  return { jobId, bookId };
}
