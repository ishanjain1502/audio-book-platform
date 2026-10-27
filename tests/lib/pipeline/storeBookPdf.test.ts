import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "@/lib/storage/local";

describe("storeBookPdf", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-pdf-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uploads once and leaves the first bytes in place", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getBook } = await import("@/lib/book/meta");
    const { storeBookPdf } = await import("@/lib/pipeline/storeBookPdf");
    const bookId = upsertBook({
      title: "Original",
      author: null,
      fingerprint: "abc",
      pageCount: 3,
      wordCount: 800,
    });
    const storage = new LocalStorage(path.join(tmpDir, "objects"));
    const first = await storeBookPdf(bookId, Buffer.from("first"), storage);
    const second = await storeBookPdf(bookId, Buffer.from("second"), storage);
    expect(first).toEqual({ uploaded: true, objectKey: `books/${bookId}/source.pdf` });
    expect(second).toEqual({ uploaded: false, objectKey: `books/${bookId}/source.pdf` });
    const saved = await storage.getBuffer(`books/${bookId}/source.pdf`);
    expect(saved.toString()).toBe("first");
    const book = getBook(bookId);
    expect(book?.pdfObjectKey).toBe(`books/${bookId}/source.pdf`);
    expect(book?.pdfAccessUrl).toBe(`/api/books/${bookId}/pdf`);
    expect(book?.pdfObjectKey).toBeTruthy();
  });
});
