import { excludedHeadingKind, isChapterHeading, storyHeadingKind } from "@/lib/pdf/chapters";
import type { CollectedLine } from "@/lib/pdf/pageText";

const REPEATED_LINE_PAGES = 3;

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

export function stripNonStoryText(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const pages = normalized
    .split(/\n\s*\n/)
    .map((page) => page.trim())
    .filter(Boolean);
  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || isChapterHeading(trimmed)) continue;
      seen.add(trimmed);
    }
    for (const line of seen) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  const repeated = new Set(
    [...counts].filter(([, count]) => count >= REPEATED_LINE_PAGES).map(([line]) => line),
  );

  const lines = normalized.split("\n");
  const headingAt = lines.findIndex((line) => isChapterHeading(line.trim()));
  const storyLines = (headingAt >= 0 ? lines.slice(headingAt) : lines).filter((line) => {
    const trimmed = line.trim();
    return !trimmed || !repeated.has(trimmed);
  });

  return storyLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
