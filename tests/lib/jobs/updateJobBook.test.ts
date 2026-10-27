import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("updateJobBook", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-edit-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("updates meta for an awaiting_review job and leaves the fingerprint", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const { getBook } = await import("@/lib/book/meta");
    const { updateJobBook } = await import("@/lib/jobs/updateJobBook");
    const bookId = upsertBook({
      title: "Original",
      author: "Ada",
      fingerprint: "abc",
      pageCount: 10,
      wordCount: 800,
    });
    const job = getDb()
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, 'awaiting_review')",
      )
      .run(bookId, "a@b.com");
    const result = updateJobBook(Number(job.lastInsertRowid), {
      title: "Renamed",
      author: "",
      pageCount: 11,
    });
    expect(result).toEqual({ ok: true });
    const book = getBook(bookId);
    expect(book?.title).toBe("Renamed");
    expect(book?.author).toBeNull();
    expect(book?.pageCount).toBe(11);
    expect(book?.fingerprint).toBe("abc");
  });
});
