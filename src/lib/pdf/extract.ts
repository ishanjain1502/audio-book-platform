import pdfParse from "pdf-parse";
import { createPageCollector, type CollectedLine, type PageRecord } from "@/lib/pdf/pageText";
import { filterStoryLines, joinStoryLines, type StoryStart } from "@/lib/pdf/storyText";

export class PdfExtractError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "PdfExtractError";
  }
}

const MIN_WORDS = 500;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export type PdfExtractDiagnostics = {
  pagesExtracted: number;
  pagesEmpty: number;
  pagesFailed: number;
  excluded: {
    marginPageNumber: number;
    repeatedHeader: number;
    frontMatter: number;
    introduction: number;
    preface: number;
    foreword: number;
  };
  storyStart: StoryStart;
  wordsIn: number;
  wordsOut: number;
  largeReduction: boolean;
};

export type PdfExtractResult = {
  text: string;
  metadata: { title?: string; author?: string; pages: number };
  wordCount: number;
  diagnostics: PdfExtractDiagnostics;
};

const REASON_KEY = {
  "margin-page-number": "marginPageNumber",
  "repeated-header": "repeatedHeader",
  "front-matter": "frontMatter",
  introduction: "introduction",
  preface: "preface",
  foreword: "foreword",
} as const;

export function buildStoryExtract(input: {
  lines: CollectedLine[];
  pages: PageRecord[];
  metadata: { title?: string; author?: string; pages: number };
}): PdfExtractResult {
  const filtered = filterStoryLines(input.lines);
  const text = joinStoryLines(filtered.kept);
  const wordsIn = countWords(input.lines.map((line) => line.text).join(" "));
  const wordsOut = countWords(text);
  const excluded = {
    marginPageNumber: 0,
    repeatedHeader: 0,
    frontMatter: 0,
    introduction: 0,
    preface: 0,
    foreword: 0,
  };
  for (const item of filtered.excluded) {
    excluded[REASON_KEY[item.reason]] += 1;
  }
  const diagnostics: PdfExtractDiagnostics = {
    pagesExtracted: input.pages.length,
    pagesEmpty: input.pages.filter((page) => page.status === "empty").length,
    pagesFailed: input.pages.filter((page) => page.status === "failed").length,
    excluded,
    storyStart: filtered.storyStart,
    wordsIn,
    wordsOut,
    largeReduction: wordsIn > 0 && wordsOut * 2 < wordsIn,
  };
  console.info(diagnostics);
  if (!text) {
    throw new PdfExtractError("No text layer found. Scanned PDFs are not supported yet.", 422);
  }
  if (wordsOut < MIN_WORDS) {
    throw new PdfExtractError("PDF too short to generate an audiobook.", 422);
  }
  return { text, metadata: input.metadata, wordCount: wordsOut, diagnostics };
}

export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
  const collector = createPageCollector();
  let data: Awaited<ReturnType<typeof pdfParse>>;
  try {
    data = await pdfParse(buffer, { pagerender: collector.render });
  } catch {
    throw new PdfExtractError("No text layer found. Scanned PDFs are not supported yet.", 422);
  }
  return buildStoryExtract({
    lines: collector.lines,
    pages: collector.pages,
    metadata: {
      title: data.info?.Title?.trim() || undefined,
      author: data.info?.Author?.trim() || undefined,
      pages: data.numpages,
    },
  });
}
