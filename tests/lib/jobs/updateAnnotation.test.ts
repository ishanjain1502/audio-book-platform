import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("updateAnnotation", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-update-annotation-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves speaker edits and section review flags during annotation review", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");

    const bookId = upsertBook({
      title: "The Book",
      author: "Author",
      fingerprint: "fp-update-annotation",
      pageCount: 42,
      wordCount: 100,
    });

    const job = getDb()
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, ?)",
      )
      .run(bookId, "a@b.com", "awaiting_annotation");
    const jobId = Number(job.lastInsertRowid);

    getDb()
      .prepare(
        "INSERT INTO chapters (job_id, idx, title, text, reviewed) VALUES (?, 0, ?, ?, 0)",
      )
      .run(jobId, "Chapter I", "One.");

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
        `INSERT INTO character_maps
         (book_id, name, aliases_json, role, speaks, gender_presentation, age_impression,
          tonality_json, confidence, source, mode, speaker_index, voice_id)
         VALUES (?, ?, '', '', 1, '', '', '[]', 1, 'test', 'text_sample', 1, 'v')`,
      )
      .run(bookId, "Daisy");

    getDb()
      .prepare(
        `INSERT INTO segments (job_id, chapter_idx, paragraph_idx, annotated_text)
         VALUES (?, 0, 0, ?)`,
      )
      .run(jobId, "<|speaker:0|>One [pause]");

    const { setTurnSpeaker, setSectionReviewed } = await import("@/lib/jobs/updateAnnotation");

    expect(setTurnSpeaker(jobId, { chapterIdx: 0, paragraphIdx: 0, turnIdx: 0, speakerIndex: 1 }))
      .toEqual({ ok: true, speakerIndex: 1, speakerName: "Daisy" });

    const segmentAfterEdit = getDb()
      .prepare(
        "SELECT annotated_text FROM segments WHERE job_id = ? AND chapter_idx = 0 AND paragraph_idx = 0",
      )
      .get(jobId) as { annotated_text: string };
    expect(segmentAfterEdit.annotated_text).toBe("<|speaker:1|>One [pause]");

    expect(setTurnSpeaker(jobId, { chapterIdx: 0, paragraphIdx: 0, turnIdx: 0, speakerIndex: 9 }))
      .toEqual({ ok: false, status: 400, error: "Unknown speaker" });

    const segmentAfterBadSpeaker = getDb()
      .prepare(
        "SELECT annotated_text FROM segments WHERE job_id = ? AND chapter_idx = 0 AND paragraph_idx = 0",
      )
      .get(jobId) as { annotated_text: string };
    expect(segmentAfterBadSpeaker.annotated_text).toBe("<|speaker:1|>One [pause]");

    expect(setSectionReviewed(jobId, 0, true)).toEqual({ ok: true, reviewed: true });

    const chapter = getDb()
      .prepare("SELECT reviewed FROM chapters WHERE job_id = ? AND idx = 0")
      .get(jobId) as { reviewed: number };
    expect(chapter.reviewed).toBe(1);

    getDb().prepare("UPDATE jobs SET status = ? WHERE id = ?").run("queued", jobId);
    expect(setSectionReviewed(jobId, 0, true)).toEqual({
      ok: false,
      status: 409,
      error: "Annotation is not open for review",
    });
  });

  it("replaces a paragraph's lines and rejects writes that must not stick", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const bookId = upsertBook({
      title: "The Book",
      author: "Author",
      fingerprint: "fp-replace-paragraph",
      pageCount: 42,
      wordCount: 100,
    });
    const job = getDb()
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, ?)",
      )
      .run(bookId, "a@b.com", "awaiting_annotation");
    const jobId = Number(job.lastInsertRowid);
    getDb()
      .prepare(
        "INSERT INTO chapters (job_id, idx, title, text, reviewed) VALUES (?, 0, ?, ?, 0)",
      )
      .run(jobId, "Chapter I", "One.");
    for (const [name, speakerIndex] of [
      ["Nick", 0],
      ["Daisy", 1],
    ] as const) {
      getDb()
        .prepare(
          `INSERT INTO character_maps
         (book_id, name, aliases_json, role, speaks, gender_presentation, age_impression,
          tonality_json, confidence, source, mode, speaker_index, voice_id)
         VALUES (?, ?, '', '', 1, '', '', '[]', 1, 'test', 'text_sample', ?, 'v')`,
        )
        .run(bookId, name, speakerIndex);
    }
    getDb()
      .prepare(
        `INSERT INTO segments (job_id, chapter_idx, paragraph_idx, annotated_text)
       VALUES (?, 0, 0, ?)`,
      )
      .run(jobId, "<|speaker:0|>One [pause]");

    const { replaceParagraphTurns } = await import("@/lib/jobs/updateAnnotation");
    const stored = () =>
      (
        getDb()
          .prepare(
            "SELECT annotated_text FROM segments WHERE job_id = ? AND chapter_idx = 0 AND paragraph_idx = 0",
          )
          .get(jobId) as { annotated_text: string }
      ).annotated_text;

    expect(
      replaceParagraphTurns(jobId, {
        chapterIdx: 0,
        paragraphIdx: 0,
        turns: [
          { speakerIndex: 0, text: "One [pause]" },
          { speakerIndex: 1, text: "  " },
        ],
      }),
    ).toEqual({
      ok: true,
      paragraphIdx: 0,
      turns: [
        { turnIdx: 0, speakerIndex: 0, speakerName: "Nick", text: "One [pause]" },
        { turnIdx: 1, speakerIndex: 1, speakerName: "Daisy", text: "  " },
      ],
    });
    expect(stored()).toBe("<|speaker:0|>One [pause]<|speaker:1|>  ");
    expect(
      (getDb().prepare("SELECT COUNT(*) AS c FROM segments WHERE job_id = ?").get(jobId) as { c: number }).c,
    ).toBe(1);
    expect(
      (getDb().prepare("SELECT reviewed FROM chapters WHERE job_id = ? AND idx = 0").get(jobId) as { reviewed: number }).reviewed,
    ).toBe(0);

    expect(
      replaceParagraphTurns(jobId, { chapterIdx: 0, paragraphIdx: 0, turns: [] }),
    ).toEqual({ ok: false, status: 400, error: "A paragraph must have a line" });
    expect(
      replaceParagraphTurns(jobId, {
        chapterIdx: 0,
        paragraphIdx: 0,
        turns: [{ speakerIndex: 1.5, text: "No" }],
      }),
    ).toEqual({ ok: false, status: 400, error: "Invalid line" });
    expect(
      replaceParagraphTurns(jobId, {
        chapterIdx: 0,
        paragraphIdx: 0,
        turns: [{ speakerIndex: 0, text: "Hello <|speaker:1|>" }],
      }),
    ).toEqual({ ok: false, status: 400, error: "A line cannot contain a speaker tag" });
    expect(
      replaceParagraphTurns(jobId, {
        chapterIdx: 0,
        paragraphIdx: 0,
        turns: [{ speakerIndex: 9, text: "No" }],
      }),
    ).toEqual({ ok: false, status: 400, error: "Unknown speaker" });
    expect(stored()).toBe("<|speaker:0|>One [pause]<|speaker:1|>  ");

    getDb()
      .prepare("UPDATE chapters SET text = ? WHERE job_id = ? AND idx = 0")
      .run("One.\n\nTwo.", jobId);
    expect(
      replaceParagraphTurns(jobId, {
        chapterIdx: 0,
        paragraphIdx: 0,
        turns: [{ speakerIndex: 0, text: "Changed" }],
      }),
    ).toEqual({ ok: false, status: 409, error: "Section is not ready" });
    expect(stored()).toBe("<|speaker:0|>One [pause]<|speaker:1|>  ");

    getDb().prepare("UPDATE chapters SET text = ? WHERE job_id = ? AND idx = 0").run("One.", jobId);
    getDb().prepare("UPDATE jobs SET status = ? WHERE id = ?").run("queued", jobId);
    expect(
      replaceParagraphTurns(jobId, {
        chapterIdx: 0,
        paragraphIdx: 0,
        turns: [],
      }),
    ).toEqual({ ok: false, status: 409, error: "Annotation is not open for review" });

    getDb().prepare("UPDATE jobs SET status = ? WHERE id = ?").run("awaiting_annotation", jobId);
    expect(
      replaceParagraphTurns(jobId, {
        chapterIdx: 4,
        paragraphIdx: 0,
        turns: [{ speakerIndex: 0, text: "No" }],
      }),
    ).toEqual({ ok: false, status: 404, error: "Job not found" });
    expect(
      replaceParagraphTurns(999999, {
        chapterIdx: 0,
        paragraphIdx: 0,
        turns: [{ speakerIndex: 0, text: "No" }],
      }),
    ).toEqual({ ok: false, status: 404, error: "Job not found" });

    getDb()
      .prepare(
        `INSERT INTO segments (job_id, chapter_idx, paragraph_idx, annotated_text)
       VALUES (?, 0, 1, ?)`,
      )
      .run(jobId, "<|speaker:0|>extra");
    getDb()
      .prepare("DELETE FROM segments WHERE job_id = ? AND chapter_idx = 0 AND paragraph_idx = 0")
      .run(jobId);
    expect(
      replaceParagraphTurns(jobId, {
        chapterIdx: 0,
        paragraphIdx: 0,
        turns: [{ speakerIndex: 0, text: "Missing" }],
      }),
    ).toEqual({ ok: false, status: 404, error: "Segment not found" });
  });
});
