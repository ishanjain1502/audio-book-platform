import { getDb } from "@/lib/db/client";

export class BookMetaError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "BookMetaError";
  }
}

export function normalizeAuthor(author: string | null | undefined): string | null {
  const trimmed = author?.trim() ?? "";
  return trimmed.length ? trimmed : null;
}

export function parseBookMeta(input: {
  title: string;
  author: string | null;
  pageCount: number;
}): { title: string; author: string | null; pageCount: number } {
  const title = input.title.trim();
  if (!title) throw new BookMetaError("Title is required");
  if (!Number.isInteger(input.pageCount) || input.pageCount < 1) {
    throw new BookMetaError("Page count must be a positive integer");
  }
  return { title, author: normalizeAuthor(input.author), pageCount: input.pageCount };
}

export type BookRecord = {
  id: number;
  title: string | null;
  author: string | null;
  fingerprint: string;
  pageCount: number | null;
  wordCount: number | null;
  pdfObjectKey: string | null;
  pdfAccessUrl: string | null;
  researchedAt: string | null;
  researchMode: string | null;
  researchStartedAt: string | null;
  researchError: string | null;
};

type BookRow = {
  id: number;
  title: string | null;
  author: string | null;
  fingerprint: string;
  page_count: number | null;
  word_count: number | null;
  pdf_object_key: string | null;
  pdf_access_url: string | null;
  researched_at: string | null;
  research_mode: string | null;
  research_started_at: string | null;
  research_error: string | null;
};

function mapBook(row: BookRow): BookRecord {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    fingerprint: row.fingerprint,
    pageCount: row.page_count,
    wordCount: row.word_count,
    pdfObjectKey: row.pdf_object_key,
    pdfAccessUrl: row.pdf_access_url,
    researchedAt: row.researched_at,
    researchMode: row.research_mode,
    researchStartedAt: row.research_started_at,
    researchError: row.research_error,
  };
}

export function getBook(bookId: number): BookRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, title, author, fingerprint, page_count, word_count,
              pdf_object_key, pdf_access_url, researched_at, research_mode,
              research_started_at, research_error
       FROM books WHERE id = ?`,
    )
    .get(bookId) as BookRow | undefined;
  return row ? mapBook(row) : null;
}

export function updateBookMeta(
  bookId: number,
  meta: { title: string; author: string | null; pageCount: number },
): void {
  getDb()
    .prepare("UPDATE books SET title = ?, author = ?, page_count = ? WHERE id = ?")
    .run(meta.title, meta.author, meta.pageCount, bookId);
}
