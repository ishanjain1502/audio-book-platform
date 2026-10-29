import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { createPageCollector, type CollectedLine, type PageRecord } from "@/lib/pdf/pageText";
import {
  filterStoryLines,
  joinStoryLines,
  type ExclusionReason,
  type StoryStart,
} from "@/lib/pdf/storyText";

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

const REASON_ORDER: ExclusionReason[] = [
  "margin-page-number",
  "repeated-header",
  "front-matter",
  "introduction",
  "preface",
  "foreword",
];

function pageRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const page = sorted[i];
    if (page === prev + 1) {
      prev = page;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = page;
    prev = page;
  }
  return parts.join(", ");
}

export function formatRemovalReport(input: {
  metadata: { title?: string; author?: string; pages: number };
  pages: PageRecord[];
  diagnostics: PdfExtractDiagnostics;
  excluded: { line: CollectedLine; reason: ExclusionReason }[];
}): string {
  const empty = input.pages.filter((page) => page.status === "empty").map((page) => page.page);
  const failed = input.pages.filter((page) => page.status === "failed").map((page) => page.page);
  const lines = [
    `PDF extract: ${input.metadata.title ?? "(no title)"} by ${input.metadata.author ?? "(no author)"}`,
    `pages: ${input.diagnostics.pagesExtracted} extracted, ${input.diagnostics.pagesEmpty} empty${empty.length ? ` (${empty.join(", ")})` : ""}, ${input.diagnostics.pagesFailed} failed${failed.length ? ` (${failed.join(", ")})` : ""}`,
    `words: ${input.diagnostics.wordsIn} in -> ${input.diagnostics.wordsOut} out; story start: ${input.diagnostics.storyStart}; large reduction: ${input.diagnostics.largeReduction ? "yes" : "no"}`,
    "",
    `Removed ${input.excluded.length} lines`,
  ];
  for (const reason of REASON_ORDER) {
    const items = input.excluded.filter((item) => item.reason === reason);
    if (items.length === 0) continue;
    lines.push("", `${reason} (${items.length})`);
    const groups = new Map<string, number[]>();
    for (const item of items) {
      const text = item.line.text.trim();
      const pages = groups.get(text) ?? [];
      pages.push(item.line.page);
      groups.set(text, pages);
    }
    for (const [text, pages] of groups) {
      lines.push(`  p${pageRanges(pages)}  ${text}`);
    }
  }
  return lines.join("\n");
}

function writeRemovalReport(report: string) {
  if (process.env.VITEST) return;
  const dir = path.join(process.cwd(), "logs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "pdf-extract-last.txt");
  fs.writeFileSync(file, report + "\n");
  console.info(`PDF extract removals written to ${file}`);
}

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
  const report = formatRemovalReport({
    metadata: input.metadata,
    pages: input.pages,
    diagnostics,
    excluded: filtered.excluded,
  });
  console.info(diagnostics);
  console.info(report);
  writeRemovalReport(report);
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
