import { describe, expect, it } from "vitest";
import {
  createPageCollector,
  pageLinesFromItems,
  pageTextFromItems,
  renderPdfPage,
} from "@/lib/pdf/pageText";
import { stripNonStoryText } from "@/lib/pdf/storyText";

describe("pageTextFromItems", () => {
  const pageHeight = 1000;

  it("drops lines in the top and bottom margin and keeps the story line", () => {
    const text = pageTextFromItems(
      [
        { str: "Running Title", x: 72, y: 960 },
        { str: "Once upon a time", x: 72, y: 500 },
        { str: "42", x: 300, y: 40 },
      ],
      pageHeight,
    );

    expect(text).toBe("Once upon a time");
  });

  it("drops a line that is only a page number even when it sits in the body", () => {
    const text = pageTextFromItems(
      [
        { str: "The story continues here.", x: 72, y: 500 },
        { str: "17", x: 280, y: 400 },
      ],
      pageHeight,
    );

    expect(text).toBe("The story continues here.");
  });

  it("joins fragments on the same line from left to right and reads lines from top to bottom", () => {
    const text = pageTextFromItems(
      [
        { str: "second line", x: 72, y: 400 },
        { str: "world", x: 110, y: 500 },
        { str: "Hello ", x: 72, y: 500 },
      ],
      pageHeight,
    );

    expect(text).toBe("Hello world\nsecond line");
  });
});

it("keeps margin lines and page-number lines in reading order", () => {
  const lines = pageLinesFromItems(
    [
      { str: "second line", x: 72, y: 400 },
      { str: "world", x: 110, y: 500 },
      { str: "Hello ", x: 72, y: 500 },
      { str: "Running Title", x: 72, y: 960 },
      { str: "17", x: 300, y: 40 },
    ],
    1000,
  );
  expect(lines.map((line) => line.text)).toEqual([
    "Running Title",
    "Hello world",
    "second line",
    "17",
  ]);
});

it("records an empty page and a failed page without throwing", async () => {
  const collector = createPageCollector();
  await expect(
    collector.render({
      view: [0, 0, 600, 800],
      getTextContent: async () => {
        throw new Error("bad page");
      },
    }),
  ).resolves.toBe("");
  await collector.render({
    view: [0, 0, 600, 0],
    getTextContent: async () => ({ items: [] }),
  });
  await collector.render({
    view: [0, 0, 600, 800],
    getTextContent: async () => ({
      items: [{ str: "Once upon a time", transform: [1, 0, 0, 1, 72, 400] }],
    }),
  });
  expect(collector.pages).toEqual([
    { page: 1, status: "failed" },
    { page: 2, status: "empty" },
    { page: 3, status: "ok" },
  ]);
  expect(collector.lines).toEqual([
    { page: 3, y: 400, pageHeight: 800, text: "Once upon a time" },
  ]);
});

describe("renderPdfPage", () => {
  it("reads positioned text items and drops the margin", async () => {
    const text = await renderPdfPage({
      view: [0, 0, 600, 800],
      getTextContent: async () => ({
        items: [
          { str: "Running Title", transform: [1, 0, 0, 1, 72, 780] },
          { str: "Once upon a time", transform: [1, 0, 0, 1, 72, 400] },
          { str: "12", transform: [1, 0, 0, 1, 300, 20] },
        ],
      }),
    });

    expect(text).toBe("Once upon a time");
  });
});

describe("stripNonStoryText", () => {
  it("drops everything before the first chapter heading", () => {
    const text = stripNonStoryText(
      ["Copyright 2020", "All rights reserved", "", "Chapter 1", "It is a truth.", "", "Chapter 2", "More story."].join(
        "\n",
      ),
    );

    expect(text.startsWith("Chapter 1")).toBe(true);
    expect(text).toContain("It is a truth.");
    expect(text).toContain("Chapter 2");
    expect(text).not.toContain("Copyright");
    expect(text).not.toContain("All rights reserved");
  });

  it("keeps the text when there is no chapter heading", () => {
    const text = stripNonStoryText("No headings here.\nJust the story.");
    expect(text).toBe("No headings here.\nJust the story.");
  });

  it("drops a line repeated across three pages and keeps the story lines", () => {
    const page = (body: string) => `Pride and Prejudice\n${body}`;
    const text = stripNonStoryText(
      [page("Chapter 1\nStory one."), page("Story two."), page("Story three.")].join("\n\n"),
    );

    expect(text).not.toContain("Pride and Prejudice");
    expect(text).toContain("Chapter 1");
    expect(text).toContain("Story one.");
    expect(text).toContain("Story two.");
    expect(text).toContain("Story three.");
  });

  it("keeps a line that repeats on only two pages", () => {
    const text = stripNonStoryText("Yes.\nChapter 1\nFirst.\n\nYes.\nSecond.");
    expect(text).toContain("Yes.");
    expect(text).toContain("First.");
    expect(text).toContain("Second.");
  });
});
