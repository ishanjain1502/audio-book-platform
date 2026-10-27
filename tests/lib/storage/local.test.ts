import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { bookPdfAccessUrl, bookPdfObjectKey } from "@/lib/storage/keys";
import { LocalStorage } from "@/lib/storage/local";

describe("local storage", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads a book pdf at books/{id}/source.pdf", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "abg-store-"));
    dirs.push(root);
    const storage = new LocalStorage(root);
    const key = bookPdfObjectKey(12);
    expect(key).toBe("books/12/source.pdf");
    expect(bookPdfAccessUrl(12)).toBe("/api/books/12/pdf");
    await storage.put(key, Buffer.from("pdf-bytes"), "application/pdf");
    const read = await storage.getBuffer(key);
    expect(read.toString()).toBe("pdf-bytes");
    expect(fs.existsSync(path.join(root, "books", "12", "source.pdf"))).toBe(true);
  });
});
