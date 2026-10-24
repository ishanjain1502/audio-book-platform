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

export async function runJob(jobId: number): Promise<void> {
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

    if (!assigned) {
      const fullText = chapters.map((c) => c.text).join("\n\n");
      const mapResult = await buildCharacterMap({
        title: book.title,
        author: book.author ?? "Unknown",
        fullText,
      });
      assigned = assignVoices(mapResult.characters, narratorVoiceId);
      saveCharacterMaps(book.id, assigned, mapResult.mode);
    } else if (narratorVoiceId) {
      assigned = assigned.map((c) =>
        c.role === "narrator" ? { ...c, voice_id: narratorVoiceId! } : c,
      );
      saveCharacterMaps(book.id, assigned, "cached");
    }

    const referenceIds = referenceIdsInOrder(assigned);
    const jobDir = path.join(dataDir(), "jobs", String(jobId));
    fs.mkdirSync(jobDir, { recursive: true });

    const chapterOutputs: string[] = [];

    for (const chapter of chapters) {
      const paragraphs = splitIntoParagraphs(chapter.text);
      const speakerMap = speakerMapForChapter(assigned);

      const annotationJobs = paragraphs.map((p, i) => ({
        paragraph: p,
        prev: i > 0 ? paragraphs[i - 1] : null,
        next: i < paragraphs.length - 1 ? paragraphs[i + 1] : null,
        speakerMap,
      }));

      const annotated = await annotateParagraphsParallel(annotationJobs);

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
        annotatedText: row.annotated_text,
        referenceIds,
        outputPath: path.join(
          jobDir,
          `ch${row.chapter_idx}-p${row.paragraph_idx}.mp3`,
        ),
      }));

      await synthesizeJobsParallel(synthJobs);

      const chapterOut = path.join(jobDir, `chapter-${chapter.idx}.mp3`);
      stitchMp3Files(
        synthJobs.map((s) => s.outputPath),
        chapterOut,
      );
      chapterOutputs.push(chapterOut);

      db.prepare(
        `UPDATE segments SET status = 'synthesized', audio_path = ?
         WHERE job_id = ? AND chapter_idx = ?`,
      ).run(synthJobs[0]?.outputPath ?? null, jobId, chapter.idx);
    }

    setJobStatus(jobId, "stitching");
    sendEmailStub(job.email, chapterOutputs);
    setJobStatus(jobId, "done");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setJobStatus(jobId, "failed", message);
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
