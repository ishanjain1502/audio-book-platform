# Audiobook Generator — Final Build Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an MVP web app that accepts a text-layer PDF, optional 15–20s narrator voice sample, and email; produces multi-chapter expressive MP3s via DeepSeek (Commandcode) + Fish Audio Drama 3; notifies via console/log stub.

**Architecture:** Next.js full-stack app with API routes driving a linear job pipeline persisted in SQLite. Two independent worker pools (annotation ×5, synthesis ×5) process paragraph segments with retry/backoff. Character maps are cached by book fingerprint; web research uses Commandcode native search with text-sample fallback.

**Tech Stack:** Node.js 20+, TypeScript, Next.js (App Router), SQLite (`better-sqlite3`), Zod, `pdf-parse` or `pdfjs-dist`, OpenAI-compatible client → Commandcode (`deepseek/deepseek-v4-flash`), Fish Audio HTTP API (`drama-3`, fallback `s2.1-pro` via env).

**Source documents:** `.docs/init.md` (pipeline overview), `.docs/init-2.md` (locked prompts, schema, validation).

## Global Constraints

- LLM: Commandcode base `https://api.commandcode.ai/provider/v1`, model `deepseek/deepseek-v4-flash`, `response_format: { type: "json_object" }`; validate with Zod; one retry with validation error appended.
- Annotation concurrency: **5** parallel paragraph calls (DeepSeek).
- Synthesis concurrency: **5** parallel Fish Audio calls (no shared semaphore with annotation).
- Voice sample: **hard-fail** unless duration is **15.0–20.0 seconds** (server-side probe).
- PDF: text-layer only; reject if no text or **< 500 words**.
- Chapters: TOC/bookmarks → `Chapter N` regex → **3,000-word sections** labeled `Section 1`, …; never fail job for missing headings.
- Drama 3: max **16** speakers per request; collapse minor roles to shared `supporting` voice when exceeded.
- Character map cache key: `sha256(normalized_first_5k_words + title)` (not per upload file).
- Delivery: MP3s on **local disk** under job-specific paths; email = **stub** (log link paths; no SMTP in v1).
- Web research: **Commandcode native web search**; fallback to text sample if `sources_found < 2` OR `avg(confidence) < 0.5`.
- Expression: verbatim paragraph text after tag strip; uncertain emotion → no direction tags.
- Pin Fish Drama 3 tag vocabulary and API field shapes in a constants module after reading official docs once at build time.

## Decisions Log (confirmed with product owner)

| Topic | Choice |
|--------|--------|
| User surface | Full web UI: upload PDF + voice + email, status/progress |
| Web search | Commandcode native |
| Voice sample | Strict 15.0–20.0 s |
| Concurrency | 5 annotation + 5 synthesis (fixed) |
| Output + notify | Local disk + email stub (console/log) |

## Open at implementation time (verify, do not guess)

1. **`reference_id` shape** — Confirm from Fish docs whether `reference_id` is a string, array, and that array index `N` maps to `<|speaker:N|>`. Only `src/lib/fish/synthesize.ts` should change if wrong.
2. **Inter-paragraph silence** — After first sample MP3, measure tail silence; enable 250 ms gap insert only if needed (`src/lib/audio/stitch.ts`).
3. **Commandcode search tool** — Discover exact tool/API surface Commandcode exposes for web search; implement in `src/lib/research/searchBookInfo.ts` behind `SearchProvider` interface.

---

## Target repository layout

```
audio-book-gen/
├── .env.example
├── package.json
├── next.config.ts
├── src/
│   ├── app/
│   │   ├── page.tsx                 # upload form
│   │   ├── jobs/[id]/page.tsx       # poll status + download links
│   │   └── api/
│   │       ├── jobs/route.ts        # POST create job
│   │       └── jobs/[id]/route.ts   # GET status + artifacts
│   ├── lib/
│   │   ├── db/
│   │   │   ├── schema.sql
│   │   │   └── client.ts
│   │   ├── pdf/
│   │   │   ├── extract.ts
│   │   │   └── chapters.ts
│   │   ├── book/
│   │   │   └── fingerprint.ts
│   │   ├── research/
│   │   │   ├── searchBookInfo.ts    # Commandcode native
│   │   │   └── characterMap.ts      # Prompt A orchestration
│   │   ├── voices/
│   │   │   ├── voices.json          # generated once at dev setup
│   │   │   └── assign.ts
│   │   ├── annotate/
│   │   │   ├── screenplay.ts        # Prompt B
│   │   │   └── queue.ts             # p-limit(5)
│   │   ├── fish/
│   │   │   ├── constants.ts         # tags, caps, models from docs
│   │   │   ├── synthesize.ts
│   │   │   └── queue.ts             # p-limit(5)
│   │   ├── audio/
│   │   │   ├── validateSample.ts
│   │   │   └── stitch.ts
│   │   ├── llm/
│   │   │   └── commandcode.ts
│   │   ├── pipeline/
│   │   │   └── runJob.ts            # orchestrates stages
│   │   └── notify/
│   │       └── emailStub.ts
│   └── data/                        # gitignored: sqlite + mp3 output
├── scripts/
│   └── fetch-voices.ts              # one-off voices.list → voices.json
└── tests/
    └── ...                          # mirrors lib/ units
```

---

## Phase 0 — Project bootstrap

### Task 0: Scaffold Next.js + SQLite + env

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.env.example`, `.gitignore`
- Create: `src/lib/db/schema.sql`, `src/lib/db/client.ts`

**Interfaces:**
- Produces: `getDb()` returning a initialized SQLite connection; migrations applied from `schema.sql`.

- [ ] **Step 1:** Initialize Next.js with TypeScript and App Router; add `better-sqlite3`, `zod`, `p-limit`, `pdf-parse`, `dotenv`.
- [ ] **Step 2:** Copy SQL from init-2 §6 into `schema.sql` (`books`, `character_maps`, `jobs`, `chapters`, `segments`).
- [ ] **Step 3:** Implement `getDb()` that runs schema on first connect; path `src/data/app.db` (gitignored).
- [ ] **Step 4:** Add `.env.example` with `COMMANDCODE_API_KEY`, `FISH_API_KEY`, `FISH_BASE_URL`, `FISH_FALLBACK_MODEL=s2.1-pro`, `DATA_DIR=./src/data`.
- [ ] **Step 5:** Commit scaffold.

---

## Phase 1 — Constants, validation, PDF ingestion

### Task 1: Fish/Drama constants (docs-driven)

**Files:**
- Create: `src/lib/fish/constants.ts`
- Test: `tests/lib/fish/constants.test.ts`

- [ ] **Step 1:** Read official Fish Audio Drama 3 docs; pin `DRAMA3_MODEL`, `MAX_SPEAKERS=16`, allowed direction/tag strings, `MAX_ANNOTATED_CHARS` (start 2000), TTS path.
- [ ] **Step 2:** Test asserts exported tag list is non-empty and `MAX_SPEAKERS === 16`.

### Task 2: Voice sample validator

**Files:**
- Create: `src/lib/audio/validateSample.ts`
- Test: `tests/lib/audio/validateSample.test.ts`

**Interfaces:**
- Produces: `validateVoiceSample(buffer: Buffer): { durationSec: number }` throws `VoiceSampleError` with HTTP-minded codes.

- [ ] **Step 1:** Failing tests for 14.9s, 20.1s, non-audio buffer.
- [ ] **Step 2:** Implement duration probe (e.g. `music-metadata` or `ffmpeg-static` ffprobe); enforce **15.0–20.0** inclusive.
- [ ] **Step 3:** Pass tests; commit.

### Task 3: PDF extract + chapter split

**Files:**
- Create: `src/lib/pdf/extract.ts`, `src/lib/pdf/chapters.ts`
- Test: `tests/lib/pdf/chapters.test.ts` (fixture strings; optional small PDF fixture)

**Interfaces:**
- Produces: `extractPdfText(buffer) → { text, metadata }`
- Produces: `splitChapters(text, toc?) → { title, rawText }[]`

- [ ] **Step 1:** Reject empty text and `< 500` words with typed errors per init-2 §1.
- [ ] **Step 2:** Implement TOC/bookmark path if library supports; regex `Chapter\s+\d+`; fallback 3k-word sections.
- [ ] **Step 3:** Unit tests for regex and fixed-word fallback; commit.

### Task 4: Book fingerprint + cache lookup

**Files:**
- Create: `src/lib/book/fingerprint.ts`
- Test: `tests/lib/book/fingerprint.test.ts`

**Interfaces:**
- Produces: `computeFingerprint(title: string, fullText: string): string`
- Produces: `findBookByFingerprint(fp): BookRow | null`

- [ ] **Step 1:** Normalize whitespace; hash first 5k words + normalized title (SHA-256).
- [ ] **Step 2:** DB helpers insert/find `books`; commit.

---

## Phase 2 — LLM, research, voices

### Task 5: Commandcode client + JSON retry helper

**Files:**
- Create: `src/lib/llm/commandcode.ts`
- Test: `tests/lib/llm/commandcode.test.ts` (mock fetch)

**Interfaces:**
- Produces: `chatJson<T>(messages, schema: z.ZodType<T>): Promise<T>` with one validation retry.

- [ ] **Step 1:** OpenAI-compatible client pointed at Commandcode base URL.
- [ ] **Step 2:** Parse JSON; on Zod failure, retry once with error appended to user message.
- [ ] **Step 3:** Tests with mocked 200 + invalid then valid JSON; commit.

### Task 6: `searchBookInfo` (Commandcode native)

**Files:**
- Create: `src/lib/research/searchBookInfo.ts`
- Create: `src/lib/research/types.ts`

**Interfaces:**
- Produces: `searchBookInfo(title, author): Promise<{ snippets: string[]; sourcesFound: number }>`

- [ ] **Step 1:** Inspect Commandcode capabilities; wire native web search to return 3–5 snippets (title/author query).
- [ ] **Step 2:** Integration test behind `RUN_INTEGRATION=1` or manual script; document in comment if skipped in CI.
- [ ] **Step 3:** Commit.

### Task 7: Prompt A — character map + fallback + persist

**Files:**
- Create: `src/lib/research/characterMap.ts`
- Create: `src/lib/research/prompts/characterMap.ts` (system/user templates from init-2 §3)
- Test: `tests/lib/research/characterMap.test.ts`

**Interfaces:**
- Produces: `buildCharacterMap({ title, author, mode, snippets | textSample }): CharacterMapResult`
- Consumes: `chatJson`, Zod schema for characters array

- [ ] **Step 1:** Copy Prompt A text from init-2; define Zod schema matching documented JSON shape.
- [ ] **Step 2:** Orchestration: web mode → validate thresholds → else text sample (first 20% + 5 dialogue-heavy chapters by `"` count).
- [ ] **Step 3:** Persist to `character_maps`; assign `speaker_index` (narrator = 0, others 1..n-1 deterministic order).
- [ ] **Step 4:** Tests with fixtures for fallback trigger; commit.

### Task 8: Voice library + assignment

**Files:**
- Create: `scripts/fetch-voices.ts`, `src/lib/voices/voices.json`, `src/lib/voices/assign.ts`
- Create: `src/lib/fish/cloneVoice.ts`
- Test: `tests/lib/voices/assign.test.ts`

- [ ] **Step 1:** Run script once: `voices.list(self_only=false)`, select 10–12 EN voices, write metadata + IDs to `voices.json`.
- [ ] **Step 2:** If job includes validated voice sample, call Fish clone/create-reference API (confirm endpoint from docs in `cloneVoice.ts`); store returned ID on `jobs.custom_voice_path` metadata or narrator `voice_id`.
- [ ] **Step 3:** Greedy tag-overlap assignment per init-2 §2; narrator uses clone ID when present, else library `reserved_for: "narrator"`.
- [ ] **Step 4:** Store `voice_id` on each `character_maps` row; all character voices distinct from narrator; commit.

---

## Phase 3 — Annotation and synthesis

### Task 9: Prompt B — paragraph screenplay + verbatim guard

**Files:**
- Create: `src/lib/annotate/screenplay.ts`, `src/lib/annotate/prompts/screenplay.ts`
- Create: `src/lib/annotate/verbatim.ts`
- Test: `tests/lib/annotate/verbatim.test.ts`, `tests/lib/annotate/screenplay.test.ts`

**Interfaces:**
- Produces: `annotateParagraph({ paragraph, prev, next, speakerMap }): { annotated, speakersUsed }`
- Produces: `stripTags(s): string` for equality check

- [ ] **Step 1:** Implement verbatim strip/compare (whitespace-normalized).
- [ ] **Step 2:** Prompt B from init-2 §4; global `speaker_map_json` per chapter.
- [ ] **Step 3:** On validation failure: retry once with diff; fallback = speaker tag only, no directions.
- [ ] **Step 4:** Tests for paraphrase rejection and fallback; commit.

### Task 10: Annotation queue (5-wide)

**Files:**
- Create: `src/lib/annotate/queue.ts`
- Modify: `src/lib/pipeline/runJob.ts` (stub if not exists)

- [ ] **Step 1:** `p-limit(5)` wrapper updating `segments.status` (`pending` → `annotated` / `failed`).
- [ ] **Step 2:** Dead-letter: store `error`, `attempts` on segment row; continue chapter.
- [ ] **Step 3:** Commit.

### Task 11: Drama 3 synthesize wrapper + queue

**Files:**
- Create: `src/lib/fish/synthesize.ts`, `src/lib/fish/retry.ts`, `src/lib/fish/queue.ts`
- Test: `tests/lib/fish/retry.test.ts`

**Interfaces:**
- Produces: `synthesize({ annotatedText, referenceIds, model? }): Promise<Buffer>`

- [ ] **Step 1:** Implement retry with backoff on 429/5xx; after exhaustion call `FISH_FALLBACK_MODEL`.
- [ ] **Step 2:** Map `referenceIds` in speaker-index order; split long paragraphs at `MAX_ANNOTATED_CHARS`.
- [ ] **Step 3:** Queue with `p-limit(5)`; write MP3 to `DATA_DIR/jobs/{jobId}/ch{a}-p{b}.mp3`; update `segments`.
- [ ] **Step 4:** Log raw request/response on fatal failure; commit.

---

## Phase 4 — Stitch, pipeline, web UI

### Task 12: Stitch chapters

**Files:**
- Create: `src/lib/audio/stitch.ts`
- Test: `tests/lib/audio/stitch.test.ts`

- [ ] **Step 1:** Concatenate segment MP3s in `(chapter_idx, paragraph_idx)` order (ffmpeg or `ffmpeg-static`).
- [ ] **Step 2:** Optional 250 ms silence between paragraphs behind flag set after manual sample listen.
- [ ] **Step 3:** Output `chapter-{idx}.mp3` per job; commit.

### Task 13: Job orchestrator

**Files:**
- Create: `src/lib/pipeline/runJob.ts`
- Create: `src/lib/notify/emailStub.ts`

**Interfaces:**
- Consumes: all prior stages
- Produces: `runJob(jobId): Promise<void>` updating `jobs.status`

Pipeline order:

1. Extract PDF → chapters → persist `chapters` + paragraph `segments`
2. Fingerprint → cache hit skips Prompt A
3. Else research → character map → voice assign → cache
4. Build per-chapter speaker maps
5. Annotate all segments (queue 5)
6. Synthesize (queue 5)
7. Stitch per chapter
8. `emailStub.send(email, localPaths)` + `jobs.status = done`

- [ ] **Step 1:** Implement state machine `queued → processing → stitching → done | failed`.
- [ ] **Step 2:** Run pipeline in API background (`void runJob(id)` after POST); ensure single-flight per job.
- [ ] **Step 3:** Commit.

### Task 14: Web UI + API

**Files:**
- Create: `src/app/page.tsx`, `src/app/jobs/[id]/page.tsx`
- Create: `src/app/api/jobs/route.ts`, `src/app/api/jobs/[id]/route.ts`

- [ ] **Step 1:** POST multipart: PDF, optional voice WAV/MP3, email; validate sample; create `jobs` row; return `{ jobId }`.
- [ ] **Step 2:** GET job: `{ status, progress, chapters: [{ title, downloadUrl }] }` — download via API route streaming local file.
- [ ] **Step 3:** Status page polls every 2s until `done` or `failed`.
- [ ] **Step 4:** Manual E2E checklist (below); commit.

---

## Phase 5 — Hardening and E2E

### Task 15: Sample book path + cost logging

- [ ] **Step 1:** Add `fixtures/sample-book.pdf` (or documented external path) + optional hard-coded character map JSON for dev bypass.
- [ ] **Step 2:** Log DeepSeek token usage and Fish UTF-8 bytes per job (init.md cost note).
- [ ] **Step 3:** Full pipeline run; fix top 3 failures; document in `.docs/e2e-notes.md` if needed.

---

## Prompts and schemas (canonical copy)

Do not paraphrase in code — import from `src/lib/research/prompts/` and `src/lib/annotate/prompts/` using **exact** text in init-2 §3 (Prompt A) and §4 (Prompt B).

Zod schemas must include:

- Character: `name`, `aliases`, `role`, `speaks`, `gender_presentation`, `age_impression`, `tonality`, `confidence`, `source`
- Screenplay: `annotated`, `speakers_used`, `notes`

---

## Test plan (manual + automated)

| Area | Automated | Manual |
|------|-----------|--------|
| Fingerprint cache | Unit | Re-upload same PDF → skips research |
| Voice 15–20s | Unit | Upload 14s → 400 |
| Chapter fallback | Unit | PDF without headings → Section N |
| Verbatim annotation | Unit | — |
| Full pipeline | Integration (optional) | One public-domain PDF end-to-end |
| Drama 3 | Mocked unit | One real paragraph listen test |

---

## Suggested implementation order (timeboxed)

| Block | Hours | Tasks |
|-------|-------|-------|
| Foundation | 0–2 | 0, 1, 2, 3, 4 |
| Intelligence | 2–5 | 5, 6, 7, 8 |
| Audio core | 5–8 | 9, 10, 11, 12 |
| Product | 8–10 | 13, 14 |
| E2E | 10–12 | 15 |

---

## Risk register (from init docs)

| Risk | Mitigation in plan |
|------|---------------------|
| Drama 3 preview instability | Retry, fallback model, segment dead-letter |
| Web research spoilers/wrong tone | Prompt guardrail; `source` field; text fallback |
| PDF messy layout | Text-only MVP; no OCR |
| >16 speakers | Collapse to `supporting` voice |
| LLM paraphrase | Verbatim validator + fallback |
| Commandcode search API drift | Isolated `searchBookInfo.ts` |

---

## Spec coverage checklist

- [x] PDF → chapters (TOC / regex / 3k sections)
- [x] Character map web + text fallback
- [x] SQLite fingerprint cache
- [x] Voice library + greedy assign
- [x] Prompt B paragraph annotation (5 parallel)
- [x] Drama 3 synthesis (5 parallel) + stitch
- [x] Validation rules init-2 §1
- [x] Full web upload + status
- [x] Email stub + local files
- [ ] `reference_id` API shape — verify in Task 11
- [ ] Inter-paragraph silence — decide in Task 12

---

*Plan version: 2026-10-24. Supersedes narrative-only docs for implementation ordering; prompts and SQL remain authoritative in `init-2.md` where duplicated.*
