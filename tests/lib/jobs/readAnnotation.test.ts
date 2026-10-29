import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("readAnnotation", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-read-annotation-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds annotation view for in-progress and finished section review", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const { readAnnotation } = await import("@/lib/jobs/readAnnotation");

    const bookId = upsertBook({
      title: "The Book",
      author: "Author",
      fingerprint: "fp-read-annotation",
      pageCount: 42,
      wordCount: 100,
    });

    const job = getDb()
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, ?)",
      )
      .run(bookId, "a@b.com", "annotating");
    const jobId = Number(job.lastInsertRowid);

    getDb()
      .prepare(
        "INSERT INTO chapters (job_id, idx, title, text, reviewed) VALUES (?, 0, ?, ?, 0)",
      )
      .run(jobId, "Chapter I", "One.\n\nTwo.");

    getDb()
      .prepare(
        `INSERT INTO character_maps
         (book_id, name, aliases_json, role, speaks, gender_presentation, age_impression,
          tonality_json, confidence, source, mode, speaker_index, voice_id)
         VALUES (?, ?, '', '', 1, '', '', '[]', 1, 'test', 'text_sample', 0, 'v')`,
      )
      .run(bookId, "Nick");

    getDb()
      .prepare(
        `INSERT INTO segments (job_id, chapter_idx, paragraph_idx, annotated_text)
         VALUES (?, 0, 0, ?)`,
      )
      .run(jobId, "<|speaker:0|>One [pause]<|speaker:1|>line");

    let view = readAnnotation(jobId);
    expect(view?.currentSection).toBe(1);
    expect(view?.sections).toEqual([]);
    expect(view?.characters).toEqual([{ name: "Nick", speakerIndex: 0 }]);

    getDb()
      .prepare(
        `INSERT INTO segments (job_id, chapter_idx, paragraph_idx, annotated_text)
         VALUES (?, 0, 1, ?)`,
      )
      .run(jobId, "<|speaker:1|>Two");

    getDb().prepare("UPDATE jobs SET status = ? WHERE id = ?").run("awaiting_annotation", jobId);
    getDb().prepare("UPDATE chapters SET reviewed = 1 WHERE job_id = ?").run(jobId);

    view = readAnnotation(jobId);
    expect(view?.currentSection).toBeNull();
    expect(view?.sections).toEqual([
      {
        n: 1,
        title: "Chapter I",
        reviewed: true,
        messages: [
          { paragraphIdx: 0, turnIdx: 0, speakerIndex: 0, speakerName: "Nick", text: "One [pause]" },
          { paragraphIdx: 0, turnIdx: 1, speakerIndex: 1, speakerName: "Speaker 1", text: "line" },
          { paragraphIdx: 1, turnIdx: 0, speakerIndex: 1, speakerName: "Speaker 1", text: "Two" },
        ],
      },
    ]);
  });
});
