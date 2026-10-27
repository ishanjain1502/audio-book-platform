import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "@/lib/storage/local";

describe("ingestUploadedBook", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-ingest-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates an awaiting_review job and keeps saved meta on a second upload", async () => {
    const { ingestUploadedBook } = await import("@/lib/pipeline/ingestUpload");
    const { getBook } = await import("@/lib/book/meta");
    const { getDb } = await import("@/lib/db/client");
    const { readJobStatus } = await import("@/lib/jobs/statusFile");
    const storage = new LocalStorage(path.join(tmpDir, "objects"));
    const first = await ingestUploadedBook({
      pdfBuffer: Buffer.from("first-pdf"),
      email: "a@b.com",
      voice: null,
      title: "Original",
      author: "Ada",
      fullText: "Hello there.",
      wordCount: 2,
      pageCount: 4,
      chapters: [{ title: "Chapter 1", rawText: "Hello there." }],
      storage,
    });
    const second = await ingestUploadedBook({
      pdfBuffer: Buffer.from("second-pdf"),
      email: "c@d.com",
      voice: { buffer: Buffer.from("voice"), extension: ".mp3" },
      title: "Original",
      author: "Ada",
      fullText: "Hello there.",
      wordCount: 2,
      pageCount: 9,
      chapters: [{ title: "Chapter 1", rawText: "Hello there." }],
      storage,
    });
    expect(second.bookId).toBe(first.bookId);
    expect(second.jobId).not.toBe(first.jobId);
    const book = getBook(first.bookId);
    expect(book?.title).toBe("Original");
    expect(book?.author).toBe("Ada");
    expect(book?.pageCount).toBe(4);
    expect((await storage.getBuffer(`books/${first.bookId}/source.pdf`)).toString()).toBe(
      "first-pdf",
    );
    const db = getDb();
    const jobs = db
      .prepare("SELECT id, status, custom_voice_path FROM jobs ORDER BY id")
      .all() as { id: number; status: string; custom_voice_path: string | null }[];
    expect(jobs.map((job) => job.status)).toEqual(["awaiting_review", "awaiting_review"]);
    expect(jobs[1].custom_voice_path).toBeTruthy();
    expect(readJobStatus(first.jobId)?.status).toBe("awaiting_review");
    const chapterCount = db
      .prepare("SELECT COUNT(*) AS n FROM chapters WHERE job_id = ?")
      .get(first.jobId) as { n: number };
    expect(chapterCount.n).toBe(1);
  });
});
