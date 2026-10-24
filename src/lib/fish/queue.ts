import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import { synthesizeWithFallback } from "@/lib/fish/synthesize";

const SYNTHESIS_CONCURRENCY = 5;

export type SynthesisJob = {
  annotatedText: string;
  referenceIds: string[];
  outputPath: string;
};

export async function synthesizeJobsParallel(
  jobs: SynthesisJob[],
): Promise<void> {
  const limit = pLimit(SYNTHESIS_CONCURRENCY);
  await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        fs.mkdirSync(path.dirname(job.outputPath), { recursive: true });
        const audio = await synthesizeWithFallback({
          annotatedText: job.annotatedText,
          referenceIds: job.referenceIds,
        });
        fs.writeFileSync(job.outputPath, audio);
      }),
    ),
  );
}
