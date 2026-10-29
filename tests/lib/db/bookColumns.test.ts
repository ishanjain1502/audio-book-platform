import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyBookColumnMigrations, applyChapterColumnMigrations } from "@/lib/db/client";

const COLUMNS = [
  "pdf_object_key",
  "pdf_access_url",
  "pdf_uploaded_at",
  "researched_at",
  "research_mode",
  "research_started_at",
  "research_error",
];

describe("applyBookColumnMigrations", () => {
  it("adds book storage and research columns to an old books table", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE books (
        id INTEGER PRIMARY KEY,
        title TEXT,
        author TEXT,
        fingerprint TEXT UNIQUE NOT NULL,
        page_count INTEGER,
        word_count INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    applyBookColumnMigrations(database);
    applyBookColumnMigrations(database);
    const names = (
      database.prepare("PRAGMA table_info(books)").all() as { name: string }[]
    ).map((column) => column.name);
    for (const column of COLUMNS) expect(names).toContain(column);
    database.close();
  });
});

describe("applyChapterColumnMigrations", () => {
  it("adds chapters.reviewed to an old chapters table", () => {
    const database = new Database(":memory:");
    database.exec(`
    CREATE TABLE chapters (
      id INTEGER PRIMARY KEY,
      job_id INTEGER,
      idx INTEGER,
      title TEXT,
      text TEXT,
      speaker_count INTEGER
    );
  `);
    applyChapterColumnMigrations(database);
    applyChapterColumnMigrations(database);
    const names = (
      database.prepare("PRAGMA table_info(chapters)").all() as { name: string }[]
    ).map((column) => column.name);
    expect(names).toContain("reviewed");
    database.close();
  });
});
