/**
 * Run audiobook job outside Next.js (SQLite + long work stay off the dev server).
 * Usage: npx tsx scripts/run-job.ts <jobId>
 */
import { config } from "dotenv";
import fs from "fs";
import path from "path";

config({ path: path.join(process.cwd(), ".env") });

import {
  jobDir,
  readJobStatus,
  writeJobStatus,
} from "../src/lib/jobs/statusFile";
import { runJob } from "../src/lib/pipeline/runJob";
import { closeDb } from "../src/lib/db/client";
import { prepareJobFromUpload } from "../src/lib/pipeline/prepareUpload";
import { createJobLogger } from "../src/lib/jobs/jobLog";

async function main() {
  const jobId = Number(process.argv[2]);
  if (!Number.isFinite(jobId)) {
    console.error("Usage: npx tsx scripts/run-job.ts <jobId>");
    process.exit(1);
  }

  const dir = jobDir(jobId);
  const metaPath = path.join(dir, "upload.json");
  if (!fs.existsSync(metaPath)) {
    console.error(`Missing upload.json for job ${jobId}`);
    process.exit(1);
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
    email: string;
    pdfPath: string;
    voicePath: string | null;
    title: string;
    author: string | null;
  };

  const log = createJobLogger(jobId);

  try {
    log.info(`worker started for "${meta.title}" → ${meta.email}`);
    const status = readJobStatus(jobId);
    if (status) {
      writeJobStatus({ ...status, status: "processing", phase: "prepare", detail: "Loading PDF…" });
    }

    const pdfBuffer = fs.readFileSync(meta.pdfPath);
    const internalJobId = await prepareJobFromUpload({
      jobId,
      pdfBuffer,
      email: meta.email,
      voicePath: meta.voicePath,
      title: meta.title,
      author: meta.author,
    });

    if (internalJobId !== jobId) {
      console.warn(`Job id mapping ${jobId} -> ${internalJobId}`);
    }

    const { getDb } = await import("../src/lib/db/client");
    const db = getDb();
    const chapterRows = db
      .prepare(
        "SELECT idx, title FROM chapters WHERE job_id = ? ORDER BY idx",
      )
      .all(jobId) as { idx: number; title: string }[];
    const base = readJobStatus(jobId);
    if (base) {
      writeJobStatus({
        ...base,
        status: "processing",
        chapters: chapterRows.map((c) => ({
          idx: c.idx,
          title: c.title,
          ready: false,
        })),
      });
    }

    await runJob(jobId, (patch) => {
      const current = readJobStatus(jobId);
      if (current) writeJobStatus({ ...current, ...patch });
    });

    const done = readJobStatus(jobId);
    if (done) {
      writeJobStatus({
        ...done,
        status: "done",
        progress: 100,
        chapters: done.chapters.map((c) => ({ ...c, ready: true })),
      });
    }
    console.log(`Job ${jobId} finished`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const current = readJobStatus(jobId);
    if (current) {
      writeJobStatus({ ...current, status: "failed", error: message });
    }
    console.error(err);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

main();
