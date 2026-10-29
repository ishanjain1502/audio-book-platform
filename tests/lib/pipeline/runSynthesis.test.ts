import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fish/cloneVoice", () => ({
  cloneVoiceFromFile: vi.fn(),
}));
vi.mock("@/lib/fish/queue", () => ({
  synthesizeJobsParallel: vi.fn(async () => undefined),
}));

describe("runSynthesis", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-run-synthesis-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws and leaves job failed when character map is missing and no custom voice", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const { runSynthesis } = await import("@/lib/pipeline/runSynthesis");
    const { cloneVoiceFromFile } = await import("@/lib/fish/cloneVoice");
    const { synthesizeJobsParallel } = await import("@/lib/fish/queue");

    const bookId = upsertBook({
      title: "The Book",
      author: "Author",
      fingerprint: "fp-run-synthesis",
      pageCount: 42,
      wordCount: 100,
    });

    const job = getDb()
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, ?)",
      )
      .run(bookId, "a@b.com", "queued");
    const jobId = Number(job.lastInsertRowid);

    getDb()
      .prepare(
        "INSERT INTO chapters (job_id, idx, title, text, reviewed) VALUES (?, 0, ?, ?, 1)",
      )
      .run(jobId, "Ch", "Hello.");

    await expect(runSynthesis(jobId)).rejects.toThrow(
      "Character map is missing",
    );

    const jobRow = getDb()
      .prepare("SELECT status FROM jobs WHERE id = ?")
      .get(jobId) as { status: string };
    expect(jobRow.status).toBe("failed");
    expect(cloneVoiceFromFile).not.toHaveBeenCalled();
    expect(synthesizeJobsParallel).not.toHaveBeenCalled();
  });
});
