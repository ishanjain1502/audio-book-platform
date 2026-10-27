import fs from "fs";
import path from "path";
import type { Storage } from "@/lib/storage/types";

export class LocalStorage implements Storage {
  constructor(private readonly rootDir: string) {}

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const file = path.join(this.rootDir, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }

  async getBuffer(key: string): Promise<Buffer> {
    return fs.readFileSync(path.join(this.rootDir, key));
  }
}
