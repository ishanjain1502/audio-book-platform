# Audiobook Generator

PDF → expressive multi-chapter MP3 via Commandcode (DeepSeek) + Fish Audio Drama 3.

## Setup

1. Copy `.env.example` to `.env` and set `COMMANDCODE_API_KEY` and `FISH_API_KEY`.
2. `npm install` and `npm approve-scripts better-sqlite3` if needed.
3. `npm run dev` — open http://localhost:3000

## Scripts

- `npm test` — unit tests
- `npm run build` — production build

## Debugging the pipeline

Upload runs in Next.js; synthesis runs in a separate worker (`scripts/run-job.ts`). To step through the worker:

1. Upload a PDF once and note the `jobId` (or use a failed job that still has `src/data/jobs/<id>/upload.json`).
2. **Run and Debug** → **Debug job worker** → enter the job id.
3. Press **Continue** (F5) after start (`--inspect-brk` pauses on launch). Set breakpoints in `src/lib/pipeline/runJob.ts`, Fish, annotate, etc.

See `.docs/build-plan.md` for architecture and pipeline details.
