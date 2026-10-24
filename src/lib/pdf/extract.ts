import pdfParse from "pdf-parse";

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
    data = await pdfParse(buffer);
  } catch {
    throw new PdfExtractError(
      "No text layer found. Scanned PDFs are not supported yet.",
      422,
    );
  }

  const text = (data.text ?? "").replace(/\r\n/g, "\n").trim();
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
