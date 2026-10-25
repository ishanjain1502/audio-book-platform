import fs from "fs";
import path from "path";
import { annotateParagraphsParallel } from "@/lib/annotate/queue";
import { stitchMp3Files } from "@/lib/audio/stitch";
import {
  loadCharacterMaps,
  saveCharacterMaps,
} from "@/lib/book/characterMapsDb";
import { computeFingerprint, upsertBook } from "@/lib/book/fingerprint";
import { getDb } from "@/lib/db/client";
import { cloneVoiceFromFile } from "@/lib/fish/cloneVoice";
import { synthesizeJobsParallel } from "@/lib/fish/queue";
import { sendEmailStub } from "@/lib/notify/emailStub";
import { splitChapters, splitIntoParagraphs } from "@/lib/pdf/chapters";
import { buildCharacterMap } from "@/lib/research/characterMap";
import {
  assignVoices,
  referenceIdsInOrder,
  speakerMapForChapter,
} from "@/lib/voices/assign";
import { createJobLogger } from "@/lib/jobs/jobLog";

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

export type JobProgressPatch = {
  status?: string;
  progress?: number;
  phase?: string;
  detail?: string;
  chapters?: { idx: number; title: string; ready: boolean }[];
  error?: string | null;
};

export async function runJob(
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
    setJobStatus(jobId, "failed", "Missing book_id");
    return;
  }

  setJobStatus(jobId, "processing");
  const log = createJobLogger(jobId);
  log.info("processing started");

  const report = (patch: JobProgressPatch) => onProgress?.(patch);

  try {
    const book = db
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(job.book_id) as {
      id: number;
      title: string;
      author: string | null;
    };

    const chapters = db
      .prepare(
        "SELECT idx, title, text FROM chapters WHERE job_id = ? ORDER BY idx",
      )
      .all(jobId) as { idx: number; title: string; text: string }[];

    let assigned = loadCharacterMaps(book.id);
    let narratorVoiceId: string | null = null;

    if (job.custom_voice_path) {
      const refId = `job-${jobId}-narrator`;
      narratorVoiceId = await cloneVoiceFromFile(
        job.custom_voice_path,
        refId,
        "Narrator reference sample for audiobook production.",
      );
    }

    const segmentPlan = chapters.map((ch) => ({
      chapter: ch,
      paragraphs: splitIntoParagraphs(ch.text),
    }));
    const totalSegments = segmentPlan.reduce(
      (n, s) => n + s.paragraphs.length,
      0,
    );
    const totalWorkUnits = Math.max(1, totalSegments * 2);
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

    if (!assigned) {
      log.info("building character map (web research or text sample)");
      report({ phase: "character_map", detail: "Researching characters…" });
      const fullText = chapters.map((c) => c.text).join("\n\n");
      const mapResult = await buildCharacterMap({
        title: book.title,
        author: book.author ?? "Unknown",
        fullText,
      });
      assigned = assignVoices(mapResult.characters, narratorVoiceId);
      saveCharacterMaps(book.id, assigned, mapResult.mode);
      log.info(
        `character map ready: ${assigned.length} voices (${mapResult.mode}, ${mapResult.sources_found} sources)`,
      );
    } else if (narratorVoiceId) {
      assigned = assigned.map((c) =>
        c.role === "narrator" ? { ...c, voice_id: narratorVoiceId! } : c,
      );
      saveCharacterMaps(book.id, assigned, "cached");
    } else {
      log.info(`using cached character map (${assigned!.length} characters)`);
    }

    const referenceIds = referenceIdsInOrder(assigned!);
    const jobDir = path.join(dataDir(), "jobs", String(jobId));
    fs.mkdirSync(jobDir, { recursive: true });

    const chapterOutputs: string[] = [];

    for (const chapter of chapters) {
      const paragraphs = splitIntoParagraphs(chapter.text);
      log.info(
        `chapter ${chapter.idx} "${chapter.title}" — ${paragraphs.length} paragraphs`,
      );
      const speakerMap = speakerMapForChapter(assigned!);

      const annotationJobs = paragraphs.map((p, i) => ({
        chapterIdx: chapter.idx,
        paragraphIdx: i,
        totalInChapter: paragraphs.length,
        paragraph: p,
        prev: i > 0 ? paragraphs[i - 1] : null,
        next: i < paragraphs.length - 1 ? paragraphs[i + 1] : null,
        speakerMap,
      }));

      bumpProgress(
        "annotate",
        `Chapter ${chapter.idx + 1}/${chapters.length}: annotating 0/${paragraphs.length}`,
      );

      const annotated = await annotateParagraphsParallel(annotationJobs, {
        log,
        onParagraphDone: (done, total) => {
          workUnitsDone += 1;
          bumpProgress(
            "annotate",
            `Chapter ${chapter.idx + 1}/${chapters.length}: annotated ${done}/${total}`,
          );
        },
      });
      log.info(`chapter ${chapter.idx} annotation complete`);

      const segmentRows = annotated.map((a, paragraphIdx) => ({
        chapter_idx: chapter.idx,
        paragraph_idx: paragraphIdx,
        annotated_text: a.annotated,
      }));

      const insertSeg = db.prepare(
        `INSERT OR REPLACE INTO segments
         (job_id, chapter_idx, paragraph_idx, annotated_text, status)
         VALUES (?, ?, ?, ?, 'annotated')`,
      );
      for (const row of segmentRows) {
        insertSeg.run(
          jobId,
          row.chapter_idx,
          row.paragraph_idx,
          row.annotated_text,
        );
      }

      const synthJobs = segmentRows.map((row) => ({
        chapterIdx: row.chapter_idx,
        paragraphIdx: row.paragraph_idx,
        totalInChapter: paragraphs.length,
        annotatedText: row.annotated_text,
        referenceIds,
        outputPath: path.join(
          jobDir,
          `ch${row.chapter_idx}-p${row.paragraph_idx}.mp3`,
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

export function prepareJobFromPdf(input: {
  pdfBuffer: Buffer;
  email: string;
  voicePath: string | null;
  title: string;
  author: string | null;
  fullText: string;
  wordCount: number;
  pageCount: number;
}): number {
  const fingerprint = computeFingerprint(input.title, input.fullText);
  const bookId = upsertBook({
    title: input.title,
    author: input.author,
    fingerprint,
    wordCount: input.wordCount,
    pageCount: input.pageCount,
  });

  const db = getDb();
  const jobResult = db
    .prepare(
      `INSERT INTO jobs (book_id, email, custom_voice_path, status)
       VALUES (?, ?, ?, 'queued')`,
    )
    .run(bookId, input.email, input.voicePath);

  const jobId = Number(jobResult.lastInsertRowid);
  const chapters = splitChapters(input.fullText);
  const insertChapter = db.prepare(
    `INSERT INTO chapters (job_id, idx, title, text) VALUES (?, ?, ?, ?)`,
  );
  chapters.forEach((ch, idx) => {
    insertChapter.run(jobId, idx, ch.title, ch.rawText);
  });

  return jobId;
}
