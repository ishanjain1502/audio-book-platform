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
