import pdfParse from "pdf-parse";
import { renderPdfPage } from "@/lib/pdf/pageText";
import { stripNonStoryText } from "@/lib/pdf/storyText";

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

export type PdfExtractResult = {
  text: string;
  metadata: { title?: string; author?: string; pages: number };
  wordCount: number;
};

export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
  let data: Awaited<ReturnType<typeof pdfParse>>;
  try {
    data = await pdfParse(buffer, { pagerender: renderPdfPage });
  } catch {
    throw new PdfExtractError(
      "No text layer found. Scanned PDFs are not supported yet.",
      422,
    );
  }

  const text = stripNonStoryText(data.text ?? "");
  if (!text) {
    throw new PdfExtractError(
      "No text layer found. Scanned PDFs are not supported yet.",
      422,
    );
  }

  const wordCount = countWords(text);
  if (wordCount < MIN_WORDS) {
    throw new PdfExtractError("PDF too short to generate an audiobook.", 422);
  }

  return {
    text,
    metadata: {
      title: data.info?.Title?.trim() || undefined,
      author: data.info?.Author?.trim() || undefined,
      pages: data.numpages,
    },
    wordCount,
  };
}
