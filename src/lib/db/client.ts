import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
let db: Database.Database | null = null;

function resolveDataDir(): string {
  const raw = process.env.DATA_DIR ?? "./src/data";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function ensureSchema(database: Database.Database): void {
  const schemaPath = path.join(process.cwd(), "src/lib/db/schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  database.exec(sql);
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
