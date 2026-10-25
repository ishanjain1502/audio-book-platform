/**
 * Rebuild chapter-*.mp3 from per-paragraph segment files (fixes bad byte-concat metadata).
 * Usage: npx tsx scripts/restitch-job.ts <jobId>
 */
import fs from "fs";
import path from "path";

import { stitchMp3Files } from "../src/lib/audio/stitch";
import { jobDir } from "../src/lib/jobs/statusFile";

const jobId = Number(process.argv[2]);
if (!Number.isFinite(jobId)) {
  console.error("Usage: npx tsx scripts/restitch-job.ts <jobId>");
  process.exit(1);
}

const dir = jobDir(jobId);
if (!fs.existsSync(dir)) {
  console.error(`Job dir not found: ${dir}`);
  process.exit(1);
}

const segmentRe = /^ch(\d+)-p(\d+)\.mp3$/;
const byChapter = new Map<number, { paragraphIdx: number; path: string }[]>();

for (const name of fs.readdirSync(dir)) {
  const m = segmentRe.exec(name);
  if (!m) continue;
  const chapterIdx = Number(m[1]);
  const paragraphIdx = Number(m[2]);
  const list = byChapter.get(chapterIdx) ?? [];
  list.push({ paragraphIdx, path: path.join(dir, name) });
  byChapter.set(chapterIdx, list);
}

if (byChapter.size === 0) {
  console.error("No ch{N}-p{M}.mp3 segment files found.");
  process.exit(1);
}

for (const [chapterIdx, segments] of [...byChapter.entries()].sort(
  (a, b) => a[0] - b[0],
)) {
  segments.sort((a, b) => a.paragraphIdx - b.paragraphIdx);
  const out = path.join(dir, `chapter-${chapterIdx}.mp3`);
  stitchMp3Files(segments.map((s) => s.path), out);
  console.log(
    `chapter-${chapterIdx}.mp3 (${segments.length} segments) → ${out}`,
  );
}
