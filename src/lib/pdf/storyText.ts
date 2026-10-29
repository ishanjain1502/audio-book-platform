import { isChapterHeading } from "@/lib/pdf/chapters";

const REPEATED_LINE_PAGES = 3;

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
