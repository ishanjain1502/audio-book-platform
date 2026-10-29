# Annotation review before audiobook generation — design spec

**Status:** Approved (2026-10-29)

## Goals

- After book research, show the annotation and let the user review it before any audio is generated.
- Show each finished section on one scrolling page, labeled with the same 1-based section number the generation progress already uses.
- Show each speaker turn as a chat message from that speaker. Let the user change the speaker on a message.
- Collapse a section when the user checks it, and keep that check across a refresh.
- Start the existing generation page only after every section is annotated and checked.

## Non-goals

- A free-form chat with the model, re-annotating a section from the page, or editing the words or pacing tags.
- Changing the generation page at `/jobs/{id}`.
- Changing PDF extraction, research, voice cloning, or the Fish synthesis calls.
- A public token or a new database besides the columns named below.

## Decisions

| Topic | Choice |
| --- | --- |
| Research button | Saves title, author, and page count, then starts annotation. It does not start audio |
| Annotation page | `/jobs/{id}/annotation`, one scroll |
| Section label | `Section {n}` where `n` is `chapters.idx + 1`. When the stored title differs, show that title beside the label |
| When a section appears | Only after every paragraph in that section has a saved `segments` row |
| Chat message | One `<\|speaker:N\|>` turn inside a paragraph. A paragraph can be several messages, in order |
| Edit | Changes that turn's speaker index only. Words and pacing tags stay |
| Reviewed | Checkbox on the section. Checked sections start collapsed. The header opens them again. Unchecking leaves them open |
| Confirm | Enabled only when annotation has finished and every section is checked. Then the existing generation page speaks the saved lines |

## Flow

1. The research page at `/jobs/{id}/review` stays the place for title, author, page count, and the character list. Its button label is **Review annotation**. The button stays disabled until the job is `awaiting_review`, research is ready, the title is non-empty, and the page count is a positive integer.
2. The button saves the book meta, sets the job to `annotating`, starts the annotation worker, and opens `/jobs/{id}/annotation`.
3. The annotation page polls while the job is `annotating`. It shows the 1-based number of the section currently being annotated. Finished sections appear above that notice, in index order.
4. Each finished section is a block titled `Section {n}`. The user can change the speaker on any message in an open section. The change saves immediately.
5. Checking the section sets it reviewed and collapses it to the header. Clicking the header expands it and leaves it checked. Unchecking clears reviewed and leaves the body open.
6. When the last section is saved, the job becomes `awaiting_annotation`. **Confirm and generate audiobook** enables only then, and only when every section is checked.
7. Confirm sets the job to `queued`, starts the synthesis worker, and opens `/jobs/{id}`. That worker speaks the saved annotation and does not call the annotation model.

## Status

| Status | Meaning |
| --- | --- |
| `awaiting_review` | Research page. Annotation has not started |
| `annotating` | Annotation worker is running |
| `awaiting_annotation` | Every section is saved. The user is reviewing |
| `queued` | Confirm has started synthesis |
| `processing`, `stitching`, `done`, `failed` | Unchanged generation outcomes |

`scripts/run-job.ts <id>` with no mode keeps today's full pipeline. New confirms do not use that mode.

- `scripts/run-job.ts <id> annotate` runs annotation only.
- `scripts/run-job.ts <id> synthesize` runs synthesis only and requires a saved annotation for every paragraph.

## Data

`chapters` gains `reviewed INTEGER NOT NULL DEFAULT 0`. `ensureSchema` adds it with the same duplicate-column ignore used for `books`.

A section is complete when the number of `segments` rows for that `job_id` and `chapter_idx` equals the number of paragraphs from `splitIntoParagraphs` on that chapter's text. Each row's `status` is `annotated` and `annotated_text` holds the model output.

Speaker choices are the book's `character_maps` rows: `name` and `speaker_index`. Annotation does not clone a custom voice and does not change those rows. Synthesis keeps today's voice clone and narrator voice-id swap, then reads `annotated_text` from `segments`.

Messages are parsed by splitting `annotated_text` on `<|speaker:N|>`. Text before the first tag, if any, is one message for speaker index 0. Each later tag starts a new message whose text runs until the next tag. The message stores `paragraphIdx`, `turnIdx`, `speakerIndex`, and the text including pacing tags.

Replacing a speaker rebuilds that paragraph's `annotated_text` with the new index on that `turnIdx` only. Every other byte of that paragraph stays unchanged.

## APIs

`POST /api/jobs/{id}/annotate` is the research button and the retry. It accepts the same `{ title, author, pageCount }` body as today's confirm. Title and page count must pass the current meta rules, and `researched_at` must be set. From `awaiting_review`, it writes the meta, sets `annotating`, and spawns `annotate`. A call while `annotating` or `awaiting_annotation` is rejected. If spawning the worker throws, the job is set to `failed` with that error.

`GET /api/jobs/{id}/annotation` returns:

- `status`, `error`
- `currentSection`: the 1-based index of the first incomplete section while `annotating`, otherwise null
- `characters`: `{ name, speakerIndex }[]` from the character map, ordered by `speaker_index`
- `sections`: only complete sections, in index order. Each has `n`, `title`, `reviewed`, and `messages`

`PATCH /api/jobs/{id}/annotation` accepts either:

- `{ chapterIdx, reviewed: boolean }` to set that chapter's flag, or
- `{ chapterIdx, paragraphIdx, turnIdx, speakerIndex }` to replace one speaker tag

The speaker index must be one of the character map indexes. The chapter must already be complete. Both edits are rejected unless the job is `annotating` or `awaiting_annotation`.

`POST /api/jobs/{id}/confirm` remains the audio start, with a new gate. The annotation page sends the title, author, and page count already saved on the book. Confirm writes that meta again, and rejects the call unless the job is `awaiting_annotation`, every section is complete, and every chapter has `reviewed = 1`. It then sets `queued` and spawns `synthesize`. If spawning throws, the job is set to `failed` with that error.

`POST /api/jobs/{id}/annotate` is also the retry. When the job is `failed` and at least the book research is ready, it deletes `segments` rows only for chapters that are not complete, sets `annotating`, and spawns `annotate` again. Complete chapters and their reviewed flags stay.

## Page

`src/app/jobs/[id]/annotation/page.tsx` loads `GET /api/jobs/{id}/annotation` and polls every 2 seconds while `status` is `annotating`.

The in-progress line reads `Annotating section {n}`. Finished sections render in order. A reviewed section renders as the header row until the header is clicked. The checkbox is available as soon as the section appears, including while a later section is still annotating.

Each message shows the character name for its speaker index. An index missing from the map shows `Speaker {n}`. The speaker control lists the character map names. A successful speaker PATCH returns `{ speakerIndex, speakerName }`, and the page shows that speaker on the message. A successful reviewed PATCH returns `{ reviewed }`.

**Confirm and generate audiobook** is disabled until `status` is `awaiting_annotation` and every returned section is reviewed. A failed job shows `error` and a retry that calls `POST /api/jobs/{id}/annotate` again.

## Failure behavior

- Research is not ready: the research button stays disabled, and `POST .../annotate` is rejected.
- Annotation throws: the job becomes `failed` with the error message. Sections already complete stay on the page. Retry continues at the first incomplete section after deleting that section's partial rows.
- Speaker index outside the map, or an edit to an incomplete section: rejected, and the saved text stays.
- Confirm while any section is incomplete or unchecked: rejected, and no synthesis worker starts.
- Synthesis failure: the generation page shows it, as it does today. The annotation rows stay.

## Testing

Unit tests only. No live model call and no live Fish call.

- A section is complete only when its segment count equals its paragraph count.
- Replacing turn 1's speaker changes that `<|speaker:N|>` and leaves every other byte of the paragraph.
- A speaker index outside the map is rejected.
- `POST .../annotate` from `awaiting_review` sets `annotating` and does not spawn synthesis.
- Confirm from `awaiting_annotation` is rejected until every chapter is reviewed, and a passing confirm spawns synthesis only.
- Retry deletes segments for incomplete chapters and leaves complete chapters in place.
