import path from "path";
import { LocalStorage } from "@/lib/storage/local";
import { createR2StorageFromEnv } from "@/lib/storage/r2";
import type { Storage } from "@/lib/storage/types";

function dataDir(): string {
  const raw = process.env.DATA_DIR ?? "./src/data";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function getStorage(): Storage {
  const backend = process.env.STORAGE_BACKEND ?? "local";
  if (backend === "local") return new LocalStorage(path.join(dataDir(), "objects"));
  if (backend === "r2") return createR2StorageFromEnv();
  throw new Error(`Unknown STORAGE_BACKEND: ${backend}`);
}
