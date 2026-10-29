1. Mission
Inspect and improve the existing PDF-to-story-text pipeline. The
pipeline should retain the intended narrative of a novel while removing
clearly irrelevant PDF artifacts such as running headers, running
footers, page numbers, publisher advertisements, and explicitly excluded
sections.

This is a codebase implementation task, not a request to replace the
stack or design a new system from scratch.
Non-negotiable principles
1. Do not silently lose narrative content.
2. Do not classify text as irrelevant based only on position or
   repetition.
3. Keep the original PDF unchanged and available for recovery.
4. Make filtering decisions explainable and testable.
5. Measure quality against verified examples rather than relying on
   intuition.
6. Preserve existing downstream interfaces wherever practical.
7. Make incremental, reviewable changes.
8. Do not add OCR in this task unless the repository already supports
   it or a specific requirement is approved. Current behavior does
   not support scanned PDFs.
2. Current Pipeline (Repository Context)
The current upload path is:
POST /api/jobs
    -> extractPdfText
        -> page text extraction via pdf-parse / pageText.ts
        -> stripNonStoryText
        -> reject if cleaned word count < 500
        -> splitChapters
        -> save books + chapters
        -> retain original PDF separately
prepareJobFromUpload runs the same extract-then-split sequence. The
web upload already performs that work, so the worker does not extract
the PDF again. Preserve this behavior unless repository inspection
identifies a concrete correctness issue.
Current page extraction behavior
File: src/lib/pdf/pageText.ts
- Uses pdf-parse once per page.
- Drops the top and bottom 8% of each page.
- Groups fragments whose y-coordinates are within 2 units into a line.
- Sorts fragments left-to-right and lines top-to-bottom.
- Removes lines consisting only of page-number patterns such as 17,
  - 17, or 17 —.
- Joins retained lines with a single newline.
- Pages are joined with a blank line, which downstream cleanup treats
  as a page boundary.
- A failed page becomes an empty string and is skipped.
- If the entire file fails to parse, the API returns 422 with a
  scanned-PDF/no-text-layer message.
- There is no OCR.
Coordinate assumptions in the existing implementation must be verified
from the actual code and parser output before changing them. Do not
assume coordinate orientation or units based only on this brief.
Current story cleanup behavior
File: src/lib/pdf/storyText.ts
- The first line matching a heading like Chapter 1 or Chapter IV
  marks the beginning of the story.
- Everything before that heading is removed.
- Chapter One does not currently match.
- If no matching heading exists, the whole text is retained.
- Blank-line-separated blocks are treated as pages.
- Any line appearing on 3 or more pages is removed everywhere.
- Chapter headings are exempt from repeated-line removal.
Current gate
- Words are counted by splitting on whitespace.
- Fewer than 500 words returns HTTP 422 with an audiobook-related
  message.
- Empty text after cleanup uses the scanned-PDF message.
- The 500-word check is a size heuristic, not proof that the extracted
  content is valid.
Current chapter splitting
File: src/lib/pdf/chapters.ts
- Recognized Chapter N or Chapter IV lines become chapter
  headings.
- Each chapter body runs until the next recognized heading.
- The heading line is excluded from the chapter body.
- If no headings are found, text is split into 3,000-word blocks named
  Section 1, Section 2, etc.
- Annotation/synthesis later splits chapter text into 1,500-character
  chunks.
Current stored data
- Book metadata: title, author, word count, page count.
- Fingerprint: title plus the first 5,000 words of cleaned text.
- Chapter rows: idx, title, text.
- Original PDF bytes are stored separately.
- The worker consumes stored chapters and should not repeat
  extraction.
Existing diagnostic script
npx tsx scripts/compare-gatsby-extract.ts

Writes: - scripts/.compare-out/previous.txt: raw pdf-parse text. -
scripts/.compare-out/margins.txt: after page margin filtering. -
scripts/.compare-out/next.txt: after story cleanup.

Inspect and preserve or extend this script as appropriate.
3. Main Risks to Address
P0: Aggressive fixed-margin removal
Dropping all text in the top and bottom 8% can remove valid chapter
headings or narrative lines. It can also fail to remove headers that sit
outside those margins.

Required direction: Treat page position as a signal for identifying
candidate headers/footers, not as sufficient evidence for deletion.
Combine position with repetition, text similarity, formatting, and
page-number patterns where those signals are available.

Do not remove all text from a region automatically unless there is
strong, tested evidence that doing so is safe for the supported document
types.
P0: Repeated-line removal can delete narrative
A line repeated on 3 or more pages may be a refrain, repeated dialogue,
a quotation, a poem, or another intentional narrative element.

Required direction: Do not remove repeated lines solely because they
recur across pages. Restrict automatic removal to high-confidence
running header/footer or page-artifact candidates. Preserve repeated
text in the narrative body by default.
P0: Front-matter detection is too narrow
Using the first Chapter 1 or Chapter IV heading as the sole story
boundary can discard a prologue or other meaningful content, miss
Chapter One, and fail on books with unnumbered chapters or different
structures.

Required direction: Implement conservative, section-aware detection.
Recognize common structural markers where feasible, but do not assume
every book follows one convention. Apply an explicit inclusion policy.
Preserve a prologue by default. Treat introductions and supplementary
sections according to clear policy and evidence; do not discard
ambiguous sections automatically.
P1: The 500-word gate is not a quality check
Keep a minimum-size check if it is needed by product requirements, but
separate it from extraction-quality validation. Do not treat a word
count above 500 as evidence that the story was extracted correctly.
P1: Missing pages can go unnoticed
A failed page currently becomes empty and is skipped. This may be
acceptable for some blank pages, but a page with extraction failure
inside a chapter can cause silent information loss.

Required direction: Preserve page-level extraction status and report
unexpected empty or failed pages. Do not necessarily reject every empty
page; distinguish legitimate blank/image pages from suspicious gaps.
P1: Chapter detection and fallback semantics
A 3,000-word fallback section is not necessarily a real chapter.
Preserve current consumer compatibility but make the segmentation method
observable if this can be done without disproportionate schema changes.
Prefer paragraph boundaries for fallback splitting where feasible.
4. Required Workflow for the Coding Agent
Step 1: Inspect before editing
Inspect at minimum:
- src/lib/pdf/pageText.ts
- src/lib/pdf/storyText.ts
- src/lib/pdf/chapters.ts
- extractPdfText and its callers
- prepareJobFromUpload
- POST /api/jobs
- scripts/compare-gatsby-extract.ts
- Relevant tests, database schema, and downstream annotation/synthesis
  readers
- The actual pdf-parse version and how page-level coordinates are
  obtained
Document the current behavior and important assumptions. Confirm the
real data shape before changing coordinate logic.
Step 2: Establish a baseline
Run existing tests and the Gatsby comparison script. Record the current
outputs and any known failures before editing.

If the repository contains additional representative PDFs, use them. Do
not assume Gatsby is representative of all novels.
Step 3: Add regression fixtures first
Create focused tests for the current failure modes before changing
behavior. At minimum, cover:
1. A repeated running header.
2. Page numbers in footer positions.
3. A repeated sentence in the narrative body.
4. A prologue before Chapter 1.
5. Chapter One and other common heading variants.
6. A novel with no explicit chapter headings.
7. A narrative line close to the top or bottom page edge.
8. A page with no extracted text between valid pages.
9. A document with front matter and a valid story.
10. A document whose text is below the 500-word threshold.
11. Empty/invalid PDFs and text extraction failure.
12. Fallback section splitting.
Tests should assert specific expected behavior, not merely that a
function does not throw.
Step 4: Implement conservative filtering
- Keep the extraction stage separate from content selection.
- Where feasible, retain page number and block/line provenance through
  filtering.
- Detect repeated headers/footers using multiple signals.
- Avoid deleting narrative text based only on frequency, position,
  short length, or numeric appearance.
- Keep a clear reason for each automatic exclusion, at least in
  diagnostics or testable internal results.
- Use an explicit "unknown/ambiguous" path where useful. Ambiguous
  content should be preserved by default or flagged, not silently
  discarded.
- Avoid introducing an LLM call into the main upload path for this
  iteration unless necessary and approved.
Step 5: Improve section and chapter detection
- Add common chapter heading variants only when tests demonstrate the
  expected behavior.
- Avoid false positives where chapter-like words occur inside
  narrative text.
- Preserve prologues and other included story sections.
- Do not treat the absence of a recognized heading as proof that all
  text is story content.
- Keep fallback segmentation compatible with current downstream
  consumers.
- If adding metadata such as segmentationMethod, inspect schema and
  consumers first and make the smallest compatible change.
Step 6: Add diagnostics and quality checks
For each processing stage, where practical, record:
- Input and output word counts.
- Number of pages extracted, empty, or failed.
- Number of lines/blocks excluded by each rule.
- Number of detected sections and chapters.
- Whether fallback segmentation was used.
- Processing duration.
- Any suspiciously large text reduction or internal gap.
A sudden large reduction should flag a document for investigation rather
than automatically reject it based on an arbitrary universal threshold.

Keep logging structured and avoid logging full copyrighted novel text or
unnecessarily large text excerpts in production logs.
Step 7: Verify downstream compatibility
Confirm that:
- books metadata is still populated correctly.
- chapters rows retain the fields downstream consumers expect.
- Annotation and synthesis continue to read stored chapters.
- prepareJobFromUpload does not cause redundant extraction.
- Existing API response/error conventions remain compatible or are
  deliberately updated with tests.
- The original PDF remains available and unchanged.
Step 8: Run the full test suite and report results
Run relevant unit/integration tests, type checking, linting, and the
comparison script. Report any commands that could not be run and why. Do
not claim tests passed unless they were actually executed.
5. Suggested Internal Design (Adapt to the Existing Code)
Do not introduce a large new framework. Prefer small, typed functions
and minimal changes.

Potential stages:
extractPdfPages()
    -> page text/items and extraction status

identifyPageArtifacts()
    -> candidate header/footer/page-number decisions

detectStorySections()
    -> candidate sections and boundaries

applyStoryInclusionPolicy()
    -> cleaned story text plus diagnostics

splitChapters()
    -> chapters with source ordering preserved

validateExtraction()
    -> quality diagnostics and warnings
These are conceptual names, not mandatory APIs. Reuse existing functions
and naming conventions where possible.

If current parser output cannot support reliable block-level provenance,
document that limitation and implement the best safe improvement
possible without a wholesale parser migration.

Do not add a new PDF library just for architectural neatness. First
establish, using tests and measurements, whether the current pdf-parse
integration is the source of the failures.
6. Quality Metrics and Acceptance Criteria
Use a small, manually verified test corpus. Do not present illustrative
targets as measured performance.
Functional acceptance criteria
- Narrative text is not deleted solely because it repeats on multiple
  pages.
- Text is not deleted solely because it lies in the top/bottom 8% of a
  page.
- A prologue before Chapter 1 is retained under the default story
  policy.
- Supported chapter heading variants have explicit tests.
- Failed/empty page extraction is observable and does not silently
  disappear from diagnostics.
- Every excluded item can be explained by a rule or policy in
  tests/diagnostics.
- Chapter order and chapter body boundaries are preserved.
- Fallback chunks remain distinguishable from confidently detected
  chapters where feasible.
- Existing downstream consumers and the upload/worker contract
  continue to work.
- No unnecessary OCR, LLM, queue, database, or infrastructure
  dependency is introduced.
Evaluation metrics
Where a manually verified reference is available, calculate:

Content precision relevant content retained / all content retained

Content recall
relevant content retained / all relevant reference content

Also measure:
- Chapter-boundary accuracy.
- Text fidelity against the reference.
- Pages with empty/failed extraction.
- Percentage of text removed by each filtering rule.
- Processing time per PDF.
Do not claim a target such as 99% precision or 99.5% recall without
evaluating a representative, manually verified corpus. Prioritize
avoiding lost narrative text, while also tracking irrelevant content
that survives.
Definition of done
The work is complete when:
1. The agent has inspected the actual repository and confirmed the
   implementation details.
2. Regression tests cover the identified failure modes.
3. Filtering behavior is safer and test-backed.
4. Diagnostics expose suspicious extraction loss and page failures.
5. Existing upload, persistence, worker, annotation, and synthesis
   flows remain compatible.
6. The full relevant test/typecheck/lint commands have been run where
   available.
7. A concise implementation report lists changed files, behavior
   changes, test commands/results, known limitations, and suggested
   next steps.
7. Scope Boundaries
Unless repository evidence requires otherwise, do not:
- Rewrite the whole PDF pipeline.
- Migrate the application from TypeScript/Node.js to Python.
- Add OCR support in this iteration.
- Add an LLM to every PDF or page.
- Build a distributed processing system or introduce a queue solely
  for this task.
- Change database schemas without demonstrating the need and checking
  all consumers.
- Change the product's definition of a valid audiobook source without
  confirming existing requirements.
- Remove the original PDF or make irreversible transformations to it.
- Automatically discard ambiguous introductory, supplementary, or
  narrative content.
If a larger change appears necessary, explain the evidence, propose the
smallest safe change, and separate it from the required work.
8. Final Report Format
When finished, report:
1. Findings: Confirmed failure modes in the original
   implementation.
2. Changes: Files changed and the reason for each change.
3. Behavior: What is now included/excluded and how uncertain cases
   behave.
4. Tests: Exact commands run and their actual results.
5. Quality evidence: Results on the golden/fixture corpus; clearly
   distinguish measured values from estimates.
6. Compatibility: Confirmation of upload, persistence, worker,
   annotation, and synthesis behavior.
7. Limitations: Remaining risks, including scanned PDFs and
   unsupported layout cases.
8. Next steps: Only the highest-value follow-up work.
Work incrementally. Prefer a small, tested improvement over a broad
rewrite.