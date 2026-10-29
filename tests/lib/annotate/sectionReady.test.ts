import { describe, expect, it } from "vitest";
import { firstIncompleteSection, sectionIsComplete } from "@/lib/annotate/sectionReady";

describe("sectionIsComplete", () => {
  it("is complete only when the segment count equals the paragraph count", () => {
    expect(sectionIsComplete(2, 2)).toBe(true);
    expect(sectionIsComplete(2, 1)).toBe(false);
    expect(sectionIsComplete(0, 0)).toBe(false);
  });
});

describe("firstIncompleteSection", () => {
  it("returns the 1-based index of the first incomplete section", () => {
    expect(
      firstIncompleteSection([
        { idx: 0, paragraphCount: 1, segmentCount: 1 },
        { idx: 1, paragraphCount: 2, segmentCount: 1 },
      ]),
    ).toBe(2);
  });

  it("returns null when every section is complete", () => {
    expect(
      firstIncompleteSection([{ idx: 0, paragraphCount: 1, segmentCount: 1 }]),
    ).toBeNull();
  });
});
