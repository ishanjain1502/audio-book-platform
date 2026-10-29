const MARGIN_RATIO = 0.08;
const SAME_LINE_Y = 2;
const PAGE_NUMBER_LINE = /^(?:[-–—]\s*)?\d{1,4}(?:\s*[-–—])?$/;

export type PositionedText = {
  str: string;
  x: number;
  y: number;
};

export type PageLine = { y: number; text: string };

export function pageLinesFromItems(items: PositionedText[], pageHeight: number): PageLine[] {
  if (pageHeight <= 0) return [];
  const grouped: { y: number; parts: { x: number; str: string }[] }[] = [];
  for (const item of items) {
    if (!item.str) continue;
    let line = grouped.find((candidate) => Math.abs(candidate.y - item.y) <= SAME_LINE_Y);
    if (!line) {
      line = { y: item.y, parts: [] };
      grouped.push(line);
    }
    line.parts.push({ x: item.x, str: item.str });
  }
  grouped.sort((a, b) => b.y - a.y);
  const lines: PageLine[] = [];
  for (const line of grouped) {
    const text = line.parts
      .sort((a, b) => a.x - b.x)
      .map((part) => part.str)
      .join("")
      .trim();
    if (text) lines.push({ y: line.y, text });
  }
  return lines;
}

type Line = {
  y: number;
  parts: { x: number; str: string }[];
};

export function pageTextFromItems(items: PositionedText[], pageHeight: number): string {
  if (pageHeight <= 0) return "";

  const top = pageHeight * (1 - MARGIN_RATIO);
  const bottom = pageHeight * MARGIN_RATIO;
  const lines: Line[] = [];

  for (const item of items) {
    if (!item.str) continue;
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= SAME_LINE_Y);
    if (!line) {
      line = { y: item.y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x: item.x, str: item.str });
  }

  lines.sort((a, b) => b.y - a.y);
  const kept: string[] = [];
  for (const line of lines) {
    if (line.y >= top || line.y <= bottom) continue;
    const text = line.parts
      .sort((a, b) => a.x - b.x)
      .map((part) => part.str)
      .join("")
      .trim();
    if (!text || PAGE_NUMBER_LINE.test(text)) continue;
    kept.push(text);
  }
  return kept.join("\n");
}

type PdfTextItem = {
  str?: string;
  transform?: number[];
};

export type PdfPageSource = {
  view: number[];
  getTextContent: (options?: {
    normalizeWhitespace?: boolean;
    disableCombineTextItems?: boolean;
  }) => Promise<{ items: PdfTextItem[] }>;
};

export async function renderPdfPage(pageData: PdfPageSource): Promise<string> {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });
  const pageHeight = pageData.view[3] - pageData.view[1];
  const items: PositionedText[] = [];
  for (const item of textContent.items) {
    if (!item.str || !item.transform) continue;
    items.push({ str: item.str, x: item.transform[4], y: item.transform[5] });
  }
  return pageTextFromItems(items, pageHeight);
}

export type PageStatus = "ok" | "empty" | "failed";
export type PageRecord = { page: number; status: PageStatus };
export type CollectedLine = {
  page: number;
  y: number;
  pageHeight: number;
  text: string;
};
export type PageCollector = {
  render: (pageData: PdfPageSource) => Promise<string>;
  lines: CollectedLine[];
  pages: PageRecord[];
};

export function createPageCollector(): PageCollector {
  const lines: CollectedLine[] = [];
  const pages: PageRecord[] = [];
  let nextPage = 1;
  const render = async (pageData: PdfPageSource): Promise<string> => {
    const page = nextPage++;
    try {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      const pageHeight = pageData.view[3] - pageData.view[1];
      const items: PositionedText[] = [];
      for (const item of textContent.items) {
        if (!item.str || !item.transform) continue;
        items.push({ str: item.str, x: item.transform[4], y: item.transform[5] });
      }
      const pageLines = pageLinesFromItems(items, pageHeight);
      if (pageLines.length === 0) {
        pages.push({ page, status: "empty" });
        return "";
      }
      pages.push({ page, status: "ok" });
      for (const line of pageLines) {
        lines.push({ page, y: line.y, pageHeight, text: line.text });
      }
      return pageLines.map((line) => line.text).join("\n");
    } catch {
      pages.push({ page, status: "failed" });
      return "";
    }
  };
  return { render, lines, pages };
}
