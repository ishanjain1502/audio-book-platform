import {
  AnnotationTurnError,
  replaceSpeakerTurn,
  serializeAnnotationTurns,
} from "@/lib/annotate/turns";
import { sectionIsComplete } from "@/lib/annotate/sectionReady";
import { getDb } from "@/lib/db/client";
import { splitIntoParagraphs } from "@/lib/pdf/chapters";

const ANNOTATION_OPEN = new Set(["annotating", "awaiting_annotation"]);

type Fail = { ok: false; status: number; error: string };

function annotationNotOpen(): Fail {
  return { ok: false, status: 409, error: "Annotation is not open for review" };
}

function getJob(jobId: number): { status: string; book_id: number | null } | undefined {
  return getDb()
    .prepare("SELECT status, book_id FROM jobs WHERE id = ?")
    .get(jobId) as { status: string; book_id: number | null } | undefined;
}

function assertAnnotationOpen(jobId: number): Fail | null {
  const job = getJob(jobId);
  if (!job) return { ok: false, status: 404, error: "Job not found" };
  if (!ANNOTATION_OPEN.has(job.status)) return annotationNotOpen();
  return null;
}

export function setSectionReviewed(
  jobId: number,
  chapterIdx: number,
  reviewed: boolean,
): { ok: true; reviewed: boolean } | Fail {
  const gate = assertAnnotationOpen(jobId);
  if (gate) return gate;

  const chapter = getDb()
    .prepare("SELECT idx FROM chapters WHERE job_id = ? AND idx = ?")
    .get(jobId, chapterIdx);
  if (!chapter) return { ok: false, status: 404, error: "Job not found" };

  getDb()
    .prepare("UPDATE chapters SET reviewed = ? WHERE job_id = ? AND idx = ?")
    .run(reviewed ? 1 : 0, jobId, chapterIdx);

  return { ok: true, reviewed };
}

export function setTurnSpeaker(
  jobId: number,
  input: {
    chapterIdx: number;
    paragraphIdx: number;
    turnIdx: number;
    speakerIndex: number;
  },
): { ok: true; speakerIndex: number; speakerName: string } | Fail {
  const gate = assertAnnotationOpen(jobId);
  if (gate) return gate;

  const job = getJob(jobId)!;
  if (!job.book_id) return { ok: false, status: 404, error: "Job not found" };

  const chapter = getDb()
    .prepare("SELECT text FROM chapters WHERE job_id = ? AND idx = ?")
    .get(jobId, input.chapterIdx) as { text: string } | undefined;
  if (!chapter) return { ok: false, status: 404, error: "Job not found" };

  const paragraphCount = splitIntoParagraphs(chapter.text).length;
  const segmentCount = (
    getDb()
      .prepare(
        "SELECT COUNT(*) AS c FROM segments WHERE job_id = ? AND chapter_idx = ?",
      )
      .get(jobId, input.chapterIdx) as { c: number }
  ).c;

  if (!sectionIsComplete(paragraphCount, segmentCount)) {
    return { ok: false, status: 409, error: "Section is not ready" };
  }

  const speakerRow = getDb()
    .prepare(
      "SELECT name FROM character_maps WHERE book_id = ? AND speaker_index = ?",
    )
    .get(job.book_id, input.speakerIndex) as { name: string } | undefined;
  if (!speakerRow) {
    return { ok: false, status: 400, error: "Unknown speaker" };
  }

  const segment = getDb()
    .prepare(
      `SELECT annotated_text FROM segments
       WHERE job_id = ? AND chapter_idx = ? AND paragraph_idx = ?`,
    )
    .get(jobId, input.chapterIdx, input.paragraphIdx) as
    | { annotated_text: string }
    | undefined;
  if (!segment) {
    return { ok: false, status: 404, error: "Segment not found" };
  }

  let updated: string;
  try {
    updated = replaceSpeakerTurn(
      segment.annotated_text,
      input.turnIdx,
      input.speakerIndex,
    );
  } catch (err) {
    if (err instanceof AnnotationTurnError) {
      return { ok: false, status: 400, error: err.message };
    }
    throw err;
  }

  getDb()
    .prepare(
      `UPDATE segments SET annotated_text = ?
       WHERE job_id = ? AND chapter_idx = ? AND paragraph_idx = ?`,
    )
    .run(updated, jobId, input.chapterIdx, input.paragraphIdx);

  return {
    ok: true,
    speakerIndex: input.speakerIndex,
    speakerName: speakerRow.name,
  };
}

export type SavedTurn = {
  turnIdx: number;
  speakerIndex: number;
  speakerName: string;
  text: string;
};

export function replaceParagraphTurns(
  jobId: number,
  input: {
    chapterIdx: number;
    paragraphIdx: number;
    turns: { speakerIndex: number; text: string }[];
  },
): { ok: true; paragraphIdx: number; turns: SavedTurn[] } | Fail {
  const gate = assertAnnotationOpen(jobId);
  if (gate) return gate;

  if (input.turns.length === 0) {
    return { ok: false, status: 400, error: "A paragraph must have a line" };
  }
  if (
    !Number.isInteger(input.chapterIdx) ||
    !Number.isInteger(input.paragraphIdx) ||
    input.turns.some(
      (turn) => typeof turn.text !== "string" || !Number.isInteger(turn.speakerIndex),
    )
  ) {
    return { ok: false, status: 400, error: "Invalid line" };
  }
  if (input.turns.some((turn) => turn.text.includes("<|speaker:"))) {
    return { ok: false, status: 400, error: "A line cannot contain a speaker tag" };
  }

  const job = getJob(jobId)!;
  if (!job.book_id) return { ok: false, status: 404, error: "Job not found" };

  const chapter = getDb()
    .prepare("SELECT text FROM chapters WHERE job_id = ? AND idx = ?")
    .get(jobId, input.chapterIdx) as { text: string } | undefined;
  if (!chapter) return { ok: false, status: 404, error: "Job not found" };

  const paragraphCount = splitIntoParagraphs(chapter.text).length;
  const segmentCount = (
    getDb()
      .prepare(
        "SELECT COUNT(*) AS c FROM segments WHERE job_id = ? AND chapter_idx = ?",
      )
      .get(jobId, input.chapterIdx) as { c: number }
  ).c;
  if (!sectionIsComplete(paragraphCount, segmentCount)) {
    return { ok: false, status: 409, error: "Section is not ready" };
  }

  const names = new Map<number, string>();
  for (const turn of input.turns) {
    if (names.has(turn.speakerIndex)) continue;
    const speakerRow = getDb()
      .prepare(
        "SELECT name FROM character_maps WHERE book_id = ? AND speaker_index = ?",
      )
      .get(job.book_id, turn.speakerIndex) as { name: string } | undefined;
    if (!speakerRow) return { ok: false, status: 400, error: "Unknown speaker" };
    names.set(turn.speakerIndex, speakerRow.name);
  }

  const segment = getDb()
    .prepare(
      `SELECT annotated_text FROM segments
       WHERE job_id = ? AND chapter_idx = ? AND paragraph_idx = ?`,
    )
    .get(jobId, input.chapterIdx, input.paragraphIdx) as
    | { annotated_text: string }
    | undefined;
  if (!segment) return { ok: false, status: 404, error: "Segment not found" };

  getDb()
    .prepare(
      `UPDATE segments SET annotated_text = ?
       WHERE job_id = ? AND chapter_idx = ? AND paragraph_idx = ?`,
    )
    .run(
      serializeAnnotationTurns(input.turns),
      jobId,
      input.chapterIdx,
      input.paragraphIdx,
    );

  return {
    ok: true,
    paragraphIdx: input.paragraphIdx,
    turns: input.turns.map((turn, turnIdx) => ({
      turnIdx,
      speakerIndex: turn.speakerIndex,
      speakerName: names.get(turn.speakerIndex) ?? `Speaker ${turn.speakerIndex}`,
      text: turn.text,
    })),
  };
}
