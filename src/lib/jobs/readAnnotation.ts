import { parseAnnotationTurns } from "@/lib/annotate/turns";
import { firstIncompleteSection, sectionIsComplete } from "@/lib/annotate/sectionReady";
import { getDb } from "@/lib/db/client";
import { splitIntoParagraphs } from "@/lib/pdf/chapters";

export type AnnotationMessage = {
  paragraphIdx: number;
  turnIdx: number;
  speakerIndex: number;
  speakerName: string;
  text: string;
};

export type AnnotationSection = {
  n: number;
  title: string;
  reviewed: boolean;
  messages: AnnotationMessage[];
};

export type AnnotationView = {
  status: string;
  error: string | null;
  currentSection: number | null;
  characters: { name: string; speakerIndex: number }[];
  sections: AnnotationSection[];
  book: { title: string; author: string | null; pageCount: number | null };
};

type ChapterRow = {
  idx: number;
  title: string;
  text: string;
  reviewed: number;
};

function speakerNameForIndex(
  speakerIndex: number,
  byIndex: Map<number, string>,
): string {
  return byIndex.get(speakerIndex) ?? `Speaker ${speakerIndex}`;
}

export function readAnnotation(jobId: number): AnnotationView | null {
  const job = getDb()
    .prepare("SELECT status, error, book_id FROM jobs WHERE id = ?")
    .get(jobId) as { status: string; error: string | null; book_id: number | null } | undefined;
  if (!job?.book_id) return null;

  const book = getDb()
    .prepare("SELECT title, author, page_count FROM books WHERE id = ?")
    .get(job.book_id) as
    | { title: string; author: string | null; page_count: number | null }
    | undefined;
  if (!book) return null;

  const characterRows = getDb()
    .prepare(
      "SELECT name, speaker_index FROM character_maps WHERE book_id = ? ORDER BY speaker_index",
    )
    .all(job.book_id) as { name: string; speaker_index: number }[];

  const characters = characterRows.map((row) => ({
    name: row.name,
    speakerIndex: row.speaker_index,
  }));

  const nameBySpeakerIndex = new Map(
    characterRows.map((row) => [row.speaker_index, row.name] as const),
  );

  const chapters = getDb()
    .prepare(
      "SELECT idx, title, text, reviewed FROM chapters WHERE job_id = ? ORDER BY idx",
    )
    .all(jobId) as ChapterRow[];

  const segmentCountStmt = getDb().prepare(
    "SELECT COUNT(*) AS c FROM segments WHERE job_id = ? AND chapter_idx = ?",
  );

  const sectionInputs = chapters.map((chapter) => ({
    idx: chapter.idx,
    paragraphCount: splitIntoParagraphs(chapter.text).length,
    segmentCount: (
      segmentCountStmt.get(jobId, chapter.idx) as { c: number }
    ).c,
  }));

  const incomplete =
    job.status === "annotating" ? firstIncompleteSection(sectionInputs) : null;

  const segmentRowsStmt = getDb().prepare(
    `SELECT paragraph_idx, annotated_text FROM segments
     WHERE job_id = ? AND chapter_idx = ?
     ORDER BY paragraph_idx`,
  );

  const sections: AnnotationSection[] = [];

  for (const chapter of chapters) {
    const input = sectionInputs.find((s) => s.idx === chapter.idx)!;
    if (!sectionIsComplete(input.paragraphCount, input.segmentCount)) continue;

    const messages: AnnotationMessage[] = [];
    const segmentRows = segmentRowsStmt.all(jobId, chapter.idx) as {
      paragraph_idx: number;
      annotated_text: string;
    }[];

    for (const segment of segmentRows) {
      const turns = parseAnnotationTurns(segment.annotated_text);
      turns.forEach((turn, turnIdx) => {
        messages.push({
          paragraphIdx: segment.paragraph_idx,
          turnIdx,
          speakerIndex: turn.speakerIndex,
          speakerName: speakerNameForIndex(turn.speakerIndex, nameBySpeakerIndex),
          text: turn.text,
        });
      });
    }

    sections.push({
      n: chapter.idx + 1,
      title: chapter.title,
      reviewed: chapter.reviewed !== 0,
      messages,
    });
  }

  return {
    status: job.status,
    error: job.error,
    currentSection: incomplete,
    characters,
    sections,
    book: {
      title: book.title,
      author: book.author,
      pageCount: book.page_count,
    },
  };
}
