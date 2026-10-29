import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { createPageCollector } from "../src/lib/pdf/pageText";
import { excludePageArtifacts, filterStoryLines, joinStoryLines } from "../src/lib/pdf/storyText";

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function linesOf(text: string): string[] {
  return text.split("\n");
}

function preview(text: string, maxLines: number): string {
  return linesOf(text).slice(0, maxLines).join("\n");
}

async function main() {
  const pdfPath = path.join(process.cwd(), "testSamples/the-great-gatsby-f-scott-fitzgerald.pdf");
  const buffer = fs.readFileSync(pdfPath);
  const previous = await pdfParse(buffer);
  const previousText = (previous.text ?? "").replace(/\r\n/g, "\n").trim();
  const collector = createPageCollector();
  await pdfParse(buffer, { pagerender: collector.render });
  const afterMargins = joinStoryLines(excludePageArtifacts(collector.lines).kept);
  const nextText = joinStoryLines(filterStoryLines(collector.lines).kept);

  const outDir = path.join(process.cwd(), "scripts/.compare-out");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "previous.txt"), previousText);
  fs.writeFileSync(path.join(outDir, "margins.txt"), afterMargins);
  fs.writeFileSync(path.join(outDir, "next.txt"), nextText);

  const prevLines = linesOf(previousText);
  const nextLines = linesOf(nextText);
  const prevSet = new Map<string, number>();
  for (const line of prevLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    prevSet.set(trimmed, (prevSet.get(trimmed) ?? 0) + 1);
  }
  const nextSet = new Set(nextLines.map((line) => line.trim()).filter(Boolean));
  const removed = [...prevSet.entries()]
    .filter(([line]) => !nextSet.has(line))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  console.log(
    JSON.stringify(
      {
        pages: previous.numpages,
        title: previous.info?.Title ?? null,
        author: previous.info?.Author ?? null,
        previous: { words: words(previousText), lines: prevLines.length, chars: previousText.length },
        afterMarginFilter: { words: words(afterMargins), lines: linesOf(afterMargins).length, chars: afterMargins.length },
        next: { words: words(nextText), lines: nextLines.length, chars: nextText.length },
        removedDistinctLines: removed.length,
        removedLineOccurrences: removed.reduce((sum, [, count]) => sum + count, 0),
        topRemoved: removed.slice(0, 40).map(([line, count]) => ({ count, line: line.slice(0, 180) })),
        previousOpening: preview(previousText, 80),
        nextOpening: preview(nextText, 40),
        previousEnding: linesOf(previousText).slice(-25).join("\n"),
        nextEnding: nextLines.slice(-25).join("\n"),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
