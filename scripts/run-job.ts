/**
 * Run audiobook job outside Next.js (SQLite + long work stay off the dev server).
 * Usage: npx tsx scripts/run-job.ts <jobId> [full|annotate|synthesize]
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
import { runJob, type JobProgressPatch } from "../src/lib/pipeline/runJob";
import { runAnnotation } from "../src/lib/pipeline/runAnnotation";
import { runSynthesis } from "../src/lib/pipeline/runSynthesis";
import { closeDb } from "../src/lib/db/client";
import { prepareJobFromUpload } from "../src/lib/pipeline/prepareUpload";
import { jobIsPrepared } from "../src/lib/pipeline/jobReady";
import { createJobLogger } from "../src/lib/jobs/jobLog";

type RunMode = "full" | "annotate" | "synthesize";

function parseMode(raw: string | undefined): RunMode | null {
  const mode = raw ?? "full";
  if (mode === "full" || mode === "annotate" || mode === "synthesize") {
    return mode;
  }
  return null;
}

async function main() {
  const jobId = Number(process.argv[2]);
  const mode = parseMode(process.argv[3]);
  if (!Number.isFinite(jobId)) {
    console.error(
      "Usage: npx tsx scripts/run-job.ts <jobId> [full|annotate|synthesize]",
    );
    process.exit(1);
  }
  if (mode === null) {
    console.error(
      "Usage: npx tsx scripts/run-job.ts <jobId> [full|annotate|synthesize]",
    );
    process.exit(1);
  }

  const dir = jobDir(jobId);
  const log = createJobLogger(jobId);

  try {
    if (jobIsPrepared(jobId)) {
      const { getDb } = await import("../src/lib/db/client");
      const row = getDb()
        .prepare("SELECT email FROM jobs WHERE id = ?")
        .get(jobId) as { email: string };
      log.info(`worker started for prepared job ${jobId} → ${row.email}`);
    } else {
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
      log.info(`worker started for "${meta.title}" → ${meta.email}`);
      const status = readJobStatus(jobId);
      if (status) {
        writeJobStatus({
          ...status,
          status: "processing",
          phase: "prepare",
          detail: "Loading PDF…",
        });
      }
      const pdfBuffer = fs.readFileSync(meta.pdfPath);
      await prepareJobFromUpload({
        jobId,
        pdfBuffer,
        email: meta.email,
        voicePath: meta.voicePath,
        title: meta.title,
        author: meta.author,
      });
    }

    const { getDb } = await import("../src/lib/db/client");
    const db = getDb();
    const chapterRows = db
      .prepare("SELECT idx, title FROM chapters WHERE job_id = ? ORDER BY idx")
      .all(jobId) as { idx: number; title: string }[];
    const base = readJobStatus(jobId);
    if (base && mode !== "annotate") {
      writeJobStatus({
        ...base,
        status: "processing",
        chapters: chapterRows.map((chapter) => ({
          idx: chapter.idx,
          title: chapter.title,
          ready: false,
        })),
      });
    }

    const onProgress = (patch: JobProgressPatch) => {
      const current = readJobStatus(jobId);
      if (current) writeJobStatus({ ...current, ...patch });
    };

    if (mode === "full") {
      await runJob(jobId, onProgress);
    } else if (mode === "annotate") {
      await runAnnotation(jobId, onProgress);
    } else {
      await runSynthesis(jobId, onProgress);
    }

    if (mode !== "annotate") {
      const jobRow = db
        .prepare("SELECT status FROM jobs WHERE id = ?")
        .get(jobId) as { status: string };
      const done = readJobStatus(jobId);
      if (done && jobRow.status === "done") {
        writeJobStatus({
          ...done,
          status: "done",
          progress: 100,
          chapters: done.chapters.map((c) => ({ ...c, ready: true })),
        });
      }
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
