import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("jobIsPrepared", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-ready-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is true only when the job has a book and chapters", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const { jobIsPrepared } = await import("@/lib/pipeline/jobReady");
    const bookId = upsertBook({
      title: "Original",
      author: null,
      fingerprint: "abc",
      pageCount: 1,
      wordCount: 800,
    });
    const db = getDb();
    const prepared = db
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, 'queued')",
      )
      .run(bookId, "a@b.com");
    const preparedId = Number(prepared.lastInsertRowid);
    expect(jobIsPrepared(preparedId)).toBe(false);
    db.prepare(
      "INSERT INTO chapters (job_id, idx, title, text) VALUES (?, 0, 'Chapter 1', 'Hello.')",
    ).run(preparedId);
    expect(jobIsPrepared(preparedId)).toBe(true);
  });
});
