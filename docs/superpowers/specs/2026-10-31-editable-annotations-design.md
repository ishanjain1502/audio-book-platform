# Editable annotation lines — design spec

**Status:** Draft, awaiting review (2026-10-31)

## Goals

- Let the user edit the words of an annotation line, including the delivery tags already in that line.
- Let the user add a line, delete a line, or split a line at the cursor.
- Keep each change inside the paragraph that already holds the line.
- Show delivery tags as capsules while a line is closed, and as plain text while it is open.
- Save by rewriting that paragraph’s lines in one write.

## Non-goals

- Creating, deleting, or rebreaking PDF paragraphs. Segment rows stay one per paragraph.
- Merging two lines.
- A rich editor where the capsules are the thing being edited.
- Re-annotating a section with the model.
- Changing the research page, the generation page, PDF extraction, voice cloning, or the Fish synthesis calls.
- A new database column.

## Decisions

| Topic | Choice |
| --- | --- |
| Saved unit | One paragraph. The page sends every line of that paragraph, and the server replaces its `annotated_text` |
| Line | One speaker turn. Several lines can share a paragraph |
| Storage | Each line is stored as `<\|speaker:N\|>` immediately followed by its text. Lines are concatenated with no extra separator |
| Delivery tags | Stay in the line string: `[pause]`, `[measured]`, `<slow>…</slow>`, and the same kinds of tags |
| Closed line | Those tags render as capsules. The tag characters stay visible |
| Open line | A normal text box. The same string shows the tags as text |
| Add | Inserts an empty line after the current line, with the same speaker, then opens that new line |
| Split | Available only while that line’s text box is open. Text before the cursor stays. Text after the cursor becomes the next line, with the same speaker. The editor then closes |
| Delete | Removes that line. Unavailable when the paragraph has only one line |
| Last line | A paragraph always keeps at least one line |
| Empty line | Allowed while reviewing. A line is empty when `text.trim()` is empty. The stored text is saved as submitted, including spaces |
| Confirm | Stays disabled until every line has text and every section is checked. The confirm request rejects an empty line |
| Reviewed | Editing a line does not change the section’s reviewed flag |
| Speaker dropdown | Uses the same paragraph write. An open draft is included |

## Saved text

`serializeAnnotationTurns` in `src/lib/annotate/turns.ts` accepts `{ speakerIndex: number; text: string }[]` and returns the concatenated tags. Speaker 0 gets an explicit tag, the same as every other speaker. An empty line is a tag with nothing after it:

`<|speaker:0|>One [pause]<|speaker:1|>`

A paragraph whose turns already start with explicit speaker tags parses and serializes back to the same string. A leading narrator stretch that was stored without a tag gains `<|speaker:0|>` the first time that paragraph is rewritten.

`replaceParagraphTurns` in `src/lib/jobs/updateAnnotation.ts` writes that string onto the existing `segments` row for `chapterIdx` and `paragraphIdx`. It does not insert or delete segment rows.

## API

`PATCH /api/jobs/{id}/annotation` gains this body, beside the existing reviewed and speaker bodies:

```json
{ "chapterIdx": 0, "paragraphIdx": 0, "turns": [{ "speakerIndex": 0, "text": "One [pause]" }] }
```

When `chapterIdx`, `paragraphIdx`, and a `turns` array are all present, this is the paragraph write. The route does not also apply `reviewed` or the single-turn speaker update from that request. The existing speaker body and reviewed body stay valid. The annotation page uses the paragraph write for text, add, split, delete, and speaker changes.

Checks run in this order. The first failure is the response, and the request does not fall through to the reviewed or speaker update.

- The job exists. A missing job is 404 “Job not found”.
- The job is `annotating` or `awaiting_annotation`. Otherwise 409 “Annotation is not open for review”.
- `chapterIdx` and `paragraphIdx` are integers, `turns` has at least one entry, every `text` is a string, and every `speakerIndex` is an integer. An empty list is 400 “A paragraph must have a line”. Any other break in this check is 400 “Invalid line”.
- No line contains `<|speaker:`. Otherwise 400 “A line cannot contain a speaker tag”.
- The chapter exists. A missing chapter is 404 “Job not found”.
- The section is already complete. Otherwise 409 “Section is not ready”.
- Every `speakerIndex` is in that book’s character map. Otherwise 400 “Unknown speaker”.
- The paragraph’s segment row exists. A missing row is 404 “Segment not found”.

A successful response is:

```json
{
  "paragraphIdx": 0,
  "turns": [{ "turnIdx": 0, "speakerIndex": 0, "speakerName": "Nick", "text": "One [pause]" }]
}
```

`turnIdx` is the index in that array. After a successful text save, add, split, or delete, the page replaces the messages for that `paragraphIdx` with this list. A successful speaker change updates that line’s speaker index and name and leaves the open draft in place.

`canGenerateAudiobook` takes `linesHaveText`. Confirm computes it by parsing every segment with `parseAnnotationTurns`. It is false when any segment has no turns, or any turn has empty trimmed text. The checks stay in this order: title, page count, annotation ready, every section checked, then every line has text. The new failure reason is “Every line must have text”.

## Page

`src/app/jobs/[id]/annotation/page.tsx` keeps the section list, the reviewed checkbox, and the speaker dropdown.

A closed line shows the speaker name, the dropdown, and the text. `splitDeliveryTags` in `src/lib/annotate/deliveryTags.ts` splits that text into text tokens and tag tokens, scanning left to right and taking the earliest non-overlapping match. A tag token is a complete bracket tag, `[` plus one or more characters that are not brackets or newlines plus `]`, or a complete paired tag whose name is one or more ASCII letters and whose closing name matches the opening name exactly. Incomplete markup stays a text token. Each tag token renders inline as a capsule sized for the surrounding line: rounded full shape, accent text, an accent-tinted background, and an accent-colored border, using the active status badge colors. Clicking the text opens the text box.

The text box is a textarea labeled with the speaker name. Enter inserts a newline. Leaving the field saves when the string differs from the saved text. A successful save closes the editor and shows the returned lines. A failed save leaves the box open and shows the error under the list.

The two-second refresh keeps running while a line is open. It updates status, other paragraphs, and other sections. It does not replace the paragraph that contains the open editor.

Add, Split, and Delete sit on the line. Each one builds a line list from the paragraph’s saved lines, uses the open draft as that line’s text when the box is open, applies its own change, and sends one paragraph write. The control keeps the text box from blurring, so the blur save does not send a second write. Add inserts the empty line after the current line. Split replaces the current line with the two cursor pieces. Delete removes the current line. Add, after a successful write, opens the new empty line. Split and Delete, after a successful write, close the editor. A failed action shows the error and leaves the draft in place.

The speaker dropdown sends that same list with the chosen speaker on the current line. A successful change keeps the text box open and keeps the draft text. Confirm and generate audiobook stays disabled while `status` is not `awaiting_annotation`, any section is unchecked, any displayed line is empty, or a save is in flight.

## Failures

| Condition | Status | Error | Stored text |
| --- | --- | --- | --- |
| Unknown job or chapter | 404 | Job not found | Unchanged |
| Unknown paragraph | 404 | Segment not found | Unchanged |
| Invalid paragraph write | 400 | Invalid line | Unchanged |
| Job is not `annotating` or `awaiting_annotation` | 409 | Annotation is not open for review | Unchanged |
| Section is incomplete | 409 | Section is not ready | Unchanged |
| Speaker index is missing from the character map | 400 | Unknown speaker | Unchanged |
| `turns` is empty | 400 | A paragraph must have a line | Unchanged |
| A line contains `<\|speaker:` | 400 | A line cannot contain a speaker tag | Unchanged |
| Confirm while any line is empty | 409 | Every line must have text | Unchanged, and synthesis does not start |

A split at the start or end of the text is allowed. It creates an empty line, and Confirm stays disabled until that line has text.

## Testing

Unit tests only. No browser test, no live model call, and no live Fish call.

- `splitDeliveryTags` marks `[pause]`, `[measured]`, and `<slow>word</slow>` as tag tokens, and leaves the surrounding words as text tokens. An unclosed `<slow>` stays text.
- Serializing lines writes an explicit `<|speaker:N|>` on every line, including an empty line.
- A paragraph that already uses explicit speaker tags parses and serializes to the same string.
- `replaceParagraphTurns` writes that text and returns the speaker names.
- The write is rejected for an empty line list, an invalid line, an unknown speaker, a line that contains `<|speaker:`, an incomplete section, and a job that is not open for review. The stored text is unchanged in each case.
- Confirm is rejected with “Every line must have text” when any saved line is empty, and the synthesis worker is not spawned.
- The existing speaker-change and reviewed-checkbox tests still pass.
