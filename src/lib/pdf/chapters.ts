export type Chapter = { title: string; rawText: string };

const CHAPTER_HEADING_RE =
  /^(?:chapter|CHAPTER)\s+(\d+|[IVXLC]+)\b[^\n]*$/im;

export function isChapterHeading(line: string): boolean {
  return CHAPTER_HEADING_RE.test(line.trim());
}

const SECTION_WORDS = 3000;

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function splitByFixedWords(text: string): Chapter[] {
  const words = text.split(/\s+/).filter(Boolean);
  const sections: Chapter[] = [];
  for (let i = 0; i < words.length; i += SECTION_WORDS) {
    const chunk = words.slice(i, i + SECTION_WORDS).join(" ");
    sections.push({
      title: `Section ${sections.length + 1}`,
      rawText: chunk,
    });
  }
  return sections.length ? sections : [{ title: "Section 1", rawText: text }];
}

export function splitChapters(fullText: string): Chapter[] {
  const lines = fullText.split("\n");
  const headingIndices: { index: number; title: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (isChapterHeading(line)) {
      headingIndices.push({ index: i, title: line });
    }
  }

  if (headingIndices.length === 0) {
    return splitByFixedWords(fullText);
  }

  const chapters: Chapter[] = [];
  for (let h = 0; h < headingIndices.length; h++) {
    const start = headingIndices[h].index;
    const end =
      h + 1 < headingIndices.length
        ? headingIndices[h + 1].index
        : lines.length;
    const body = lines.slice(start + 1, end).join("\n").trim();
    chapters.push({
      title: headingIndices[h].title,
      rawText: body || lines[start],
    });
  }

  return chapters.filter((c) => c.rawText.length > 0);
}

/** Keep LLM + TTS chunks bounded when PDFs lack blank-line paragraph breaks. */
const MAX_PARAGRAPH_CHARS = 1500;

function splitLongBlock(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^\s.!?]+/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current + sentence;
    if (next.length > MAX_PARAGRAPH_CHARS && current.trim()) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

export function splitIntoParagraphs(chapterText: string): string[] {
  const parts = splitParagraphs(chapterText);
  const out: string[] = [];
  for (const part of parts) {
    if (part.length > MAX_PARAGRAPH_CHARS) {
      out.push(...splitLongBlock(part));
    } else {
      out.push(part);
    }
  }
  return out.filter(Boolean);
}
