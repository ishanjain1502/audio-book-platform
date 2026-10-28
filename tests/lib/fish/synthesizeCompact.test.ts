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

vi.mock("@/lib/audio/stitch", () => ({
  concatMp3Buffers: (buffers: Buffer[]) => Buffer.concat(buffers),
}));

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
