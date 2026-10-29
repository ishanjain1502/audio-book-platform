import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("startAnnotation", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-start-annotation-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function seed(status: string, researched: boolean): Promise<number> {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const { writeJobStatus } = await import("@/lib/jobs/statusFile");
    const bookId = upsertBook({
      title: "Original",
      author: "Ada",
      fingerprint: `fp-${status}-${researched}-start`,
      pageCount: 10,
      wordCount: 800,
    });
    if (researched) {
      getDb()
        .prepare("UPDATE books SET researched_at = ? WHERE id = ?")
        .run("2026-10-27T11:00:00.000Z", bookId);
    }
    const job = getDb()
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, ?)",
      )
      .run(bookId, "a@b.com", status);
    const jobId = Number(job.lastInsertRowid);
    writeJobStatus({
      id: jobId,
      status,
      email: "a@b.com",
      progress: 0,
      chapters: [],
    });
    return jobId;
  }

  it("starts annotation from review and does not spawn synthesis", async () => {
    const jobId = await seed("awaiting_review", true);
    const spawned: string[] = [];
    const { startAnnotation } = await import("@/lib/jobs/startAnnotation");
    const result = startAnnotation(
      jobId,
      { title: "Original", author: "Ada", pageCount: 10 },
      (id, mode) => spawned.push(`${id}:${mode}`),
    );
    expect(result).toEqual({ ok: true });
    expect(spawned).toEqual([`${jobId}:annotate`]);
  });

  it("retries a failed job by deleting only incomplete segments", async () => {
    const jobId = await seed("failed", true);
    const { getDb } = await import("@/lib/db/client");
    getDb()
      .prepare(
        "INSERT INTO chapters (job_id, idx, title, text, reviewed) VALUES (?, 0, ?, ?, 1)",
      )
      .run(jobId, "Chapter I", "One.");
    getDb()
      .prepare(
        "INSERT INTO chapters (job_id, idx, title, text, reviewed) VALUES (?, 1, ?, ?, 0)",
      )
      .run(jobId, "Chapter II", "Two.\n\nThree.");
    getDb()
      .prepare(
        `INSERT INTO segments (job_id, chapter_idx, paragraph_idx, annotated_text)
         VALUES (?, 0, 0, ?)`,
      )
      .run(jobId, "<|speaker:0|>One.");
    getDb()
      .prepare(
        `INSERT INTO segments (job_id, chapter_idx, paragraph_idx, annotated_text)
         VALUES (?, 1, 0, ?)`,
      )
      .run(jobId, "<|speaker:0|>Two.");
    const spawned: string[] = [];
    const { startAnnotation } = await import("@/lib/jobs/startAnnotation");
    expect(
      startAnnotation(jobId, { title: "Original", author: "Ada", pageCount: 10 }, (id, mode) =>
        spawned.push(`${id}:${mode}`),
      ),
    ).toEqual({ ok: true });
    expect(spawned).toEqual([`${jobId}:annotate`]);
    const ch0Seg = getDb()
      .prepare(
        "SELECT COUNT(*) AS c FROM segments WHERE job_id = ? AND chapter_idx = 0",
      )
      .get(jobId) as { c: number };
    expect(ch0Seg.c).toBe(1);
    const ch0Reviewed = getDb()
      .prepare("SELECT reviewed FROM chapters WHERE job_id = ? AND idx = 0")
      .get(jobId) as { reviewed: number };
    expect(ch0Reviewed.reviewed).toBe(1);
    const ch1Seg = getDb()
      .prepare(
        "SELECT COUNT(*) AS c FROM segments WHERE job_id = ? AND chapter_idx = 1",
      )
      .get(jobId) as { c: number };
    expect(ch1Seg.c).toBe(0);
  });
});
