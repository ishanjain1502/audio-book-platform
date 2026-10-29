import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("confirmJob", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-confirm-"));
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
      fingerprint: `fp-${status}-${researched}`,
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

  it("queues a researched review job and spawns once", async () => {
    const jobId = await seed("awaiting_annotation", true);
    const { getDb } = await import("@/lib/db/client");
    getDb()
      .prepare(
        "INSERT INTO chapters (job_id, idx, title, text, reviewed) VALUES (?, 0, ?, ?, 1)",
      )
      .run(jobId, "Chapter I", "Hello.");
    getDb()
      .prepare(
        `INSERT INTO segments (job_id, chapter_idx, paragraph_idx, annotated_text)
         VALUES (?, 0, 0, ?)`,
      )
      .run(jobId, "<|speaker:0|>Hello.");
    const spawned: string[] = [];
    const { confirmJob } = await import("@/lib/jobs/confirmJob");
    const first = confirmJob(
      jobId,
      { title: "Original", author: "Ada", pageCount: 10 },
      (id, mode) => spawned.push(`${id}:${mode}`),
    );
    const second = confirmJob(
      jobId,
      { title: "Original", author: "Ada", pageCount: 10 },
      (id, mode) => spawned.push(`${id}:${mode}`),
    );
    expect(first).toEqual({ ok: true });
    expect(second).toMatchObject({ ok: false, status: 409 });
    expect(spawned).toEqual([`${jobId}:synthesize`]);
    const row = getDb().prepare("SELECT status FROM jobs WHERE id = ?").get(jobId) as {
      status: string;
    };
    expect(row.status).toBe("queued");
  });

  it("rejects confirm before research is saved", async () => {
    const jobId = await seed("awaiting_review", false);
    const { confirmJob } = await import("@/lib/jobs/confirmJob");
    const result = confirmJob(
      jobId,
      { title: "Original", author: "Ada", pageCount: 10 },
      () => {
        throw new Error("should not spawn");
      },
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: "Annotation is not ready",
    });
  });
});
