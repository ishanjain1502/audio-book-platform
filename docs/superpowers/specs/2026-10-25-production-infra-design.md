# Production infrastructure — design spec

**Status:** Approved (2026-10-25)  
**Decisions (2026-10-25):** Render single Web Service (one instance), Postgres before launch, **Cloudflare R2** for artifacts (**retain until manual delete**), **Nodemailer + Gmail** (dedicated account) for “your audiobook is ready” email with job link, observability MVP (Sentry + structured logs).

## Goals

- Run reliably on **Render** with **one** web service that serves Next.js and runs the audiobook pipeline in-process (same model as today).
- Replace **SQLite** with **Render PostgreSQL** before launch.
- Store **durable artifacts** in **Cloudflare R2**: **source PDF (required)**, voice sample when provided, final chapter MP3s.
- Persist **R2 object keys and stable app access URLs** in Postgres so the pipeline and APIs can resolve files without local disk, and a **known book** can start a new job **without re-uploading the PDF** (fetch from R2 via `books` record).
- On job success, **email the user** at the address collected at upload with a link to access their audiobook (job page and/or downloads).
- Add **observability** sufficient to debug failed/stuck jobs: errors, searchable logs by `jobId`, basic timing.

## Non-goals (this milestone)

- Multi-instance autoscaling or a separate worker service.
- CDN/custom domain on R2 (optional later; app can proxy or presign from API).
- Full OpenTelemetry / custom metrics dashboards (Tier 2 — after launch).
- User accounts, login, or per-user libraries.
- Running our own mail server (outbound mail uses **Gmail SMTP** via Nodemailer).

---

## Render topology

```text
┌──────────────────────────────────────────────────────────────┐
│  Render Web Service (instances: 1)                            │
│  ┌─────────────┐  ┌─────────────────────────────────────┐   │
│  │ Next.js     │  │ Pipeline (runJob in-process)         │   │
│  │ API + UI    │  │ temp files → stitch → upload R2      │   │
│  └──────┬──────┘  └──────────────┬──────────────────────┘   │
│         │                        │                            │
│         │ DATABASE_URL           │ S3 API (HTTPS)              │
│         ▼                        ▼                            │
│  ┌──────────────┐         ┌─────────────────┐                  │
│  │ Render       │         │ Cloudflare R2   │                  │
│  │ PostgreSQL   │         │ bucket          │                  │
│  └──────────────┘         └─────────────────┘                  │
│         │                                                     │
│         │  optional: small ephemeral or tiny disk for        │
│         │  ffmpeg segment scratch (deleted after upload)      │
└─────────┼─────────────────────────────────────────────────────┘
          │
          ▼
    Sentry + log drain (stdout)
          │
          ▼
    Gmail SMTP (Nodemailer)
```

| Resource | Purpose |
|----------|---------|
| **Web Service** | `npm run build` → `npm start`; health check on `/api/health`. |
| **PostgreSQL** | Job/book/segment state; **R2 object keys + app access URLs** for PDF, voice, and chapter audio. |
| **R2** | Canonical store for PDFs (per book), job voice samples, and chapter MP3s. |
| **Persistent disk** | **Optional** — only if segment stitch temp files exceed comfortable `/tmp` size; not the system of record for outputs. |
| **Instance count** | **1** until designed otherwise; R2 + Postgres already allow scaling the app later. |

**Constraint:** Do not rely on the Render ephemeral filesystem for anything the user must download after a deploy.

---

## Object storage: Cloudflare R2

### Why R2

- S3-compatible API (`@aws-sdk/client-s3` with custom endpoint).
- **No egress fees** from R2 (fits large MP3 delivery via presigned URLs).
- Free tier (check current Cloudflare docs for limits): sufficient for early production; **no automatic expiry** on objects (see retention).

### Retention

- **Policy:** Objects stay in R2 **until manual delete**. No bucket lifecycle rules that auto-remove job data.
- **Operations:** v1 may omit an admin UI; manual delete = Cloudflare dashboard and/or a future internal script (`deleteJobArtifacts(jobId)`). Postgres job row deletion is separate and should be documented if you remove DB without R2 cleanup.
- **Pipeline:** Paragraph segments may stay on local scratch during stitch; **PDF and final chapter MP3s are always uploaded to R2** and recorded in the DB.

### Bucket layout (convention)

| Key pattern | Content | Notes |
|-------------|---------|--------|
| `books/{bookId}/source.pdf` | **Canonical PDF** for this book (fingerprint) | Uploaded on first ingest; reused for later jobs |
| `jobs/{jobId}/voice-sample.{ext}` | Custom narrator sample | When user provides voice; kept until manual delete |
| `jobs/{jobId}/chapters/chapter-{idx}.mp3` | **Deliverable** per job | Kept until manual delete |
| `jobs/{jobId}/segments/...` | Paragraph audio | Optional; not required for v1 |

**PDF rule:** On upload, compute fingerprint → upsert `books` → `PutObject` to `books/{bookId}/source.pdf` (overwrite only if same book id and intentional re-upload). If `books.pdf_object_key` already exists for a cache hit, **skip re-upload** and read PDF from R2 for text extraction / pipeline (or trust cached `chapters` text in DB for re-runs — product choice: v1 still extracts from R2 PDF when starting a job without file upload).

### DB storage: keys vs URLs

Store **both** where useful:

| Field kind | Example column | Contents |
|------------|----------------|----------|
| **Object key** | `pdf_object_key` | `books/12/source.pdf` — source of truth for R2 `GetObject` / `PutObject` |
| **App access URL** | `pdf_access_url` | Stable API path for browsers/clients: `/api/books/12/pdf` (token required on request) |
| **Absolute URL** | optional `pdf_public_url` | Not stored by default; compute at runtime as ``${APP_URL}${pdf_access_url}?token=...`` for email/admin. Do **not** store short-lived presigned R2 URLs in the DB. |

Same pattern for chapters: `audio_object_key` + `audio_access_url` (e.g. `/api/jobs/42/chapters/0`). Jobs may denormalize `pdf_object_key` / `pdf_access_url` from `books` at creation for convenience.

Rename legacy `segments.audio_path` → `audio_object_key` (nullable); segment rows optional for v1 R2 persistence.

### Re-run without PDF upload (v1 API shape)

- **With PDF:** current flow — upload → R2 → create job.
- **Without PDF:** `POST /api/jobs` with `bookId` (or `fingerprint`) + `email` (+ optional voice) — no `pdf` field. Server loads `books.pdf_object_key`, downloads from R2 (or streams) for validation/extraction, creates job linked to same `book_id`. UI can follow in a later milestone; schema and pipeline support it at launch.

### Access patterns

| Consumer | Pattern |
|----------|---------|
| **Pipeline** | `PutObject` for PDF at ingest and chapter MP3 at stitch; worker uses R2 API token (secret on Render only). |
| **Browser / email** | Use **URLs stored in DB** (`*_access_url`) under `APP_URL` + `token`; handlers validate `public_token` then **302 to presigned GET** or proxy stream from R2. |
| **Book PDF** | `GET /api/books/{bookId}/pdf?token=` (token scoped to job or book — use job token if book-only is too open; see security note below). |
| **Local dev** | `STORAGE_BACKEND=local` under `DATA_DIR` **or** dev R2 bucket; same `Storage` interface. |

### `Storage` module (new)

Single interface used by `runJob`, upload handler, and chapter API:

- `put(key, body | stream, contentType)`
- `getStream(key)` / `getBuffer(key)` (for API range requests if proxying)
- `presignGet(key, expiresSeconds)`
- `delete(key)` (optional cleanup job)

Implementation: `R2Storage` (production), `LocalStorage` (dev/tests).

### Env vars (R2)

| Variable | Purpose |
|----------|---------|
| `R2_ACCOUNT_ID` | Cloudflare account |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token |
| `R2_BUCKET_NAME` | Bucket |
| `R2_PUBLIC_URL` | Optional custom domain; else use presigned only |
| `STORAGE_BACKEND` | `r2` \| `local` |

---

## Email delivery

### Behavior

When `runJob` finishes successfully (today: `sendEmailStub`):

1. Ensure final chapter objects exist in R2 and DB reflects `done`.
2. Send **one transactional email** to `jobs.email`.
3. Record send outcome on the job (see schema) for support/debug.

### Email content (v1)

- **Subject:** e.g. `Your audiobook is ready`
- **Body:** Short copy + primary CTA link:
  - **`{APP_URL}/jobs/{jobId}?token={publicToken}`**  
  `APP_URL` = public site URL on Render (e.g. `https://audiobook-gen.onrender.com`).
- Optional: bullet list of chapter titles (no need to embed long presigned URLs in email if the job page lists players/downloads).

Replace `src/lib/notify/emailStub.ts` with `sendJobReadyEmail({ to, jobId, publicToken, chapterTitles })`.

### Provider: Nodemailer + Gmail

Use a **dedicated Gmail or Google Workspace account** for the product (not a personal inbox). Implement `sendJobReadyEmail` with **Nodemailer** and Gmail SMTP.

| Setting | Value |
|---------|--------|
| Host | `smtp.gmail.com` |
| Port | `587` (STARTTLS) or `465` (SSL) — pick one in config |
| Auth | Account email + **Google App Password** (requires 2-Step Verification on the account) |

| Variable | Purpose |
|----------|---------|
| `SMTP_HOST` | Default `smtp.gmail.com` |
| `SMTP_PORT` | `587` or `465` |
| `SMTP_USER` | Gmail address |
| `SMTP_PASS` | App Password (Render secret) |
| `EMAIL_FROM` | From header; use same address or a configured **Send mail as** alias |
| `APP_URL` | Canonical public base URL for links |

**Limits & deliverability:** Gmail enforces daily send limits (stricter on consumer `@gmail.com` than Workspace). Fine for low-volume “job ready” mail; watch spam folder on first sends. For a custom domain on **Google Workspace**, set `EMAIL_FROM` to that domain and use Workspace’s normal SPF/DKIM (managed in Google Admin). Consumer Gmail cannot fully brand a custom domain without Workspace.

**Implementation:** `src/lib/notify/sendJobReadyEmail.ts` — plain-text + minimal HTML, link to tokenized job URL; errors surfaced to `email_status` / Sentry (do not log `SMTP_PASS`).

### Failure handling

- If email fails: job stays **`done`**; set `email_status = 'failed'` and log error to Sentry. Optional retry via admin script or one automatic retry with backoff.
- Do not block completion on email alone; user can still open the job page if they have the URL (see access control).

---

## Job link security

Today job IDs are enumerable (`/jobs/1`, `/jobs/2`). For email links and sharing:

- Add **`jobs.public_token`** (`uuid`, unique, indexed) at job creation.
- Job page and download API require **`token` query param** or path segment matching the job (e.g. `/jobs/[id]` reads token from query; API `GET /api/jobs/[id]` requires `Authorization: Bearer <token>` or `?token=`).
- Email contains only the tokenized URL. UI copy: “Anyone with this link can listen.”

Non-goals: full auth; optional future “revoke link” by rotating token.

---

## Database: PostgreSQL + Drizzle

### Why Drizzle

- Schema stays close to current SQL (`schema.sql` is the source of truth to port).
- Type-safe queries; migrations in repo.

### Schema port (SQLite → Postgres)

| SQLite today | Postgres |
|--------------|----------|
| `INTEGER PRIMARY KEY` | `GENERATED BY DEFAULT AS IDENTITY` |
| `DATETIME` | `timestamptz` |
| `speaks INTEGER` | `boolean` |
| `INSERT OR REPLACE` | `ON CONFLICT DO UPDATE` |
| `TEXT` JSON | `text` or `jsonb` (optional) |

### New / changed columns

**`books`**

| Column | Type | Purpose |
|--------|------|---------|
| `pdf_object_key` | `text` | R2 key, e.g. `books/{id}/source.pdf` |
| `pdf_access_url` | `text` | App route, e.g. `/api/books/{id}/pdf` |
| `pdf_uploaded_at` | `timestamptz` | First successful R2 put |

**`jobs`**

| Column | Type | Purpose |
|--------|------|---------|
| `public_token` | `uuid NOT NULL UNIQUE` | Unguessable link access |
| `pdf_object_key` | `text` | Copy of book key at job creation (for queries) |
| `pdf_access_url` | `text` | App route for this job’s book PDF |
| `voice_object_key` | `text` | nullable; replaces filesystem `custom_voice_path` |
| `voice_access_url` | `text` | nullable, e.g. `/api/jobs/{id}/voice-sample` |
| `email_status` | `text` | `pending` \| `sent` \| `failed` |
| `email_sent_at` | `timestamptz` | nullable |
| `email_error` | `text` | nullable |

Drop or stop writing **`jobs.custom_voice_path`** after migration (local path only).

**`chapters`**

| Column | Type | Purpose |
|--------|------|---------|
| `audio_object_key` | `text` | R2 key when chapter MP3 is ready |
| `audio_access_url` | `text` | e.g. `/api/jobs/{jobId}/chapters/{idx}` — set when stitch + upload complete |

**`segments`**

| Column | Type | Purpose |
|--------|------|---------|
| `audio_object_key` | `text` | Renamed from `audio_path`; optional if segments not in R2 |

**URL helpers (code, not columns):** `absoluteArtifactUrl(accessUrl, publicToken)` → ``${APP_URL}${accessUrl}?token=${publicToken}`` for email and JSON API responses.

Tables: `books`, `character_maps`, `jobs`, `chapters`, `segments` (same domains as today).

**PDF API security:** Book PDF is sensitive. Require the same **`jobs.public_token`** (or a dedicated book token later) on `GET /api/books/{bookId}/pdf` when the request is user-facing; internal pipeline uses R2 key directly with service credentials.

### Access layer

- Remove `better-sqlite3`; **async** Drizzle + `pg` pool.
- Port all DB call sites and scripts.

### Migrations

- Drizzle Kit; `releaseCommand` on Render to migrate before/start with new revision.

### Tests

- Postgres test DB; storage tests use `LocalStorage` or MinIO-compatible mock.

---

## Observability

### Tier 1 (launch)

| Component | Choice |
|-----------|--------|
| **Logging** | `pino` JSON; `jobId`, `stage`, `durationMs`, R2 key on upload, `email_status`. |
| **Errors** | Sentry (Next + pipeline + email send). |
| **Health** | `GET /api/health` + optional `SELECT 1`. |

### Privacy

- No PDF/screenplay body in logs; no presigned URLs in logs (or log key only).

---

## Environment variables (summary)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres |
| `APP_URL` | Public site URL for email links |
| R2_* | Object storage |
| `STORAGE_BACKEND` | `r2` / `local` |
| `DATA_DIR` | Local scratch / dev storage only |
| `SMTP_*`, `EMAIL_FROM` | Gmail via Nodemailer |
| `COMMANDCODE_API_KEY`, `FISH_API_KEY`, … | Unchanged |
| `SENTRY_DSN`, `LOG_LEVEL` | Observability |

---

## Implementation order (for planning doc)

1. Postgres + Drizzle + migrations (artifact keys/URLs, `public_token`, email fields).
2. `Storage` abstraction + R2 + local; **upload PDF to `books/{id}/source.pdf` on ingest**; persist `pdf_object_key` + `pdf_access_url`; pipeline uploads chapter MP3s and sets chapter URL columns.
3. APIs: chapter + **book PDF** download; auth via `public_token`; presign or proxy from R2; job status JSON includes `audio_access_url` / absolute URLs for ready chapters.
4. `POST /api/jobs` without PDF when `bookId` present and `books.pdf_object_key` set (optional UI later).
5. Replace email stub with Nodemailer + Gmail; wire on job `done`.
6. Job UI: accept `token` in URL; hide dev “terminal” messaging where inappropriate.
7. Observability: pino, Sentry, `/api/health`.
8. Render: `render.yaml`, env vars, migrate on deploy; README (prefer API proxy over direct R2 browser GET).

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| R2 free tier / growth | No auto-expiry — monitor bucket size; manual delete when retiring jobs. |
| Large temp disk during stitch | Stream where possible; avoid uploading paragraph segments to R2 unless needed. |
| Gmail send limits or spam | Dedicated account; App Password; test to major providers; consider Workspace if volume grows. |
| Token leak = access to audiobook | Treat like unlisted link; document for users. |
| Sync→async DB regressions | Port DB + storage with tests before Render cutover. |

---

## Approval

**Approved 2026-10-25.** Implementation plan: [`docs/superpowers/plans/2026-10-25-production-infra.md`](../plans/2026-10-25-production-infra.md).
