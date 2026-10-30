import { describe, expect, it } from "vitest";
import {
  addLine,
  changeSpeaker,
  deleteLine,
  replaceParagraphMessages,
  retainOpenParagraph,
  splitLine,
  withDraft,
} from "@/lib/annotate/editLines";

const lines = [
  { speakerIndex: 0, text: "Hello [pause] there" },
  { speakerIndex: 1, text: "Yes" },
];

describe("editLines", () => {
  it("overlays a draft onto one line and leaves the saved lines when there is no draft", () => {
    expect(withDraft(lines, 0, "Hello friend")).toEqual([
      { speakerIndex: 0, text: "Hello friend" },
      { speakerIndex: 1, text: "Yes" },
    ]);
    expect(withDraft(lines, 0, null)).toEqual(lines);
  });

  it("adds an empty line after the current line with the same speaker", () => {
    expect(addLine(lines, 0)).toEqual([
      { speakerIndex: 0, text: "Hello [pause] there" },
      { speakerIndex: 0, text: "" },
      { speakerIndex: 1, text: "Yes" },
    ]);
  });

  it("splits at the cursor, including a split that leaves an empty side", () => {
    expect(splitLine(lines, 0, 6)).toEqual([
      { speakerIndex: 0, text: "Hello " },
      { speakerIndex: 0, text: "[pause] there" },
      { speakerIndex: 1, text: "Yes" },
    ]);
    expect(splitLine(lines, 1, 0)).toEqual([
      { speakerIndex: 0, text: "Hello [pause] there" },
      { speakerIndex: 1, text: "" },
      { speakerIndex: 1, text: "Yes" },
    ]);
  });

  it("deletes a line and refuses to delete the last line", () => {
    expect(deleteLine(lines, 1)).toEqual([
      { speakerIndex: 0, text: "Hello [pause] there" },
    ]);
    expect(deleteLine([{ speakerIndex: 0, text: "Only" }], 0)).toBeNull();
  });

  it("changes one speaker", () => {
    expect(changeSpeaker(lines, 1, 2)).toEqual([
      { speakerIndex: 0, text: "Hello [pause] there" },
      { speakerIndex: 2, text: "Yes" },
    ]);
  });

  it("keeps the open paragraph during a refresh and replaces one paragraph after a save", () => {
    const previous = [
      { paragraphIdx: 0, turnIdx: 0, text: "draft" },
      { paragraphIdx: 1, turnIdx: 0, text: "old" },
    ];
    const incoming = [
      { paragraphIdx: 0, turnIdx: 0, text: "server" },
      { paragraphIdx: 1, turnIdx: 0, text: "fresh" },
    ];
    expect(retainOpenParagraph(previous, incoming, 0)).toEqual([
      { paragraphIdx: 0, turnIdx: 0, text: "draft" },
      { paragraphIdx: 1, turnIdx: 0, text: "fresh" },
    ]);
    expect(retainOpenParagraph(previous, incoming, null)).toEqual(incoming);
    expect(
      replaceParagraphMessages(previous, 0, [
        { paragraphIdx: 0, turnIdx: 0, text: "saved" },
      ]),
    ).toEqual([
      { paragraphIdx: 0, turnIdx: 0, text: "saved" },
      { paragraphIdx: 1, turnIdx: 0, text: "old" },
    ]);
  });
});
