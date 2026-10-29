import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("runAnnotation", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-run-annotation-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips complete sections and annotates the rest", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const { runAnnotation } = await import("@/lib/pipeline/runAnnotation");

    const bookId = upsertBook({
      title: "The Book",
      author: "Author",
      fingerprint: "fp-run-annotation",
      pageCount: 42,
      wordCount: 100,
    });
    getDb()
      .prepare("UPDATE books SET researched_at = ? WHERE id = ?")
      .run("2026-10-27T11:00:00.000Z", bookId);

    const job = getDb()
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, ?)",
      )
      .run(bookId, "a@b.com", "annotating");
    const jobId = Number(job.lastInsertRowid);

    getDb()
      .prepare(
        "INSERT INTO chapters (job_id, idx, title, text, reviewed) VALUES (?, 0, ?, ?, 1)",
      )
      .run(jobId, "Done ch", "Done.");
    getDb()
      .prepare(
        "INSERT INTO chapters (job_id, idx, title, text, reviewed) VALUES (?, 1, ?, ?, 0)",
      )
      .run(jobId, "Next ch", "Next.");

    getDb()
      .prepare(
        `INSERT INTO character_maps
         (book_id, name, aliases_json, role, speaks, gender_presentation, age_impression,
          tonality_json, confidence, source, mode, speaker_index, voice_id)
         VALUES (?, ?, '[]', 'narrator', 1, '', '', '[]', 1, 'test', 'text_sample', 0, 'v-narrator')`,
      )
      .run(bookId, "Narrator");

    getDb()
      .prepare(
        `INSERT INTO segments (job_id, chapter_idx, paragraph_idx, annotated_text, status)
         VALUES (?, 0, 0, ?, 'annotated')`,
      )
      .run(jobId, "<|speaker:0|>Done");

    const annotate = vi.fn(async () => [
      { annotated: "<|speaker:0|>Next", speakersUsed: [0] },
    ]);

    await runAnnotation(jobId, undefined, annotate);

    expect(annotate).toHaveBeenCalledTimes(1);

    const ch0Seg = getDb()
      .prepare(
        "SELECT annotated_text FROM segments WHERE job_id = ? AND chapter_idx = 0 AND paragraph_idx = 0",
      )
      .get(jobId) as { annotated_text: string };
    expect(ch0Seg.annotated_text).toBe("<|speaker:0|>Done");

    const ch0Reviewed = getDb()
      .prepare("SELECT reviewed FROM chapters WHERE job_id = ? AND idx = 0")
      .get(jobId) as { reviewed: number };
    expect(ch0Reviewed.reviewed).toBe(1);

    const ch1Seg = getDb()
      .prepare(
        "SELECT annotated_text FROM segments WHERE job_id = ? AND chapter_idx = 1 AND paragraph_idx = 0",
      )
      .get(jobId) as { annotated_text: string };
    expect(ch1Seg.annotated_text).toBe("<|speaker:0|>Next");

    const jobRow = getDb()
      .prepare("SELECT status FROM jobs WHERE id = ?")
      .get(jobId) as { status: string };
    expect(jobRow.status).toBe("awaiting_annotation");
  });
});
