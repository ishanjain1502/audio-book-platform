import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import { synthesizeWithFallback } from "@/lib/fish/synthesize";
import type { JobLogger } from "@/lib/jobs/jobLog";

const SYNTHESIS_CONCURRENCY = 5;

export type SynthesisJob = {
  chapterIdx: number;
  paragraphIdx: number;
  totalInChapter: number;
  annotatedText: string;
  referenceIds: string[];
  outputPath: string;
};

export type SynthesisProgressHandlers = {
  log?: JobLogger;
  onSegmentDone?: (done: number, total: number, label: string) => void;
};

export async function synthesizeJobsParallel(
  jobs: SynthesisJob[],
  handlers: SynthesisProgressHandlers = {},
): Promise<void> {
  const limit = pLimit(SYNTHESIS_CONCURRENCY);
  const total = jobs.length;
  let completed = 0;

  await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const label = `ch${job.chapterIdx} p${job.paragraphIdx + 1}/${job.totalInChapter}`;
        handlers.log?.info(`synthesize start ${label}`);
        const started = Date.now();
        fs.mkdirSync(path.dirname(job.outputPath), { recursive: true });
        const audio = await synthesizeWithFallback({
          annotatedText: job.annotatedText,
          referenceIds: job.referenceIds,
        });
        fs.writeFileSync(job.outputPath, audio);
        completed += 1;
        const sec = ((Date.now() - started) / 1000).toFixed(1);
        handlers.log?.info(
          `synthesize done ${label} (${completed}/${total} this chapter, ${audio.length} bytes, ${sec}s)`,
        );
        handlers.onSegmentDone?.(completed, total, label);
      }),
    ),
  );
}
