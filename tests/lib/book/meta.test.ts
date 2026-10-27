import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("book meta", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-meta-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps the first meta when the same fingerprint is inserted again", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getBook } = await import("@/lib/book/meta");
    const first = upsertBook({
      title: "Original",
      author: "Ada",
      fingerprint: "abc",
      pageCount: 10,
      wordCount: 800,
    });
    const second = upsertBook({
      title: "Replacement",
      author: "Bea",
      fingerprint: "abc",
      pageCount: 99,
      wordCount: 1,
    });
    expect(second).toBe(first);
    const book = getBook(first);
    expect(book?.title).toBe("Original");
    expect(book?.author).toBe("Ada");
    expect(book?.pageCount).toBe(10);
    expect(book?.wordCount).toBe(800);
  });

  it("updates title, author, and page count without changing the fingerprint", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getBook, parseBookMeta, updateBookMeta } = await import("@/lib/book/meta");
    const bookId = upsertBook({
      title: "Original",
      author: "Ada",
      fingerprint: "abc",
      pageCount: 10,
      wordCount: 800,
    });
    const meta = parseBookMeta({ title: "  New Title  ", author: "   ", pageCount: 12 });
    expect(meta.author).toBeNull();
    updateBookMeta(bookId, meta);
    const book = getBook(bookId);
    expect(book?.title).toBe("New Title");
    expect(book?.author).toBeNull();
    expect(book?.pageCount).toBe(12);
    expect(book?.fingerprint).toBe("abc");
    expect(book?.wordCount).toBe(800);
  });

  it("rejects an empty title and a non-positive page count", async () => {
    const { parseBookMeta } = await import("@/lib/book/meta");
    expect(() => parseBookMeta({ title: "  ", author: null, pageCount: 1 })).toThrow(
      /Title is required/,
    );
    expect(() => parseBookMeta({ title: "Book", author: null, pageCount: 0 })).toThrow(
      /Page count must be a positive integer/,
    );
  });
});
