/**
 * Tail job progress log. Usage: npx tsx scripts/tail-progress.ts <jobId>
 */
import fs from "fs";
import path from "path";
import { jobDir } from "../src/lib/jobs/statusFile";

const jobId = Number(process.argv[2]);
if (!Number.isFinite(jobId)) {
  console.error("Usage: npx tsx scripts/tail-progress.ts <jobId>");
  process.exit(1);
}

const logPath = path.join(jobDir(jobId), "progress.log");
if (!fs.existsSync(logPath)) {
  console.log(`Waiting for ${logPath}…`);
}

let offset = 0;
const tick = () => {
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (stat.size > offset) {
    const chunk = fs.readFileSync(logPath, { encoding: "utf8" }).slice(offset);
    process.stdout.write(chunk);
    offset = stat.size;
  }
};

setInterval(tick, 500);
tick();
