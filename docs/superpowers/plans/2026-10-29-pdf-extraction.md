# Safer PDF story extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep narrative text the extractor currently drops for position or repetition, and drop front matter, introductions, prefaces, and forewords while keeping prologues and epilogues.

**Architecture:** `pdf-parse` 1.1.4 still walks pages. The page renderer records positioned lines and a per-page status. Artifact removal and the story policy run on those lines. `extractPdfText` still returns text, metadata, and word count, plus diagnostics. `splitChapters` uses the same heading tests and stores `idx`, `title`, and `text`.

**Tech Stack:** TypeScript, `pdf-parse` 1.1.4, Vitest. No new PDF library, OCR, LLM, database column, or queue.

## Global Constraints

- Parser stays `pdf-parse` 1.1.4. Coordinates stay `transform[4]`, `transform[5]`, and page height `view[3] - view[1]`. A larger `y` is higher on the page.
- Margin band stays `y >= pageHeight * 0.92` or `y <= pageHeight * 0.08`.
- A margin line is dropped only as `margin-page-number` (regex `/^(?:[-–—]\s*)?\d{1,4}(?:\s*[-–—])?$/`, checked first) or as `repeated-header` when that trimmed line sits in the margin on at least 3 pages, counted once per page. Only those margin copies drop. Match is exact and case-sensitive.
- A narrative margin line stays. A repeated body sentence stays. A body page-number line stays. A margin line repeated on only 2 pages stays.
- Single-word headings match the whole trimmed line: keyword alone, a trailing period, a continuation starting with `to`, or a subtitle after `:`, `.`, `—`, `–`, or `-`. `Preface to the Second Edition` matches. `Prologue was his favorite word` does not.
- `Prologue` and `Chapter` start the story and become their own chapters. `Epilogue` is kept as its own chapter and does not start the story. `Introduction`, `Preface`, and `Foreword` sections are removed, including subtitle forms.
- Lines before the first Prologue or Chapter are `front-matter`. With no such heading, other lines stay and those three sections are still removed.
- `Chapter` plus digits or Roman numerals (`IVXLC`) keeps today's any-suffix rule. `Chapter` plus an English number from one through ninety-nine, including hyphenated `Twenty-One`, must end the line or use a punctuation subtitle. `Chapter one morning` is body text.
- Joined story text uses one newline inside a page and a blank line between pages that still have kept lines. A page with no kept lines adds no extra gap.
- 500-word gate and both 422 messages stay. Empty final text: "No text layer found. Scanned PDFs are not supported yet." Under 500 words: "PDF too short to generate an audiobook."
- `largeReduction` is true when `wordsIn > 0` and `wordsOut * 2 < wordsIn`. It does not change the HTTP result.
- Log diagnostics once with `console.info`. Counts only. No line text.
- Do not change `src/app/api/jobs/route.ts`, `src/lib/pipeline/prepareUpload.ts`, the database schema, annotation, or synthesis.
- `POST /api/jobs` and `prepareJobFromUpload` keep calling `extractPdfText` then `splitChapters`. The worker still skips extraction when the job is already prepared.

## File structure

- Modify `src/lib/pdf/chapters.ts`. Heading tests shared by the filter and `splitChapters`.
- Modify `src/lib/pdf/pageText.ts`. Positioned lines and a page collector. No deletion in this file after the last task.
- Modify `src/lib/pdf/storyText.ts`. Artifact removal, story policy, and the join. Remove `stripNonStoryText` in the last task.
- Modify `src/lib/pdf/extract.ts`. Run the collector and the filter. Add diagnostics. Keep the existing errors.
- Modify `scripts/compare-gatsby-extract.ts`. `previous.txt` is raw `pdf-parse`. `margins.txt` is after artifact removal. `next.txt` is the final story text.
- Modify `tests/lib/pdf/chapters.test.ts` and `tests/lib/pdf/storyText.test.ts`. Create `tests/lib/pdf/extract.test.ts`.

---

### Task 1: Share the heading tests

**Files:**
- Modify: `src/lib/pdf/chapters.ts`
- Test: `tests/lib/pdf/chapters.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `storyHeadingKind(line: string): "prologue" | "chapter" | "epilogue" | null`
  - `excludedHeadingKind(line: string): "introduction" | "preface" | "foreword" | null`
  - `isChapterHeading(line: string): boolean` — true when `storyHeadingKind` is non-null
  - `splitChapters` stays `{ title: string; rawText: string }[]` and now splits on prologue and epilogue too because it calls `isChapterHeading`

`stripNonStoryText` still calls `isChapterHeading`. After this task a Prologue or `Chapter One` line also starts that old cut. Leave `stripNonStoryText` in place until Task 6.

- [ ] **Step 1: Write the failing test**

Add these tests to `tests/lib/pdf/chapters.test.ts`. Keep the two existing tests.

```typescript
import { isChapterHeading, splitChapters, storyHeadingKind, excludedHeadingKind } from "@/lib/pdf/chapters";

it("classifies story and excluded headings", () => {
  expect(storyHeadingKind("Prologue")).toBe("prologue");
  expect(storyHeadingKind("Prologue: The storm")).toBe("prologue");
  expect(storyHeadingKind("Epilogue to the Reader")).toBe("epilogue");
  expect(storyHeadingKind("Chapter 1: Dawn")).toBe("chapter");
  expect(storyHeadingKind("Chapter IV")).toBe("chapter");
  expect(storyHeadingKind("Chapter One")).toBe("chapter");
  expect(storyHeadingKind("Chapter Twenty-One: A Title")).toBe("chapter");
  expect(storyHeadingKind("Chapter one morning")).toBeNull();
  expect(storyHeadingKind("Prologue was his favorite word")).toBeNull();
  expect(excludedHeadingKind("Introduction")).toBe("introduction");
  expect(excludedHeadingKind("Preface to the Second Edition")).toBe("preface");
  expect(excludedHeadingKind("Foreword: A note")).toBe("foreword");
  expect(excludedHeadingKind("Chapter 1")).toBeNull();
  expect(isChapterHeading("Prologue")).toBe(true);
  expect(isChapterHeading("Epilogue.")).toBe(true);
  expect(isChapterHeading("Preface")).toBe(false);
});

it("splits a prologue and an epilogue into their own chapters", () => {
  const chapters = splitChapters(
    ["Prologue", "Once.", "Chapter 1", "Body.", "Epilogue", "After."].join("\n"),
  );
  expect(chapters.map((chapter) => chapter.title)).toEqual(["Prologue", "Chapter 1", "Epilogue"]);
  expect(chapters[0].rawText).toBe("Once.");
  expect(chapters[1].rawText).toBe("Body.");
  expect(chapters[2].rawText).toBe("After.");
});

it("keeps Chapter one morning inside the chapter body", () => {
  const chapters = splitChapters(
    ["Chapter 1", "Chapter one morning", "Chapter Two", "Next."].join("\n"),
  );
  expect(chapters).toHaveLength(2);
  expect(chapters[0].rawText).toContain("Chapter one morning");
  expect(chapters[1].title).toBe("Chapter Two");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/pdf/chapters.test.ts`

Expected: FAIL because `storyHeadingKind` is not exported.

- [ ] **Step 3: Write the heading tests**

Replace the top of `src/lib/pdf/chapters.ts` through `isChapterHeading`. Leave `SECTION_WORDS` and everything below it unchanged.

```typescript
export type Chapter = { title: string; rawText: string };

export type StoryHeadingKind = "prologue" | "chapter" | "epilogue";
export type ExcludedHeadingKind = "introduction" | "preface" | "foreword";

const SINGLE_WORD_HEADING =
  /^(prologue|epilogue|introduction|preface|foreword)(?:\s+to\b.*|\s*[:.—–-]\s*\S.*)?\.?$/i;

const CHAPTER_NUMBER_HEADING = /^chapter\s+(?:\d+|[IVXLC]+)\b.*$/i;

const CHAPTER_WORD_HEADING =
  /^chapter\s+(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(?:one|two|three|four|five|six|seven|eight|nine)|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|one|two|three|four|five|six|seven|eight|nine)\b(?:\s*[:.—–-]\s*\S.*)?$/i;

export function storyHeadingKind(line: string): StoryHeadingKind | null {
  const text = line.trim();
  const single = text.match(SINGLE_WORD_HEADING);
  if (single) {
    const word = single[1].toLowerCase();
    if (word === "prologue") return "prologue";
    if (word === "epilogue") return "epilogue";
    return null;
  }
  if (CHAPTER_NUMBER_HEADING.test(text) || CHAPTER_WORD_HEADING.test(text)) return "chapter";
  return null;
}

export function excludedHeadingKind(line: string): ExcludedHeadingKind | null {
  const text = line.trim();
  const single = text.match(SINGLE_WORD_HEADING);
  if (!single) return null;
  const word = single[1].toLowerCase();
  if (word === "introduction" || word === "preface" || word === "foreword") return word;
  return null;
}

export function isChapterHeading(line: string): boolean {
  return storyHeadingKind(line) !== null;
}
```

The `-` in the character class `[:.—–-]` must stay the last character so it is literal.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/pdf/chapters.test.ts tests/lib/pdf/storyText.test.ts`

Expected: PASS. The existing Chapter N and 3,000-word fallback tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/chapters.ts tests/lib/pdf/chapters.test.ts
git commit -m "$(cat <<'EOF'
feat: recognize prologue, epilogue, and chapter number words

EOF
)"
```

---

### Task 2: Record positioned lines and page status

**Files:**
- Modify: `src/lib/pdf/pageText.ts`
- Test: `tests/lib/pdf/storyText.test.ts`

**Interfaces:**
- Consumes: `PositionedText` and `PdfPageSource` already in `src/lib/pdf/pageText.ts`.
- Produces:

```typescript
export type PageLine = { y: number; text: string };

export function pageLinesFromItems(items: PositionedText[], pageHeight: number): PageLine[]

export type PageStatus = "ok" | "empty" | "failed";

export type PageRecord = { page: number; status: PageStatus };

export type CollectedLine = {
  page: number;
  y: number;
  pageHeight: number;
  text: string;
};

export type PageCollector = {
  render: (pageData: PdfPageSource) => Promise<string>;
  lines: CollectedLine[];
  pages: PageRecord[];
};

export function createPageCollector(): PageCollector
```

`pageTextFromItems` and `renderPdfPage` keep today's margin and page-number drops until Task 6. The collector does not use those drops.

- [ ] **Step 1: Write the failing test**

Add this import and these tests to `tests/lib/pdf/storyText.test.ts`:

```typescript
import { createPageCollector, pageLinesFromItems } from "@/lib/pdf/pageText";

it("keeps margin lines and page-number lines in reading order", () => {
  const lines = pageLinesFromItems(
    [
      { str: "second line", x: 72, y: 400 },
      { str: "world", x: 110, y: 500 },
      { str: "Hello ", x: 72, y: 500 },
      { str: "Running Title", x: 72, y: 960 },
      { str: "17", x: 300, y: 40 },
    ],
    1000,
  );
  expect(lines.map((line) => line.text)).toEqual([
    "Running Title",
    "Hello world",
    "second line",
    "17",
  ]);
});

it("records an empty page and a failed page without throwing", async () => {
  const collector = createPageCollector();
  await expect(
    collector.render({
      view: [0, 0, 600, 800],
      getTextContent: async () => {
        throw new Error("bad page");
      },
    }),
  ).resolves.toBe("");
  await collector.render({
    view: [0, 0, 600, 0],
    getTextContent: async () => ({ items: [] }),
  });
  await collector.render({
    view: [0, 0, 600, 800],
    getTextContent: async () => ({
      items: [{ str: "Once upon a time", transform: [1, 0, 0, 1, 72, 400] }],
    }),
  });
  expect(collector.pages).toEqual([
    { page: 1, status: "failed" },
    { page: 2, status: "empty" },
    { page: 3, status: "ok" },
  ]);
  expect(collector.lines).toEqual([
    { page: 3, y: 400, pageHeight: 800, text: "Once upon a time" },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/pdf/storyText.test.ts`

Expected: FAIL because `pageLinesFromItems` is not exported.

- [ ] **Step 3: Add the collector**

Add this to `src/lib/pdf/pageText.ts` below `PositionedText`. Do not change `pageTextFromItems` or `renderPdfPage`.

```typescript
export type PageLine = { y: number; text: string };

export function pageLinesFromItems(items: PositionedText[], pageHeight: number): PageLine[] {
  if (pageHeight <= 0) return [];
  const grouped: { y: number; parts: { x: number; str: string }[] }[] = [];
  for (const item of items) {
    if (!item.str) continue;
    let line = grouped.find((candidate) => Math.abs(candidate.y - item.y) <= SAME_LINE_Y);
    if (!line) {
      line = { y: item.y, parts: [] };
      grouped.push(line);
    }
    line.parts.push({ x: item.x, str: item.str });
  }
  grouped.sort((a, b) => b.y - a.y);
  const lines: PageLine[] = [];
  for (const line of grouped) {
    const text = line.parts
      .sort((a, b) => a.x - b.x)
      .map((part) => part.str)
      .join("")
      .trim();
    if (text) lines.push({ y: line.y, text });
  }
  return lines;
}

export type PageStatus = "ok" | "empty" | "failed";
export type PageRecord = { page: number; status: PageStatus };
export type CollectedLine = {
  page: number;
  y: number;
  pageHeight: number;
  text: string;
};
export type PageCollector = {
  render: (pageData: PdfPageSource) => Promise<string>;
  lines: CollectedLine[];
  pages: PageRecord[];
};

export function createPageCollector(): PageCollector {
  const lines: CollectedLine[] = [];
  const pages: PageRecord[] = [];
  let nextPage = 1;
  const render = async (pageData: PdfPageSource): Promise<string> => {
    const page = nextPage++;
    try {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      const pageHeight = pageData.view[3] - pageData.view[1];
      const items: PositionedText[] = [];
      for (const item of textContent.items) {
        if (!item.str || !item.transform) continue;
        items.push({ str: item.str, x: item.transform[4], y: item.transform[5] });
      }
      const pageLines = pageLinesFromItems(items, pageHeight);
      if (pageLines.length === 0) {
        pages.push({ page, status: "empty" });
        return "";
      }
      pages.push({ page, status: "ok" });
      for (const line of pageLines) {
        lines.push({ page, y: line.y, pageHeight, text: line.text });
      }
      return pageLines.map((line) => line.text).join("\n");
    } catch {
      pages.push({ page, status: "failed" });
      return "";
    }
  };
  return { render, lines, pages };
}
```

`PdfPageSource` is already declared later in the file. Move that type above `createPageCollector`, or add the collector below `PdfPageSource`. TypeScript must see `PdfPageSource` before `PageCollector`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/pdf/storyText.test.ts`

Expected: PASS, including the existing margin-drop tests for `pageTextFromItems`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/pageText.ts tests/lib/pdf/storyText.test.ts
git commit -m "$(cat <<'EOF'
feat: record PDF page lines and empty or failed pages

EOF
)"
```

---

### Task 3: Drop only two-signal page artifacts

**Files:**
- Modify: `src/lib/pdf/storyText.ts`
- Test: `tests/lib/pdf/storyText.test.ts`

**Interfaces:**
- Consumes: `CollectedLine` from `src/lib/pdf/pageText.ts`.
- Produces:

```typescript
export type ExclusionReason =
  | "margin-page-number"
  | "repeated-header"
  | "front-matter"
  | "introduction"
  | "preface"
  | "foreword";

export function excludePageArtifacts(lines: CollectedLine[]): {
  kept: CollectedLine[];
  excluded: { line: CollectedLine; reason: ExclusionReason }[];
}
```

Leave `stripNonStoryText` in the file.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/pdf/storyText.test.ts`:

```typescript
import { excludePageArtifacts } from "@/lib/pdf/storyText";
import type { CollectedLine } from "@/lib/pdf/pageText";

function line(page: number, y: number, text: string): CollectedLine {
  return { page, y, pageHeight: 1000, text };
}

it("drops a margin header repeated on three pages and keeps the body", () => {
  const lines = [1, 2, 3].flatMap((page) => [
    line(page, 960, "Running Title"),
    line(page, 500, "Story on page " + page),
  ]);
  const result = excludePageArtifacts(lines);
  expect(result.kept.map((item) => item.text)).toEqual([
    "Story on page 1",
    "Story on page 2",
    "Story on page 3",
  ]);
  expect(result.excluded.every((item) => item.reason === "repeated-header")).toBe(true);
});

it("drops a footer page number and keeps a page number in the body", () => {
  const result = excludePageArtifacts([
    line(1, 500, "The story continues here."),
    line(1, 400, "17"),
    line(1, 40, "42"),
  ]);
  expect(result.kept.map((item) => item.text)).toEqual([
    "The story continues here.",
    "17",
  ]);
  expect(result.excluded).toEqual([
    { line: line(1, 40, "42"), reason: "margin-page-number" },
  ]);
});

it("keeps a sentence repeated in the body and a margin line seen once", () => {
  const lines = [
    line(1, 960, "A line near the edge."),
    ...[1, 2, 3].map((page) => line(page, 500, "The same sentence.")),
    line(2, 960, "Only twice"),
    line(3, 960, "Only twice"),
  ];
  const result = excludePageArtifacts(lines);
  expect(result.kept.map((item) => item.text)).toEqual([
    "A line near the edge.",
    "The same sentence.",
    "The same sentence.",
    "The same sentence.",
    "Only twice",
    "Only twice",
  ]);
  expect(result.excluded).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/pdf/storyText.test.ts`

Expected: FAIL because `excludePageArtifacts` is not exported.

- [ ] **Step 3: Implement artifact removal**

Add this to `src/lib/pdf/storyText.ts`. Keep `stripNonStoryText`.

```typescript
import type { CollectedLine } from "@/lib/pdf/pageText";

const MARGIN_RATIO = 0.08;
const REPEATED_HEADER_PAGES = 3;
const PAGE_NUMBER_LINE = /^(?:[-–—]\s*)?\d{1,4}(?:\s*[-–—])?$/;

export type ExclusionReason =
  | "margin-page-number"
  | "repeated-header"
  | "front-matter"
  | "introduction"
  | "preface"
  | "foreword";

function inMargin(line: CollectedLine): boolean {
  if (line.pageHeight <= 0) return false;
  return line.y >= line.pageHeight * (1 - MARGIN_RATIO) || line.y <= line.pageHeight * MARGIN_RATIO;
}

export function excludePageArtifacts(lines: CollectedLine[]): {
  kept: CollectedLine[];
  excluded: { line: CollectedLine; reason: ExclusionReason }[];
} {
  const marginPages = new Map<string, Set<number>>();
  for (const line of lines) {
    const text = line.text.trim();
    if (!inMargin(line) || !text || PAGE_NUMBER_LINE.test(text)) continue;
    const pages = marginPages.get(text) ?? new Set<number>();
    pages.add(line.page);
    marginPages.set(text, pages);
  }
  const repeated = new Set(
    [...marginPages]
      .filter(([, pages]) => pages.size >= REPEATED_HEADER_PAGES)
      .map(([text]) => text),
  );
  const kept: CollectedLine[] = [];
  const excluded: { line: CollectedLine; reason: ExclusionReason }[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (inMargin(line) && PAGE_NUMBER_LINE.test(text)) {
      excluded.push({ line, reason: "margin-page-number" });
      continue;
    }
    if (inMargin(line) && repeated.has(text)) {
      excluded.push({ line, reason: "repeated-header" });
      continue;
    }
    kept.push(line);
  }
  return { kept, excluded };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/pdf/storyText.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/storyText.ts tests/lib/pdf/storyText.test.ts
git commit -m "$(cat <<'EOF'
feat: drop PDF margin lines only with a second signal

EOF
)"
```

---

### Task 4: Apply the story policy and join pages

**Files:**
- Modify: `src/lib/pdf/storyText.ts`
- Test: `tests/lib/pdf/storyText.test.ts`

**Interfaces:**
- Consumes: `excludePageArtifacts`, `CollectedLine`, `storyHeadingKind`, `excludedHeadingKind`.
- Produces:

```typescript
export type StoryStart = "prologue" | "chapter" | "none";

export function applyStoryPolicy(lines: CollectedLine[]): {
  kept: CollectedLine[];
  excluded: { line: CollectedLine; reason: ExclusionReason }[];
  storyStart: StoryStart;
}

export function joinStoryLines(lines: CollectedLine[]): string

export function filterStoryLines(lines: CollectedLine[]): {
  kept: CollectedLine[];
  excluded: { line: CollectedLine; reason: ExclusionReason }[];
  storyStart: StoryStart;
}
```

`filterStoryLines` runs `excludePageArtifacts`, then `applyStoryPolicy` on the kept lines. `joinStoryLines` joins one page with `\n` and pages with `\n\n`.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/pdf/storyText.test.ts`. Reuse the `line` helper from Task 3.

```typescript
import { applyStoryPolicy, filterStoryLines, joinStoryLines } from "@/lib/pdf/storyText";

it("keeps a prologue and drops the preface that follows it", () => {
  const lines = [
    line(1, 500, "Copyright 2020"),
    line(1, 400, "Preface"),
    line(1, 300, "A note."),
    line(2, 500, "Prologue"),
    line(2, 400, "Once."),
    line(3, 500, "Preface"),
    line(3, 400, "Later note."),
    line(4, 500, "Chapter 1"),
    line(4, 400, "Body."),
  ];
  const result = applyStoryPolicy(lines);
  expect(result.storyStart).toBe("prologue");
  expect(result.kept.map((item) => item.text)).toEqual(["Prologue", "Once.", "Chapter 1", "Body."]);
  expect(result.excluded.map((item) => item.reason)).toEqual([
    "front-matter",
    "front-matter",
    "front-matter",
    "preface",
    "preface",
  ]);
});

it("drops an introduction and a foreword after the story starts", () => {
  const lines = [
    line(1, 500, "Chapter One"),
    line(1, 400, "Body."),
    line(1, 300, "About the Author"),
    line(2, 500, "Introduction: A Note"),
    line(2, 400, "Skip me."),
    line(3, 500, "Foreword"),
    line(3, 400, "Skip this too."),
    line(4, 500, "Epilogue"),
    line(4, 400, "After."),
  ];
  const result = applyStoryPolicy(lines);
  expect(result.storyStart).toBe("chapter");
  expect(result.kept.map((item) => item.text)).toEqual([
    "Chapter One",
    "Body.",
    "About the Author",
    "Epilogue",
    "After.",
  ]);
  expect(result.excluded.map((item) => item.reason)).toEqual([
    "introduction",
    "introduction",
    "foreword",
    "foreword",
  ]);
});

it("keeps text with no story heading and still drops a preface section", () => {
  const result = applyStoryPolicy([
    line(1, 500, "Hello."),
    line(1, 400, "Preface to the Second Edition"),
    line(1, 300, "Not the story."),
    line(1, 200, "After."),
  ]);
  expect(result.storyStart).toBe("none");
  expect(result.kept.map((item) => item.text)).toEqual(["Hello.", "After."]);
  expect(result.excluded.map((item) => item.reason)).toEqual(["preface", "preface"]);
});

it("joins kept pages with one blank line and skips an empty gap", () => {
  expect(joinStoryLines([line(1, 500, "Alpha"), line(3, 500, "Beta")])).toBe("Alpha\n\nBeta");
});

it("filters artifacts before the story policy", () => {
  const lines = [1, 2, 3].flatMap((page) => [
    line(page, 960, "Running Title"),
    line(page, 500, page === 1 ? "Chapter 1" : "Body " + page),
  ]);
  const result = filterStoryLines(lines);
  expect(result.kept.map((item) => item.text)).toEqual(["Chapter 1", "Body 2", "Body 3"]);
  expect(result.excluded.every((item) => item.reason === "repeated-header")).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/pdf/storyText.test.ts`

Expected: FAIL because `applyStoryPolicy` is not exported.

- [ ] **Step 3: Implement the policy and the join**

Add this to `src/lib/pdf/storyText.ts`.

```typescript
import { excludedHeadingKind, storyHeadingKind } from "@/lib/pdf/chapters";

export type StoryStart = "prologue" | "chapter" | "none";

export function applyStoryPolicy(lines: CollectedLine[]): {
  kept: CollectedLine[];
  excluded: { line: CollectedLine; reason: ExclusionReason }[];
  storyStart: StoryStart;
} {
  const storyStartIndex = lines.findIndex((line) => {
    const kind = storyHeadingKind(line.text);
    return kind === "prologue" || kind === "chapter";
  });
  const startKind = storyStartIndex < 0 ? null : storyHeadingKind(lines[storyStartIndex].text);
  const storyStart: StoryStart =
    startKind === "prologue" ? "prologue" : startKind === "chapter" ? "chapter" : "none";
  const kept: CollectedLine[] = [];
  const excluded: { line: CollectedLine; reason: ExclusionReason }[] = [];
  let skipping: "introduction" | "preface" | "foreword" | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (storyStartIndex >= 0 && i < storyStartIndex) {
      excluded.push({ line, reason: "front-matter" });
      continue;
    }
    const excludedKind = excludedHeadingKind(line.text);
    const recognized = excludedKind !== null || storyHeadingKind(line.text) !== null;
    if (skipping && !recognized) {
      excluded.push({ line, reason: skipping });
      continue;
    }
    skipping = null;
    if (excludedKind) {
      skipping = excludedKind;
      excluded.push({ line, reason: excludedKind });
      continue;
    }
    kept.push(line);
  }
  return { kept, excluded, storyStart };
}

export function joinStoryLines(lines: CollectedLine[]): string {
  if (lines.length === 0) return "";
  const pages: string[][] = [];
  let currentPage = lines[0].page;
  let bucket: string[] = [];
  for (const line of lines) {
    if (line.page !== currentPage) {
      pages.push(bucket);
      bucket = [];
      currentPage = line.page;
    }
    bucket.push(line.text);
  }
  pages.push(bucket);
  return pages
    .filter((page) => page.length > 0)
    .map((page) => page.join("\n"))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function filterStoryLines(lines: CollectedLine[]): {
  kept: CollectedLine[];
  excluded: { line: CollectedLine; reason: ExclusionReason }[];
  storyStart: StoryStart;
} {
  const artifacts = excludePageArtifacts(lines);
  const story = applyStoryPolicy(artifacts.kept);
  return {
    kept: story.kept,
    excluded: [...artifacts.excluded, ...story.excluded],
    storyStart: story.storyStart,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/pdf/storyText.test.ts tests/lib/pdf/chapters.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/storyText.ts tests/lib/pdf/storyText.test.ts
git commit -m "$(cat <<'EOF'
feat: keep prologues and drop introductions, prefaces, and forewords

EOF
)"
```

---

### Task 5: Wire extraction and diagnostics

**Files:**
- Modify: `src/lib/pdf/extract.ts`
- Create: `tests/lib/pdf/extract.test.ts`

**Interfaces:**
- Consumes: `createPageCollector`, `filterStoryLines`, `joinStoryLines`, `CollectedLine`, `PageRecord`.
- Produces:

```typescript
export type PdfExtractDiagnostics = {
  pagesExtracted: number;
  pagesEmpty: number;
  pagesFailed: number;
  excluded: {
    marginPageNumber: number;
    repeatedHeader: number;
    frontMatter: number;
    introduction: number;
    preface: number;
    foreword: number;
  };
  storyStart: "prologue" | "chapter" | "none";
  wordsIn: number;
  wordsOut: number;
  largeReduction: boolean;
};

export type PdfExtractResult = {
  text: string;
  metadata: { title?: string; author?: string; pages: number };
  wordCount: number;
  diagnostics: PdfExtractDiagnostics;
};

export function buildStoryExtract(input: {
  lines: CollectedLine[];
  pages: PageRecord[];
  metadata: { title?: string; author?: string; pages: number };
}): PdfExtractResult

export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult>
```

`buildStoryExtract` logs `diagnostics` with `console.info`, then throws the existing `PdfExtractError` values. `extractPdfText` parses with `collector.render` and passes `data.numpages` as `metadata.pages`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/pdf/extract.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStoryExtract, extractPdfText, PdfExtractError } from "@/lib/pdf/extract";
import type { CollectedLine } from "@/lib/pdf/pageText";

function words(count: number, prefix: string): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");
}

function body(text: string): CollectedLine[] {
  return text.split("\n").map((item, index) => ({
    page: 1,
    y: 500 - index,
    pageHeight: 1000,
    text: item,
  }));
}

describe("buildStoryExtract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a long enough chapter and logs counts without the sentence", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const front = words(600, "front");
    const story = words(500, "word");
    const result = buildStoryExtract({
      lines: body(["Copyright", front, "Chapter 1", story].join("\n")),
      pages: [
        { page: 1, status: "ok" },
        { page: 2, status: "empty" },
        { page: 3, status: "failed" },
      ],
      metadata: { title: "Book", author: "Ada", pages: 3 },
    });
    expect(result.text.startsWith("Chapter 1")).toBe(true);
    expect(result.text).toContain("word0");
    expect(result.text).not.toContain("Copyright");
    expect(result.wordCount).toBe(502);
    expect(result.diagnostics).toMatchObject({
      pagesExtracted: 3,
      pagesEmpty: 1,
      pagesFailed: 1,
      storyStart: "chapter",
      wordsOut: 502,
      largeReduction: true,
    });
    expect(result.diagnostics.excluded.frontMatter).toBe(2);
    expect(info).toHaveBeenCalledWith(result.diagnostics);
    expect(JSON.stringify(result.diagnostics)).not.toContain("word0");
  });

  it("rejects fewer than 500 words with the existing message", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(() =>
      buildStoryExtract({
        lines: body("Chapter 1\nToo short."),
        pages: [{ page: 1, status: "ok" }],
        metadata: { pages: 1 },
      }),
    ).toThrowError(new PdfExtractError("PDF too short to generate an audiobook.", 422));
  });

  it("rejects a preface-only text with the scanned-PDF message", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(() =>
      buildStoryExtract({
        lines: body("Preface\nNot the story."),
        pages: [{ page: 1, status: "ok" }],
        metadata: { pages: 1 },
      }),
    ).toThrowError(
      new PdfExtractError("No text layer found. Scanned PDFs are not supported yet.", 422),
    );
    expect(info.mock.calls[0][0]).toMatchObject({
      storyStart: "none",
      wordsOut: 0,
      excluded: { preface: 2 },
    });
  });
});

it("rejects a buffer the parser cannot read", async () => {
  await expect(extractPdfText(Buffer.from("not a pdf"))).rejects.toMatchObject({
    name: "PdfExtractError",
    message: "No text layer found. Scanned PDFs are not supported yet.",
    statusCode: 422,
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/pdf/extract.test.ts`

Expected: FAIL because `buildStoryExtract` is not exported.

- [ ] **Step 3: Replace `src/lib/pdf/extract.ts`**

```typescript
import pdfParse from "pdf-parse";
import { createPageCollector, type CollectedLine, type PageRecord } from "@/lib/pdf/pageText";
import { filterStoryLines, joinStoryLines, type StoryStart } from "@/lib/pdf/storyText";

export class PdfExtractError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "PdfExtractError";
  }
}

const MIN_WORDS = 500;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export type PdfExtractDiagnostics = {
  pagesExtracted: number;
  pagesEmpty: number;
  pagesFailed: number;
  excluded: {
    marginPageNumber: number;
    repeatedHeader: number;
    frontMatter: number;
    introduction: number;
    preface: number;
    foreword: number;
  };
  storyStart: StoryStart;
  wordsIn: number;
  wordsOut: number;
  largeReduction: boolean;
};

export type PdfExtractResult = {
  text: string;
  metadata: { title?: string; author?: string; pages: number };
  wordCount: number;
  diagnostics: PdfExtractDiagnostics;
};

const REASON_KEY = {
  "margin-page-number": "marginPageNumber",
  "repeated-header": "repeatedHeader",
  "front-matter": "frontMatter",
  introduction: "introduction",
  preface: "preface",
  foreword: "foreword",
} as const;

export function buildStoryExtract(input: {
  lines: CollectedLine[];
  pages: PageRecord[];
  metadata: { title?: string; author?: string; pages: number };
}): PdfExtractResult {
  const filtered = filterStoryLines(input.lines);
  const text = joinStoryLines(filtered.kept);
  const wordsIn = countWords(input.lines.map((line) => line.text).join(" "));
  const wordsOut = countWords(text);
  const excluded = {
    marginPageNumber: 0,
    repeatedHeader: 0,
    frontMatter: 0,
    introduction: 0,
    preface: 0,
    foreword: 0,
  };
  for (const item of filtered.excluded) {
    excluded[REASON_KEY[item.reason]] += 1;
  }
  const diagnostics: PdfExtractDiagnostics = {
    pagesExtracted: input.pages.length,
    pagesEmpty: input.pages.filter((page) => page.status === "empty").length,
    pagesFailed: input.pages.filter((page) => page.status === "failed").length,
    excluded,
    storyStart: filtered.storyStart,
    wordsIn,
    wordsOut,
    largeReduction: wordsIn > 0 && wordsOut * 2 < wordsIn,
  };
  console.info(diagnostics);
  if (!text) {
    throw new PdfExtractError("No text layer found. Scanned PDFs are not supported yet.", 422);
  }
  if (wordsOut < MIN_WORDS) {
    throw new PdfExtractError("PDF too short to generate an audiobook.", 422);
  }
  return { text, metadata: input.metadata, wordCount: wordsOut, diagnostics };
}

export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
  const collector = createPageCollector();
  let data: Awaited<ReturnType<typeof pdfParse>>;
  try {
    data = await pdfParse(buffer, { pagerender: collector.render });
  } catch {
    throw new PdfExtractError("No text layer found. Scanned PDFs are not supported yet.", 422);
  }
  return buildStoryExtract({
    lines: collector.lines,
    pages: collector.pages,
    metadata: {
      title: data.info?.Title?.trim() || undefined,
      author: data.info?.Author?.trim() || undefined,
      pages: data.numpages,
    },
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/pdf/extract.test.ts tests/lib/pdf/storyText.test.ts`

Expected: PASS. The invalid-buffer test rejects with `PdfExtractError` and does not log diagnostics.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/extract.ts tests/lib/pdf/extract.test.ts
git commit -m "$(cat <<'EOF'
feat: extract story text from positioned PDF lines

EOF
)"
```

---

### Task 6: Retire the old drops and update the comparison script

**Files:**
- Modify: `src/lib/pdf/pageText.ts`
- Modify: `src/lib/pdf/storyText.ts`
- Modify: `tests/lib/pdf/storyText.test.ts`
- Modify: `scripts/compare-gatsby-extract.ts`

**Interfaces:**
- Consumes: `pageLinesFromItems`, `createPageCollector`, `excludePageArtifacts`, `filterStoryLines`, `joinStoryLines`.
- Produces: `pageTextFromItems` joins every non-empty line. `renderPdfPage` returns that text and does not drop margin lines. `stripNonStoryText` is removed.

- [ ] **Step 1: Write the failing test**

In `tests/lib/pdf/storyText.test.ts`, replace the two tests that expect margin lines and body page numbers to disappear.

The test named "drops lines in the top and bottom margin and keeps the story line" becomes:

```typescript
it("keeps the margin line, the story line, and the footer number", () => {
  const text = pageTextFromItems(
    [
      { str: "Running Title", x: 72, y: 960 },
      { str: "Once upon a time", x: 72, y: 500 },
      { str: "42", x: 300, y: 40 },
    ],
    1000,
  );
  expect(text).toBe("Running Title\nOnce upon a time\n42");
});
```

The test named "drops a line that is only a page number even when it sits in the body" becomes:

```typescript
it("keeps a page-number line in the body", () => {
  const text = pageTextFromItems(
    [
      { str: "The story continues here.", x: 72, y: 500 },
      { str: "17", x: 280, y: 400 },
    ],
    1000,
  );
  expect(text).toBe("The story continues here.\n17");
});
```

The `renderPdfPage` test becomes:

```typescript
it("reads positioned text items and keeps the margin", async () => {
  const text = await renderPdfPage({
    view: [0, 0, 600, 800],
    getTextContent: async () => ({
      items: [
        { str: "Running Title", transform: [1, 0, 0, 1, 72, 780] },
        { str: "Once upon a time", transform: [1, 0, 0, 1, 72, 400] },
        { str: "12", transform: [1, 0, 0, 1, 300, 20] },
      ],
    }),
  });
  expect(text).toBe("Running Title\nOnce upon a time\n12");
});
```

Delete the `describe("stripNonStoryText")` block.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/pdf/storyText.test.ts`

Expected: FAIL because `pageTextFromItems` still drops the margin lines.

- [ ] **Step 3: Stop dropping inside page text and delete the old story cut**

Replace `pageTextFromItems` with:

```typescript
export function pageTextFromItems(items: PositionedText[], pageHeight: number): string {
  return pageLinesFromItems(items, pageHeight)
    .map((line) => line.text)
    .join("\n");
}
```

Replace `renderPdfPage` with a call through the collector so it records lines the same way and returns the unfiltered page string:

```typescript
export async function renderPdfPage(pageData: PdfPageSource): Promise<string> {
  return createPageCollector().render(pageData);
}
```

Delete `MARGIN_RATIO` and `PAGE_NUMBER_LINE` from `pageText.ts` if nothing in that file uses them.

Delete `stripNonStoryText` and its `REPEATED_LINE_PAGES` constant from `storyText.ts`. Delete the `isChapterHeading` import if `storyText.ts` no longer uses it.

Replace `scripts/compare-gatsby-extract.ts` with:

```typescript
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { createPageCollector } from "../src/lib/pdf/pageText";
import { excludePageArtifacts, filterStoryLines, joinStoryLines } from "../src/lib/pdf/storyText";

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function linesOf(text: string): string[] {
  return text.split("\n");
}

function preview(text: string, maxLines: number): string {
  return linesOf(text).slice(0, maxLines).join("\n");
}

async function main() {
  const pdfPath = path.join(process.cwd(), "testSamples/the-great-gatsby-f-scott-fitzgerald.pdf");
  const buffer = fs.readFileSync(pdfPath);
  const previous = await pdfParse(buffer);
  const previousText = (previous.text ?? "").replace(/\r\n/g, "\n").trim();
  const collector = createPageCollector();
  await pdfParse(buffer, { pagerender: collector.render });
  const afterMargins = joinStoryLines(excludePageArtifacts(collector.lines).kept);
  const nextText = joinStoryLines(filterStoryLines(collector.lines).kept);

  const outDir = path.join(process.cwd(), "scripts/.compare-out");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "previous.txt"), previousText);
  fs.writeFileSync(path.join(outDir, "margins.txt"), afterMargins);
  fs.writeFileSync(path.join(outDir, "next.txt"), nextText);

  const prevLines = linesOf(previousText);
  const nextLines = linesOf(nextText);
  const prevSet = new Map<string, number>();
  for (const line of prevLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    prevSet.set(trimmed, (prevSet.get(trimmed) ?? 0) + 1);
  }
  const nextSet = new Set(nextLines.map((line) => line.trim()).filter(Boolean));
  const removed = [...prevSet.entries()]
    .filter(([line]) => !nextSet.has(line))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  console.log(
    JSON.stringify(
      {
        pages: previous.numpages,
        title: previous.info?.Title ?? null,
        author: previous.info?.Author ?? null,
        previous: { words: words(previousText), lines: prevLines.length, chars: previousText.length },
        afterMarginFilter: { words: words(afterMargins), lines: linesOf(afterMargins).length, chars: afterMargins.length },
        next: { words: words(nextText), lines: nextLines.length, chars: nextText.length },
        removedDistinctLines: removed.length,
        removedLineOccurrences: removed.reduce((sum, [, count]) => sum + count, 0),
        topRemoved: removed.slice(0, 40).map(([line, count]) => ({ count, line: line.slice(0, 180) })),
        previousOpening: preview(previousText, 80),
        nextOpening: preview(nextText, 40),
        previousEnding: linesOf(previousText).slice(-25).join("\n"),
        nextEnding: nextLines.slice(-25).join("\n"),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the tests and the comparison script**

Run: `npx vitest run tests/lib/pdf`

Expected: PASS.

Run: `npm test`

Expected: PASS. This covers upload and pipeline tests that call `extractPdfText` only if they already do. Do not edit those callers.

Run: `npx tsx scripts/compare-gatsby-extract.ts`

Expected when `testSamples/the-great-gatsby-f-scott-fitzgerald.pdf` is present: the script writes the three files and prints JSON. Expected when that gitignored sample is absent: the process exits because `readFileSync` throws. Record that result. It is not a code failure.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/pageText.ts src/lib/pdf/storyText.ts tests/lib/pdf/storyText.test.ts scripts/compare-gatsby-extract.ts
git commit -m "$(cat <<'EOF'
feat: compare PDF extracts after artifact and story filters

EOF
)"
```
