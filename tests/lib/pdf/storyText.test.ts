import { describe, expect, it } from "vitest";
import {
  createPageCollector,
  pageLinesFromItems,
  pageTextFromItems,
  renderPdfPage,
} from "@/lib/pdf/pageText";
import type { CollectedLine } from "@/lib/pdf/pageText";
import {
  applyStoryPolicy,
  excludePageArtifacts,
  filterStoryLines,
  joinStoryLines,
} from "@/lib/pdf/storyText";

function line(page: number, y: number, text: string): CollectedLine {
  return { page, y, pageHeight: 1000, text };
}

describe("pageTextFromItems", () => {
  const pageHeight = 1000;

  it("keeps the margin line, the story line, and the footer number", () => {
    const text = pageTextFromItems(
      [
        { str: "Running Title", x: 72, y: 960 },
        { str: "Once upon a time", x: 72, y: 500 },
        { str: "42", x: 300, y: 40 },
      ],
      pageHeight,
    );

    expect(text).toBe("Running Title\nOnce upon a time\n42");
  });

  it("keeps a page-number line in the body", () => {
    const text = pageTextFromItems(
      [
        { str: "The story continues here.", x: 72, y: 500 },
        { str: "17", x: 280, y: 400 },
      ],
      pageHeight,
    );

    expect(text).toBe("The story continues here.\n17");
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
  it("reads positioned text items and keeps the margin", async () => {
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

    expect(text).toBe("Running Title\nOnce upon a time\n12");
  });
});

describe("excludePageArtifacts", () => {
  it("drops a margin header repeated on three pages and keeps the body", () => {
    const lines = [1, 2, 3].flatMap((page) => [
      line(page, 960, "Running Title"),
      line(page, 500, "Story on page " + page),
    ]);
    const result = excludePageArtifacts(lines);
    expect(result.kept.map((item) => item.text)).toEqual([
      "Story on page 1",
      "Story on page 2",
      "Story on page 3",
    ]);
    expect(result.excluded.every((item) => item.reason === "repeated-header")).toBe(true);
  });

  it("drops a footer page number and keeps a page number in the body", () => {
    const result = excludePageArtifacts([
      line(1, 500, "The story continues here."),
      line(1, 400, "17"),
      line(1, 40, "42"),
    ]);
    expect(result.kept.map((item) => item.text)).toEqual([
      "The story continues here.",
      "17",
    ]);
    expect(result.excluded).toEqual([
      { line: line(1, 40, "42"), reason: "margin-page-number" },
    ]);
  });

  it("keeps a sentence repeated in the body and a margin line seen once", () => {
    const lines = [
      line(1, 960, "A line near the edge."),
      ...[1, 2, 3].map((page) => line(page, 500, "The same sentence.")),
      line(2, 960, "Only twice"),
      line(3, 960, "Only twice"),
    ];
    const result = excludePageArtifacts(lines);
    expect(result.kept.map((item) => item.text)).toEqual([
      "A line near the edge.",
      "The same sentence.",
      "The same sentence.",
      "The same sentence.",
      "Only twice",
      "Only twice",
    ]);
    expect(result.excluded).toEqual([]);
  });
});

it("keeps a prologue and drops the preface that follows it", () => {
  const lines = [
    line(1, 500, "Copyright 2020"),
    line(1, 400, "Preface"),
    line(1, 300, "A note."),
    line(2, 500, "Prologue"),
    line(2, 400, "Once."),
    line(3, 500, "Preface"),
    line(3, 400, "Later note."),
    line(4, 500, "Chapter 1"),
    line(4, 400, "Body."),
  ];
  const result = applyStoryPolicy(lines);
  expect(result.storyStart).toBe("prologue");
  expect(result.kept.map((item) => item.text)).toEqual(["Prologue", "Once.", "Chapter 1", "Body."]);
  expect(result.excluded.map((item) => item.reason)).toEqual([
    "front-matter",
    "front-matter",
    "front-matter",
    "preface",
    "preface",
  ]);
});

it("drops an introduction and a foreword after the story starts", () => {
  const lines = [
    line(1, 500, "Chapter One"),
    line(1, 400, "Body."),
    line(1, 300, "About the Author"),
    line(2, 500, "Introduction: A Note"),
    line(2, 400, "Skip me."),
    line(3, 500, "Foreword"),
    line(3, 400, "Skip this too."),
    line(4, 500, "Epilogue"),
    line(4, 400, "After."),
  ];
  const result = applyStoryPolicy(lines);
  expect(result.storyStart).toBe("chapter");
  expect(result.kept.map((item) => item.text)).toEqual([
    "Chapter One",
    "Body.",
    "About the Author",
    "Epilogue",
    "After.",
  ]);
  expect(result.excluded.map((item) => item.reason)).toEqual([
    "introduction",
    "introduction",
    "foreword",
    "foreword",
  ]);
});

it("keeps text with no story heading and still drops a preface section", () => {
  const result = applyStoryPolicy([
    line(1, 500, "Hello."),
    line(1, 400, "Preface to the Second Edition"),
    line(1, 300, "Not the story."),
    line(1, 200, "After."),
  ]);
  expect(result.storyStart).toBe("none");
  expect(result.kept.map((item) => item.text)).toEqual(["Hello."]);
  expect(result.excluded.map((item) => item.reason)).toEqual(["preface", "preface", "preface"]);
});

it("joins kept pages with one blank line and skips an empty gap", () => {
  expect(joinStoryLines([line(1, 500, "Alpha"), line(3, 500, "Beta")])).toBe("Alpha\n\nBeta");
});

it("filters artifacts before the story policy", () => {
  const lines = [1, 2, 3].flatMap((page) => [
    line(page, 960, "Running Title"),
    line(page, 500, page === 1 ? "Chapter 1" : "Body " + page),
  ]);
  const result = filterStoryLines(lines);
  expect(result.kept.map((item) => item.text)).toEqual(["Chapter 1", "Body 2", "Body 3"]);
  expect(result.excluded.every((item) => item.reason === "repeated-header")).toBe(true);
});

