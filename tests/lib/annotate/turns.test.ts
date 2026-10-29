import { describe, expect, it } from "vitest";
import {
  AnnotationTurnError,
  parseAnnotationTurns,
  replaceSpeakerTurn,
} from "@/lib/annotate/turns";

describe("parseAnnotationTurns", () => {
  it("splits speaker tags and keeps pacing text on the turn", () => {
    expect(
      parseAnnotationTurns("<|speaker:0|>Hello [pause]<|speaker:1|>there"),
    ).toEqual([
      { speakerIndex: 0, text: "Hello [pause]" },
      { speakerIndex: 1, text: "there" },
    ]);
  });

  it("treats text before the first tag as speaker 0", () => {
    expect(parseAnnotationTurns("Hello <|speaker:1|>there")).toEqual([
      { speakerIndex: 0, text: "Hello " },
      { speakerIndex: 1, text: "there" },
    ]);
  });
});

describe("replaceSpeakerTurn", () => {
  it("changes turn 1 and leaves every other byte", () => {
    const annotated = "<|speaker:0|>Hello [pause]<|speaker:1|>there";
    expect(replaceSpeakerTurn(annotated, 1, 2)).toBe(
      "<|speaker:0|>Hello [pause]<|speaker:2|>there",
    );
  });

  it("rejects a missing turn and a tagless leading turn", () => {
    expect(() => replaceSpeakerTurn("<|speaker:0|>Hi", 3, 1)).toThrow(AnnotationTurnError);
    expect(() => replaceSpeakerTurn("Hello <|speaker:1|>there", 0, 2)).toThrow(
      AnnotationTurnError,
    );
  });
});
