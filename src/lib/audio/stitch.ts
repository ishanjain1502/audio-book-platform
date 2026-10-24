import fs from "fs";
import path from "path";

/** Concatenate MP3 files in order (byte concat; acceptable for MVP). */
export function stitchMp3Files(paths: string[], outputPath: string): void {
  const buffers = paths.map((p) => fs.readFileSync(p));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.concat(buffers));
}
