import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getStorage } from "@/lib/storage";
import { LocalStorage } from "@/lib/storage/local";
import { R2Storage } from "@/lib/storage/r2";

describe("R2Storage", () => {
  it("puts and gets an object through the S3 client", async () => {
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        if (command instanceof GetObjectCommand) {
          return { Body: { transformToByteArray: async () => Buffer.from("pdf") } };
        }
        return {};
      },
    };
    const storage = new R2Storage(client, "media-assets");
    await storage.put("books/3/source.pdf", Buffer.from("pdf"), "application/pdf");
    const read = await storage.getBuffer("books/3/source.pdf");
    expect(read.toString()).toBe("pdf");
    expect(sent[0]).toBeInstanceOf(PutObjectCommand);
    expect(sent[1]).toBeInstanceOf(GetObjectCommand);
  });
});

describe("getStorage", () => {
  const prevBackend = process.env.STORAGE_BACKEND;
  const prevData = process.env.DATA_DIR;
  const dirs: string[] = [];

  afterEach(() => {
    process.env.STORAGE_BACKEND = prevBackend;
    process.env.DATA_DIR = prevData;
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns local storage under DATA_DIR/objects", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "abg-backend-"));
    dirs.push(root);
    process.env.DATA_DIR = root;
    process.env.STORAGE_BACKEND = "local";
    const storage = getStorage();
    expect(storage).toBeInstanceOf(LocalStorage);
  });

  it("rejects an unknown backend", () => {
    process.env.STORAGE_BACKEND = "s3";
    expect(() => getStorage()).toThrow(/Unknown STORAGE_BACKEND/);
  });
});
