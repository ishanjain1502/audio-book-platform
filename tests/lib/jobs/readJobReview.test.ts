import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("readJobReview", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-review-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns saved meta and an idle research status", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const { readJobReview } = await import("@/lib/jobs/readJobReview");
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
    const review = readJobReview(Number(job.lastInsertRowid));
    expect(review).toMatchObject({
      bookId,
      title: "Original",
      author: "Ada",
      pageCount: 10,
      researchStatus: "idle",
      researchMode: null,
      researchError: null,
      characters: [],
    });
  });
});
