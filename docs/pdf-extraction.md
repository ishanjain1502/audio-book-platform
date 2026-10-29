# PDF extraction

Text-layer PDFs are extracted and split into chapters on `POST /api/jobs`. There is no OCR. The worker does not extract again when the job is already prepared (chapters already stored). The original PDF bytes are stored unchanged.

## Pipeline

1. **`extractPdfText`** — `pdf-parse` renders each page through a line collector (`pageText.ts`). Pages keep positioned lines joined top-to-bottom within the page; pages are separated by a blank line.
2. **`filterStoryLines`** — Drops margin page numbers and running headers that repeat on at least three pages. Applies story policy (below). Diagnostics are logged as exclusion counts plus word counts in/out.
3. **Gate** — Fewer than 500 words → 422 “PDF too short…”. Empty text → 422 scanned-PDF message.
4. **`splitChapters`** — Runs in the upload handler after extract; chapter rows are saved with the job.

`prepareJobFromUpload` runs the same extract-then-split sequence when the worker must prepare a job that was not created through the web upload path.

## Story policy

Story starts at the first **Prologue** or **Chapter** line. Text before that is removed. **Introduction**, **Preface**, and **Foreword** sections are removed through the next recognized heading, or through the end if none follows. **Epilogue** is kept as story.

## Chapters (`splitChapters`)

Splits on **Prologue**, **Chapter**, and **Epilogue** headings. Text before the first such heading becomes `Section 1`, `Section 2`, … blocks of 3000 words each, then heading-based chapters follow. Prologue and Epilogue each become their own chapter; the heading line is not part of the body.

If there are no story headings, the whole text is split into 3000-word sections only.

Paragraph splitting (1500-character chunks) happens later when annotation or synthesis reads chapter text.
