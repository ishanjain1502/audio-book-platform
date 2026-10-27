import { getBook } from "@/lib/book/meta";
import { deriveResearchStatus, type ResearchStatus } from "@/lib/book/researchStatus";
import { loadCharacterMaps } from "@/lib/book/characterMapsDb";
import { getDb } from "@/lib/db/client";
import { toCharacterSummaries, type CharacterSummary } from "@/lib/research/summary";

export type JobReview = {
  bookId: number | null;
  title: string | null;
  author: string | null;
  pageCount: number | null;
  researchStatus: ResearchStatus;
  researchMode: string | null;
  researchError: string | null;
  characters: CharacterSummary[];
};

const EMPTY: JobReview = {
  bookId: null,
  title: null,
  author: null,
  pageCount: null,
  researchStatus: "idle",
  researchMode: null,
  researchError: null,
  characters: [],
};

export function readJobReview(jobId: number, now: Date = new Date()): JobReview {
  const job = getDb()
    .prepare("SELECT book_id FROM jobs WHERE id = ?")
    .get(jobId) as { book_id: number | null } | undefined;
  if (!job?.book_id) return EMPTY;
  const book = getBook(job.book_id);
  if (!book) return EMPTY;
  const saved = loadCharacterMaps(book.id) ?? [];
  return {
    bookId: book.id,
    title: book.title,
    author: book.author,
    pageCount: book.pageCount,
    researchStatus: deriveResearchStatus(book, now),
    researchMode: book.researchMode,
    researchError: book.researchError,
    characters: toCharacterSummaries(saved),
  };
}
