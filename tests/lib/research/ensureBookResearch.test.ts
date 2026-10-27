import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/research/characterMap", () => ({
  buildCharacterMap: vi.fn(),
}));

const character = {
  name: "Narrator",
  aliases: [],
  role: "narrator" as const,
  speaks: true,
  gender_presentation: null,
  age_impression: "adult" as const,
  tonality: ["calm"],
  confidence: 0.9,
  source: "text",
};

describe("ensureBookResearch", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-research-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
    vi.resetAllMocks();
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function seedJob(): Promise<number> {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const bookId = upsertBook({
      title: "Original",
      author: null,
      fingerprint: "abc",
      pageCount: 10,
      wordCount: 800,
    });
    const db = getDb();
    const job = db
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, ?, 'awaiting_review')",
      )
      .run(bookId, "a@b.com", null);
    db.prepare(
      "INSERT INTO chapters (job_id, idx, title, text) VALUES (?, 0, 'Chapter 1', ?)",
    ).run(Number(job.lastInsertRowid), "Hello there.");
    return Number(job.lastInsertRowid);
  }

  it("saves research once and does not call the model again", async () => {
    const { buildCharacterMap } = await import("@/lib/research/characterMap");
    vi.mocked(buildCharacterMap).mockResolvedValue({
      book_title: "Original",
      author: "Unknown",
      mode: "text_sample",
      sources_found: 0,
      characters: [character],
    });
    const jobId = await seedJob();
    const { ensureBookResearch } = await import("@/lib/research/ensureBookResearch");
    const { getBook } = await import("@/lib/book/meta");
    const first = await ensureBookResearch(jobId);
    const second = await ensureBookResearch(jobId);
    expect(buildCharacterMap).toHaveBeenCalledTimes(1);
    expect(buildCharacterMap).toHaveBeenCalledWith({
      title: "Original",
      author: "Unknown",
      fullText: "Hello there.",
    });
    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    if (second.status === "ready") {
      expect(second.characters).toEqual([
        { name: "Narrator", role: "narrator", tonality: ["calm"] },
      ]);
      expect(second.researchMode).toBe("text_sample");
    }
    const { getDb } = await import("@/lib/db/client");
    const bookId = (
      getDb().prepare("SELECT book_id FROM jobs WHERE id = ?").get(jobId) as {
        book_id: number;
      }
    ).book_id;
    expect(getBook(bookId)?.researchedAt).toBeTruthy();
    expect(getBook(bookId)?.researchError).toBeNull();
  });

  it("records a failure without marking the book researched", async () => {
    const { buildCharacterMap } = await import("@/lib/research/characterMap");
    vi.mocked(buildCharacterMap).mockRejectedValue(new Error("model down"));
    const jobId = await seedJob();
    const { ensureBookResearch } = await import("@/lib/research/ensureBookResearch");
    const { getBook } = await import("@/lib/book/meta");
    const result = await ensureBookResearch(jobId);
    expect(result).toEqual({ status: "failed", error: "model down" });
    const { getDb } = await import("@/lib/db/client");
    const bookId = (
      getDb().prepare("SELECT book_id FROM jobs WHERE id = ?").get(jobId) as {
        book_id: number;
      }
    ).book_id;
    const book = getBook(bookId);
    expect(book?.researchedAt).toBeNull();
    expect(book?.researchError).toBe("model down");
    expect(book?.researchStartedAt).toBeNull();
  });

  it("does not start a second research while the lock is fresh", async () => {
    const { buildCharacterMap } = await import("@/lib/research/characterMap");
    const jobId = await seedJob();
    const { getDb } = await import("@/lib/db/client");
    const bookId = (
      getDb().prepare("SELECT book_id FROM jobs WHERE id = ?").get(jobId) as {
        book_id: number;
      }
    ).book_id;
    getDb()
      .prepare("UPDATE books SET research_started_at = ? WHERE id = ?")
      .run(new Date().toISOString(), bookId);
    const { ensureBookResearch } = await import("@/lib/research/ensureBookResearch");
    const result = await ensureBookResearch(jobId);
    expect(result).toEqual({ status: "running" });
    expect(buildCharacterMap).not.toHaveBeenCalled();
  });

  it("does not save research after the lock is stolen", async () => {
    const { buildCharacterMap } = await import("@/lib/research/characterMap");
    const jobId = await seedJob();
    const { getDb } = await import("@/lib/db/client");
    const bookId = (
      getDb().prepare("SELECT book_id FROM jobs WHERE id = ?").get(jobId) as {
        book_id: number;
      }
    ).book_id;
    const stolenAt = new Date(Date.now() + 60_000).toISOString();
    vi.mocked(buildCharacterMap).mockImplementation(async () => {
      getDb()
        .prepare("UPDATE books SET research_started_at = ? WHERE id = ?")
        .run(stolenAt, bookId);
      return {
        book_title: "Original",
        author: "Unknown",
        mode: "text_sample",
        sources_found: 0,
        characters: [character],
      };
    });
    const { ensureBookResearch } = await import("@/lib/research/ensureBookResearch");
    const { getBook } = await import("@/lib/book/meta");
    const result = await ensureBookResearch(jobId);
    expect(result.status).toBe("running");
    const book = getBook(bookId);
    expect(book?.researchedAt).toBeNull();
    expect(book?.researchStartedAt).toBe(stolenAt);
  });

  it("does not record a failure after the lock is stolen", async () => {
    const { buildCharacterMap } = await import("@/lib/research/characterMap");
    const jobId = await seedJob();
    const { getDb } = await import("@/lib/db/client");
    const bookId = (
      getDb().prepare("SELECT book_id FROM jobs WHERE id = ?").get(jobId) as {
        book_id: number;
      }
    ).book_id;
    const stolenAt = new Date(Date.now() + 60_000).toISOString();
    vi.mocked(buildCharacterMap).mockImplementation(async () => {
      getDb()
        .prepare("UPDATE books SET research_started_at = ? WHERE id = ?")
        .run(stolenAt, bookId);
      throw new Error("model down");
    });
    const { ensureBookResearch } = await import("@/lib/research/ensureBookResearch");
    const { getBook } = await import("@/lib/book/meta");
    const result = await ensureBookResearch(jobId);
    expect(result.status).toBe("running");
    const book = getBook(bookId);
    expect(book?.researchError).toBeNull();
    expect(book?.researchStartedAt).toBe(stolenAt);
  });

  it("rolls back research success when saving character maps throws", async () => {
    const { buildCharacterMap } = await import("@/lib/research/characterMap");
    vi.mocked(buildCharacterMap).mockResolvedValue({
      book_title: "Original",
      author: "Unknown",
      mode: "text_sample",
      sources_found: 0,
      characters: [character],
    });
    const maps = await import("@/lib/book/characterMapsDb");
    const spy = vi.spyOn(maps, "saveCharacterMaps").mockImplementation(() => {
      throw new Error("map save failed");
    });
    try {
      const jobId = await seedJob();
      const { ensureBookResearch } = await import("@/lib/research/ensureBookResearch");
      const { getBook } = await import("@/lib/book/meta");
      const result = await ensureBookResearch(jobId);
      expect(result).toEqual({ status: "failed", error: "map save failed" });
      const { getDb } = await import("@/lib/db/client");
      const bookId = (
        getDb().prepare("SELECT book_id FROM jobs WHERE id = ?").get(jobId) as {
          book_id: number;
        }
      ).book_id;
      const book = getBook(bookId);
      expect(book?.researchedAt).toBeNull();
      expect(book?.researchError).toBe("map save failed");
      expect(book?.researchStartedAt).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
