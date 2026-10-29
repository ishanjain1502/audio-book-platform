/**
 * Wipe local app state and recreate an empty SQLite database.
 * Usage: npm run reset
 *
 * Removes app.db (and WAL/SHM) plus the jobs folder so the next job id starts at 1.
 * If the database file is open (for example `npm run dev`), rows are deleted in place.
 * Does not delete Cloudflare R2 objects.
 */
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";

config({ path: path.join(process.cwd(), ".env") });

function resolveDataDir(): string {
  const raw = process.env.DATA_DIR ?? "./src/data";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function isBusy(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "EPERM";
}

function removePath(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`removed ${target}`);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function emptyTables(db: Database.Database): string[] {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];

  db.pragma("foreign_keys = OFF");
  const clear = db.transaction(() => {
    for (const table of tables) {
      db.prepare(`DELETE FROM ${quoteIdent(table.name)}`).run();
    }
    const sequence = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'")
      .get();
    if (sequence) db.prepare("DELETE FROM sqlite_sequence").run();
  });
  clear();
  return tables.map((table) => table.name);
}

const dataDir = resolveDataDir();
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "app.db");
const dbSidecars = [`${dbPath}-wal`, `${dbPath}-shm`];
let removedDbFile = false;
let dbBusy = false;

if (fs.existsSync(dbPath)) {
  try {
    removePath(dbPath);
    removedDbFile = true;
  } catch (error) {
    if (!isBusy(error)) throw error;
    dbBusy = true;
    console.log(`${dbPath} is open, so existing rows will be deleted in place.`);
  }
}

if (!dbBusy) {
  for (const file of dbSidecars) {
    if (!fs.existsSync(file)) continue;
    try {
      removePath(file);
    } catch (error) {
      if (!isBusy(error)) throw error;
      console.log(`left ${file} in place (file is open)`);
    }
  }
}

const jobsDir = path.join(dataDir, "jobs");
if (fs.existsSync(jobsDir)) {
  try {
    removePath(jobsDir);
  } catch (error) {
    if (!isBusy(error)) throw error;
    console.error(
      `${jobsDir} is in use. Stop \`npm run dev\`, then run \`npm run reset\` again.`,
    );
    process.exit(1);
  }
}

async function finish(): Promise<void> {
  const { getDb, closeDb } = await import("../src/lib/db/client");
  const db = getDb();
  db.pragma("busy_timeout = 5000");
  const tables = emptyTables(db);
  closeDb();

  console.log(
    removedDbFile ? `fresh database at ${dbPath}` : `cleared database at ${dbPath}`,
  );
  console.log(`tables: ${tables.join(", ")}`);
}

finish().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
