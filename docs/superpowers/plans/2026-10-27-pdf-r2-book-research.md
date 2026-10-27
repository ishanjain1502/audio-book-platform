# PDF upload to R2 and one-time book research — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload a text PDF to R2, save book meta on the `books` row, research that book only once, and start audiobook generation only after the user confirms the review.

**Architecture:** `POST /api/jobs` validates the PDF and voice, upserts the book, stores `books/{bookId}/source.pdf`, and creates a job in `awaiting_review` without starting the worker. The review page reads saved meta. `POST /api/jobs/{id}/research` runs `buildCharacterMap` only when `researched_at` is null, then saves `character_maps`. Confirm updates meta and spawns the existing worker, which skips research when a map is already saved.

**Tech Stack:** Next.js 15 App Router, SQLite (`better-sqlite3`), Vitest, `@aws-sdk/client-s3` for Cloudflare R2, existing `buildCharacterMap` and `assignVoices`.

## Global Constraints

- PDF object key is `books/{bookId}/source.pdf`. If `books.pdf_object_key` is set, skip the put.
- Do not store presigned URLs. `pdf_access_url` is `/api/books/{bookId}/pdf`. Do not add a download handler.
- `STORAGE_BACKEND=r2` uses the `media-assets` bucket and existing `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. `STORAGE_BACKEND=local` writes under `DATA_DIR`. Tests use `local`.
- Voice samples stay on local disk at `jobs.custom_voice_path`. Do not upload them to R2.
- Research runs only when `researched_at` is null. Success sets `researched_at` and `research_mode` (`web_research` or `text_sample`) and saves `character_maps`. Failure sets `research_error`, clears `research_started_at`, and leaves `researched_at` null.
- A fresh `research_started_at` younger than 10 minutes means `running`. Do not start a second research. A lock older than 10 minutes is stale.
- Write the research lock and commit it before calling the model.
- Title and author edits update the same `books` row, do not change `fingerprint`, and do not research again.
- A fingerprint match keeps the stored title, author, page count, and word count.
- Fingerprint formula stays `sha256` of the normalized title at upload plus the first 5,000 words.
- Confirm is allowed only for `awaiting_review` when `researched_at` is set, the title is non-empty, and the page count is a positive integer. A blank author is stored as null.
- A second confirm is rejected. The worker is spawned with the job id only and does not read `upload.json` when the job already has a book and chapters.
- `runJob` does not research when a character map is already saved. Do not change the custom-narrator remap branch.
- Invalid PDF or voice stores nothing in R2 and creates no job. A failed R2 put creates no job.
- Unit tests only. No live R2 and no live model calls.
- Timestamps written by this feature are ISO-8601 UTC strings.

## File map

| Path | Responsibility |
| --- | --- |
| `src/lib/db/schema.sql` | New `books` columns on fresh databases |
| `src/lib/db/client.ts` | Additive column migration for existing databases |
| `src/lib/storage/types.ts` | `Storage` interface |
| `src/lib/storage/keys.ts` | PDF object key and access path |
| `src/lib/storage/local.ts` | Filesystem storage under `DATA_DIR/objects` |
| `src/lib/storage/r2.ts` | R2 `put` / `getBuffer` |
| `src/lib/storage/index.ts` | `getStorage()` from `STORAGE_BACKEND` |
| `src/lib/book/meta.ts` | Read and update book meta without touching fingerprint |
| `src/lib/book/researchStatus.ts` | `idle` / `running` / `ready` / `failed` |
| `src/lib/book/confirmRules.ts` | Pure confirm gate |
| `src/lib/research/summary.ts` | Character list shown on the review page |
| `src/lib/research/ensureBookResearch.ts` | One-time research lock and save |
| `src/lib/pipeline/storeBookPdf.ts` | Put the PDF once per book |
| `src/lib/pipeline/ingestUpload.ts` | Book, PDF, job, and chapters for `awaiting_review` |
| `src/lib/pipeline/jobReady.ts` | Whether the worker can skip PDF prepare |
| `src/lib/jobs/readJobReview.ts` | Review fields for `GET /api/jobs/{id}` |
| `src/lib/jobs/updateJobBook.ts` | Meta edit while awaiting review |
| `src/lib/jobs/confirmJob.ts` | Confirm gate, meta write, spawn |
| `src/lib/jobs/spawnRunner.ts` | Detached `scripts/run-job.ts` process |
| `src/app/api/jobs/route.ts` | Upload stops before the worker |
| `src/app/api/jobs/[id]/route.ts` | Include review fields |
| `src/app/api/jobs/[id]/research/route.ts` | Start or reuse research |
| `src/app/api/jobs/[id]/book/route.ts` | Save meta edits |
| `src/app/api/jobs/[id]/confirm/route.ts` | Confirm and spawn |
| `src/app/page.tsx` | Redirect to the review page |
| `src/app/jobs/[id]/review/page.tsx` | Meta form, research list, confirm |
| `scripts/run-job.ts` | Skip `upload.json` when the job is already prepared |

---

### Task 1: Book columns on new and existing databases

**Files:**
- Modify: `src/lib/db/schema.sql`
- Modify: `src/lib/db/client.ts`
- Test: `tests/lib/db/bookColumns.test.ts`

**Interfaces:**
- Consumes: `getDb` / `closeDb` from `src/lib/db/client.ts`
- Produces: `applyBookColumnMigrations(database: Database.Database): void`. Columns on `books`: `pdf_object_key`, `pdf_access_url`, `pdf_uploaded_at`, `researched_at`, `research_mode`, `research_started_at`, `research_error`, all `TEXT` null.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/bookColumns.test.ts`:

```ts
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyBookColumnMigrations } from "@/lib/db/client";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/db/bookColumns.test.ts`

Expected: FAIL because `applyBookColumnMigrations` is not exported.

- [ ] **Step 3: Add the columns and the migration**

Replace the `books` table in `src/lib/db/schema.sql` with:

```sql
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  title TEXT,
  author TEXT,
  fingerprint TEXT UNIQUE NOT NULL,
  page_count INTEGER,
  word_count INTEGER,
  pdf_object_key TEXT,
  pdf_access_url TEXT,
  pdf_uploaded_at TEXT,
  researched_at TEXT,
  research_mode TEXT,
  research_started_at TEXT,
  research_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Add this export to `src/lib/db/client.ts` and call it at the end of `ensureSchema`:

```ts
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
```

`ensureSchema` becomes:

```ts
function ensureSchema(database: Database.Database): void {
  const schemaPath = path.join(process.cwd(), "src/lib/db/schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  database.exec(sql);
  applyBookColumnMigrations(database);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/db/bookColumns.test.ts tests/lib/db/client.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.sql src/lib/db/client.ts tests/lib/db/bookColumns.test.ts
git commit -m "feat: add book pdf and research columns"
```

---

### Task 2: Local storage and PDF object keys

**Files:**
- Create: `src/lib/storage/types.ts`
- Create: `src/lib/storage/keys.ts`
- Create: `src/lib/storage/local.ts`
- Test: `tests/lib/storage/local.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces:
  - `bookPdfObjectKey(bookId: number): string`
  - `bookPdfAccessUrl(bookId: number): string`
  - `interface Storage { put(key: string, body: Buffer, contentType: string): Promise<void>; getBuffer(key: string): Promise<Buffer>; }`
  - `class LocalStorage implements Storage` with constructor `(rootDir: string)`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/storage/local.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { bookPdfAccessUrl, bookPdfObjectKey } from "@/lib/storage/keys";
import { LocalStorage } from "@/lib/storage/local";

describe("local storage", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads a book pdf at books/{id}/source.pdf", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "abg-store-"));
    dirs.push(root);
    const storage = new LocalStorage(root);
    const key = bookPdfObjectKey(12);
    expect(key).toBe("books/12/source.pdf");
    expect(bookPdfAccessUrl(12)).toBe("/api/books/12/pdf");
    await storage.put(key, Buffer.from("pdf-bytes"), "application/pdf");
    const read = await storage.getBuffer(key);
    expect(read.toString()).toBe("pdf-bytes");
    expect(fs.existsSync(path.join(root, "books", "12", "source.pdf"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/storage/local.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement keys and local storage**

`src/lib/storage/types.ts`:

```ts
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getBuffer(key: string): Promise<Buffer>;
}
```

`src/lib/storage/keys.ts`:

```ts
export function bookPdfObjectKey(bookId: number): string {
  return `books/${bookId}/source.pdf`;
}

export function bookPdfAccessUrl(bookId: number): string {
  return `/api/books/${bookId}/pdf`;
}
```

`src/lib/storage/local.ts`:

```ts
import fs from "fs";
import path from "path";
import type { Storage } from "@/lib/storage/types";

export class LocalStorage implements Storage {
  constructor(private readonly rootDir: string) {}

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const file = path.join(this.rootDir, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }

  async getBuffer(key: string): Promise<Buffer> {
    return fs.readFileSync(path.join(this.rootDir, key));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/storage/local.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/types.ts src/lib/storage/keys.ts src/lib/storage/local.ts tests/lib/storage/local.test.ts
git commit -m "feat: add local storage for book pdfs"
```

---

### Task 3: R2 storage and backend selection

**Files:**
- Create: `src/lib/storage/r2.ts`
- Create: `src/lib/storage/index.ts`
- Modify: `package.json` (via npm install)
- Test: `tests/lib/storage/r2.test.ts`

**Interfaces:**
- Consumes: `Storage` from `src/lib/storage/types.ts`
- Produces:
  - `class R2Storage implements Storage` with constructor `(client: { send(command: unknown): Promise<unknown> }, bucket: string)`
  - `getStorage(): Storage`. `STORAGE_BACKEND=local` returns `LocalStorage` rooted at `DATA_DIR/objects`. `STORAGE_BACKEND=r2` returns `R2Storage`. Any other value throws `Error` whose message includes `Unknown STORAGE_BACKEND`.

- [ ] **Step 1: Install the SDK and write the failing test**

Run: `npm install @aws-sdk/client-s3`

Create `tests/lib/storage/r2.test.ts`:

```ts
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getStorage } from "@/lib/storage";
import { LocalStorage } from "@/lib/storage/local";
import { R2Storage } from "@/lib/storage/r2";

describe("R2Storage", () => {
  it("puts and gets an object through the S3 client", async () => {
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        if (command instanceof GetObjectCommand) {
          return { Body: { transformToByteArray: async () => Buffer.from("pdf") } };
        }
        return {};
      },
    };
    const storage = new R2Storage(client, "media-assets");
    await storage.put("books/3/source.pdf", Buffer.from("pdf"), "application/pdf");
    const read = await storage.getBuffer("books/3/source.pdf");
    expect(read.toString()).toBe("pdf");
    expect(sent[0]).toBeInstanceOf(PutObjectCommand);
    expect(sent[1]).toBeInstanceOf(GetObjectCommand);
  });
});

describe("getStorage", () => {
  const prevBackend = process.env.STORAGE_BACKEND;
  const prevData = process.env.DATA_DIR;
  const dirs: string[] = [];

  afterEach(() => {
    process.env.STORAGE_BACKEND = prevBackend;
    process.env.DATA_DIR = prevData;
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns local storage under DATA_DIR/objects", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "abg-backend-"));
    dirs.push(root);
    process.env.DATA_DIR = root;
    process.env.STORAGE_BACKEND = "local";
    const storage = getStorage();
    expect(storage).toBeInstanceOf(LocalStorage);
  });

  it("rejects an unknown backend", () => {
    process.env.STORAGE_BACKEND = "s3";
    expect(() => getStorage()).toThrow(/Unknown STORAGE_BACKEND/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/storage/r2.test.ts`

Expected: FAIL because `src/lib/storage/r2.ts` and `src/lib/storage/index.ts` do not exist.

- [ ] **Step 3: Implement R2 and getStorage**

`src/lib/storage/r2.ts`:

```ts
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Storage } from "@/lib/storage/types";

type ObjectClient = {
  send(command: unknown): Promise<{ Body?: { transformToByteArray?: () => Promise<Uint8Array> } }>;
};

export class R2Storage implements Storage {
  constructor(
    private readonly client: ObjectClient,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getBuffer(key: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const transform = out.Body?.transformToByteArray;
    if (!transform) throw new Error(`Empty R2 object: ${key}`);
    return Buffer.from(await transform());
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function createR2StorageFromEnv(): R2Storage {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return new R2Storage(client, requireEnv("R2_BUCKET_NAME"));
}
```

`src/lib/storage/index.ts`:

```ts
import path from "path";
import { LocalStorage } from "@/lib/storage/local";
import { createR2StorageFromEnv } from "@/lib/storage/r2";
import type { Storage } from "@/lib/storage/types";

function dataDir(): string {
  const raw = process.env.DATA_DIR ?? "./src/data";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function getStorage(): Storage {
  const backend = process.env.STORAGE_BACKEND ?? "local";
  if (backend === "local") return new LocalStorage(path.join(dataDir(), "objects"));
  if (backend === "r2") return createR2StorageFromEnv();
  throw new Error(`Unknown STORAGE_BACKEND: ${backend}`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/storage/r2.test.ts tests/lib/storage/local.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/storage/r2.ts src/lib/storage/index.ts tests/lib/storage/r2.test.ts
git commit -m "feat: add R2 storage backend"
```

---

### Task 4: Book meta that does not fork the book

**Files:**
- Create: `src/lib/book/meta.ts`
- Test: `tests/lib/book/meta.test.ts`

**Interfaces:**
- Consumes: `upsertBook` from `src/lib/book/fingerprint.ts`, `getDb` / `closeDb`
- Produces:
  - `class BookMetaError extends Error` with `statusCode = 400`
  - `normalizeAuthor(author: string | null | undefined): string | null`
  - `parseBookMeta(input: { title: string; author: string | null; pageCount: number }): { title: string; author: string | null; pageCount: number }`
  - `BookRecord` with `id`, `title`, `author`, `fingerprint`, `pageCount`, `wordCount`, `pdfObjectKey`, `pdfAccessUrl`, `researchedAt`, `researchMode`, `researchStartedAt`, `researchError`
  - `getBook(bookId: number): BookRecord | null`
  - `updateBookMeta(bookId: number, meta: { title: string; author: string | null; pageCount: number }): void`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/book/meta.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("book meta", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-meta-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps the first meta when the same fingerprint is inserted again", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getBook } = await import("@/lib/book/meta");
    const first = upsertBook({
      title: "Original",
      author: "Ada",
      fingerprint: "abc",
      pageCount: 10,
      wordCount: 800,
    });
    const second = upsertBook({
      title: "Replacement",
      author: "Bea",
      fingerprint: "abc",
      pageCount: 99,
      wordCount: 1,
    });
    expect(second).toBe(first);
    const book = getBook(first);
    expect(book?.title).toBe("Original");
    expect(book?.author).toBe("Ada");
    expect(book?.pageCount).toBe(10);
    expect(book?.wordCount).toBe(800);
  });

  it("updates title, author, and page count without changing the fingerprint", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getBook, parseBookMeta, updateBookMeta } = await import("@/lib/book/meta");
    const bookId = upsertBook({
      title: "Original",
      author: "Ada",
      fingerprint: "abc",
      pageCount: 10,
      wordCount: 800,
    });
    const meta = parseBookMeta({ title: "  New Title  ", author: "   ", pageCount: 12 });
    expect(meta.author).toBeNull();
    updateBookMeta(bookId, meta);
    const book = getBook(bookId);
    expect(book?.title).toBe("New Title");
    expect(book?.author).toBeNull();
    expect(book?.pageCount).toBe(12);
    expect(book?.fingerprint).toBe("abc");
    expect(book?.wordCount).toBe(800);
  });

  it("rejects an empty title and a non-positive page count", async () => {
    const { parseBookMeta } = await import("@/lib/book/meta");
    expect(() => parseBookMeta({ title: "  ", author: null, pageCount: 1 })).toThrow(
      /Title is required/,
    );
    expect(() => parseBookMeta({ title: "Book", author: null, pageCount: 0 })).toThrow(
      /Page count must be a positive integer/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/book/meta.test.ts`

Expected: FAIL because `@/lib/book/meta` does not exist. The first assertion group must stay failing only for the missing module. `upsertBook` already keeps the original row; do not add an `UPDATE` to `upsertBook`.

- [ ] **Step 3: Implement meta reads and updates**

Create `src/lib/book/meta.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/book/meta.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/book/meta.ts tests/lib/book/meta.test.ts
git commit -m "feat: save book meta without changing fingerprint"
```

---

### Task 5: Research status and confirm rules

**Files:**
- Create: `src/lib/book/researchStatus.ts`
- Create: `src/lib/book/confirmRules.ts`
- Test: `tests/lib/book/researchStatus.test.ts`
- Test: `tests/lib/book/confirmRules.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `RESEARCH_LOCK_MS = 600000`
  - `ResearchStatus = "idle" | "running" | "ready" | "failed"`
  - `deriveResearchStatus(book: { researchedAt: string | null; researchStartedAt: string | null; researchError: string | null }, now: Date): ResearchStatus`
  - `canConfirm(input: { jobStatus: string; researchedAt: string | null; title: string; author: string | null; pageCount: number }): { ok: true; title: string; author: string | null; pageCount: number } | { ok: false; reason: string }`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/book/researchStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveResearchStatus } from "@/lib/book/researchStatus";

const now = new Date("2026-10-27T12:00:00.000Z");

describe("deriveResearchStatus", () => {
  it("is ready when researched_at is set", () => {
    expect(
      deriveResearchStatus(
        {
          researchedAt: "2026-10-27T11:00:00.000Z",
          researchStartedAt: "2026-10-27T11:59:00.000Z",
          researchError: "old",
        },
        now,
      ),
    ).toBe("ready");
  });

  it("is running when the lock is younger than 10 minutes", () => {
    expect(
      deriveResearchStatus(
        {
          researchedAt: null,
          researchStartedAt: "2026-10-27T11:51:00.000Z",
          researchError: null,
        },
        now,
      ),
    ).toBe("running");
  });

  it("treats a lock older than 10 minutes as stale", () => {
    expect(
      deriveResearchStatus(
        {
          researchedAt: null,
          researchStartedAt: "2026-10-27T11:49:00.000Z",
          researchError: "boom",
        },
        now,
      ),
    ).toBe("failed");
    expect(
      deriveResearchStatus(
        {
          researchedAt: null,
          researchStartedAt: "2026-10-27T11:49:00.000Z",
          researchError: null,
        },
        now,
      ),
    ).toBe("idle");
  });

  it("is failed when an error is saved and idle otherwise", () => {
    expect(
      deriveResearchStatus(
        { researchedAt: null, researchStartedAt: null, researchError: "boom" },
        now,
      ),
    ).toBe("failed");
    expect(
      deriveResearchStatus(
        { researchedAt: null, researchStartedAt: null, researchError: null },
        now,
      ),
    ).toBe("idle");
  });
});
```

Create `tests/lib/book/confirmRules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canConfirm } from "@/lib/book/confirmRules";

const ready = {
  jobStatus: "awaiting_review",
  researchedAt: "2026-10-27T11:00:00.000Z",
  title: "  Dune  ",
  author: "   ",
  pageCount: 12,
};

describe("canConfirm", () => {
  it("accepts a reviewed book and stores a blank author as null", () => {
    const result = canConfirm(ready);
    expect(result).toEqual({
      ok: true,
      title: "Dune",
      author: null,
      pageCount: 12,
    });
  });

  it("rejects an empty title, a bad page count, a job that is not awaiting review, and missing research", () => {
    expect(canConfirm({ ...ready, title: " " })).toMatchObject({
      ok: false,
      reason: "Title is required",
    });
    expect(canConfirm({ ...ready, pageCount: 1.5 })).toMatchObject({
      ok: false,
      reason: "Page count must be a positive integer",
    });
    expect(canConfirm({ ...ready, jobStatus: "queued" })).toMatchObject({
      ok: false,
      reason: "Job is not awaiting review",
    });
    expect(canConfirm({ ...ready, researchedAt: null })).toMatchObject({
      ok: false,
      reason: "Book research is not ready",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/book/researchStatus.test.ts tests/lib/book/confirmRules.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the pure rules**

`src/lib/book/researchStatus.ts`:

```ts
export const RESEARCH_LOCK_MS = 10 * 60 * 1000;

export type ResearchStatus = "idle" | "running" | "ready" | "failed";

export function deriveResearchStatus(
  book: {
    researchedAt: string | null;
    researchStartedAt: string | null;
    researchError: string | null;
  },
  now: Date,
): ResearchStatus {
  if (book.researchedAt) return "ready";
  if (book.researchStartedAt) {
    const started = Date.parse(book.researchStartedAt);
    if (Number.isFinite(started) && now.getTime() - started < RESEARCH_LOCK_MS) {
      return "running";
    }
  }
  if (book.researchError) return "failed";
  return "idle";
}
```

`src/lib/book/confirmRules.ts`:

```ts
import { normalizeAuthor } from "@/lib/book/meta";

export function canConfirm(input: {
  jobStatus: string;
  researchedAt: string | null;
  title: string;
  author: string | null;
  pageCount: number;
}):
  | { ok: true; title: string; author: string | null; pageCount: number }
  | { ok: false; reason: string } {
  const title = input.title.trim();
  if (!title) return { ok: false, reason: "Title is required" };
  if (!Number.isInteger(input.pageCount) || input.pageCount < 1) {
    return { ok: false, reason: "Page count must be a positive integer" };
  }
  if (input.jobStatus !== "awaiting_review") {
    return { ok: false, reason: "Job is not awaiting review" };
  }
  if (!input.researchedAt) {
    return { ok: false, reason: "Book research is not ready" };
  }
  return {
    ok: true,
    title,
    author: normalizeAuthor(input.author),
    pageCount: input.pageCount,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/book/researchStatus.test.ts tests/lib/book/confirmRules.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/book/researchStatus.ts src/lib/book/confirmRules.ts tests/lib/book/researchStatus.test.ts tests/lib/book/confirmRules.test.ts
git commit -m "feat: add research status and confirm rules"
```

---

### Task 6: Research a book once and save the character map

**Files:**
- Create: `src/lib/research/summary.ts`
- Create: `src/lib/research/ensureBookResearch.ts`
- Test: `tests/lib/research/ensureBookResearch.test.ts`

**Interfaces:**
- Consumes: `getBook`, `deriveResearchStatus`, `RESEARCH_LOCK_MS`, `buildCharacterMap`, `assignVoices`, `saveCharacterMaps`, `loadCharacterMaps`, `getDb`
- Produces:
  - `CharacterSummary = { name: string; role: string; tonality: string[] }`
  - `toCharacterSummaries(characters: { name: string; role: string; tonality: string[] }[]): CharacterSummary[]`
  - `EnsureResearchResult = { status: "ready"; characters: CharacterSummary[]; researchMode: string | null } | { status: "running" } | { status: "failed"; error: string }`
  - `ensureBookResearch(jobId: number, now?: Date): Promise<EnsureResearchResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/research/ensureBookResearch.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/research/characterMap", () => ({
  buildCharacterMap: vi.fn(),
}));

const character = {
  name: "Narrator",
  aliases: [],
  role: "narrator" as const,
  speaks: true,
  gender_presentation: null,
  age_impression: "adult" as const,
  tonality: ["calm"],
  confidence: 0.9,
  source: "text",
};

describe("ensureBookResearch", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-research-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
    vi.resetAllMocks();
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function seedJob(): Promise<number> {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const bookId = upsertBook({
      title: "Original",
      author: null,
      fingerprint: "abc",
      pageCount: 10,
      wordCount: 800,
    });
    const db = getDb();
    const job = db
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, ?, 'awaiting_review')",
      )
      .run(bookId, "a@b.com", null);
    db.prepare(
      "INSERT INTO chapters (job_id, idx, title, text) VALUES (?, 0, 'Chapter 1', ?)",
    ).run(Number(job.lastInsertRowid), "Hello there.");
    return Number(job.lastInsertRowid);
  }

  it("saves research once and does not call the model again", async () => {
    const { buildCharacterMap } = await import("@/lib/research/characterMap");
    vi.mocked(buildCharacterMap).mockResolvedValue({
      book_title: "Original",
      author: "Unknown",
      mode: "text_sample",
      sources_found: 0,
      characters: [character],
    });
    const jobId = await seedJob();
    const { ensureBookResearch } = await import("@/lib/research/ensureBookResearch");
    const { getBook } = await import("@/lib/book/meta");
    const first = await ensureBookResearch(jobId);
    const second = await ensureBookResearch(jobId);
    expect(buildCharacterMap).toHaveBeenCalledTimes(1);
    expect(buildCharacterMap).toHaveBeenCalledWith({
      title: "Original",
      author: "Unknown",
      fullText: "Hello there.",
    });
    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    if (second.status === "ready") {
      expect(second.characters).toEqual([
        { name: "Narrator", role: "narrator", tonality: ["calm"] },
      ]);
      expect(second.researchMode).toBe("text_sample");
    }
    const { getDb } = await import("@/lib/db/client");
    const bookId = (
      getDb().prepare("SELECT book_id FROM jobs WHERE id = ?").get(jobId) as {
        book_id: number;
      }
    ).book_id;
    expect(getBook(bookId)?.researchedAt).toBeTruthy();
    expect(getBook(bookId)?.researchError).toBeNull();
  });

  it("records a failure without marking the book researched", async () => {
    const { buildCharacterMap } = await import("@/lib/research/characterMap");
    vi.mocked(buildCharacterMap).mockRejectedValue(new Error("model down"));
    const jobId = await seedJob();
    const { ensureBookResearch } = await import("@/lib/research/ensureBookResearch");
    const { getBook } = await import("@/lib/book/meta");
    const result = await ensureBookResearch(jobId);
    expect(result).toEqual({ status: "failed", error: "model down" });
    const { getDb } = await import("@/lib/db/client");
    const bookId = (
      getDb().prepare("SELECT book_id FROM jobs WHERE id = ?").get(jobId) as {
        book_id: number;
      }
    ).book_id;
    const book = getBook(bookId);
    expect(book?.researchedAt).toBeNull();
    expect(book?.researchError).toBe("model down");
    expect(book?.researchStartedAt).toBeNull();
  });

  it("does not start a second research while the lock is fresh", async () => {
    const { buildCharacterMap } = await import("@/lib/research/characterMap");
    const jobId = await seedJob();
    const { getDb } = await import("@/lib/db/client");
    const bookId = (
      getDb().prepare("SELECT book_id FROM jobs WHERE id = ?").get(jobId) as {
        book_id: number;
      }
    ).book_id;
    getDb()
      .prepare("UPDATE books SET research_started_at = ? WHERE id = ?")
      .run(new Date().toISOString(), bookId);
    const { ensureBookResearch } = await import("@/lib/research/ensureBookResearch");
    const result = await ensureBookResearch(jobId);
    expect(result).toEqual({ status: "running" });
    expect(buildCharacterMap).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/research/ensureBookResearch.test.ts`

Expected: FAIL because `ensureBookResearch` is not defined.

- [ ] **Step 3: Implement one-time research**

`src/lib/research/summary.ts`:

```ts
export type CharacterSummary = {
  name: string;
  role: string;
  tonality: string[];
};

export function toCharacterSummaries(
  characters: { name: string; role: string; tonality: string[] }[],
): CharacterSummary[] {
  return characters.map((character) => ({
    name: character.name,
    role: character.role,
    tonality: character.tonality,
  }));
}
```

`src/lib/research/ensureBookResearch.ts`:

```ts
import { getBook } from "@/lib/book/meta";
import { deriveResearchStatus, RESEARCH_LOCK_MS } from "@/lib/book/researchStatus";
import { loadCharacterMaps, saveCharacterMaps } from "@/lib/book/characterMapsDb";
import { getDb } from "@/lib/db/client";
import { buildCharacterMap } from "@/lib/research/characterMap";
import { toCharacterSummaries, type CharacterSummary } from "@/lib/research/summary";
import { assignVoices } from "@/lib/voices/assign";

export type EnsureResearchResult =
  | { status: "ready"; characters: CharacterSummary[]; researchMode: string | null }
  | { status: "running" }
  | { status: "failed"; error: string };

function readyResult(bookId: number, researchMode: string | null): EnsureResearchResult {
  const saved = loadCharacterMaps(bookId) ?? [];
  return {
    status: "ready",
    characters: toCharacterSummaries(saved),
    researchMode,
  };
}

export async function ensureBookResearch(
  jobId: number,
  now: Date = new Date(),
): Promise<EnsureResearchResult> {
  const db = getDb();
  const job = db
    .prepare("SELECT book_id FROM jobs WHERE id = ?")
    .get(jobId) as { book_id: number | null } | undefined;
  if (!job?.book_id) return { status: "failed", error: "Missing book" };
  const book = getBook(job.book_id);
  if (!book) return { status: "failed", error: "Missing book" };

  const status = deriveResearchStatus(book, now);
  if (status === "ready") return readyResult(book.id, book.researchMode);
  if (status === "running") return { status: "running" };

  const staleBefore = new Date(now.getTime() - RESEARCH_LOCK_MS).toISOString();
  const lock = db
    .prepare(
      `UPDATE books
       SET research_started_at = ?, research_error = NULL
       WHERE id = ?
         AND researched_at IS NULL
         AND (research_started_at IS NULL OR research_started_at <= ?)`,
    )
    .run(now.toISOString(), book.id, staleBefore);
  if (lock.changes === 0) return { status: "running" };

  try {
    const chapters = db
      .prepare("SELECT text FROM chapters WHERE job_id = ? ORDER BY idx")
      .all(jobId) as { text: string }[];
    const map = await buildCharacterMap({
      title: book.title ?? "Untitled",
      author: book.author ?? "Unknown",
      fullText: chapters.map((chapter) => chapter.text).join("\n\n"),
    });
    const assigned = assignVoices(map.characters, null);
    saveCharacterMaps(book.id, assigned, map.mode);
    db.prepare(
      `UPDATE books
       SET researched_at = ?, research_mode = ?, research_started_at = NULL, research_error = NULL
       WHERE id = ?`,
    ).run(now.toISOString(), map.mode, book.id);
    return readyResult(book.id, map.mode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE books SET research_started_at = NULL, research_error = ? WHERE id = ?`,
    ).run(message, book.id);
    return { status: "failed", error: message };
  }
}
```

The lock comparison uses `<= staleBefore`. `research_started_at` values written by this function are ISO-8601, so string comparison matches time order. A fresh lock is greater than `staleBefore` and the `UPDATE` changes 0 rows.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/research/ensureBookResearch.test.ts`

Expected: PASS. `buildCharacterMap` is called once in the success test and zero times in the lock test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/research/summary.ts src/lib/research/ensureBookResearch.ts tests/lib/research/ensureBookResearch.test.ts
git commit -m "feat: research a book once and save the character map"
```

---

### Task 7: Store the PDF once

**Files:**
- Create: `src/lib/pipeline/storeBookPdf.ts`
- Test: `tests/lib/pipeline/storeBookPdf.test.ts`

**Interfaces:**
- Consumes: `Storage`, `bookPdfObjectKey`, `bookPdfAccessUrl`, `getBook`, `getDb`
- Produces: `storeBookPdf(bookId: number, pdf: Buffer, storage: Storage): Promise<{ uploaded: boolean; objectKey: string }>`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/pipeline/storeBookPdf.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "@/lib/storage/local";

describe("storeBookPdf", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-pdf-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uploads once and leaves the first bytes in place", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getBook } = await import("@/lib/book/meta");
    const { storeBookPdf } = await import("@/lib/pipeline/storeBookPdf");
    const bookId = upsertBook({
      title: "Original",
      author: null,
      fingerprint: "abc",
      pageCount: 3,
      wordCount: 800,
    });
    const storage = new LocalStorage(path.join(tmpDir, "objects"));
    const first = await storeBookPdf(bookId, Buffer.from("first"), storage);
    const second = await storeBookPdf(bookId, Buffer.from("second"), storage);
    expect(first).toEqual({ uploaded: true, objectKey: `books/${bookId}/source.pdf` });
    expect(second).toEqual({ uploaded: false, objectKey: `books/${bookId}/source.pdf` });
    const saved = await storage.getBuffer(`books/${bookId}/source.pdf`);
    expect(saved.toString()).toBe("first");
    const book = getBook(bookId);
    expect(book?.pdfObjectKey).toBe(`books/${bookId}/source.pdf`);
    expect(book?.pdfAccessUrl).toBe(`/api/books/${bookId}/pdf`);
    expect(book?.pdfObjectKey).toBeTruthy();
  });
});
```

Add `pdfUploadedAt: string | null` to `BookRecord` in `src/lib/book/meta.ts` only if the test needs it. This test does not. The implementation still writes `pdf_uploaded_at`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/pipeline/storeBookPdf.test.ts`

Expected: FAIL because `storeBookPdf` is not defined.

- [ ] **Step 3: Implement the one-time put**

Create `src/lib/pipeline/storeBookPdf.ts`:

```ts
import { getBook } from "@/lib/book/meta";
import { getDb } from "@/lib/db/client";
import { bookPdfAccessUrl, bookPdfObjectKey } from "@/lib/storage/keys";
import type { Storage } from "@/lib/storage/types";

export async function storeBookPdf(
  bookId: number,
  pdf: Buffer,
  storage: Storage,
): Promise<{ uploaded: boolean; objectKey: string }> {
  const existing = getBook(bookId);
  if (!existing) throw new Error(`Book ${bookId} not found`);
  if (existing.pdfObjectKey) {
    return { uploaded: false, objectKey: existing.pdfObjectKey };
  }
  const objectKey = bookPdfObjectKey(bookId);
  await storage.put(objectKey, pdf, "application/pdf");
  getDb()
    .prepare(
      `UPDATE books
       SET pdf_object_key = ?, pdf_access_url = ?, pdf_uploaded_at = ?
       WHERE id = ?`,
    )
    .run(objectKey, bookPdfAccessUrl(bookId), new Date().toISOString(), bookId);
  return { uploaded: true, objectKey };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/pipeline/storeBookPdf.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/storeBookPdf.ts tests/lib/pipeline/storeBookPdf.test.ts
git commit -m "feat: store a book pdf once"
```

---

### Task 8: Ingest the upload and stop before the worker

**Files:**
- Create: `src/lib/pipeline/ingestUpload.ts`
- Modify: `src/app/api/jobs/route.ts`
- Modify: `src/app/page.tsx` (the `router.push` line)
- Test: `tests/lib/pipeline/ingestUpload.test.ts`

**Interfaces:**
- Consumes: `upsertBook`, `storeBookPdf`, `Storage`, `allocateJobId`, `jobDir`, `writeJobStatus`, `splitChapters` is not called here; the route passes chapters
- Produces: `ingestUploadedBook(input: { pdfBuffer: Buffer; email: string; voice: { buffer: Buffer; extension: ".wav" | ".mp3" } | null; title: string; author: string | null; fullText: string; wordCount: number; pageCount: number; chapters: { title: string; rawText: string }[]; storage: Storage }): Promise<{ jobId: number; bookId: number }>`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/pipeline/ingestUpload.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "@/lib/storage/local";

describe("ingestUploadedBook", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-ingest-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates an awaiting_review job and keeps saved meta on a second upload", async () => {
    const { ingestUploadedBook } = await import("@/lib/pipeline/ingestUpload");
    const { getBook } = await import("@/lib/book/meta");
    const { getDb } = await import("@/lib/db/client");
    const { readJobStatus } = await import("@/lib/jobs/statusFile");
    const storage = new LocalStorage(path.join(tmpDir, "objects"));
    const first = await ingestUploadedBook({
      pdfBuffer: Buffer.from("first-pdf"),
      email: "a@b.com",
      voice: null,
      title: "Original",
      author: "Ada",
      fullText: "Hello there.",
      wordCount: 2,
      pageCount: 4,
      chapters: [{ title: "Chapter 1", rawText: "Hello there." }],
      storage,
    });
    const second = await ingestUploadedBook({
      pdfBuffer: Buffer.from("second-pdf"),
      email: "c@d.com",
      voice: { buffer: Buffer.from("voice"), extension: ".mp3" },
      title: "Original",
      author: "Ada",
      fullText: "Hello there.",
      wordCount: 2,
      pageCount: 9,
      chapters: [{ title: "Chapter 1", rawText: "Hello there." }],
      storage,
    });
    expect(second.bookId).toBe(first.bookId);
    expect(second.jobId).not.toBe(first.jobId);
    const book = getBook(first.bookId);
    expect(book?.title).toBe("Original");
    expect(book?.author).toBe("Ada");
    expect(book?.pageCount).toBe(4);
    expect((await storage.getBuffer(`books/${first.bookId}/source.pdf`)).toString()).toBe(
      "first-pdf",
    );
    const db = getDb();
    const jobs = db
      .prepare("SELECT id, status, custom_voice_path FROM jobs ORDER BY id")
      .all() as { id: number; status: string; custom_voice_path: string | null }[];
    expect(jobs.map((job) => job.status)).toEqual(["awaiting_review", "awaiting_review"]);
    expect(jobs[1].custom_voice_path).toBeTruthy();
    expect(readJobStatus(first.jobId)?.status).toBe("awaiting_review");
    const chapterCount = db
      .prepare("SELECT COUNT(*) AS n FROM chapters WHERE job_id = ?")
      .get(first.jobId) as { n: number };
    expect(chapterCount.n).toBe(1);
  });
});
```

The second call uses the same title, author, and text so `computeFingerprint` hits the first book. `pageCount: 9` must be ignored. Title edits are covered by Task 4, not by a second ingest.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/pipeline/ingestUpload.test.ts`

Expected: FAIL because `ingestUploadedBook` is not defined.

- [ ] **Step 3: Implement ingest and point the upload route at it**

Create `src/lib/pipeline/ingestUpload.ts`:

```ts
import fs from "fs";
import path from "path";
import { computeFingerprint, upsertBook } from "@/lib/book/fingerprint";
import { getDb } from "@/lib/db/client";
import { allocateJobId, jobDir, writeJobStatus } from "@/lib/jobs/statusFile";
import { storeBookPdf } from "@/lib/pipeline/storeBookPdf";
import type { Storage } from "@/lib/storage/types";

export async function ingestUploadedBook(input: {
  pdfBuffer: Buffer;
  email: string;
  voice: { buffer: Buffer; extension: ".wav" | ".mp3" } | null;
  title: string;
  author: string | null;
  fullText: string;
  wordCount: number;
  pageCount: number;
  chapters: { title: string; rawText: string }[];
  storage: Storage;
}): Promise<{ jobId: number; bookId: number }> {
  const fingerprint = computeFingerprint(input.title, input.fullText);
  const bookId = upsertBook({
    title: input.title,
    author: input.author,
    fingerprint,
    wordCount: input.wordCount,
    pageCount: input.pageCount,
  });
  await storeBookPdf(bookId, input.pdfBuffer, input.storage);

  const jobId = allocateJobId();
  const dir = jobDir(jobId);
  fs.mkdirSync(dir, { recursive: true });
  let voicePath: string | null = null;
  if (input.voice) {
    voicePath = path.join(dir, `voice${input.voice.extension}`);
    fs.writeFileSync(voicePath, input.voice.buffer);
  }

  const db = getDb();
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO jobs (id, book_id, email, custom_voice_path, status)
       VALUES (?, ?, ?, ?, 'awaiting_review')`,
    ).run(jobId, bookId, input.email, voicePath);
    const insertChapter = db.prepare(
      "INSERT INTO chapters (job_id, idx, title, text) VALUES (?, ?, ?, ?)",
    );
    input.chapters.forEach((chapter, idx) => {
      insertChapter.run(jobId, idx, chapter.title, chapter.rawText);
    });
  });
  write();

  writeJobStatus({
    id: jobId,
    status: "awaiting_review",
    email: input.email,
    progress: 0,
    chapters: input.chapters.map((chapter, idx) => ({
      idx,
      title: chapter.title,
      ready: false,
    })),
  });

  return { jobId, bookId };
}
```

`jobs.id` is `INTEGER PRIMARY KEY` without `AUTOINCREMENT`, so inserting an explicit id from `allocateJobId()` is valid.

Replace `src/app/api/jobs/route.ts` with a route that does not spawn a worker. Keep `PdfExtractError` and `VoiceSampleError` handling. Order: read form, extract PDF, validate voice bytes, then ingest. Title is `extracted.metadata.title ?? path.basename(fileName, ".pdf")`. Author is `extracted.metadata.author ?? null`. Chapters come from `splitChapters(extracted.text)`.

```ts
import path from "path";
import { NextResponse } from "next/server";
import { validateVoiceSample } from "@/lib/audio/validateSample";
import { extractPdfText, PdfExtractError } from "@/lib/pdf/extract";
import { splitChapters } from "@/lib/pdf/chapters";
import { ingestUploadedBook } from "@/lib/pipeline/ingestUpload";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const pdf = form.get("pdf");
    const email = String(form.get("email") ?? "").trim();
    const voice = form.get("voice");

    if (!email || !pdf || !(pdf instanceof Blob)) {
      return NextResponse.json(
        { error: "pdf and email are required" },
        { status: 400 },
      );
    }

    const pdfBuffer = Buffer.from(await pdf.arrayBuffer());
    const extracted = await extractPdfText(pdfBuffer);

    let voiceInput: { buffer: Buffer; extension: ".wav" | ".mp3" } | null = null;
    if (voice && voice instanceof Blob && voice.size > 0) {
      const voiceBuffer = Buffer.from(await voice.arrayBuffer());
      await validateVoiceSample(voiceBuffer);
      voiceInput = {
        buffer: voiceBuffer,
        extension: voice.type.includes("wav") ? ".wav" : ".mp3",
      };
    }

    const fileName = pdf instanceof File ? pdf.name : "book.pdf";
    const title =
      extracted.metadata.title ?? path.basename(fileName, ".pdf");
    const ingested = await ingestUploadedBook({
      pdfBuffer,
      email,
      voice: voiceInput,
      title,
      author: extracted.metadata.author ?? null,
      fullText: extracted.text,
      wordCount: extracted.wordCount,
      pageCount: extracted.metadata.pages,
      chapters: splitChapters(extracted.text),
      storage: getStorage(),
    });

    return NextResponse.json({ jobId: ingested.jobId });
  } catch (err) {
    if (err instanceof PdfExtractError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      err.name === "VoiceSampleError"
    ) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 },
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
```

In `src/app/page.tsx`, change the success navigation to:

```ts
router.push(`/jobs/${data.jobId}/review`);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/pipeline/ingestUpload.test.ts`

Expected: PASS. The second upload keeps title `Original`, author `Ada`, page count `4`, and the PDF bytes `first-pdf`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/ingestUpload.ts src/app/api/jobs/route.ts src/app/page.tsx tests/lib/pipeline/ingestUpload.test.ts
git commit -m "feat: upload the pdf and wait for review"
```

---

### Task 9: Review payload on the job GET

**Files:**
- Create: `src/lib/jobs/readJobReview.ts`
- Modify: `src/app/api/jobs/[id]/route.ts`
- Test: `tests/lib/jobs/readJobReview.test.ts`

**Interfaces:**
- Consumes: `getBook`, `deriveResearchStatus`, `loadCharacterMaps`, `toCharacterSummaries`, `getDb`
- Produces: `readJobReview(jobId: number, now?: Date): { bookId: number | null; title: string | null; author: string | null; pageCount: number | null; researchStatus: ResearchStatus; researchMode: string | null; researchError: string | null; characters: CharacterSummary[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/jobs/readJobReview.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("readJobReview", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-review-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns saved meta and an idle research status", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const { readJobReview } = await import("@/lib/jobs/readJobReview");
    const bookId = upsertBook({
      title: "Original",
      author: "Ada",
      fingerprint: "abc",
      pageCount: 10,
      wordCount: 800,
    });
    const job = getDb()
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, 'awaiting_review')",
      )
      .run(bookId, "a@b.com");
    const review = readJobReview(Number(job.lastInsertRowid));
    expect(review).toMatchObject({
      bookId,
      title: "Original",
      author: "Ada",
      pageCount: 10,
      researchStatus: "idle",
      researchMode: null,
      researchError: null,
      characters: [],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/jobs/readJobReview.test.ts`

Expected: FAIL because `readJobReview` is not defined.

- [ ] **Step 3: Implement the reader and add it to GET**

Create `src/lib/jobs/readJobReview.ts`:

```ts
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
```

In `src/app/api/jobs/[id]/route.ts`, import `readJobReview` and spread it into the JSON response:

```ts
const review = readJobReview(jobId);
return NextResponse.json({
  id: status.id,
  status: status.status,
  error: status.error ?? null,
  email: status.email,
  progress,
  phase: status.phase ?? null,
  detail: status.detail ?? null,
  chapters,
  ...review,
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/jobs/readJobReview.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/readJobReview.ts src/app/api/jobs/[id]/route.ts tests/lib/jobs/readJobReview.test.ts
git commit -m "feat: return book meta and research status on the job"
```

---

### Task 10: Save meta edits and confirm the job

**Files:**
- Create: `src/lib/jobs/spawnRunner.ts`
- Create: `src/lib/jobs/updateJobBook.ts`
- Create: `src/lib/jobs/confirmJob.ts`
- Create: `src/app/api/jobs/[id]/book/route.ts`
- Create: `src/app/api/jobs/[id]/research/route.ts`
- Create: `src/app/api/jobs/[id]/confirm/route.ts`
- Test: `tests/lib/jobs/updateJobBook.test.ts`
- Test: `tests/lib/jobs/confirmJob.test.ts`

**Interfaces:**
- Consumes: `canConfirm`, `updateBookMeta`, `getBook`, `getDb`, `readJobStatus`, `writeJobStatus`, `ensureBookResearch`
- Produces:
  - `spawnJobRunner(jobId: number): void`
  - `updateJobBook(jobId: number, input: { title: string; author: string | null; pageCount: number }): { ok: true } | { ok: false; status: number; error: string }`
  - `confirmJob(jobId: number, input: { title: string; author: string | null; pageCount: number }, spawn?: (jobId: number) => void): { ok: true } | { ok: false; status: number; error: string }`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/jobs/updateJobBook.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("updateJobBook", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-edit-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("updates meta for an awaiting_review job and leaves the fingerprint", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const { getBook } = await import("@/lib/book/meta");
    const { updateJobBook } = await import("@/lib/jobs/updateJobBook");
    const bookId = upsertBook({
      title: "Original",
      author: "Ada",
      fingerprint: "abc",
      pageCount: 10,
      wordCount: 800,
    });
    const job = getDb()
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, 'awaiting_review')",
      )
      .run(bookId, "a@b.com");
    const result = updateJobBook(Number(job.lastInsertRowid), {
      title: "Renamed",
      author: "",
      pageCount: 11,
    });
    expect(result).toEqual({ ok: true });
    const book = getBook(bookId);
    expect(book?.title).toBe("Renamed");
    expect(book?.author).toBeNull();
    expect(book?.pageCount).toBe(11);
    expect(book?.fingerprint).toBe("abc");
  });
});
```

Create `tests/lib/jobs/confirmJob.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("confirmJob", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-confirm-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function seed(status: string, researched: boolean): Promise<number> {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const { writeJobStatus } = await import("@/lib/jobs/statusFile");
    const bookId = upsertBook({
      title: "Original",
      author: "Ada",
      fingerprint: `fp-${status}-${researched}`,
      pageCount: 10,
      wordCount: 800,
    });
    if (researched) {
      getDb()
        .prepare("UPDATE books SET researched_at = ? WHERE id = ?")
        .run("2026-10-27T11:00:00.000Z", bookId);
    }
    const job = getDb()
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, ?)",
      )
      .run(bookId, "a@b.com", status);
    const jobId = Number(job.lastInsertRowid);
    writeJobStatus({
      id: jobId,
      status,
      email: "a@b.com",
      progress: 0,
      chapters: [],
    });
    return jobId;
  }

  it("queues a researched review job and spawns once", async () => {
    const jobId = await seed("awaiting_review", true);
    const spawned: number[] = [];
    const { confirmJob } = await import("@/lib/jobs/confirmJob");
    const { getDb } = await import("@/lib/db/client");
    const first = confirmJob(
      jobId,
      { title: "Original", author: "Ada", pageCount: 10 },
      (id) => spawned.push(id),
    );
    const second = confirmJob(
      jobId,
      { title: "Original", author: "Ada", pageCount: 10 },
      (id) => spawned.push(id),
    );
    expect(first).toEqual({ ok: true });
    expect(second).toMatchObject({ ok: false, status: 409 });
    expect(spawned).toEqual([jobId]);
    const row = getDb().prepare("SELECT status FROM jobs WHERE id = ?").get(jobId) as {
      status: string;
    };
    expect(row.status).toBe("queued");
  });

  it("rejects confirm before research is saved", async () => {
    const jobId = await seed("awaiting_review", false);
    const { confirmJob } = await import("@/lib/jobs/confirmJob");
    const result = confirmJob(
      jobId,
      { title: "Original", author: "Ada", pageCount: 10 },
      () => {
        throw new Error("should not spawn");
      },
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: "Book research is not ready",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/jobs/updateJobBook.test.ts tests/lib/jobs/confirmJob.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement edit, confirm, spawn, and the three routes**

`src/lib/jobs/spawnRunner.ts` — move the previous `spawnJobRunner` from the old jobs route here, unchanged:

```ts
import { spawn } from "child_process";
import path from "path";
import { getDb } from "@/lib/db/client";
import { readJobStatus, writeJobStatus } from "@/lib/jobs/statusFile";

export function spawnJobRunner(jobId: number): void {
  const script = path.join(process.cwd(), "scripts", "run-job.ts");
  const child = spawn("npx", ["tsx", script, String(jobId)], {
    cwd: process.cwd(),
    detached: true,
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
  child.unref();
  child.on("error", (err) => {
    console.error(`Failed to spawn job ${jobId}`, err);
    const message = err.message;
    getDb()
      .prepare("UPDATE jobs SET status = 'failed', error = ? WHERE id = ?")
      .run(message, jobId);
    const current = readJobStatus(jobId);
    if (current) writeJobStatus({ ...current, status: "failed", error: message });
  });
}
```

`src/lib/jobs/updateJobBook.ts`:

```ts
import { getBook, parseBookMeta, updateBookMeta, BookMetaError } from "@/lib/book/meta";
import { getDb } from "@/lib/db/client";

export function updateJobBook(
  jobId: number,
  input: { title: string; author: string | null; pageCount: number },
): { ok: true } | { ok: false; status: number; error: string } {
  try {
    const meta = parseBookMeta(input);
    const job = getDb()
      .prepare("SELECT book_id, status FROM jobs WHERE id = ?")
      .get(jobId) as { book_id: number | null; status: string } | undefined;
    if (!job?.book_id) return { ok: false, status: 404, error: "Job not found" };
    if (job.status !== "awaiting_review") {
      return { ok: false, status: 409, error: "Job is not awaiting review" };
    }
    if (!getBook(job.book_id)) return { ok: false, status: 404, error: "Book not found" };
    updateBookMeta(job.book_id, meta);
    return { ok: true };
  } catch (err) {
    if (err instanceof BookMetaError) {
      return { ok: false, status: err.statusCode, error: err.message };
    }
    throw err;
  }
}
```

`src/lib/jobs/confirmJob.ts`:

```ts
import { canConfirm } from "@/lib/book/confirmRules";
import { getBook, updateBookMeta } from "@/lib/book/meta";
import { getDb } from "@/lib/db/client";
import { readJobStatus, writeJobStatus } from "@/lib/jobs/statusFile";
import { spawnJobRunner } from "@/lib/jobs/spawnRunner";

export function confirmJob(
  jobId: number,
  input: { title: string; author: string | null; pageCount: number },
  spawn: (jobId: number) => void = spawnJobRunner,
): { ok: true } | { ok: false; status: number; error: string } {
  const job = getDb()
    .prepare("SELECT book_id, status FROM jobs WHERE id = ?")
    .get(jobId) as { book_id: number | null; status: string } | undefined;
  if (!job?.book_id) return { ok: false, status: 404, error: "Job not found" };
  const book = getBook(job.book_id);
  if (!book) return { ok: false, status: 404, error: "Book not found" };
  const gate = canConfirm({
    jobStatus: job.status,
    researchedAt: book.researchedAt,
    title: input.title,
    author: input.author,
    pageCount: input.pageCount,
  });
  if (!gate.ok) {
    const status = gate.reason === "Job is not awaiting review" || gate.reason === "Book research is not ready" ? 409 : 400;
    return { ok: false, status, error: gate.reason };
  }
  updateBookMeta(job.book_id, gate);
  getDb().prepare("UPDATE jobs SET status = 'queued', error = NULL WHERE id = ?").run(jobId);
  const current = readJobStatus(jobId);
  if (current) writeJobStatus({ ...current, status: "queued", error: null });
  try {
    spawn(jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    getDb().prepare("UPDATE jobs SET status = 'failed', error = ? WHERE id = ?").run(message, jobId);
    if (current) writeJobStatus({ ...current, status: "failed", error: message });
    return { ok: false, status: 500, error: message };
  }
  return { ok: true };
}
```

`src/app/api/jobs/[id]/book/route.ts`:

```ts
import { NextResponse } from "next/server";
import { updateJobBook } from "@/lib/jobs/updateJobBook";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const jobId = Number((await context.params).id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const body = (await request.json()) as {
    title?: string;
    author?: string | null;
    pageCount?: number;
  };
  const result = updateJobBook(jobId, {
    title: body.title ?? "",
    author: body.author ?? null,
    pageCount: body.pageCount ?? 0,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
```

`src/app/api/jobs/[id]/research/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ensureBookResearch } from "@/lib/research/ensureBookResearch";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const jobId = Number((await context.params).id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const result = await ensureBookResearch(jobId);
  return NextResponse.json(result);
}
```

`src/app/api/jobs/[id]/confirm/route.ts`:

```ts
import { NextResponse } from "next/server";
import { confirmJob } from "@/lib/jobs/confirmJob";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const jobId = Number((await context.params).id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const body = (await request.json()) as {
    title?: string;
    author?: string | null;
    pageCount?: number;
  };
  const result = confirmJob(jobId, {
    title: body.title ?? "",
    author: body.author ?? null,
    pageCount: body.pageCount ?? 0,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/jobs/updateJobBook.test.ts tests/lib/jobs/confirmJob.test.ts`

Expected: PASS. The second confirm returns 409 and `spawn` is called once.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/spawnRunner.ts src/lib/jobs/updateJobBook.ts src/lib/jobs/confirmJob.ts src/app/api/jobs/[id]/book/route.ts src/app/api/jobs/[id]/research/route.ts src/app/api/jobs/[id]/confirm/route.ts tests/lib/jobs/updateJobBook.test.ts tests/lib/jobs/confirmJob.test.ts
git commit -m "feat: save book meta and confirm review"
```

---

### Task 11: Worker uses the saved book and skips research

**Files:**
- Create: `src/lib/pipeline/jobReady.ts`
- Modify: `scripts/run-job.ts`
- Test: `tests/lib/pipeline/jobReady.test.ts`
- Test: `tests/lib/pipeline/runJob.cachedResearch.test.ts`

**Interfaces:**
- Consumes: `getDb`, `runJob`, saved `character_maps`
- Produces: `jobIsPrepared(jobId: number): boolean`. True only when the job has a non-null `book_id` and at least one `chapters` row.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/pipeline/jobReady.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("jobIsPrepared", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-ready-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is true only when the job has a book and chapters", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { getDb } = await import("@/lib/db/client");
    const { jobIsPrepared } = await import("@/lib/pipeline/jobReady");
    const bookId = upsertBook({
      title: "Original",
      author: null,
      fingerprint: "abc",
      pageCount: 1,
      wordCount: 800,
    });
    const db = getDb();
    const prepared = db
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, 'queued')",
      )
      .run(bookId, "a@b.com");
    const preparedId = Number(prepared.lastInsertRowid);
    expect(jobIsPrepared(preparedId)).toBe(false);
    db.prepare(
      "INSERT INTO chapters (job_id, idx, title, text) VALUES (?, 0, 'Chapter 1', 'Hello.')",
    ).run(preparedId);
    expect(jobIsPrepared(preparedId)).toBe(true);
  });
});
```

Create `tests/lib/pipeline/runJob.cachedResearch.test.ts`:

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/research/characterMap", () => ({
  buildCharacterMap: vi.fn(),
}));
vi.mock("@/lib/fish/cloneVoice", () => ({
  cloneVoiceFromFile: vi.fn(),
}));
vi.mock("@/lib/annotate/queue", () => ({
  annotateParagraphsParallel: vi.fn(async () => [{ annotated: "Hello." }]),
}));
vi.mock("@/lib/fish/queue", () => ({
  synthesizeJobsParallel: vi.fn(async () => undefined),
}));
vi.mock("@/lib/audio/stitch", () => ({
  stitchMp3Files: vi.fn(),
}));
vi.mock("@/lib/notify/emailStub", () => ({
  sendEmailStub: vi.fn(),
}));

describe("runJob cached research", () => {
  let tmpDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abg-run-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db/client");
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not call research when a character map is saved", async () => {
    const { upsertBook } = await import("@/lib/book/fingerprint");
    const { saveCharacterMaps } = await import("@/lib/book/characterMapsDb");
    const { getDb } = await import("@/lib/db/client");
    const { buildCharacterMap } = await import("@/lib/research/characterMap");
    const { runJob } = await import("@/lib/pipeline/runJob");
    const bookId = upsertBook({
      title: "Original",
      author: "Ada",
      fingerprint: "abc",
      pageCount: 1,
      wordCount: 800,
    });
    saveCharacterMaps(
      bookId,
      [
        {
          name: "Narrator",
          aliases: [],
          role: "narrator",
          speaks: true,
          gender_presentation: null,
          age_impression: "adult",
          tonality: ["calm"],
          confidence: 0.9,
          source: "text",
          speaker_index: 0,
          voice_id: "voice-narrator",
        },
      ],
      "text_sample",
    );
    const job = getDb()
      .prepare(
        "INSERT INTO jobs (book_id, email, custom_voice_path, status) VALUES (?, ?, NULL, 'queued')",
      )
      .run(bookId, "a@b.com");
    const jobId = Number(job.lastInsertRowid);
    getDb()
      .prepare("INSERT INTO chapters (job_id, idx, title, text) VALUES (?, 0, 'Chapter 1', ?)")
      .run(jobId, "Hello.");
    await runJob(jobId);
    expect(buildCharacterMap).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/pipeline/jobReady.test.ts tests/lib/pipeline/runJob.cachedResearch.test.ts`

Expected: `jobIsPrepared` fails because the module is missing. The `runJob` test should PASS against the current `if (!assigned)` branch. If it fails, fix the test setup, not the skip branch. Do not remove the narrator remap.

- [ ] **Step 3: Implement jobIsPrepared and teach the worker to use it**

Create `src/lib/pipeline/jobReady.ts`:

```ts
import { getDb } from "@/lib/db/client";

export function jobIsPrepared(jobId: number): boolean {
  const db = getDb();
  const job = db
    .prepare("SELECT book_id FROM jobs WHERE id = ?")
    .get(jobId) as { book_id: number | null } | undefined;
  if (!job?.book_id) return false;
  const chapters = db
    .prepare("SELECT COUNT(*) AS n FROM chapters WHERE job_id = ?")
    .get(jobId) as { n: number };
  return chapters.n > 0;
}
```

In `scripts/run-job.ts`, after the job id check and before requiring `upload.json`:

```ts
import { jobIsPrepared } from "../src/lib/pipeline/jobReady";
```

Replace the block that always reads `upload.json` and calls `prepareJobFromUpload` with:

```ts
const log = createJobLogger(jobId);

try {
  if (jobIsPrepared(jobId)) {
    const { getDb } = await import("../src/lib/db/client");
    const row = getDb()
      .prepare("SELECT email FROM jobs WHERE id = ?")
      .get(jobId) as { email: string };
    log.info(`worker started for prepared job ${jobId} → ${row.email}`);
  } else {
    const metaPath = path.join(dir, "upload.json");
    if (!fs.existsSync(metaPath)) {
      console.error(`Missing upload.json for job ${jobId}`);
      process.exit(1);
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      email: string;
      pdfPath: string;
      voicePath: string | null;
      title: string;
      author: string | null;
    };
    log.info(`worker started for "${meta.title}" → ${meta.email}`);
    const status = readJobStatus(jobId);
    if (status) {
      writeJobStatus({
        ...status,
        status: "processing",
        phase: "prepare",
        detail: "Loading PDF…",
      });
    }
    const pdfBuffer = fs.readFileSync(meta.pdfPath);
    await prepareJobFromUpload({
      jobId,
      pdfBuffer,
      email: meta.email,
      voicePath: meta.voicePath,
      title: meta.title,
      author: meta.author,
    });
  }

  const { getDb } = await import("../src/lib/db/client");
  const db = getDb();
  const chapterRows = db
    .prepare("SELECT idx, title FROM chapters WHERE job_id = ? ORDER BY idx")
    .all(jobId) as { idx: number; title: string }[];
  const base = readJobStatus(jobId);
  if (base) {
    writeJobStatus({
      ...base,
      status: "processing",
      chapters: chapterRows.map((chapter) => ({
        idx: chapter.idx,
        title: chapter.title,
        ready: false,
      })),
    });
  }

  await runJob(jobId, (patch) => {
    const current = readJobStatus(jobId);
    if (current) writeJobStatus({ ...current, ...patch });
  });
  // keep the existing done / catch / finally blocks
}
```

Leave the rest of `main` (done status, catch, `closeDb`) as it is. A prepared job never reads `upload.json`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/pipeline/jobReady.test.ts tests/lib/pipeline/runJob.cachedResearch.test.ts`

Expected: PASS. `buildCharacterMap` is not called.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/jobReady.ts scripts/run-job.ts tests/lib/pipeline/jobReady.test.ts tests/lib/pipeline/runJob.cachedResearch.test.ts
git commit -m "feat: skip research when the book map is already saved"
```

---

### Task 12: Review page

**Files:**
- Create: `src/app/jobs/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `GET /api/jobs/{id}` review fields from Task 9, `POST /api/jobs/{id}/research`, `PATCH /api/jobs/{id}/book`, `POST /api/jobs/{id}/confirm`
- Produces: the review screen at `/jobs/{id}/review`

- [ ] **Step 1: Write the page**

Create `src/app/jobs/[id]/review/page.tsx` as a client page. On load, `GET /api/jobs/{id}`. If `researchStatus` is `idle`, `POST /api/jobs/{id}/research` once. If it is `running`, poll `GET` every 2 seconds until it changes. If it is `failed`, show `researchError` and a Retry button that calls `POST` again. Do not auto-retry.

Fields: title, author, page count. Leaving a field sends `PATCH /api/jobs/{id}/book` with the current values. Confirm sends `POST /api/jobs/{id}/confirm` with those values, and is disabled unless `researchStatus === "ready"`, the trimmed title is non-empty, and the page count is an integer greater than or equal to 1. On confirm success, `router.push(/jobs/${id})`.

Show each character's name, role, and tonality, and one line: `Web research` when `researchMode === "web_research"`, otherwise `From the book text`. Do not show raw snippets.

Use `GlassCard`, `Button`, and the same input classes as `src/app/page.tsx` (`surface-input`, `text-ink-primary`, `text-ink-muted`, `text-semantic-error`).

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";

type CharacterSummary = { name: string; role: string; tonality: string[] };

type ReviewJob = {
  title: string | null;
  author: string | null;
  pageCount: number | null;
  researchStatus: "idle" | "running" | "ready" | "failed";
  researchMode: string | null;
  researchError: string | null;
  characters: CharacterSummary[];
};

export default function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [pageCount, setPageCount] = useState("");
  const [researchStatus, setResearchStatus] = useState<ReviewJob["researchStatus"]>("idle");
  const [researchMode, setResearchMode] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void params.then((value) => setId(value.id));
  }, [params]);

  function apply(job: ReviewJob, fillFields: boolean) {
    if (fillFields) {
      setTitle(job.title ?? "");
      setAuthor(job.author ?? "");
      setPageCount(job.pageCount == null ? "" : String(job.pageCount));
    }
    setResearchStatus(job.researchStatus);
    setResearchMode(job.researchMode);
    setResearchError(job.researchError);
    setCharacters(job.characters);
  }

  useEffect(() => {
    if (!id) return;
    let active = true;
    const load = async (fillFields: boolean) => {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok || !active) return;
      apply((await res.json()) as ReviewJob, fillFields);
    };
    void load(true);
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id || researchStatus !== "idle") return;
    let active = true;
    void (async () => {
      const res = await fetch(`/api/jobs/${id}/research`, { method: "POST" });
      if (!active) return;
      const body = (await res.json()) as {
        status: ReviewJob["researchStatus"];
        error?: string;
        characters?: CharacterSummary[];
        researchMode?: string | null;
      };
      setResearchStatus(body.status);
      if (body.status === "failed") setResearchError(body.error ?? "Research failed");
      if (body.status === "ready") {
        setCharacters(body.characters ?? []);
        setResearchMode(body.researchMode ?? null);
        setResearchError(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, researchStatus]);

  useEffect(() => {
    if (!id || researchStatus !== "running") return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok) return;
      const job = (await res.json()) as ReviewJob;
      if (job.researchStatus === "running") return;
      apply(job, false);
    }, 2000);
    return () => clearInterval(timer);
  }, [id, researchStatus]);

  async function saveMeta() {
    if (!id) return;
    setError(null);
    const res = await fetch(`/api/jobs/${id}/book`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        author,
        pageCount: Number(pageCount),
      }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) setError(body.error ?? "Could not save book details");
  }

  async function confirm() {
    if (!id) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/jobs/${id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        author,
        pageCount: Number(pageCount),
      }),
    });
    const body = (await res.json()) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setError(body.error ?? "Could not start the audiobook");
      return;
    }
    router.push(`/jobs/${id}`);
  }

  const pageOk = Number.isInteger(Number(pageCount)) && Number(pageCount) >= 1;
  const canConfirm =
    researchStatus === "ready" && title.trim().length > 0 && pageOk && !saving;

  if (!id) return null;

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-12 sm:px-6">
      <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight">
        Book details
      </h1>
      <GlassCard accent>
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <label className="block text-sm">
            <span className="text-ink-primary">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => void saveMeta()}
              className="surface-input mt-2 min-h-11 w-full rounded-xl px-3 py-2 text-ink-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-primary">Author</span>
            <input
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              onBlur={() => void saveMeta()}
              className="surface-input mt-2 min-h-11 w-full rounded-xl px-3 py-2 text-ink-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-primary">Pages</span>
            <input
              inputMode="numeric"
              value={pageCount}
              onChange={(event) => setPageCount(event.target.value)}
              onBlur={() => void saveMeta()}
              className="surface-input mt-2 min-h-11 w-full rounded-xl px-3 py-2 text-ink-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>

          {researchStatus === "running" || researchStatus === "idle" ? (
            <p className="text-sm text-ink-muted">Researching this book…</p>
          ) : null}
          {researchStatus === "failed" ? (
            <div className="space-y-3">
              <p className="text-sm text-semantic-error">
                {researchError ?? "Research failed"}
              </p>
              <Button type="button" variant="ghost" onClick={() => setResearchStatus("idle")}>
                Retry research
              </Button>
            </div>
          ) : null}
          {researchStatus === "ready" ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-muted">
                {researchMode === "web_research" ? "Web research" : "From the book text"}
              </p>
              <ul className="space-y-2 text-sm text-ink-primary">
                {characters.map((character) => (
                  <li key={character.name}>
                    {character.name} · {character.role} · {character.tonality.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? <p className="text-sm text-semantic-error">{error}</p> : null}
          <Button type="submit" disabled={!canConfirm}>
            {saving ? "Starting…" : "Generate audiobook"}
          </Button>
        </form>
      </GlassCard>
    </main>
  );
}
```

Retry sets status back to `idle`, which re-runs the effect that calls `POST /research`. That matches "retry only when the user asks."

- [ ] **Step 2: Run the unit tests and the production build**

Run: `npx vitest run`

Expected: PASS

Run: `npm run build`

Expected: the Next.js build completes. The new review route is compiled.

- [ ] **Step 3: Commit**

```bash
git add src/app/jobs/[id]/review/page.tsx
git commit -m "feat: review book meta before generation"
```

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| R2 or local PDF at `books/{bookId}/source.pdf`, skip when the key exists | 2, 3, 7 |
| No presigned URLs, no public PDF route | 7 stores the access path only |
| Meta saved on `books`; repeat upload does not replace it | 4, 8 |
| Title edit does not change fingerprint or re-research | 4, 10 |
| Research once, lock, stale lock, saved character map, failure retry | 5, 6, 12 |
| Confirm gate and single worker spawn | 5, 10 |
| Worker skips research and skips `upload.json` when prepared | 11 |
| Review page | 12 |
| Voice stays local | 8 |

Self-review notes: the ingest test must reuse the same title and text so the fingerprint matches. The research lock compares ISO timestamps with `<= staleBefore`. `runJob`'s narrator remap branch is left unchanged.
