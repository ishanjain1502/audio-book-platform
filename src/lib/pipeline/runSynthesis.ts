import fs from "fs";
import path from "path";
import { stitchMp3Files } from "@/lib/audio/stitch";
import {
  loadCharacterMaps,
  saveCharacterMaps,
} from "@/lib/book/characterMapsDb";
import { getDb } from "@/lib/db/client";
import { cloneVoiceFromFile } from "@/lib/fish/cloneVoice";
import { synthesizeJobsParallel } from "@/lib/fish/queue";
import { createJobLogger } from "@/lib/jobs/jobLog";
import { sendEmailStub } from "@/lib/notify/emailStub";
import { splitIntoParagraphs } from "@/lib/pdf/chapters";
import {
  referenceIdsInOrder,
} from "@/lib/voices/assign";
import type { JobProgressPatch } from "@/lib/pipeline/runJob";

function dataDir(): string {
  const raw = process.env.DATA_DIR ?? "./src/data";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

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

export async function runSynthesis(
  jobId: number,
  onProgress?: (patch: JobProgressPatch) => void,
): Promise<void> {
  const db = getDb();
  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ?")
    .get(jobId) as {
    id: number;
    book_id: number | null;
    email: string;
    custom_voice_path: string | null;
  };

  if (!job.book_id) {
    const message = "Missing book_id";
    setJobStatus(jobId, "failed", message);
    throw new Error(message);
  }

  setJobStatus(jobId, "processing");
  const log = createJobLogger(jobId);
  log.info("synthesis started");

  const report = (patch: JobProgressPatch) => onProgress?.(patch);

  try {
    const chapters = db
      .prepare(
        "SELECT idx, title, text FROM chapters WHERE job_id = ? ORDER BY idx",
      )
      .all(jobId) as { idx: number; title: string; text: string }[];

    let assigned = loadCharacterMaps(job.book_id);
    let narratorVoiceId: string | null = null;

    if (job.custom_voice_path) {
      const refId = `job-${jobId}-narrator`;
      narratorVoiceId = await cloneVoiceFromFile(
        job.custom_voice_path,
        refId,
        "Narrator reference sample for audiobook production.",
      );
    }

    if (!assigned) {
      const message = "Character map is missing";
      setJobStatus(jobId, "failed", message);
      throw new Error(message);
    }

    if (narratorVoiceId) {
      assigned = assigned.map((c) =>
        c.role === "narrator" ? { ...c, voice_id: narratorVoiceId! } : c,
      );
      saveCharacterMaps(job.book_id, assigned, "cached");
    } else {
      log.info(`using cached character map (${assigned.length} characters)`);
    }

    const referenceIds = referenceIdsInOrder(assigned);
    const jobDir = path.join(dataDir(), "jobs", String(jobId));
    fs.mkdirSync(jobDir, { recursive: true });

    const segmentRowsStmt = db.prepare(
      `SELECT paragraph_idx, annotated_text FROM segments
       WHERE job_id = ? AND chapter_idx = ?
       ORDER BY paragraph_idx`,
    );

    const totalSegments = chapters.reduce(
      (n, ch) => n + splitIntoParagraphs(ch.text).length,
      0,
    );
    const totalWorkUnits = Math.max(1, totalSegments);
    let workUnitsDone = 0;

    const bumpProgress = (phase: string, detail: string) => {
      report({
        status: "processing",
        phase,
        detail,
        progress: Math.min(
          99,
          Math.round((workUnitsDone / totalWorkUnits) * 100),
        ),
      });
    };

    const chapterOutputs: string[] = [];

    for (const chapter of chapters) {
      const paragraphs = splitIntoParagraphs(chapter.text);
      const segmentRows = segmentRowsStmt.all(jobId, chapter.idx) as {
        paragraph_idx: number;
        annotated_text: string;
      }[];

      if (segmentRows.length !== paragraphs.length) {
        throw new Error(`Section ${chapter.idx + 1} is not annotated`);
      }

      log.info(
        `chapter ${chapter.idx} "${chapter.title}" — ${paragraphs.length} paragraphs`,
      );

      const synthJobs = segmentRows.map((row) => ({
        chapterIdx: chapter.idx,
        paragraphIdx: row.paragraph_idx,
        totalInChapter: paragraphs.length,
        annotatedText: row.annotated_text,
        referenceIds,
        outputPath: path.join(
          jobDir,
          `ch${chapter.idx}-p${row.paragraph_idx}.mp3`,
        ),
      }));

      bumpProgress(
        "synthesize",
        `Chapter ${chapter.idx + 1}/${chapters.length}: TTS 0/${synthJobs.length}`,
      );
      await synthesizeJobsParallel(synthJobs, {
        log,
        onSegmentDone: (done, total) => {
          workUnitsDone += 1;
          bumpProgress(
            "synthesize",
            `Chapter ${chapter.idx + 1}/${chapters.length}: TTS ${done}/${total}`,
          );
        },
      });
      log.info(`chapter ${chapter.idx} synthesis complete`);

      const chapterOut = path.join(jobDir, `chapter-${chapter.idx}.mp3`);
      stitchMp3Files(
        synthJobs.map((s) => s.outputPath),
        chapterOut,
      );
      chapterOutputs.push(chapterOut);

      const chapterTotal = chapters.length;
      onProgress?.({
        progress: Math.round(((chapter.idx + 1) / chapterTotal) * 100),
        chapters: chapters.map((c) => ({
          idx: c.idx,
          title: c.title,
          ready: c.idx <= chapter.idx,
        })),
      });

      db.prepare(
        `UPDATE segments SET status = 'synthesized', audio_path = ?
         WHERE job_id = ? AND chapter_idx = ?`,
      ).run(synthJobs[0]?.outputPath ?? null, jobId, chapter.idx);
    }

    log.info("stitching / finishing");
    report({ phase: "finishing", detail: "Wrapping up…", progress: 99 });
    setJobStatus(jobId, "stitching");
    sendEmailStub(job.email, chapterOutputs);
    setJobStatus(jobId, "done");
    log.info(`done — ${chapterOutputs.length} chapter MP3(s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    setJobStatus(jobId, "failed", message);
    report({ status: "failed", error: message, phase: "failed", detail: message });
    throw err;
  }
}
