import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/research/characterMap", () => ({
  buildCharacterMap: vi.fn(),
}));
vi.mock("@/lib/fish/cloneVoice", () => ({
  cloneVoiceFromFile: vi.fn(),
}));
vi.mock("@/lib/annotate/queue", () => ({
  annotateParagraphsParallel: vi.fn(async () => [{ annotated: "Hello." }]),
}));
vi.mock("@/lib/fish/queue", () => ({
  synthesizeJobsParallel: vi.fn(async () => undefined),
}));
vi.mock("@/lib/audio/stitch", () => ({
  stitchMp3Files: vi.fn(),
}));
vi.mock("@/lib/notify/emailStub", () => ({
  sendEmailStub: vi.fn(),
}));

describe("runJob cached research", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-run-"));
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

  it("does not call research when a character map is saved", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { saveCharacterMaps } = await import("@/lib/book/characterMapsDb");
    const { getDb } = await import("@/lib/db/client");
    const { buildCharacterMap } = await import("@/lib/research/characterMap");
    const { runJob } = await import("@/lib/pipeline/runJob");
    const bookId = upsertBook({
      title: "Original",
      author: "Ada",
      fingerprint: "abc",
      pageCount: 1,
      wordCount: 800,
    });
    saveCharacterMaps(
      bookId,
      [
        {
          name: "Narrator",
          aliases: [],
          role: "narrator",
          speaks: true,
          gender_presentation: null,
          age_impression: "adult",
          tonality: ["calm"],
          confidence: 0.9,
          source: "text",
          speaker_index: 0,
          voice_id: "voice-narrator",
        },
      ],
      "text_sample",
    );
    const job = getDb()
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, 'queued')",
      )
      .run(bookId, "a@b.com");
    const jobId = Number(job.lastInsertRowid);
    getDb()
      .prepare("INSERT INTO chapters (job_id, idx, title, text) VALUES (?, 0, 'Chapter 1', ?)")
      .run(jobId, "Hello.");
    await runJob(jobId);
    expect(buildCharacterMap).not.toHaveBeenCalled();
  });
});
