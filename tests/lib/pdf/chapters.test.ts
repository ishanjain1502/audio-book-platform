import { describe, expect, it } from "vitest";
import {
  excludedHeadingKind,
  isChapterHeading,
  splitChapters,
  storyHeadingKind,
} from "@/lib/pdf/chapters";

describe("splitChapters", () => {
  it("classifies story and excluded headings", () => {
    expect(storyHeadingKind("Prologue")).toBe("prologue");
    expect(storyHeadingKind("Prologue: The storm")).toBe("prologue");
    expect(storyHeadingKind("Epilogue to the Reader")).toBe("epilogue");
    expect(storyHeadingKind("Chapter 1: Dawn")).toBe("chapter");
    expect(storyHeadingKind("Chapter IV")).toBe("chapter");
    expect(storyHeadingKind("Chapter One")).toBe("chapter");
    expect(storyHeadingKind("Chapter Twenty-One: A Title")).toBe("chapter");
    expect(storyHeadingKind("Chapter one morning")).toBeNull();
    expect(storyHeadingKind("Prologue was his favorite word")).toBeNull();
    expect(excludedHeadingKind("Introduction")).toBe("introduction");
    expect(excludedHeadingKind("Preface to the Second Edition")).toBe("preface");
    expect(excludedHeadingKind("Foreword: A note")).toBe("foreword");
    expect(excludedHeadingKind("Chapter 1")).toBeNull();
    expect(isChapterHeading("Prologue")).toBe(true);
    expect(isChapterHeading("Epilogue.")).toBe(true);
    expect(isChapterHeading("Preface")).toBe(false);
  });

  it("splits a prologue and an epilogue into their own chapters", () => {
    const chapters = splitChapters(
      ["Prologue", "Once.", "Chapter 1", "Body.", "Epilogue", "After."].join("\n"),
    );
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Prologue", "Chapter 1", "Epilogue"]);
    expect(chapters[0].rawText).toBe("Once.");
    expect(chapters[1].rawText).toBe("Body.");
    expect(chapters[2].rawText).toBe("After.");
  });

  it("keeps Chapter one morning inside the chapter body", () => {
    const chapters = splitChapters(
      ["Chapter 1", "Chapter one morning", "Chapter Two", "Next."].join("\n"),
    );
    expect(chapters).toHaveLength(2);
    expect(chapters[0].rawText).toContain("Chapter one morning");
    expect(chapters[1].title).toBe("Chapter Two");
  });

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
