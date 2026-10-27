# Production infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship production-ready infra: Postgres (Drizzle), Cloudflare R2 artifacts (PDF per book + chapter MP3s), token-gated APIs, Gmail/Nodemailer completion email, observability, and Render deploy docs—per [`docs/superpowers/specs/2026-10-25-production-infra-design.md`](../specs/2026-10-25-production-infra-design.md).

**Architecture:** Replace `better-sqlite3` and filesystem job IDs/`status.json` with Postgres as the source of truth. A `Storage` interface (`local` | `r2`) stores blobs; DB holds `*_object_key` and `*_access_url`. Job create uploads PDF to `books/{bookId}/source.pdf`; pipeline stitches to temp disk then `PutObject` for chapters. APIs require `?token=` matching `jobs.public_token`.

**Tech Stack:** Node 20+, Next.js 15 App Router, Drizzle ORM, `pg`, `@aws-sdk/client-s3` (R2), `nodemailer`, `pino`, `@sentry/nextjs`, Vitest, Docker Compose (Postgres dev).

## Global Constraints

- Render: **one** Web Service instance until explicitly changed; do not rely on ephemeral disk for user artifacts.
- R2: **no** lifecycle auto-delete; objects kept until manual delete.
- PDF canonical key: `books/{bookId}/source.pdf`; chapter key: `jobs/{jobId}/chapters/chapter-{idx}.mp3`.
- Do **not** store presigned R2 URLs in the DB; store object keys + app-relative `*_access_url`.
- Email: **Nodemailer** + Gmail SMTP (`SMTP_USER`, `SMTP_PASS` App Password).
- `APP_URL` required for absolute links in email and JSON.
- Logs: no PDF text, screenplay, or secrets.

---

## File map (new / major touch)

| Path | Responsibility |
|------|----------------|
| `docker-compose.yml` | Local Postgres |
| `drizzle.config.ts` | Drizzle Kit |
| `src/lib/db/schema.ts` | Drizzle tables |
| `src/lib/db/migrations/*` | SQL migrations |
| `src/lib/db/client.ts` | Async pool + Drizzle |
| `src/lib/storage/types.ts` | `Storage` interface |
| `src/lib/storage/local.ts` | Dev/test backend |
| `src/lib/storage/r2.ts` | R2 S3 client |
| `src/lib/storage/index.ts` | `getStorage()` factory |
| `src/lib/artifacts/urls.ts` | `bookPdfKey`, `absoluteArtifactUrl`, etc. |
| `src/lib/jobs/tokens.ts` | `verifyJobToken`, `createPublicToken` |
| `src/lib/jobs/progress.ts` | DB-backed progress updates (replaces `statusFile` writes from pipeline) |
| `src/lib/notify/sendJobReadyEmail.ts` | Nodemailer |
| `src/app/api/health/route.ts` | Health check |
| `src/app/api/books/[bookId]/pdf/route.ts` | PDF download |
| `src/app/api/jobs/[id]/voice-sample/route.ts` | Optional voice GET |
| `render.yaml` | Render blueprint (optional but documented) |

**Deprecate / shrink:** `src/lib/jobs/statusFile.ts` (`allocateJobId`, `readJobStatus` for API), `src/lib/notify/emailStub.ts`, `better-sqlite3` usage.

---

### Task 1: Local Postgres + Drizzle bootstrap

**Files:**
- Create: `docker-compose.yml`, `drizzle.config.ts`, `src/lib/db/schema.ts`
- Modify: `package.json`, `.env.example`, `src/lib/db/client.ts`
- Test: `tests/lib/db/client.test.ts`

**Interfaces:**
- Produces: `getDb()` → `ReturnType<typeof drizzle>` with typed schema; `closeDb()` for tests.

- [ ] **Step 1:** Add dependencies: `drizzle-orm`, `pg`, `drizzle-kit`; dev: `@types/pg`. Remove `better-sqlite3` only after Task 2 ports callers (can do in Task 2).

- [ ] **Step 2:** Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: audiobook
      POSTGRES_PASSWORD: audiobook
      POSTGRES_DB: audiobook
    ports:
      - "5432:5432"
```

- [ ] **Step 3:** Define `src/lib/db/schema.ts` with tables matching spec: `books` (+ `pdf_object_key`, `pdf_access_url`, `pdf_uploaded_at`), `character_maps`, `jobs` (+ `public_token`, artifact columns, email columns, drop use of `custom_voice_path` in code), `chapters` (+ `audio_object_key`, `audio_access_url`), `segments` (`audio_object_key`).

Use `uuid` for `public_token` with `defaultRandom()`. `speaks` as boolean.

- [ ] **Step 4:** `drizzle.config.ts` pointing at `DATABASE_URL`; script `"db:migrate": "drizzle-kit migrate"`.

- [ ] **Step 5:** Rewrite `src/lib/db/client.ts`:

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

let pool: pg.Pool | null = null;

export function getDb() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    pool = new pg.Pool({ connectionString: url });
  }
  return drizzle(pool, { schema });
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
```

- [ ] **Step 6:** Update `tests/lib/db/client.test.ts` to use `DATABASE_URL` (skip if unset in CI with message) and assert tables exist via Drizzle introspection or simple `select 1`.

- [ ] **Step 7:** Run `docker compose up -d`, `npm run db:migrate`, `npm test`.

- [ ] **Step 8:** Commit: `chore: add Postgres drizzle schema and local compose`.

---

### Task 2: Port data access layer to async Drizzle

**Files:**
- Modify: `src/lib/book/fingerprint.ts`, `src/lib/book/characterMapsDb.ts`, `src/lib/pipeline/prepareUpload.ts`, `src/lib/pipeline/runJob.ts` (DB calls only in this task—storage later)
- Remove: `src/lib/db/schema.sql` usage from `client.ts` (keep file as reference until deleted)
- Test: `tests/lib/book/fingerprint.test.ts`

**Interfaces:**
- Produces: `async function upsertBook(...)`, `async function findBookByFingerprint(...)`, `async function loadCharacterMaps(...)`, `async function saveCharacterMaps(...)`.

- [ ] **Step 1:** Convert `fingerprint.ts` to async Drizzle; remove `better-sqlite3` type imports.

- [ ] **Step 2:** Convert `characterMapsDb.ts` to `insert ... onConflictDoUpdate` for maps.

- [ ] **Step 3:** Convert `setJobStatus` in `runJob.ts` to async Drizzle updates.

- [ ] **Step 4:** Fix all `getDb().prepare` in `runJob.ts` / `prepareUpload.ts` to awaited queries.

- [ ] **Step 5:** Update `scripts/run-job.ts` and debug scripts to `await` DB calls; `await closeDb()` on exit.

- [ ] **Step 6:** Remove `better-sqlite3` from `package.json` and `next.config.ts` `serverExternalPackages`.

- [ ] **Step 7:** `npm test` && `npm run build`.

- [ ] **Step 8:** Commit: `refactor: async drizzle data layer`.

---

### Task 3: Storage abstraction (local + R2)

**Files:**
- Create: `src/lib/storage/types.ts`, `local.ts`, `r2.ts`, `index.ts`
- Create: `tests/lib/storage/local.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces:

```typescript
export type Storage = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getBuffer(key: string): Promise<Buffer>;
  getStream(key: string): Promise<ReadableStream<Uint8Array>>;
  presignGet(key: string, expiresSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
};

export function getStorage(): Storage;
```

- [ ] **Step 1:** Implement `LocalStorage` under `DATA_DIR/storage/` mirror keys.

- [ ] **Step 2:** Implement `R2Storage` with `@aws-sdk/client-s3`, endpoint `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, `GetObject`/`PutObject`, presigner for GET.

- [ ] **Step 3:** `getStorage()` reads `STORAGE_BACKEND` (`local` default in dev).

- [ ] **Step 4:** Test put/get roundtrip on local.

- [ ] **Step 5:** Document R2 env vars in `.env.example`.

- [ ] **Step 6:** Commit: `feat: storage abstraction local and R2`.

---

### Task 4: Artifact URL helpers + job tokens

**Files:**
- Create: `src/lib/artifacts/urls.ts`, `src/lib/jobs/tokens.ts`
- Test: `tests/lib/artifacts/urls.test.ts`, `tests/lib/jobs/tokens.test.ts`

**Interfaces:**
- Produces:

```typescript
export function bookPdfObjectKey(bookId: number): string;
export function bookPdfAccessUrl(bookId: number): string;
export function chapterObjectKey(jobId: number, idx: number): string;
export function chapterAccessUrl(jobId: number, idx: number): string;
export function absoluteArtifactUrl(accessUrl: string, publicToken: string): string;

export function createPublicToken(): string;
export function verifyJobToken(job: { public_token: string }, token: string | null): boolean;
```

- [ ] **Step 1:** Tests for key/url shapes and `absoluteArtifactUrl` with `APP_URL`.

- [ ] **Step 2:** Implement helpers (use `randomUUID` for token).

- [ ] **Step 3:** Commit: `feat: artifact url and job token helpers`.

---

### Task 5: Job lifecycle in Postgres (replace status file)

**Files:**
- Create: `src/lib/jobs/progress.ts`, `src/lib/jobs/createJob.ts`
- Modify: `src/lib/db/schema.ts` (+ migration): `jobs.progress`, `jobs.phase`, `jobs.detail` (int 0–100, text nullable)
- Modify: `src/app/api/jobs/route.ts`, `src/app/api/jobs/[id]/route.ts`, `scripts/run-job.ts`
- Test: `tests/lib/jobs/createJob.test.ts`

**Interfaces:**
- Produces: `async function createJobRecord(input): Promise<{ jobId, publicToken }>`, `async function patchJobProgress(jobId, patch)`, `async function getJobStatus(jobId)`.

- [ ] **Step 1:** Migration for progress columns.

- [ ] **Step 2:** `createJobRecord` inserts job with `public_token`, returns serial `id` (no filesystem `allocateJobId`).

- [ ] **Step 3:** `getJobStatus` joins chapters; `ready` = `audio_object_key IS NOT NULL`.

- [ ] **Step 4:** Wire `runJob` `onProgress` to `patchJobProgress` (remove `writeJobStatus` from worker path).

- [ ] **Step 5:** `GET /api/jobs/[id]` reads DB; require `?token=` via `verifyJobToken`.

- [ ] **Step 6:** Commit: `feat: postgres-backed job status`.

---

### Task 6: Upload flow — PDF to R2 + DB URLs

**Files:**
- Modify: `src/app/api/jobs/route.ts`, `src/lib/pipeline/prepareUpload.ts`
- Test: integration-style test with `LocalStorage` mocking `getStorage`

**Interfaces:**
- Consumes: `getStorage`, `upsertBook`, `bookPdfObjectKey`, `createJobRecord`.

- [ ] **Step 1:** On `POST` with PDF: extract text → `upsertBook` → if `books.pdf_object_key` empty, `storage.put(bookPdfObjectKey(bookId), pdfBuffer, 'application/pdf')` and update book PDF columns; if key exists, skip put.

- [ ] **Step 2:** `createJobRecord` copies `pdf_object_key` / `pdf_access_url` onto job row.

- [ ] **Step 3:** Voice sample: `storage.put` to `jobs/{jobId}/voice-sample.ext`, set `voice_object_key` + `voice_access_url`.

- [ ] **Step 4:** `prepareJobFromUpload` accepts `pdfBuffer` from API or worker (download from storage when re-run without upload—Task 7).

- [ ] **Step 5:** Spawn worker with `jobId` only (drop `upload.json` pdf paths as source of truth; optional minimal meta file for dev only).

- [ ] **Step 6:** Commit: `feat: upload pdf and voice to storage`.

---

### Task 7: POST /api/jobs without PDF (book reuse)

**Files:**
- Modify: `src/app/api/jobs/route.ts`, `scripts/run-job.ts`

- [ ] **Step 1:** Accept JSON or form field `bookId` (number) without `pdf` when book has `pdf_object_key`.

- [ ] **Step 2:** `storage.getBuffer(pdf_object_key)` → `extractPdfText` → chapters inserted; same job create path.

- [ ] **Step 3:** Test: create book with PDF once; second job without file succeeds.

- [ ] **Step 4:** Commit: `feat: create job from existing book pdf`.

---

### Task 8: Pipeline — upload chapter MP3s + update chapter rows

**Files:**
- Modify: `src/lib/pipeline/runJob.ts`, `src/lib/fish/cloneVoice.ts` (read voice from storage path helper if needed)

- [ ] **Step 1:** After `stitchMp3Files` to temp path, `readFile` → `storage.put(chapterObjectKey(...))`.

- [ ] **Step 2:** Update `chapters` set `audio_object_key`, `audio_access_url` for that idx.

- [ ] **Step 3:** `cloneVoiceFromFile` accepts local temp path (download voice from storage to tmp first in runJob).

- [ ] **Step 4:** Remove dependency on `chapter-{idx}.mp3` on disk for API readiness.

- [ ] **Step 5:** Commit: `feat: persist chapter audio to R2`.

---

### Task 9: Download APIs (chapters, PDF, voice)

**Files:**
- Modify: `src/app/api/jobs/[id]/chapters/[idx]/route.ts`
- Create: `src/app/api/books/[bookId]/pdf/route.ts`, `src/app/api/jobs/[id]/voice-sample/route.ts`

- [ ] **Step 1:** Shared helper `requireJobAccess(request, jobId)` reading `token` query param.

- [ ] **Step 2:** Chapter route: load `audio_object_key` from DB; stream via `storage.getStream` or 302 to `presignGet` (pick one; spec allows either—prefer proxy for Range support).

- [ ] **Step 3:** Book PDF route: verify token against a job that references `book_id` OR pass `jobId` query to scope token—implement: `GET /api/books/[bookId]/pdf?token=&jobId=` so token is always job-scoped.

- [ ] **Step 4:** Voice sample route similarly.

- [ ] **Step 5:** `GET /api/jobs/[id]` includes `downloadUrl` as `absoluteArtifactUrl` when ready.

- [ ] **Step 6:** Commit: `feat: token-gated artifact download apis`.

---

### Task 10: Job UI token + email

**Files:**
- Modify: `src/app/page.tsx` (redirect with token from create response), `src/app/jobs/[id]/page.tsx`
- Create: `src/lib/notify/sendJobReadyEmail.ts`
- Delete usage: `emailStub.ts`

- [ ] **Step 1:** `POST /api/jobs` returns `{ jobId, publicToken, jobUrl }`.

- [ ] **Step 2:** Job page reads `token` from query; passes to fetch `/api/jobs/${id}?token=`.

- [ ] **Step 3:** `sendJobReadyEmail` with nodemailer transport from env; HTML + text with `absoluteArtifactUrl('/jobs/${id}', token)` for job page link.

- [ ] **Step 4:** `runJob` on success: update `email_status`; call send; catch → `failed` + Sentry.

- [ ] **Step 5:** Commit: `feat: gmail job ready email and ui token`.

---

### Task 11: Observability

**Files:**
- Create: `src/lib/log/logger.ts`, `src/app/api/health/route.ts`
- Modify: `src/instrumentation.ts` or Sentry Next setup per `@sentry/nextjs` docs, `runJob` logging

- [ ] **Step 1:** `pino` child loggers with `jobId` binding (extend `jobLog.ts` or wrap).

- [ ] **Step 2:** Sentry init for Next 15; capture pipeline errors.

- [ ] **Step 3:** `GET /api/health` → `{ ok: true }` and optional DB ping.

- [ ] **Step 4:** Commit: `feat: health logging and sentry`.

---

### Task 12: Render + docs

**Files:**
- Create: `render.yaml` (web service, env var groups documented)
- Modify: `README.md`, `.env.example`

- [ ] **Step 1:** README sections: Docker Postgres dev, R2 setup, Gmail App Password, `APP_URL`, single-instance warning, `releaseCommand` for migrations.

- [ ] **Step 2:** `render.yaml` skeleton: build `npm run build`, start `npm start`, `releaseCommand` `npm run db:migrate`.

- [ ] **Step 3:** Remove obsolete `npm approve-scripts better-sqlite3` from README.

- [ ] **Step 4:** Commit: `docs: render deploy and env`.

---

## Spec self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Postgres + Drizzle | 1–2 |
| R2 + local storage | 3 |
| PDF `books/{id}/source.pdf` + DB keys/URLs | 4, 6 |
| Chapter MP3 keys/URLs | 8, 9 |
| Re-run without PDF | 7 |
| `public_token` gating | 4, 5, 9, 10 |
| Nodemailer Gmail | 10 |
| Retention manual (no lifecycle) | 3 (no auto-delete code) |
| Sentry + pino + health | 11 |
| Render single service | 12 |
| Voice on R2 | 6, 9 |
| Email fields on job | 1, 10 |

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-10-25-production-infra.md`.

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.

**2. Inline Execution** — run tasks in this session with executing-plans checkpoints.

Which approach do you want?
