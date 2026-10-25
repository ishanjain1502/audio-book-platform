import { describe, expect, it } from "vitest";
import { isVerbatimParagraph } from "@/lib/annotate/verbatim";

describe("isVerbatimParagraph", () => {
  it("accepts tagged verbatim text", () => {
    const original = "Hello world.";
    const annotated = "<|speaker:0|>[calm] Hello world.";
    expect(isVerbatimParagraph(original, annotated)).toBe(true);
  });

  it("accepts pause and slow tags without changing words", () => {
    const original = "She stopped. Then she spoke.";
    const annotated =
      "<|speaker:0|>[measured] She stopped.[pause] Then <slow>she spoke</slow>.";
    expect(isVerbatimParagraph(original, annotated)).toBe(true);
  });

  it("rejects paraphrase", () => {
    expect(
      isVerbatimParagraph("Hello world.", "<|speaker:0|>Hello universe."),
    ).toBe(false);
  });
});
