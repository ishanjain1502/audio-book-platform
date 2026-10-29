import {
  annotateParagraphsParallel,
  type ParagraphJob,
} from "@/lib/annotate/queue";
import { sectionIsComplete } from "@/lib/annotate/sectionReady";
import { loadCharacterMaps } from "@/lib/book/characterMapsDb";
import { getDb } from "@/lib/db/client";
import { createJobLogger } from "@/lib/jobs/jobLog";
import { splitIntoParagraphs } from "@/lib/pdf/chapters";
import { speakerMapForChapter } from "@/lib/voices/assign";
import type { JobProgressPatch } from "@/lib/pipeline/runJob";

function setJobStatus(
  jobId: number,
  status: string,
  error?: string | null,
): void {
  const db = getDb();
  if (status === "done" || status === "failed") {
    db.prepare(
      `UPDATE jobs SET status = ?, error = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(status, error ?? null, jobId);
  } else {
    db.prepare(`UPDATE jobs SET status = ?, error = ? WHERE id = ?`).run(
      status,
      error ?? null,
      jobId,
    );
  }
}

export async function runAnnotation(
  jobId: number,
  onProgress?: (patch: JobProgressPatch) => void,
  annotate: typeof annotateParagraphsParallel = annotateParagraphsParallel,
): Promise<void> {
  const db = getDb();
  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ?")
    .get(jobId) as {
    id: number;
    book_id: number | null;
  };

  if (!job.book_id) {
    const message = "Missing book_id";
    setJobStatus(jobId, "failed", message);
    throw new Error(message);
  }

  const log = createJobLogger(jobId);
  const report = (patch: JobProgressPatch) => onProgress?.(patch);

  try {
    const assigned = loadCharacterMaps(job.book_id);
    if (!assigned) {
      const message = "Character map is missing";
      setJobStatus(jobId, "failed", message);
      report({ status: "failed", error: message });
      throw new Error(message);
    }

    const chapters = db
      .prepare(
        "SELECT idx, title, text FROM chapters WHERE job_id = ? ORDER BY idx",
      )
      .all(jobId) as { idx: number; title: string; text: string }[];

    const segmentCountStmt = db.prepare(
      "SELECT COUNT(*) AS c FROM segments WHERE job_id = ? AND chapter_idx = ?",
    );
    const deleteSegStmt = db.prepare(
      "DELETE FROM segments WHERE job_id = ? AND chapter_idx = ?",
    );
    const insertSeg = db.prepare(
      `INSERT OR REPLACE INTO segments
       (job_id, chapter_idx, paragraph_idx, annotated_text, status)
       VALUES (?, ?, ?, ?, 'annotated')`,
    );

    for (const chapter of chapters) {
      const paragraphs = splitIntoParagraphs(chapter.text);
      const segmentCount = (
        segmentCountStmt.get(jobId, chapter.idx) as { c: number }
      ).c;

      if (sectionIsComplete(paragraphs.length, segmentCount)) {
        continue;
      }

      deleteSegStmt.run(jobId, chapter.idx);

      report({
        detail: `Annotating section ${chapter.idx + 1}`,
      });

      const speakerMap = speakerMapForChapter(assigned);
      const annotationJobs: ParagraphJob[] = paragraphs.map((p, i) => ({
        chapterIdx: chapter.idx,
        paragraphIdx: i,
        totalInChapter: paragraphs.length,
        paragraph: p,
        prev: i > 0 ? paragraphs[i - 1] : null,
        next: i < paragraphs.length - 1 ? paragraphs[i + 1] : null,
        speakerMap,
      }));

      log.info(
        `chapter ${chapter.idx} "${chapter.title}" — annotating ${paragraphs.length} paragraphs`,
      );

      const annotated = await annotate(annotationJobs, { log });

      for (let paragraphIdx = 0; paragraphIdx < annotated.length; paragraphIdx++) {
        insertSeg.run(
          jobId,
          chapter.idx,
          paragraphIdx,
          annotated[paragraphIdx].annotated,
        );
      }

      log.info(`chapter ${chapter.idx} annotation complete`);
    }

    setJobStatus(jobId, "awaiting_annotation");
    report({ status: "awaiting_annotation" });
    log.info("annotation complete — awaiting review");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    setJobStatus(jobId, "failed", message);
    report({ status: "failed", error: message, phase: "failed", detail: message });
    throw err;
  }
}
