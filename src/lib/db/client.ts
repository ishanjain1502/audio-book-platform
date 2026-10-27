import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
let db: Database.Database | null = null;

function resolveDataDir(): string {
  const raw = process.env.DATA_DIR ?? "./src/data";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

const BOOK_MIGRATION_COLUMNS = [
  "pdf_object_key",
  "pdf_access_url",
  "pdf_uploaded_at",
  "researched_at",
  "research_mode",
  "research_started_at",
  "research_error",
] as const;

export function applyBookColumnMigrations(database: Database.Database): void {
  const existing = new Set(
    (database.prepare("PRAGMA table_info(books)").all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  for (const column of BOOK_MIGRATION_COLUMNS) {
    if (!existing.has(column)) {
      database.exec(`ALTER TABLE books ADD COLUMN ${column} TEXT`);
    }
  }
}

function ensureSchema(database: Database.Database): void {
  const schemaPath = path.join(process.cwd(), "src/lib/db/schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  database.exec(sql);
  applyBookColumnMigrations(database);
}

/** Closes the singleton (for tests). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function getDb(): Database.Database {
  if (db) return db;

  const dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "app.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureSchema(db);
  return db;
}
