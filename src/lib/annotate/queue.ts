import pLimit from "p-limit";
import { annotateParagraph } from "@/lib/annotate/screenplay";
import type { JobLogger } from "@/lib/jobs/jobLog";

const ANNOTATION_CONCURRENCY = 5;

export type ParagraphJob = {
  chapterIdx: number;
  paragraphIdx: number;
  totalInChapter: number;
  paragraph: string;
  prev: string | null;
  next: string | null;
  speakerMap: Record<string, number>;
};

export type AnnotateProgressHandlers = {
  log?: JobLogger;
  onParagraphDone?: (done: number, total: number, label: string) => void;
};

export async function annotateParagraphsParallel(
  jobs: ParagraphJob[],
  handlers: AnnotateProgressHandlers = {},
): Promise<{ annotated: string; speakersUsed: number[] }[]> {
  const limit = pLimit(ANNOTATION_CONCURRENCY);
  const total = jobs.length;
  let completed = 0;

  return Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const label = `ch${job.chapterIdx} p${job.paragraphIdx + 1}/${job.totalInChapter}`;
        handlers.log?.info(`annotate start ${label} (${job.paragraph.length} chars)`);
        const started = Date.now();
        const result = await annotateParagraph({
          paragraph: job.paragraph,
          prev: job.prev,
          next: job.next,
          speakerMap: job.speakerMap,
        });
        completed += 1;
        const sec = ((Date.now() - started) / 1000).toFixed(1);
        handlers.log?.info(
          `annotate done ${label} (${completed}/${total} this chapter, ${sec}s)`,
        );
        handlers.onParagraphDone?.(completed, total, label);
        return result;
      }),
    ),
  );
}
