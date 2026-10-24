import { describe, expect, it } from "vitest";
import { splitChapters } from "@/lib/pdf/chapters";

describe("splitChapters", () => {
  it("splits on Chapter N headings", () => {
    const text = "Intro\n\nChapter 1\n\nFirst body.\n\nChapter 2\n\nSecond body.";
    const chapters = splitChapters(text);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toMatch(/Chapter 1/i);
    expect(chapters[0].rawText).toContain("First body");
  });

  it("falls back to fixed-word sections", () => {
    const words = Array.from({ length: 3500 }, (_, i) => `w${i}`).join(" ");
    const chapters = splitChapters(words);
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    expect(chapters[0].title).toBe("Section 1");
  });
});
