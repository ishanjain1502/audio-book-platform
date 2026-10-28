# Compact Fish TTS reference list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each Fish `POST /v1/tts` call sends one `reference_id` slot per voice that speaks in that text chunk, and rewrites `<|speaker:N|>` so it matches the shorter list.

**Architecture:** A pure function, `compactFishRequest`, turns one chunk plus the full voice list into the text and `reference_id` array to post. `synthesize` calls it after the 2000-character split and before `fetch`. `CompactRequestError` extends `FatalFishError` so a bad speaker index fails once: no retry, and no second attempt on the fallback model.

**Tech Stack:** TypeScript, Vitest, the existing `fetch` call in `src/lib/fish/synthesize.ts`.

## Global Constraints

- Compact inside `synthesize`, after the text is split into chunks and before the HTTP call. Primary and fallback models both use the compacted body.
- Keep voice ids referenced by speaker tags in that chunk, in order of first appearance.
- The same voice id appears once. Later tags that use it are rewritten to the slot already assigned.
- Omit unused voices. The full list from `referenceIdsInOrder` stays on the job and is filtered per chunk.
- A chunk with no speaker tag sends only `referenceIds[0]` and leaves the text unchanged. It does not inherit the speaker from the previous slice.
- A speaker index with no voice throws `FatalFishError` before the HTTP call. The message names the index. Do not guess a voice.
- An empty `referenceIds` array throws `FatalFishError` before the HTTP call.
- Pause tags, direction tags, and the spoken words stay as written. Only the speaker-tag numbers change.
- Retry and model fallback do not run for a missing speaker index or an empty `referenceIds` array.
- Fish `429` and `5xx` responses stay retryable. Other Fish `4xx` responses stay fatal, including `Reference audio too long`, and those HTTP failures still try the fallback model.
- Do not rebuild the character map, add library voices, change chapter detection, or change `DRAMA3_MODEL` / `FISH_FALLBACK_MODEL`.
- `src/lib/fish/constants.ts` is already dirty in the working tree (`DRAMA3_MODEL` is `s2.1-pro`, while `tests/lib/fish/constants.test.ts` still expects `drama-3`). Leave that file alone. Verify this work with the test files named in each task.

## File structure

- Create `src/lib/fish/compactRequest.ts`. Owns the pure compaction and `CompactRequestError`.
- Create `tests/lib/fish/compactRequest.test.ts`. Unit tests for that function. No HTTP.
- Modify `src/lib/fish/synthesize.ts`. Calls `compactFishRequest` per chunk. Skips model fallback only for `CompactRequestError`.
- Create `tests/lib/fish/synthesizeCompact.test.ts`. Proves the posted body is compacted, that a bad index never calls `fetch`, and that model fallback is skipped only for `CompactRequestError`.

---

### Task 1: Compact one chunk

**Files:**
- Create: `src/lib/fish/compactRequest.ts`
- Test: `tests/lib/fish/compactRequest.test.ts`

**Interfaces:**
- Consumes: `FatalFishError` from `src/lib/fish/retry.ts`.
- Produces:
  - `export class CompactRequestError extends FatalFishError`
  - `export function compactFishRequest(text: string, referenceIds: string[]): { text: string; referenceIds: string[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/fish/compactRequest.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { PUBLIC_VOICE_IDS } from "@/lib/fish/constants";
import { FatalFishError } from "@/lib/fish/retry";
import { compactFishRequest } from "@/lib/fish/compactRequest";

const adrian = PUBLIC_VOICE_IDS.adrian;
const delia = PUBLIC_VOICE_IDS.delia;
const sheila = PUBLIC_VOICE_IDS.sheila;

describe("compactFishRequest", () => {
  it("sends only the voice used by the tags in the chunk", () => {
    const tenSlots = [
      adrian,
      delia,
      sheila,
      adrian,
      adrian,
      adrian,
      adrian,
      adrian,
      adrian,
      adrian,
    ];
    const text =
      "<|speaker:0|> [pause] [measured] Chapter 1[pause] 3";

    expect(compactFishRequest(text, tenSlots)).toEqual({
      text,
      referenceIds: [adrian],
    });
  });

  it("keeps one slot when several tags share a voice, in first-seen order", () => {
    const result = compactFishRequest(
      "<|speaker:0|>Hello <|speaker:3|>there <|speaker:1|>friend",
      [adrian, delia, sheila, adrian],
    );

    expect(result).toEqual({
      text: "<|speaker:0|>Hello <|speaker:0|>there <|speaker:1|>friend",
      referenceIds: [adrian, delia],
    });
  });

  it("orders slots by first appearance, not by the original speaker index", () => {
    const result = compactFishRequest(
      "<|speaker:1|>Nick <|speaker:0|>said",
      [adrian, sheila],
    );

    expect(result).toEqual({
      text: "<|speaker:0|>Nick <|speaker:1|>said",
      referenceIds: [sheila, adrian],
    });
  });

  it("leaves already-dense distinct voices unchanged", () => {
    const text = "<|speaker:0|>A <|speaker:1|>B <|speaker:2|>C";
    expect(compactFishRequest(text, [adrian, delia, sheila])).toEqual({
      text,
      referenceIds: [adrian, delia, sheila],
    });
  });

  it("sends the narrator voice when the chunk has no speaker tag", () => {
    const text = "Just narration.";
    expect(compactFishRequest(text, [adrian, delia])).toEqual({
      text,
      referenceIds: [adrian],
    });
  });

  it("throws FatalFishError naming a speaker index that has no voice", () => {
    expect(() => compactFishRequest("<|speaker:4|>Hi", [adrian])).toThrow(
      FatalFishError,
    );
    expect(() => compactFishRequest("<|speaker:4|>Hi", [adrian])).toThrow(
      /4/,
    );
  });

  it("throws FatalFishError when referenceIds is empty", () => {
    expect(() => compactFishRequest("<|speaker:0|>Hi", [])).toThrow(
      FatalFishError,
    );
    expect(() => compactFishRequest("No tag", [])).toThrow(/empty/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/lib/fish/compactRequest.test.ts`

Expected: FAIL because `src/lib/fish/compactRequest.ts` does not exist (`Cannot find module` or failed to resolve import).

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/fish/compactRequest.ts`:

```typescript
import { FatalFishError } from "@/lib/fish/retry";

export class CompactRequestError extends FatalFishError {
  constructor(message: string) {
    super(message);
    this.name = "CompactRequestError";
  }
}

export function compactFishRequest(
  text: string,
  referenceIds: string[],
): { text: string; referenceIds: string[] } {
  if (referenceIds.length === 0) {
    throw new CompactRequestError("referenceIds is empty");
  }

  if (!/<\|speaker:\d+\|>/.test(text)) {
    const narrator = referenceIds[0];
    if (!narrator) {
      throw new CompactRequestError("Speaker index 0 has no voice");
    }
    return { text, referenceIds: [narrator] };
  }

  const compact: string[] = [];
  const slotByVoice = new Map<string, number>();
  const rewritten = text.replace(
    /<\|speaker:(\d+)\|>/g,
    (_match, indexText: string) => {
      const index = Number(indexText);
      const voiceId = referenceIds[index];
      if (!voiceId) {
        throw new CompactRequestError(`Speaker index ${index} has no voice`);
      }
      let slot = slotByVoice.get(voiceId);
      if (slot === undefined) {
        slot = compact.length;
        compact.push(voiceId);
        slotByVoice.set(voiceId, slot);
      }
      return `<|speaker:${slot}|>`;
    },
  );

  return { text: rewritten, referenceIds: compact };
}
```

Create the speaker regex inside the call. A shared `/g` regex keeps `lastIndex`, and a throw inside `replace` would leave that index non-zero for the next call. Do not reuse `SPEAKER_TAG_RE` from `constants.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/lib/fish/compactRequest.test.ts`

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fish/compactRequest.ts tests/lib/fish/compactRequest.test.ts
git commit -m "$(cat <<'EOF'
Compact each Fish TTS chunk to the voices it uses.

EOF
)"
```

---

### Task 2: Post the compacted body and skip fallback for compact errors

**Files:**
- Modify: `src/lib/fish/synthesize.ts`
- Test: `tests/lib/fish/synthesizeCompact.test.ts`

**Interfaces:**
- Consumes: `compactFishRequest` and `CompactRequestError` from `src/lib/fish/compactRequest.ts`.
- Produces: `synthesize` posts `compactFishRequest(chunk, referenceIds)` for each split chunk. `synthesizeWithFallback` rethrows `CompactRequestError` and still falls back for every other error, including `FatalFishError` from a Fish HTTP 4xx.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/fish/synthesizeCompact.test.ts`:

```typescript
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FALLBACK_MODEL,
  DRAMA3_MODEL,
  MAX_ANNOTATED_CHARS,
  PUBLIC_VOICE_IDS,
} from "@/lib/fish/constants";
import { CompactRequestError } from "@/lib/fish/compactRequest";
import { FatalFishError } from "@/lib/fish/retry";
import { synthesize, synthesizeWithFallback } from "@/lib/fish/synthesize";

const adrian = PUBLIC_VOICE_IDS.adrian;
const delia = PUBLIC_VOICE_IDS.delia;

describe("synthesize compacted reference list", () => {
  const prevDataDir = process.env.DATA_DIR;
  const prevFallback = process.env.FISH_FALLBACK_MODEL;
  let dir: string;

  afterEach(() => {
    process.env.DATA_DIR = prevDataDir;
    if (prevFallback === undefined) delete process.env.FISH_FALLBACK_MODEL;
    else process.env.FISH_FALLBACK_MODEL = prevFallback;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("posts one slot per voice and the rewritten speaker tags", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fish-compact-"));
    process.env.DATA_DIR = dir;
    const fetchMock = vi.fn(
      async () => new Response(Uint8Array.from([1, 2, 3]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await synthesize({
      annotatedText:
        "<|speaker:0|>Hello <|speaker:3|>there <|speaker:1|>friend",
      referenceIds: [adrian, delia, PUBLIC_VOICE_IDS.sheila, adrian],
      model: "s2.1-pro",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      text: "<|speaker:0|>Hello <|speaker:0|>there <|speaker:1|>friend",
      reference_id: [adrian, delia],
      format: "mp3",
    });
  });

  it("does not call Fish when the speaker index has no voice", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      synthesize({
        annotatedText: "<|speaker:4|>Hi",
        referenceIds: [adrian],
        model: "s2.1-pro",
      }),
    ).rejects.toBeInstanceOf(CompactRequestError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not try the fallback model for a compact error", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      synthesizeWithFallback({
        annotatedText: "<|speaker:4|>Hi",
        referenceIds: [adrian],
      }),
    ).rejects.toBeInstanceOf(FatalFishError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the narrator for a later slice that has no speaker tag", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fish-compact-"));
    process.env.DATA_DIR = dir;
    const fetchMock = vi.fn(
      async () => new Response(Uint8Array.from([1]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await synthesize({
      annotatedText: `<|speaker:1|>${"x".repeat(MAX_ANNOTATED_CHARS)}`,
      referenceIds: [adrian, delia],
      model: "s2.1-pro",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    );
    const second = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    );
    expect(first.reference_id).toEqual([delia]);
    expect(first.text.startsWith("<|speaker:0|>")).toBe(true);
    expect(second.reference_id).toEqual([adrian]);
    expect(second.text).not.toContain("<|speaker:");
  });

  it("still tries the fallback model when Fish returns 400", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fish-compact-"));
    process.env.DATA_DIR = dir;
    delete process.env.FISH_FALLBACK_MODEL;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Reference audio too long" }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([9]), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await synthesizeWithFallback({
      annotatedText: "<|speaker:0|>Hello",
      referenceIds: [adrian, delia],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    const secondHeaders = (fetchMock.mock.calls[1][1] as RequestInit)
      .headers as Record<string, string>;
    expect(firstHeaders.model).toBe(DRAMA3_MODEL);
    expect(secondHeaders.model).toBe(DEFAULT_FALLBACK_MODEL);
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({
        text: "<|speaker:0|>Hello",
        reference_id: [adrian],
        format: "mp3",
      });
    }
  });
});
```

`delete process.env.FISH_FALLBACK_MODEL` makes the second call use `DEFAULT_FALLBACK_MODEL` from code, not a value left in the shell. The call count is the assertion that a Fish 400 still falls back. Both bodies must already be compacted. Do not change `constants.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/lib/fish/synthesizeCompact.test.ts`

Expected: FAIL.

- The first test fails because `reference_id` is still the full four-id list and the text still contains `<|speaker:3|>`.
- The later-slice test fails because both requests still send `[adrian, delia]`, and the second slice does not fall back to the narrator.
- The third test fails because `synthesizeWithFallback` catches `CompactRequestError` and calls `synthesize` again. Both calls throw before `fetch`, so this test can still see `toHaveBeenCalledTimes(0)` and pass for the wrong reason if the second call also throws before `fetch`. Guard that in Step 3 by rethrowing `CompactRequestError` before the fallback call. If Step 2's third test already passes, confirm the failure on the first test before writing implementation. Do not skip Step 3.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/fish/synthesize.ts`, add this import next to the other `@/lib/fish` imports:

```typescript
import {
  CompactRequestError,
  compactFishRequest,
} from "@/lib/fish/compactRequest";
```

Replace the chunk loop inside `synthesize` with:

```typescript
  for (const chunk of chunks) {
    const compacted = compactFishRequest(chunk, input.referenceIds);
    const buf = await retryWithBackoff(
      async () => {
        const body = {
          text: compacted.text,
          reference_id: compacted.referenceIds,
          format: "mp3",
        };
        const res = await fetch(`${fishBaseUrl()}/v1/tts`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.FISH_API_KEY ?? ""}`,
            "Content-Type": "application/json",
            model,
          },
          body: JSON.stringify(body),
        });
        const responseText = res.ok ? null : await res.text();
        logFishRequest({
          method: "POST",
          path: "/v1/tts",
          model,
          format: body.format,
          text: body.text,
          reference_id: voiceSlots(body.reference_id),
          status: res.status,
          response: responseText,
        });
        if (res.status === 429 || res.status >= 500) {
          throw new RetryableError(res.status, responseText ?? "");
        }
        if (!res.ok) {
          throw new FatalFishError(responseText ?? "");
        }
        return Buffer.from(await res.arrayBuffer());
      },
      { attempts: 5 },
    );
    buffers.push(buf);
  }
```

`compactFishRequest` runs outside `retryWithBackoff`, so a `CompactRequestError` is thrown once and is not retried.

Replace `synthesizeWithFallback` with:

```typescript
export async function synthesizeWithFallback(input: {
  annotatedText: string;
  referenceIds: string[];
}): Promise<Buffer> {
  try {
    return await synthesize({ ...input, model: DRAMA3_MODEL });
  } catch (err) {
    if (err instanceof CompactRequestError) throw err;
    const fallback =
      process.env.FISH_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL;
    return synthesize({ ...input, model: fallback });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/lib/fish/compactRequest.test.ts tests/lib/fish/synthesizeCompact.test.ts`

Expected: PASS. The compact file still has 7 tests. The synthesize file has 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fish/synthesize.ts tests/lib/fish/synthesizeCompact.test.ts
git commit -m "$(cat <<'EOF'
Send Fish only the voices that speak in each chunk.

EOF
)"
```
