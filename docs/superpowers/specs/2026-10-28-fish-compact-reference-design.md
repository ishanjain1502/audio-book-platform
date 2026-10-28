# Compact Fish TTS reference list — design spec

**Status:** Approved (2026-10-28)

## Goals

- Each `POST /v1/tts` call sends only the voices that speak in that text chunk.
- The same voice id appears once in `reference_id`, even when several speaker tags share it.
- Speaker tags in that chunk are rewritten so `<|speaker:N|>` matches `reference_id[N]`.

## Non-goals

- Rebuilding or deduplicating the cached character map.
- Adding voices to the library.
- Changing chapter detection, including table-of-contents lines treated as chapters.
- Changing which Fish model is selected, or the fallback from `s2.1-pro` to `s2.1-pro-free`.

## Decisions

| Topic | Choice |
| --- | --- |
| Where | Inside `synthesize`, after the text is split into chunks and before the HTTP call. Primary and fallback models both use the compacted body. |
| Which voices | Voice ids referenced by speaker tags in that chunk, in order of first appearance. |
| Duplicate voice ids | One slot. Later tags that use the same id are rewritten to the slot already assigned. |
| Unused voices | Omitted. The full list from `referenceIdsInOrder` stays on the job and is filtered per chunk. |
| No speaker tag | Send only `referenceIds[0]` and leave the text unchanged. |
| Speaker index with no voice | Throw `FatalFishError` before the HTTP call. Do not guess a voice. |
| Empty `referenceIds` | Throw `FatalFishError` before the HTTP call. |
| Other text | Pause tags, direction tags, and the spoken words stay as written. Only the speaker-tag numbers change. |

## Request shape

`referenceIds` is still the full ordered list for the book: index `N` is the voice for the original `<|speaker:N|>`.

For one chunk:

1. Walk `<|speaker:N|>` tags from left to right.
2. Resolve `N` to `referenceIds[N]`.
3. If that voice id is new, append it. If it is already in the compact list, reuse that position.
4. Replace the tag with `<|speaker:K|>`, where `K` is the position in the compact list.
5. Post `text` as the rewritten chunk and `reference_id` as the compact list. `format` stays `"mp3"`.

Examples:

- Job 13's contents line uses only speaker 0 (Adrian), while the job list has ten slots and eight of them are Adrian. The call sends `[Adrian]` and `<|speaker:0|>`.
- A chunk tagged speaker 0 (Adrian), speaker 3 (Adrian), then speaker 1 (Delia) sends `[Adrian, Delia]`. The tags become `<|speaker:0|>`, `<|speaker:0|>`, `<|speaker:1|>`.
- Narrator, Gatsby, and Nick on three different voices, already indexes 0, 1, and 2, stay three ids and those same indexes.

A chunk produced by the 2000-character split that contains no speaker tag uses the narrator voice, `referenceIds[0]`. It does not inherit the speaker from the previous slice.

## Error handling

- A tag whose index is missing from `referenceIds` fails that synthesis call with `FatalFishError`. The message names the index. Retry and model fallback do not run for this error.
- An empty `referenceIds` array fails the same way.
- Fish `429` and `5xx` responses stay retryable. Other Fish `4xx` responses stay fatal, including `Reference audio too long`.

## Testing

Unit tests cover the pure compact function, with no HTTP call:

- Only the voices that appear are returned, in first-seen order.
- A repeated voice id occupies one slot, and every tag that used it shares that slot.
- Text outside the speaker tags is unchanged.
- A chunk with no speaker tag returns `[referenceIds[0]]` and the original text.
- An out-of-range speaker index throws `FatalFishError`.
- An empty `referenceIds` array throws `FatalFishError`.
