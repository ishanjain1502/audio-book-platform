# Annotation Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After research, annotate the book and let the user review each finished section as speaker messages before any audio is generated.

**Architecture:** A pure turn parser edits one `<|speaker:N|>` without touching the other bytes. `runAnnotation` writes `segments` per finished section and stops. The annotation page polls those rows. Confirm spawns `runSynthesis`, which speaks the saved rows and does not call the annotation model. `runJob` with no mode stays the current full pipeline.

**Tech Stack:** TypeScript, Next.js App Router, SQLite (`better-sqlite3`), Vitest, the existing annotation queue and Fish synthesis.

## Global Constraints

- Research button label is **Review annotation**. It saves title, author, and page count, sets `annotating`, and opens `/jobs/{id}/annotation`. It does not start audio.
- Section label is `Section {n}` where `n` is `chapters.idx + 1`. When the stored title differs, show that title beside the label.
- A section appears only after every paragraph from `splitIntoParagraphs` has a `segments` row. The in-progress line reads `Annotating section {n}`.
- A chat message is one `<|speaker:N|>` turn. Text before the first tag is speaker index 0. Words and pacing tags stay. Edit changes that turn's speaker index only, and every other byte of the paragraph stays unchanged.
- Checked sections start collapsed. The header opens them again. Unchecking leaves them open. The check is stored on `chapters.reviewed`.
- **Confirm and generate audiobook** enables only when status is `awaiting_annotation` and every section is checked. It opens `/jobs/{id}`.
- `scripts/run-job.ts <id>` with no mode keeps today's full pipeline. `annotate` does not synthesize. `synthesize` requires a saved annotation for every paragraph and does not call the annotation model.
- Annotation does not clone a custom voice and does not change `character_maps`. Synthesis keeps today's voice clone and narrator voice-id swap.
- No free-form model chat, no re-annotation from the page, and no change to the generation page, PDF extraction, or research.
- Unit tests only. No live model call and no live Fish call.

## File structure

- Modify `src/lib/db/schema.sql` and `src/lib/db/client.ts`. Add `chapters.reviewed`.
- Create `src/lib/annotate/turns.ts`. Parse turns and replace one speaker tag.
- Create `src/lib/annotate/sectionReady.ts`. Decide when a section is complete.
- Create `src/lib/jobs/readAnnotation.ts`. The GET payload.
- Create `src/lib/jobs/updateAnnotation.ts`. Reviewed flag and speaker edit.
- Create `src/lib/jobs/startAnnotation.ts`. Research button and retry.
- Modify `src/lib/book/confirmRules.ts` and `src/lib/jobs/confirmJob.ts`. Audio confirm requires `awaiting_annotation`, complete sections, and every chapter reviewed.
- Create `src/lib/pipeline/runAnnotation.ts` and `src/lib/pipeline/runSynthesis.ts`. Leave `runJob` as the no-mode pipeline.
- Modify `scripts/run-job.ts` and `src/lib/jobs/spawnRunner.ts`. Pass `annotate` or `synthesize`.
- Create the annotate route, the annotation GET/PATCH route, and `src/app/jobs/[id]/annotation/page.tsx`.
- Modify `src/app/jobs/[id]/review/page.tsx`. The button starts annotation.

---

### Task 1: Store the section check

**Files:**
- Modify: `src/lib/db/schema.sql`
- Modify: `src/lib/db/client.ts`
- Test: `tests/lib/db/bookColumns.test.ts`

**Interfaces:**
- Consumes: `applyBookColumnMigrations` in `src/lib/db/client.ts`.
- Produces: `applyChapterColumnMigrations(database: Database.Database): void`. After `ensureSchema`, `chapters.reviewed` exists and defaults to `0`.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/lib/db/bookColumns.test.ts`:

```typescript
import { applyBookColumnMigrations, applyChapterColumnMigrations } from "@/lib/db/client";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/db/bookColumns.test.ts`

Expected: FAIL because `applyChapterColumnMigrations` is not exported.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/db/schema.sql`, add `reviewed INTEGER NOT NULL DEFAULT 0` to the `chapters` column list, after `speaker_count`.

In `src/lib/db/client.ts`:

```typescript
export function applyChapterColumnMigrations(database: Database.Database): void {
  const existing = new Set(
    (database.prepare("PRAGMA table_info(chapters)").all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  if (!existing.has("reviewed")) {
    database.exec("ALTER TABLE chapters ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0");
  }
}
```

Call `applyChapterColumnMigrations(database)` at the end of `ensureSchema`, after `applyBookColumnMigrations`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/db/bookColumns.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.sql src/lib/db/client.ts tests/lib/db/bookColumns.test.ts
git commit -m "feat: store a reviewed flag on each chapter"
```

---

### Task 2: Parse turns and replace one speaker

**Files:**
- Create: `src/lib/annotate/turns.ts`
- Test: `tests/lib/annotate/turns.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type AnnotationTurn = { speakerIndex: number; text: string }`
  - `export function parseAnnotationTurns(annotated: string): AnnotationTurn[]`
  - `export function replaceSpeakerTurn(annotated: string, turnIdx: number, speakerIndex: number): string`
  - `export class AnnotationTurnError extends Error`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/annotate/turns.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  AnnotationTurnError,
  parseAnnotationTurns,
  replaceSpeakerTurn,
} from "@/lib/annotate/turns";

describe("parseAnnotationTurns", () => {
  it("splits speaker tags and keeps pacing text on the turn", () => {
    expect(
      parseAnnotationTurns("<|speaker:0|>Hello [pause]<|speaker:1|>there"),
    ).toEqual([
      { speakerIndex: 0, text: "Hello [pause]" },
      { speakerIndex: 1, text: "there" },
    ]);
  });

  it("treats text before the first tag as speaker 0", () => {
    expect(parseAnnotationTurns("Hello <|speaker:1|>there")).toEqual([
      { speakerIndex: 0, text: "Hello " },
      { speakerIndex: 1, text: "there" },
    ]);
  });
});

describe("replaceSpeakerTurn", () => {
  it("changes turn 1 and leaves every other byte", () => {
    const annotated = "<|speaker:0|>Hello [pause]<|speaker:1|>there";
    expect(replaceSpeakerTurn(annotated, 1, 2)).toBe(
      "<|speaker:0|>Hello [pause]<|speaker:2|>there",
    );
  });

  it("rejects a missing turn and a tagless leading turn", () => {
    expect(() => replaceSpeakerTurn("<|speaker:0|>Hi", 3, 1)).toThrow(AnnotationTurnError);
    expect(() => replaceSpeakerTurn("Hello <|speaker:1|>there", 0, 2)).toThrow(
      AnnotationTurnError,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/annotate/turns.test.ts`

Expected: FAIL because `@/lib/annotate/turns` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/annotate/turns.ts`:

```typescript
export type AnnotationTurn = { speakerIndex: number; text: string };

export class AnnotationTurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnotationTurnError";
  }
}

const TAG = /<\|speaker:(\d+)\|>/g;

export function parseAnnotationTurns(annotated: string): AnnotationTurn[] {
  const turns: AnnotationTurn[] = [];
  const re = new RegExp(TAG.source, "g");
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(annotated))) {
    const between = annotated.slice(cursor, match.index);
    if (turns.length === 0) {
      if (between.length > 0) turns.push({ speakerIndex: 0, text: between });
    } else {
      turns[turns.length - 1].text += between;
    }
    turns.push({ speakerIndex: Number(match[1]), text: "" });
    cursor = match.index + match[0].length;
  }
  const rest = annotated.slice(cursor);
  if (turns.length === 0) {
    if (rest.length > 0) turns.push({ speakerIndex: 0, text: rest });
  } else {
    turns[turns.length - 1].text += rest;
  }
  return turns;
}

export function replaceSpeakerTurn(
  annotated: string,
  turnIdx: number,
  speakerIndex: number,
): string {
  const turns = parseAnnotationTurns(annotated);
  if (turnIdx < 0 || turnIdx >= turns.length) {
    throw new AnnotationTurnError("Turn not found");
  }
  const leading = annotated.length > 0 && !annotated.startsWith("<|speaker:");
  const tagOrdinal = leading ? turnIdx - 1 : turnIdx;
  if (tagOrdinal < 0) throw new AnnotationTurnError("Turn has no speaker tag");
  let seen = 0;
  return annotated.replace(/<\|speaker:\d+\|>/g, (tag) => {
    if (seen++ !== tagOrdinal) return tag;
    return `<|speaker:${speakerIndex}|>`;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/annotate/turns.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/annotate/turns.ts tests/lib/annotate/turns.test.ts
git commit -m "feat: replace one speaker tag in an annotated paragraph"
```

---

### Task 3: Decide when a section is complete

**Files:**
- Create: `src/lib/annotate/sectionReady.ts`
- Test: `tests/lib/annotate/sectionReady.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export function sectionIsComplete(paragraphCount: number, segmentCount: number): boolean`
  - `export function firstIncompleteSection(sections: { idx: number; paragraphCount: number; segmentCount: number }[]): number | null`

`firstIncompleteSection` returns `idx + 1` for the first incomplete section, or `null` when every section is complete.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/annotate/sectionReady.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { firstIncompleteSection, sectionIsComplete } from "@/lib/annotate/sectionReady";

describe("sectionIsComplete", () => {
  it("is complete only when the segment count equals the paragraph count", () => {
    expect(sectionIsComplete(2, 2)).toBe(true);
    expect(sectionIsComplete(2, 1)).toBe(false);
    expect(sectionIsComplete(0, 0)).toBe(false);
  });
});

describe("firstIncompleteSection", () => {
  it("returns the 1-based index of the first incomplete section", () => {
    expect(
      firstIncompleteSection([
        { idx: 0, paragraphCount: 1, segmentCount: 1 },
        { idx: 1, paragraphCount: 2, segmentCount: 1 },
      ]),
    ).toBe(2);
  });

  it("returns null when every section is complete", () => {
    expect(
      firstIncompleteSection([{ idx: 0, paragraphCount: 1, segmentCount: 1 }]),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/annotate/sectionReady.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/annotate/sectionReady.ts`:

```typescript
export function sectionIsComplete(paragraphCount: number, segmentCount: number): boolean {
  return paragraphCount > 0 && segmentCount === paragraphCount;
}

export function firstIncompleteSection(
  sections: { idx: number; paragraphCount: number; segmentCount: number }[],
): number | null {
  const found = sections.find(
    (section) => !sectionIsComplete(section.paragraphCount, section.segmentCount),
  );
  return found ? found.idx + 1 : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/annotate/sectionReady.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/annotate/sectionReady.ts tests/lib/annotate/sectionReady.test.ts
git commit -m "feat: detect the first section that is still annotating"
```

---

### Task 4: Read the annotation page payload

**Files:**
- Create: `src/lib/jobs/readAnnotation.ts`
- Test: `tests/lib/jobs/readAnnotation.test.ts`

**Interfaces:**
- Consumes: `parseAnnotationTurns`, `sectionIsComplete`, `firstIncompleteSection`, `getDb`, `splitIntoParagraphs`.
- Produces: `export type AnnotationView` and `export function readAnnotation(jobId: number): AnnotationView | null`.

`AnnotationView` is:

```typescript
export type AnnotationMessage = {
  paragraphIdx: number;
  turnIdx: number;
  speakerIndex: number;
  speakerName: string;
  text: string;
};

export type AnnotationSection = {
  n: number;
  title: string;
  reviewed: boolean;
  messages: AnnotationMessage[];
};

export type AnnotationView = {
  status: string;
  error: string | null;
  currentSection: number | null;
  characters: { name: string; speakerIndex: number }[];
  sections: AnnotationSection[];
  book: { title: string; author: string | null; pageCount: number | null };
};
```

`currentSection` is the 1-based incomplete index when `jobs.status` is `annotating`. Otherwise it is `null`. `sections` contains only complete chapters, ordered by `idx`. A speaker index missing from `character_maps` uses the name `Speaker {n}`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/jobs/readAnnotation.test.ts`. Copy the `tmpDir` / `DATA_DIR` / `closeDb` setup from `tests/lib/jobs/confirmJob.test.ts`. Seed one book, one job in `annotating`, one chapter whose text is `One.\n\nTwo.`, `reviewed = 0`, and one segment for paragraph 0 only:

```typescript
annotated_text: "<|speaker:0|>One [pause]<|speaker:1|>line"
```

Insert a `character_maps` row: name `Nick`, `speaker_index` 0, `voice_id` `v`, and the other required columns as empty strings or `0` except `book_id`, `name`, `speaks`, `tonality_json` `'[]'`, `confidence` 1, `source` `'test'`, `mode` `'text_sample'`.

Expect `readAnnotation(jobId)` to match:

```typescript
expect(view?.currentSection).toBe(1);
expect(view?.sections).toEqual([]);
expect(view?.characters).toEqual([{ name: "Nick", speakerIndex: 0 }]);
```

Insert the second paragraph's segment with text `<|speaker:1|>Two`, set the job status to `awaiting_annotation`, and set `chapters.reviewed = 1`. Expect:

```typescript
expect(view?.currentSection).toBeNull();
expect(view?.sections).toEqual([
  {
    n: 1,
    title: "Chapter I",
    reviewed: true,
    messages: [
      { paragraphIdx: 0, turnIdx: 0, speakerIndex: 0, speakerName: "Nick", text: "One [pause]" },
      { paragraphIdx: 0, turnIdx: 1, speakerIndex: 1, speakerName: "Speaker 1", text: "line" },
      { paragraphIdx: 1, turnIdx: 0, speakerIndex: 1, speakerName: "Speaker 1", text: "Two" },
    ],
  },
]);
```

Use chapter title `Chapter I` so the test proves the stored title is returned beside section number 1.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/jobs/readAnnotation.test.ts`

Expected: FAIL because `readAnnotation` is not defined.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/jobs/readAnnotation.ts`. Load the job's `status`, `error`, and `book_id`. Return `null` when the job or book is missing. Load chapters with `idx`, `title`, `text`, and `reviewed`. For each chapter, `paragraphCount` is `splitIntoParagraphs(text).length` and `segmentCount` is `SELECT COUNT(*) FROM segments WHERE job_id = ? AND chapter_idx = ?`. Build the `firstIncompleteSection` input from those counts.

Load `character_maps` for the book ordered by `speaker_index`, mapped to `{ name, speakerIndex: speaker_index }`.

For each complete chapter, load `annotated_text` ordered by `paragraph_idx`. `parseAnnotationTurns` each paragraph. `turnIdx` starts at 0 inside that paragraph. `speakerName` is the character with that `speakerIndex`, or `` `Speaker ${speakerIndex}` ``.

`currentSection` is the incomplete index only when `status === "annotating"`. `book` is the book's `title`, `author`, and `page_count`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/jobs/readAnnotation.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/readAnnotation.ts tests/lib/jobs/readAnnotation.test.ts
git commit -m "feat: read finished annotation sections for review"
```

---

### Task 5: Save a review check and a speaker edit

**Files:**
- Create: `src/lib/jobs/updateAnnotation.ts`
- Test: `tests/lib/jobs/updateAnnotation.test.ts`

**Interfaces:**
- Consumes: `replaceSpeakerTurn`, `sectionIsComplete`, `splitIntoParagraphs`, `getDb`.
- Produces:
  - `export function setSectionReviewed(jobId: number, chapterIdx: number, reviewed: boolean): { ok: true; reviewed: boolean } | { ok: false; status: number; error: string }`
  - `export function setTurnSpeaker(jobId: number, input: { chapterIdx: number; paragraphIdx: number; turnIdx: number; speakerIndex: number }): { ok: true; speakerIndex: number; speakerName: string } | { ok: false; status: number; error: string }`

Both reject unless `jobs.status` is `annotating` or `awaiting_annotation` (`409`, error `Annotation is not open for review`). A missing job is `404` / `Job not found`. `setTurnSpeaker` also rejects a speaker index that is not in `character_maps` (`400`, `Unknown speaker`), an incomplete chapter (`409`, `Section is not ready`), and `AnnotationTurnError` (`400`, the error message). On success it updates that segment's `annotated_text` and returns the name from the map.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/jobs/updateAnnotation.test.ts` with the same temp-db setup as Task 4. Seed status `awaiting_annotation`, chapter text `One.`, one segment `<|speaker:0|>One [pause]`, and character rows for speaker 0 `Nick` and speaker 1 `Daisy`.

Assert:

```typescript
const { setTurnSpeaker, setSectionReviewed } = await import("@/lib/jobs/updateAnnotation");
expect(setTurnSpeaker(jobId, { chapterIdx: 0, paragraphIdx: 0, turnIdx: 0, speakerIndex: 1 }))
  .toEqual({ ok: true, speakerIndex: 1, speakerName: "Daisy" });
```

Read `annotated_text` back and expect `<|speaker:1|>One [pause]`.

Expect `setTurnSpeaker` with `speakerIndex: 9` to equal `{ ok: false, status: 400, error: "Unknown speaker" }` and the saved text to stay `<|speaker:1|>One [pause]`.

Expect `setSectionReviewed(jobId, 0, true)` to equal `{ ok: true, reviewed: true }` and `chapters.reviewed` to be `1`.

Set the job status to `queued` and expect `setSectionReviewed` to match `{ ok: false, status: 409 }`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/jobs/updateAnnotation.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/jobs/updateAnnotation.ts` with the two functions and the rejection rules in the Interfaces block. Count paragraphs with `splitIntoParagraphs`. Count segments with `SELECT COUNT(*)`. For a speaker edit, load the one segment by `job_id`, `chapter_idx`, and `paragraph_idx`. Missing segment is `404` / `Segment not found`. Call `replaceSpeakerTurn` and `UPDATE segments SET annotated_text = ?`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/jobs/updateAnnotation.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/updateAnnotation.ts tests/lib/jobs/updateAnnotation.test.ts
git commit -m "feat: save annotation review checks and speaker edits"
```

---

### Task 6: Start annotation and gate audio confirm

**Files:**
- Create: `src/lib/jobs/startAnnotation.ts`
- Modify: `src/lib/book/confirmRules.ts`
- Modify: `src/lib/jobs/confirmJob.ts`
- Modify: `src/lib/jobs/spawnRunner.ts`
- Test: `tests/lib/book/confirmRules.test.ts`
- Test: `tests/lib/jobs/confirmJob.test.ts`
- Test: `tests/lib/jobs/startAnnotation.test.ts`

**Interfaces:**
- Consumes: `canConfirm`, `updateBookMeta`, `sectionIsComplete`, `splitIntoParagraphs`, `spawnJobRunner`.
- Produces:
  - `export function canGenerateAudiobook(input: { jobStatus: string; title: string; author: string | null; pageCount: number; sectionsComplete: boolean; allReviewed: boolean }): { ok: true; title: string; author: string | null; pageCount: number } | { ok: false; reason: string }`
  - `export function startAnnotation(jobId: number, input: { title: string; author: string | null; pageCount: number }, spawn?: (jobId: number, mode: "annotate") => void): { ok: true } | { ok: false; status: number; error: string }`
  - `spawnJobRunner(jobId: number, mode?: "annotate" | "synthesize"): void`

`canGenerateAudiobook` uses the same title and page-count failures as `canConfirm`. Then it returns `{ ok: false, reason: "Annotation is not ready" }` unless `jobStatus` is `awaiting_annotation` and `sectionsComplete` is true. Then `{ ok: false, reason: "Every section must be checked" }` unless `allReviewed` is true.

`confirmJob` computes `sectionsComplete` and `allReviewed` from chapters and segments, calls `canGenerateAudiobook`, writes meta, sets `queued`, updates `status.json`, and calls `spawn(jobId, "synthesize")`. A thrown spawn sets `failed` the way it does today.

`startAnnotation` from `awaiting_review` uses `canConfirm`. On success it writes meta, sets the job and `status.json` to `annotating`, and calls `spawn(jobId, "annotate")`. A call while `annotating` or `awaiting_annotation` returns `409` / `Annotation already started`. From `failed`, with research ready, it deletes `segments` only for chapters that are not complete, keeps `reviewed`, sets `annotating`, and spawns `annotate`. Any other status is `409` / `Annotation cannot start`. A thrown spawn sets `failed`.

`spawnJobRunner` appends the mode argument only when it is passed. No mode keeps `npx tsx scripts/run-job.ts <id>`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/book/confirmRules.test.ts`:

```typescript
import { canGenerateAudiobook } from "@/lib/book/confirmRules";

it("accepts audio confirm only when annotation is finished and every section is checked", () => {
  const base = {
    jobStatus: "awaiting_annotation",
    title: "  Dune  ",
    author: "   ",
    pageCount: 12,
    sectionsComplete: true,
    allReviewed: true,
  };
  expect(canGenerateAudiobook(base)).toEqual({
    ok: true,
    title: "Dune",
    author: null,
    pageCount: 12,
  });
  expect(canGenerateAudiobook({ ...base, jobStatus: "awaiting_review" })).toMatchObject({
    ok: false,
    reason: "Annotation is not ready",
  });
  expect(canGenerateAudiobook({ ...base, sectionsComplete: false })).toMatchObject({
    ok: false,
    reason: "Annotation is not ready",
  });
  expect(canGenerateAudiobook({ ...base, allReviewed: false })).toMatchObject({
    ok: false,
    reason: "Every section must be checked",
  });
});
```

Replace the body of `queues a researched review job and spawns once` in `tests/lib/jobs/confirmJob.test.ts`. Seed status `awaiting_annotation`, one chapter `Hello.` with `reviewed = 1`, and one segment for paragraph 0. Pass `(id, mode) => spawned.push(\`${id}:${mode}\`)`. Expect `spawned` to equal `` [`${jobId}:synthesize`] `` and the second confirm to be `409`.

Change `rejects confirm before research is saved` so an `awaiting_review` job returns `409` and `error` `Annotation is not ready`.

Create `tests/lib/jobs/startAnnotation.test.ts`:

```typescript
it("starts annotation from review and does not spawn synthesis", async () => {
  const jobId = await seed("awaiting_review", true);
  const spawned: string[] = [];
  const { startAnnotation } = await import("@/lib/jobs/startAnnotation");
  const result = startAnnotation(
    jobId,
    { title: "Original", author: "Ada", pageCount: 10 },
    (id, mode) => spawned.push(`${id}:${mode}`),
  );
  expect(result).toEqual({ ok: true });
  expect(spawned).toEqual([`${jobId}:annotate`]);
});

it("retries a failed job by deleting only incomplete segments", async () => {
  const jobId = await seed("failed", true);
  // chapter 0 text "One." with one segment, reviewed 1
  // chapter 1 text "Two.\n\nThree." with one segment
  const spawned: string[] = [];
  const { startAnnotation } = await import("@/lib/jobs/startAnnotation");
  expect(
    startAnnotation(jobId, { title: "Original", author: "Ada", pageCount: 10 }, (id, mode) =>
      spawned.push(`${id}:${mode}`),
    ),
  ).toEqual({ ok: true });
  expect(spawned).toEqual([`${jobId}:annotate`]);
  // chapter 0 still has its segment and reviewed = 1
  // chapter 1 has no segments
});
```

Use the same temp-db helper shape as `confirmJob.test.ts`. Give the retry test two chapters inside `seed` by inserting them after the helper returns, or add them in the test before calling `startAnnotation`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/book/confirmRules.test.ts tests/lib/jobs/confirmJob.test.ts tests/lib/jobs/startAnnotation.test.ts`

Expected: FAIL because `canGenerateAudiobook` and `startAnnotation` are missing, and `confirmJob` still accepts `awaiting_review`.

- [ ] **Step 3: Write the minimal implementation**

Add `canGenerateAudiobook` to `src/lib/book/confirmRules.ts` using `normalizeAuthor` and the same title and page-count checks as `canConfirm`. Leave `canConfirm` unchanged.

Change `confirmJob` to query chapters (`idx`, `text`, `reviewed`) and segment counts, set `sectionsComplete` when every chapter passes `sectionIsComplete`, and set `allReviewed` when every chapter has `reviewed === 1` and there is at least one chapter. Pass those into `canGenerateAudiobook`. Map `Annotation is not ready` and `Every section must be checked` to status `409`. Call `spawn(jobId, "synthesize")`.

Change the `spawn` parameter type to `(jobId: number, mode: "synthesize") => void`. The default remains `spawnJobRunner`.

Create `src/lib/jobs/startAnnotation.ts` with the rules in the Interfaces block. Default `spawn` is `spawnJobRunner`. On the failure retry, `DELETE FROM segments WHERE job_id = ? AND chapter_idx = ?` only for incomplete chapters.

In `src/lib/jobs/spawnRunner.ts`, add the optional mode and push it onto the `npx tsx` argument list only when present.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/book/confirmRules.test.ts tests/lib/jobs/confirmJob.test.ts tests/lib/jobs/startAnnotation.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/book/confirmRules.ts src/lib/jobs/confirmJob.ts src/lib/jobs/startAnnotation.ts src/lib/jobs/spawnRunner.ts tests/lib/book/confirmRules.test.ts tests/lib/jobs/confirmJob.test.ts tests/lib/jobs/startAnnotation.test.ts
git commit -m "feat: start annotation before audio confirm"
```

---

### Task 7: Run annotation and synthesis as separate workers

**Files:**
- Create: `src/lib/pipeline/runAnnotation.ts`
- Create: `src/lib/pipeline/runSynthesis.ts`
- Modify: `scripts/run-job.ts`
- Test: `tests/lib/pipeline/runAnnotation.test.ts`

**Interfaces:**
- Consumes: `annotateParagraphsParallel`, `synthesizeJobsParallel`, `splitIntoParagraphs`, `sectionIsComplete`, `loadCharacterMaps`, `speakerMapForChapter`, `referenceIdsInOrder`, `cloneVoiceFromFile`, `stitchMp3Files`, `sendEmailStub`, `JobProgressPatch` from `runJob.ts`.
- Produces:
  - `export async function runAnnotation(jobId: number, onProgress?: (patch: JobProgressPatch) => void): Promise<void>`
  - `export async function runSynthesis(jobId: number, onProgress?: (patch: JobProgressPatch) => void): Promise<void>`

`runAnnotation` loads the saved character map and fails the job with `Character map is missing` when it is absent. It does not clone a voice and does not synthesize. For each chapter, a complete segment set is left untouched, including `reviewed`. An incomplete chapter has its `segments` deleted, then each paragraph is annotated and inserted with status `annotated` before the next chapter starts. Progress detail is `Annotating section {idx + 1}`. When every chapter is complete, set the job status to `awaiting_annotation` and report that status. A thrown error sets `failed` and rethrows.

`runSynthesis` copies the voice-clone and narrator voice-id swap from `runJob`, then reads each chapter's saved `annotated_text` ordered by `paragraph_idx`. If that count is not the paragraph count, throw `Section {idx + 1} is not annotated` before any Fish call for that chapter. The rest of the stitch, email stub, and `done` status matches the end of `runJob`. Do not call `annotateParagraphsParallel`.

Do not change the body of `runJob`.

`scripts/run-job.ts` reads `process.argv[3] ?? "full"`. `full` keeps the current `runJob` call and the final status write of `done`. `annotate` calls `runAnnotation` and does not write `done` afterward. `synthesize` calls `runSynthesis` and keeps the final `done` write. Any other mode prints `Usage: npx tsx scripts/run-job.ts <jobId> [full|annotate|synthesize]` and exits `1`. The usage string at the top of the file matches that.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/pipeline/runAnnotation.test.ts` with the temp-db setup. Seed a researched book, a character map with one narrator at `speaker_index` 0, and a job in `annotating` with two chapters. Chapter 0 text is `Done.` and already has one segment `<|speaker:0|>Done` and `reviewed = 1`. Chapter 1 text is `Next.`.

Mock the annotator by passing it in. Change `runAnnotation` to accept an optional third argument:

```typescript
annotate?: typeof annotateParagraphsParallel
```

Default it to `annotateParagraphsParallel`. The test passes an async fake that returns `[{ annotated: "<|speaker:0|>Next", speakersUsed: [0] }]`.

Expect the fake to have been called once, chapter 0's original segment text to still be `<|speaker:0|>Done`, chapter 0 `reviewed` to still be `1`, chapter 1 to have the fake text, and `jobs.status` to be `awaiting_annotation`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/pipeline/runAnnotation.test.ts`

Expected: FAIL because `runAnnotation` is not defined.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/pipeline/runAnnotation.ts` and `src/lib/pipeline/runSynthesis.ts` as specified. Update `scripts/run-job.ts` to branch on the mode. In the `annotate` branch, skip the block that writes `status: "processing"` and skip the block that writes `status: "done"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/pipeline/runAnnotation.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/runAnnotation.ts src/lib/pipeline/runSynthesis.ts scripts/run-job.ts tests/lib/pipeline/runAnnotation.test.ts
git commit -m "feat: annotate a book without starting audio"
```

---

### Task 8: Expose the annotation routes

**Files:**
- Create: `src/app/api/jobs/[id]/annotate/route.ts`
- Create: `src/app/api/jobs/[id]/annotation/route.ts`
- Modify: `src/app/api/jobs/[id]/confirm/route.ts`

**Interfaces:**
- Consumes: `startAnnotation`, `readAnnotation`, `setSectionReviewed`, `setTurnSpeaker`, `confirmJob`.
- Produces: `POST /api/jobs/{id}/annotate`, `GET` and `PATCH /api/jobs/{id}/annotation`. Confirm stays `POST /api/jobs/{id}/confirm` and still calls `confirmJob`.

`POST /annotate` parses `{ title, author, pageCount }` the same way as `src/app/api/jobs/[id]/confirm/route.ts` and returns `startAnnotation`'s status and error.

`GET /annotation` returns `readAnnotation` as JSON, or `404` / `{ error: "Not found" }`.

`PATCH /annotation` accepts either `{ chapterIdx, reviewed }` or `{ chapterIdx, paragraphIdx, turnIdx, speakerIndex }`. A body with both shapes uses the speaker edit. A body with neither returns `400` / `{ error: "Nothing to update" }`. Return the function result.

- [ ] **Step 1: Add the routes**

Create `src/app/api/jobs/[id]/annotate/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { startAnnotation } from "@/lib/jobs/startAnnotation";

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
  const result = startAnnotation(jobId, {
    title: body.title ?? "",
    author: body.author ?? null,
    pageCount: body.pageCount ?? 0,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
```

Create `src/app/api/jobs/[id]/annotation/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { readAnnotation } from "@/lib/jobs/readAnnotation";
import { setSectionReviewed, setTurnSpeaker } from "@/lib/jobs/updateAnnotation";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const jobId = Number((await context.params).id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const view = readAnnotation(jobId);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const jobId = Number((await context.params).id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const body = (await request.json()) as {
    chapterIdx?: number;
    reviewed?: boolean;
    paragraphIdx?: number;
    turnIdx?: number;
    speakerIndex?: number;
  };
  if (
    body.paragraphIdx != null &&
    body.turnIdx != null &&
    body.speakerIndex != null &&
    body.chapterIdx != null
  ) {
    const result = setTurnSpeaker(jobId, {
      chapterIdx: body.chapterIdx,
      paragraphIdx: body.paragraphIdx,
      turnIdx: body.turnIdx,
      speakerIndex: body.speakerIndex,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ speakerIndex: result.speakerIndex, speakerName: result.speakerName });
  }
  if (body.chapterIdx != null && typeof body.reviewed === "boolean") {
    const result = setSectionReviewed(jobId, body.chapterIdx, body.reviewed);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ reviewed: result.reviewed });
  }
  return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
}
```

Leave `src/app/api/jobs/[id]/confirm/route.ts` calling `confirmJob`.

- [ ] **Step 2: Run the job tests**

Run: `npx vitest run tests/lib/jobs/startAnnotation.test.ts tests/lib/jobs/confirmJob.test.ts tests/lib/jobs/readAnnotation.test.ts tests/lib/jobs/updateAnnotation.test.ts`

Expected: PASS. These routes are thin wrappers over the functions those tests already cover.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/jobs/[id]/annotate/route.ts src/app/api/jobs/[id]/annotation/route.ts
git commit -m "feat: add annotation review endpoints"
```

---

### Task 9: Send research to the annotation page

**Files:**
- Modify: `src/app/jobs/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `POST /api/jobs/{id}/annotate`.
- Produces: the research button labeled `Review annotation`, which navigates to `/jobs/{id}/annotation`.

- [ ] **Step 1: Change the submit handler**

In `confirm()`, post to `/api/jobs/${id}/annotate` with the same JSON body. On success, `router.push(\`/jobs/${id}/annotation\`)`. Change the failure fallback string to `Could not start annotation`. Change the button text from `Generate audiobook` / `Starting…` to `Review annotation` / `Starting…`. Leave the disabled rule as it is: `awaiting_review`, research ready, non-empty title, and a positive integer page count.

- [ ] **Step 2: Check the typecheck**

Run: `npx tsc --noEmit`

Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/app/jobs/[id]/review/page.tsx
git commit -m "feat: open annotation review from the research page"
```

---

### Task 10: Build the annotation review page

**Files:**
- Create: `src/app/jobs/[id]/annotation/page.tsx`

**Interfaces:**
- Consumes: `GET` and `PATCH /api/jobs/{id}/annotation`, `POST /api/jobs/{id}/confirm`, and `AnnotationView` from Task 4.
- Produces: the page at `/jobs/{id}/annotation`.

- [ ] **Step 1: Create the page**

Create a client page that follows `src/app/jobs/[id]/review/page.tsx` for `params`, loading, and errors. Use `GlassCard` and `Button`.

Load `GET /api/jobs/${id}/annotation` on mount. While `status` is `annotating`, poll that GET every 2 seconds.

Keep local state `opened: Record<number, boolean>`. A section is collapsed when `section.reviewed` is true and `opened[section.n]` is not true.

Render finished `sections` in order. The header text is `Section {n}`. When `section.title` is not exactly `Section {n}`, append ` · {section.title}`. The checkbox is `checked={section.reviewed}`. Checking it PATCHes `{ chapterIdx: section.n - 1, reviewed: true }` and sets `opened[n]` to false. Unchecking PATCHes `reviewed: false` and sets `opened[n]` to true. Clicking the header title toggles `opened[n]` and does not PATCH.

An open section lists `messages`. Each row shows `speakerName` and `text`. The speaker control is a `<select>` of `characters`. On change, PATCH `{ chapterIdx: section.n - 1, paragraphIdx, turnIdx, speakerIndex: Number(value) }`. On a successful `{ speakerIndex, speakerName }`, replace that message in local state. On failure, show `error`.

Above the sections, when `currentSection` is a number, show `Annotating section {currentSection}`.

When `status` is `failed`, show `error` and a button `Retry annotation` that POSTs `/api/jobs/${id}/annotate` with `book.title`, `book.author`, and `book.pageCount`.

The confirm button label is `Confirm and generate audiobook`. It is disabled unless `status` is `awaiting_annotation` and every section has `reviewed`. It POSTs `/api/jobs/${id}/confirm` with the book meta and then `router.push(\`/jobs/${id}\`)`.

- [ ] **Step 2: Check the typecheck**

Run: `npx tsc --noEmit`

Expected: exit 0

- [ ] **Step 3: Run the annotation unit tests**

Run: `npx vitest run tests/lib/annotate tests/lib/jobs/readAnnotation.test.ts tests/lib/jobs/updateAnnotation.test.ts tests/lib/jobs/startAnnotation.test.ts tests/lib/jobs/confirmJob.test.ts tests/lib/pipeline/runAnnotation.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/jobs/[id]/annotation/page.tsx
git commit -m "feat: review annotation section by section before audio"
```
