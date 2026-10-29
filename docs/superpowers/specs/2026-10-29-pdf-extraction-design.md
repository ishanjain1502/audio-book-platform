# Safer PDF story extraction — design spec

**Status:** Approved (2026-10-29)

## Goals

- Keep narrative text that the current extractor drops because of page position or repetition.
- Drop front matter, introductions, prefaces, and forewords.
- Keep a prologue, and keep an epilogue.
- Record why each automatic drop happened, and record pages that came back empty or failed.
- Leave the upload, worker, database, and downstream readers on the same contract.

## Non-goals

- OCR, a new PDF library, or an LLM call during upload.
- A database column, queue, or change to annotation and synthesis.
- Paragraph-boundary fallback sections. Books with no story heading still split every 3,000 words into `Section 1`, `Section 2`, and so on.
- Special labels for About the Author, Acknowledgments, Appendix, or Contents. Those lines survive when they occur after the story start.
- Fuzzy header matching. Repeated headers match the trimmed line exactly, case-sensitive.
- Rejecting a file because the filter removed a large share of the words.

## Decisions

| Topic | Choice |
| --- | --- |
| Parser | `pdf-parse` 1.1.4 stays. The page renderer returns a string and also records line positions for the caller |
| Coordinates | Unchanged. `x` is `transform[4]`, `y` is `transform[5]`, page height is `view[3] - view[1]`. Origin is the bottom left, so a larger `y` is higher on the page |
| Public extract result | `{ text, metadata, wordCount }` stays. Add `diagnostics`. Callers may ignore it |
| Story string | Rebuilt from kept lines. One newline inside a page. A blank line between pages that still have kept lines. A page with no kept lines adds no extra gap |
| Size gate | Still 500 words on the final text. The messages and status codes stay |
| Chapters stored | `idx`, `title`, `text` only. Prologue and epilogue become their own rows when those headings exist |
| Fingerprint | Still title plus the first 5,000 words of cleaned text. A re-upload whose cleaned text changed is a new book |

## Flow

1. `extractPdfText` parses the buffer with a page collector.
2. Each page becomes ordered lines with page number, `y`, page height, and text. Grouping stays as it is: fragments within 2 `y` units form one line, fragments sort left to right, lines sort top to bottom.
3. Artifact removal runs on those lines.
4. The story policy runs on the lines that remain.
5. Kept lines join into `text`. Word count and the 500-word check run on that string.
6. `POST /api/jobs` and `prepareJobFromUpload` still call `extractPdfText`, then `splitChapters`. The worker still skips extraction when the job is already prepared. The original PDF bytes stay untouched.

A page whose `getTextContent` throws is `failed`. The renderer catches that, records the page, and returns `""` so `pdf-parse` continues. A page with height `<= 0` or with no text lines is `empty`. Neither status rejects the upload. If the whole parse throws, the result is still HTTP 422: "No text layer found. Scanned PDFs are not supported yet."

## Artifact removal

The margin band is the top and bottom 8% of the page, the same bounds as today: `y >= pageHeight * 0.92` or `y <= pageHeight * 0.08`.

A margin line is dropped when a second signal agrees:

- The trimmed line matches `/^(?:[-–—]\s*)?\d{1,4}(?:\s*[-–—])?$/`. Reason: `margin-page-number`. This is checked first.
- Or the same trimmed line occurs in the margin on at least 3 pages, counted once per page. Reason: `repeated-header`. Only the margin copies are dropped.

A narrative line in the margin stays. A repeated sentence in the body stays. A page-number line in the body stays. A margin line that repeats on only 2 pages stays.

## Story policy

Single-word headings match the whole trimmed line. The keyword may stand alone, with a trailing period, with a continuation that starts with `to`, or with a subtitle after `:`, `.`, `—`, `–`, or `-`. `Preface to the Second Edition` matches. `Prologue was his favorite word` does not.

| Heading | Class |
| --- | --- |
| `Prologue` | Story start. Own chapter |
| `Chapter` plus digits or Roman numerals (`I`, `IV`, `XII`, the current `IVXLC` set), then any rest of the line | Story start. Own chapter. This suffix rule stays as it is, so a full line `Chapter I went home` is still a heading |
| `Chapter` plus an English number from one through ninety-nine, including `Twenty-One` | Story start. Own chapter. The number word ends the line, or a punctuation subtitle follows it. `Chapter One: The Door` matches. `Chapter one morning` stays body text |
| `Epilogue` | Kept. Own chapter. Does not start the story |
| `Introduction`, `Preface`, `Foreword` | Excluded section |

The story starts at the first Prologue or Chapter line. Every line before that is `front-matter`, including a preface that sits there. From the story start onward, an Introduction, Preface, or Foreword section is removed through the line before the next recognized heading. The heading that ends the section is kept and judged on its own. Recognized headings are prologue, chapter, epilogue, introduction, preface, and foreword.

A heading line classified as Introduction, Preface, or Foreword is removed, including a subtitle form such as `Introduction: A Note`.

When no Prologue or Chapter line exists, lines stay, and an Introduction, Preface, or Foreword section is still removed. `splitChapters` then uses the 3,000-word fallback on whatever text remains.

`storyStart` in diagnostics is `prologue`, `chapter`, or `none`, taken from that first story-start heading.

## Chapter split

`splitChapters` splits on prologue, chapter, and epilogue lines, using the same heading tests. `isChapterHeading` is true for those three and false for introduction, preface, and foreword. The heading line is the chapter title and is not part of the body. Body text runs until the next of those headings. Excluded headings are already gone before this function runs. No story heading means the existing 3,000-word `Section N` split.

## Diagnostics

`extractPdfText` adds this object and logs it once with `console.info`. The log has counts only. It does not include line text.

- `pagesExtracted`: pages visited. `pagesEmpty` and `pagesFailed` are subsets of that count. The rest are pages that produced lines
- `excluded` counts for `marginPageNumber`, `repeatedHeader`, `frontMatter`, `introduction`, `preface`, `foreword`
- `storyStart`
- `wordsIn`: words across all collected lines, before either drop
- `wordsOut`: words in the final text, the same value as `wordCount`
- `largeReduction`: true when `wordsIn > 0` and `wordsOut * 2 < wordsIn`

`largeReduction` does not change the HTTP result. Empty final text is still the scanned-PDF 422. Fewer than 500 words is still "PDF too short to generate an audiobook."

## Files

- `src/lib/pdf/pageText.ts` — return positioned lines and stop dropping text. The renderer records page status.
- `src/lib/pdf/storyText.ts` — artifact removal, story policy, and the join. Export the kept lines and the exclusion reasons for tests.
- `src/lib/pdf/chapters.ts` — share the heading tests. Split on prologue and epilogue too.
- `src/lib/pdf/extract.ts` — run the stages, fill diagnostics, keep the existing errors.
- `scripts/compare-gatsby-extract.ts` — `previous.txt` stays raw `pdf-parse`. `margins.txt` becomes text after artifact removal. `next.txt` stays the final story text.
- Tests under `tests/lib/pdf/`.

## Tests

Update the current tests that expect every margin line, and every line repeated on 3 pages, to disappear.

Cover these cases with exact expected text or reasons:

1. A running header in the margin on 3 pages is removed. Body lines on those pages stay.
2. A footer page number is removed. A page-number line in the body stays.
3. One sentence repeated in the body on 3 pages stays.
4. A narrative line inside the margin, seen once, stays.
5. A prologue before Chapter 1 is kept. `splitChapters` returns the prologue chapter, then Chapter 1.
6. A preface after the prologue is removed. The prologue and the chapter stay.
7. Introduction and foreword sections are removed.
8. `Chapter One` and `Chapter Twenty-One: A Title` split. `Chapter one morning` does not.
9. A book with no story heading keeps its text. A preface section in that text is removed. Long text still becomes `Section N` blocks of 3,000 words.
10. An empty page between text pages is `empty`. The neighboring text stays, joined by a blank line.
11. A failed page is `failed` and does not throw. The other pages stay.
12. Under 500 words returns the existing too-short 422. A preface-only file that leaves no text returns the existing scanned-PDF 422. A buffer the parser rejects returns that same scanned-PDF 422.

## Compatibility

Annotation, synthesis, research, and the job status file keep reading stored chapter `idx`, `title`, and `text`. No schema change. The 500-word rule and both 422 messages stay. The original PDF remains the stored source file.
