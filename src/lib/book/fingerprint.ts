import { createHash } from "crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";

export type BookRow = {
  id: number;
  title: string | null;
  author: string | null;
  fingerprint: string;
};

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function firstWords(text: string, count: number): string {
  const words = normalizeWhitespace(text).split(" ").filter(Boolean);
  return words.slice(0, count).join(" ");
}

export function computeFingerprint(title: string, fullText: string): string {
  const payload = `${normalizeWhitespace(title).toLowerCase()}|${firstWords(fullText, 5000)}`;
  return createHash("sha256").update(payload).digest("hex");
}

export function findBookByFingerprint(
  fingerprint: string,
  database?: Database.Database,
): BookRow | null {
  const db = database ?? getDb();
  const row = db
    .prepare(
      "SELECT id, title, author, fingerprint FROM books WHERE fingerprint = ?",
    )
    .get(fingerprint) as BookRow | undefined;
  return row ?? null;
}

export function upsertBook(
  input: {
    title: string;
    author: string | null;
    fingerprint: string;
    pageCount?: number;
    wordCount?: number;
  },
  database?: Database.Database,
): number {
  const db = database ?? getDb();
  const existing = findBookByFingerprint(input.fingerprint, db);
  if (existing) return existing.id;

  const result = db
    .prepare(
      `INSERT INTO books (title, author, fingerprint, page_count, word_count)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      input.author,
      input.fingerprint,
      input.pageCount ?? null,
      input.wordCount ?? null,
    );
  return Number(result.lastInsertRowid);
}
