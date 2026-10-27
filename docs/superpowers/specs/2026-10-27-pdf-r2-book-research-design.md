# PDF upload to R2 and one-time book research — design spec

**Status:** Approved (2026-10-27)

## Goals

- After the user uploads a text PDF, store that PDF in Cloudflare R2 and open a review step.
- Save the book's meta information on the `books` row: title, author, page count, and word count.
- Research a book only when that book has never been successfully researched. Save the character map on the book so later jobs reuse it.
- Start audiobook generation only after the user confirms the review.

## Non-goals

- Replacing SQLite with Postgres, chapter MP3 upload to R2, completion email, or public tokens. Those stay in the production-infra spec.
- Uploading the voice sample to R2. It stays on local disk at `jobs.custom_voice_path`.
- A public PDF download route. Persist `pdf_access_url` as `/api/books/{bookId}/pdf` and do not add the handler in this slice.
- Re-running research when the user edits title, author, or page count.
- Changing the fingerprint formula (`sha256` of normalized title at upload plus the first 5,000 words).

## Decisions

| Topic | Choice |
| --- | --- |
| Upload form | PDF, email, and optional voice sample, same as today |
| PDF object key | `books/{bookId}/source.pdf` |
| Existing PDF | If `books.pdf_object_key` is set, skip the put |
| Job state before confirm | `awaiting_review`. Do not start the worker |
| Research | Once per book, only when `researched_at` is null |
| Saved research | `character_maps` rows for that `book_id`, plus `researched_at` and `research_mode` on `books` |
| Meta edits | Update the same `books` row. Do not change the fingerprint and do not research again |
| Repeat upload | Same fingerprint reuses the book, its saved meta, its PDF, and its research |
| Confirm | Writes the current meta, then starts the existing worker with the job id only |

## Flow

1. The home page submits the PDF, email, and optional voice sample to `POST /api/jobs`.
2. The server validates the PDF and the voice sample before it writes anything to R2. A scanned PDF, a PDF under 500 words, or an invalid voice sample returns the current error and stores nothing.
3. The server extracts text, computes the fingerprint from the extracted title and text, and upserts the book. On insert it saves `title`, `author`, `page_count`, and `word_count`. On a fingerprint match it keeps the stored title, author, page count, and word count.
4. If `pdf_object_key` is empty, it uploads the PDF to `books/{bookId}/source.pdf` and sets `pdf_object_key`, `pdf_access_url`, and `pdf_uploaded_at`. A failed upload does not create the job.
5. The server splits chapters into `chapters` for this job, saves the voice path on the job, and sets the job status to `awaiting_review`. It does not spawn the worker.
6. The browser opens `/jobs/{jobId}/review`.
7. The review page shows the saved title, author, and page count. Those fields are editable. Leaving a field saves it to the same `books` row. Confirm writes the current values again.
8. If the book has no `researched_at` and no `research_error`, the review page asks the server to research once. A book that already has `researched_at` shows the saved character list and does not call the model. A saved `research_error` waits for an explicit retry.
9. Confirm is enabled only when the job is `awaiting_review`, the book has `researched_at` set, the title is non-empty, and the page count is a positive integer. A blank author is stored as null and shown as unknown.
10. Confirm starts the existing worker with the job id. The worker reads the job, book, chapters, and character map from the database. It does not read `upload.json` or the PDF to prepare the job. `runJob` does not research when a character map is already saved. A custom narrator sample still replaces the narrator voice id inside that saved map, as it does today.

A title or author edit does not create a second book and does not move the R2 object.

## Storage

`src/lib/storage/` exposes `put` and `getBuffer`.

- `STORAGE_BACKEND=r2` uses the S3-compatible R2 client, the account and keys already in the environment, and the `media-assets` bucket.
- `STORAGE_BACKEND=local` writes under `DATA_DIR`. Tests use this backend.
- Object key: `books/{bookId}/source.pdf`.
- Do not store presigned URLs. Store the object key and the app path `/api/books/{bookId}/pdf`.

Dependency: `@aws-sdk/client-s3`.

## Schema

SQLite `CREATE TABLE IF NOT EXISTS` does not add columns to an existing database. `ensureSchema` runs additive `ALTER TABLE` statements and ignores duplicate-column errors.

New `books` columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `pdf_object_key` | text, null | `books/{id}/source.pdf` after a successful put |
| `pdf_access_url` | text, null | `/api/books/{id}/pdf` |
| `pdf_uploaded_at` | datetime, null | When the put succeeded |
| `researched_at` | datetime, null | Set only after research succeeds |
| `research_mode` | text, null | `web_research` or `text_sample` |
| `research_started_at` | datetime, null | Lock while a research call is in flight |
| `research_error` | text, null | Last failure message. Cleared on success |

`title`, `author`, `page_count`, and `word_count` stay the meta fields. They are written on first insert and updated only by an explicit edit or by confirm.

## Research

`POST /api/jobs/{id}/research` is the only research entry point for this flow.

- If `researched_at` is set, return the saved character map and do not call the model.
- If `research_started_at` is set and is less than 10 minutes old, return `running` and do not start a second call.
- If `research_started_at` is older than 10 minutes, treat the lock as stale and allow one new attempt.
- Otherwise set `research_started_at`, clear `research_error`, and commit that lock before calling the model. Then run the existing `buildCharacterMap` path. The title and author are the values already stored on the book. A null author is passed as `Unknown`.
- On success, assign voices with no custom narrator id, save `character_maps` for this `book_id`, set `research_mode` and `researched_at`, clear `research_started_at` and `research_error`.
- On failure, clear `research_started_at`, set `research_error`, leave `researched_at` null, and return the error. The review page shows that error and retries only when the user asks. It does not call research again on its own.
- A web-search miss that falls back to the book text is success. `research_mode` is `text_sample`.

Editing meta during an in-flight research does not cancel or restart that call. The single result is still saved.

The review list shows each character's name, role, and tonality, plus whether the map came from web research or from the book text. Raw search snippets are not shown.

## APIs

`POST /api/jobs` accepts the current multipart form. Response: `{ jobId }` with status `awaiting_review`.

`GET /api/jobs/{id}` adds, for the review page: `bookId`, `title`, `author`, `pageCount`, `researchStatus` (`idle`, `running`, `ready`, or `failed`), `researchMode`, `researchError`, and `characters` (`name`, `role`, `tonality`). Status is `ready` when `researched_at` is set, `running` when the lock is fresh, `failed` when `research_error` is set, and `idle` otherwise.

`PATCH /api/jobs/{id}/book` accepts `{ title, author, pageCount }` while the job is `awaiting_review`. It updates that job's book row. It rejects an empty title and a page count that is not a positive integer. A blank author is stored as null. It does not research.

`POST /api/jobs/{id}/confirm` accepts the same body, writes those fields, and rejects the call unless the job is `awaiting_review` and `researched_at` is set. It then sets the job to `queued` and spawns the worker. A second confirm is rejected.

## Review page

`src/app/jobs/[id]/review/page.tsx` loads the job and shows the three fields. When status is `idle`, it calls `POST .../research` once. When status is `running`, it polls `GET` until the status changes. When status is `failed`, it shows `researchError` and a retry action that calls `POST` again. After confirm succeeds, the browser goes to the existing `/jobs/{id}` progress page.

## Failure behavior

- Invalid PDF or voice: no R2 object and no job.
- R2 put fails: no job. A later upload of the same book retries the put when `pdf_object_key` is empty.
- Research failure: job stays `awaiting_review`, Confirm stays disabled, retry is allowed.
- Confirm of a job that has left `awaiting_review`: rejected, so a second worker is not started.
- Worker spawn failure: mark the job `failed`. The book, PDF, and saved research remain.

## Testing

Unit tests only. No live R2 and no live model calls.

- Local storage writes and reads a PDF under `DATA_DIR` at `books/{bookId}/source.pdf`. A book that already has `pdf_object_key` is not uploaded again.
- First insert writes title, author, page count, and word count. A second upsert of the same fingerprint does not replace them. An edit updates the row and leaves the fingerprint unchanged.
- Research runs only when `researched_at` is null. Success saves the character map, `researched_at`, and `research_mode`, and clears `research_error`. A later call returns the saved map and does not call the model. A failure leaves `researched_at` null and sets `research_error`. A second request while `research_started_at` is fresh does not start another research.
- When a character map is already saved, the job runner does not call research. Cover this by mocking the research function around the existing `runJob` branch.
- Confirm is allowed only for `awaiting_review` when `researched_at` is set, the title is non-empty, and the page count is a positive integer. A blank author is stored as null.

## Out of scope reminder

Voice samples, chapter audio, and Postgres are unchanged by this slice. The production-infra spec still owns those.
