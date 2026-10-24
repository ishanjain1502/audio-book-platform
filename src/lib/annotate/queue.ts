import pLimit from "p-limit";
import { annotateParagraph } from "@/lib/annotate/screenplay";

const ANNOTATION_CONCURRENCY = 5;

export type ParagraphJob = {
  paragraph: string;
  prev: string | null;
  next: string | null;
  speakerMap: Record<string, number>;
};

export async function annotateParagraphsParallel(
  jobs: ParagraphJob[],
): Promise<{ annotated: string; speakersUsed: number[] }[]> {
  const limit = pLimit(ANNOTATION_CONCURRENCY);
  return Promise.all(
    jobs.map((job) => limit(() => annotateParagraph(job))),
  );
}
