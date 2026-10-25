import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import ffmpegPath from "ffmpeg-static";

function resolveFfmpeg(): string {
  if (!ffmpegPath) {
    throw new Error("ffmpeg binary not found (ffmpeg-static)");
  }
  return ffmpegPath;
}

/** Path form safe for ffmpeg concat demuxer (works on Windows). */
function toConcatListPath(filePath: string): string {
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  return resolved.replace(/'/g, "'\\''");
}

function ffmpegConcatFiles(inputPaths: string[], outputPath: string): void {
  if (inputPaths.length === 0) {
    throw new Error("ffmpegConcatFiles: no input files");
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (inputPaths.length === 1) {
    fs.copyFileSync(inputPaths[0], outputPath);
    return;
  }

  const listPath = path.join(
    os.tmpdir(),
    `audiobook-concat-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
  );
  const listBody = inputPaths
    .map((p) => `file '${toConcatListPath(p)}'`)
    .join("\n");
  fs.writeFileSync(listPath, listBody, "utf8");

  const ffmpeg = resolveFfmpeg();
  const run = (args: string[]) =>
    spawnSync(ffmpeg, args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });

  let result = run([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath,
  ]);

  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    result = run([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      outputPath,
    ]);
  }

  try {
    fs.unlinkSync(listPath);
  } catch {
    /* ignore */
  }

  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || "unknown";
    throw new Error(`ffmpeg stitch failed: ${detail}`);
  }
}

/** Concatenate MP3 files in order with ffmpeg (correct duration metadata). */
export function stitchMp3Files(paths: string[], outputPath: string): void {
  ffmpegConcatFiles(paths, outputPath);
}

/** Merge in-memory MP3 buffers (e.g. long TTS split across API calls). */
export function concatMp3Buffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) {
    throw new Error("concatMp3Buffers: no buffers");
  }
  if (buffers.length === 1) {
    return buffers[0];
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-mp3-"));
  try {
    const paths = buffers.map((buf, i) => {
      const p = path.join(dir, `part-${i}.mp3`);
      fs.writeFileSync(p, buf);
      return p;
    });
    const out = path.join(dir, "out.mp3");
    ffmpegConcatFiles(paths, out);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
