import { excludedHeadingKind, storyHeadingKind } from "@/lib/pdf/chapters";
import type { CollectedLine } from "@/lib/pdf/pageText";

const MARGIN_RATIO = 0.08;
const REPEATED_HEADER_PAGES = 3;
const PAGE_NUMBER_LINE = /^(?:[-–—]\s*)?\d{1,4}(?:\s*[-–—])?$/;

export type ExclusionReason =
  | "margin-page-number"
  | "repeated-header"
  | "front-matter"
  | "introduction"
  | "preface"
  | "foreword";

function inMargin(line: CollectedLine): boolean {
  if (line.pageHeight <= 0) return false;
  return line.y >= line.pageHeight * (1 - MARGIN_RATIO) || line.y <= line.pageHeight * MARGIN_RATIO;
}

export function excludePageArtifacts(lines: CollectedLine[]): {
  kept: CollectedLine[];
  excluded: { line: CollectedLine; reason: ExclusionReason }[];
} {
  const marginPages = new Map<string, Set<number>>();
  for (const line of lines) {
    const text = line.text.trim();
    if (!inMargin(line) || !text || PAGE_NUMBER_LINE.test(text)) continue;
    const pages = marginPages.get(text) ?? new Set<number>();
    pages.add(line.page);
    marginPages.set(text, pages);
  }
  const repeated = new Set(
    [...marginPages]
      .filter(([, pages]) => pages.size >= REPEATED_HEADER_PAGES)
      .map(([text]) => text),
  );
  const kept: CollectedLine[] = [];
  const excluded: { line: CollectedLine; reason: ExclusionReason }[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (inMargin(line) && PAGE_NUMBER_LINE.test(text)) {
      excluded.push({ line, reason: "margin-page-number" });
      continue;
    }
    if (inMargin(line) && repeated.has(text)) {
      excluded.push({ line, reason: "repeated-header" });
      continue;
    }
    kept.push(line);
  }
  return { kept, excluded };
}

export type StoryStart = "prologue" | "chapter" | "none";

export function applyStoryPolicy(lines: CollectedLine[]): {
  kept: CollectedLine[];
  excluded: { line: CollectedLine; reason: ExclusionReason }[];
  storyStart: StoryStart;
} {
  const storyStartIndex = lines.findIndex((line) => {
    const kind = storyHeadingKind(line.text);
    return kind === "prologue" || kind === "chapter";
  });
  const startKind = storyStartIndex < 0 ? null : storyHeadingKind(lines[storyStartIndex].text);
  const storyStart: StoryStart =
    startKind === "prologue" ? "prologue" : startKind === "chapter" ? "chapter" : "none";
  const kept: CollectedLine[] = [];
  const excluded: { line: CollectedLine; reason: ExclusionReason }[] = [];
  let skipping: "introduction" | "preface" | "foreword" | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (storyStartIndex >= 0 && i < storyStartIndex) {
      excluded.push({ line, reason: "front-matter" });
      continue;
    }
    const excludedKind = excludedHeadingKind(line.text);
    const recognized = excludedKind !== null || storyHeadingKind(line.text) !== null;
    if (skipping && !recognized) {
      excluded.push({ line, reason: skipping });
      continue;
    }
    skipping = null;
    if (excludedKind) {
      skipping = excludedKind;
      excluded.push({ line, reason: excludedKind });
      continue;
    }
    kept.push(line);
  }
  return { kept, excluded, storyStart };
}

export function joinStoryLines(lines: CollectedLine[]): string {
  if (lines.length === 0) return "";
  const pages: string[][] = [];
  let currentPage = lines[0].page;
  let bucket: string[] = [];
  for (const line of lines) {
    if (line.page !== currentPage) {
      pages.push(bucket);
      bucket = [];
      currentPage = line.page;
    }
    bucket.push(line.text);
  }
  pages.push(bucket);
  return pages
    .filter((page) => page.length > 0)
    .map((page) => page.join("\n"))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function filterStoryLines(lines: CollectedLine[]): {
  kept: CollectedLine[];
  excluded: { line: CollectedLine; reason: ExclusionReason }[];
  storyStart: StoryStart;
} {
  const artifacts = excludePageArtifacts(lines);
  const story = applyStoryPolicy(artifacts.kept);
  return {
    kept: story.kept,
    excluded: [...artifacts.excluded, ...story.excluded],
    storyStart: story.storyStart,
  };
}
