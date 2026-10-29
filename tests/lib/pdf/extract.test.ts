import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStoryExtract, extractPdfText, PdfExtractError } from "@/lib/pdf/extract";
import type { CollectedLine } from "@/lib/pdf/pageText";

function words(count: number, prefix: string): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");
}

function body(text: string): CollectedLine[] {
  return text.split("\n").map((item, index) => ({
    page: 1,
    y: 500 - index,
    pageHeight: 1000,
    text: item,
  }));
}

describe("buildStoryExtract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a long enough chapter and logs counts without the sentence", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const front = words(600, "front");
    const story = words(500, "word");
    const result = buildStoryExtract({
      lines: body(["Copyright", front, "Chapter 1", story].join("\n")),
      pages: [
        { page: 1, status: "ok" },
        { page: 2, status: "empty" },
        { page: 3, status: "failed" },
      ],
      metadata: { title: "Book", author: "Ada", pages: 3 },
    });
    expect(result.text.startsWith("Chapter 1")).toBe(true);
    expect(result.text).toContain("word0");
    expect(result.text).not.toContain("Copyright");
    expect(result.wordCount).toBe(502);
    expect(result.diagnostics).toMatchObject({
      pagesExtracted: 3,
      pagesEmpty: 1,
      pagesFailed: 1,
      storyStart: "chapter",
      wordsOut: 502,
      largeReduction: true,
    });
    expect(result.diagnostics.excluded.frontMatter).toBe(2);
    expect(info).toHaveBeenCalledWith(result.diagnostics);
    const report = String(info.mock.calls[1][0]);
    expect(report).toContain("front-matter (2)");
    expect(report).toContain("Copyright");
    expect(report).toContain("empty (2)");
    expect(report).toContain("failed (3)");
    expect(report).not.toContain("word0");
    expect(JSON.stringify(result.diagnostics)).not.toContain("word0");
  });

  it("rejects fewer than 500 words with the existing message", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(() =>
      buildStoryExtract({
        lines: body("Chapter 1\nToo short."),
        pages: [{ page: 1, status: "ok" }],
        metadata: { pages: 1 },
      }),
    ).toThrowError(new PdfExtractError("PDF too short to generate an audiobook.", 422));
  });

  it("rejects a preface-only text with the scanned-PDF message", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(() =>
      buildStoryExtract({
        lines: body("Preface\nNot the story."),
        pages: [{ page: 1, status: "ok" }],
        metadata: { pages: 1 },
      }),
    ).toThrowError(
      new PdfExtractError("No text layer found. Scanned PDFs are not supported yet.", 422),
    );
    expect(info.mock.calls[0][0]).toMatchObject({
      storyStart: "none",
      wordsOut: 0,
      excluded: { preface: 2 },
    });
  });
});

it("rejects a buffer the parser cannot read", async () => {
  await expect(extractPdfText(Buffer.from("not a pdf"))).rejects.toMatchObject({
    name: "PdfExtractError",
    message: "No text layer found. Scanned PDFs are not supported yet.",
    statusCode: 422,
  });
});
