import path from "path";
import { NextResponse } from "next/server";
import { validateVoiceSample } from "@/lib/audio/validateSample";
import { extractPdfText, PdfExtractError } from "@/lib/pdf/extract";
import { splitChapters } from "@/lib/pdf/chapters";
import { ingestUploadedBook } from "@/lib/pipeline/ingestUpload";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const pdf = form.get("pdf");
    const email = String(form.get("email") ?? "").trim();
    const voice = form.get("voice");

    if (!email || !pdf || !(pdf instanceof Blob)) {
      return NextResponse.json(
        { error: "pdf and email are required" },
        { status: 400 },
      );
    }

    const pdfBuffer = Buffer.from(await pdf.arrayBuffer());
    const extracted = await extractPdfText(pdfBuffer);

    let voiceInput: { buffer: Buffer; extension: ".wav" | ".mp3" } | null = null;
    if (voice && voice instanceof Blob && voice.size > 0) {
      const voiceBuffer = Buffer.from(await voice.arrayBuffer());
      await validateVoiceSample(voiceBuffer);
      voiceInput = {
        buffer: voiceBuffer,
        extension: voice.type.includes("wav") ? ".wav" : ".mp3",
      };
    }

    const fileName = pdf instanceof File ? pdf.name : "book.pdf";
    const title =
      extracted.metadata.title ?? path.basename(fileName, ".pdf");
    const ingested = await ingestUploadedBook({
      pdfBuffer,
      email,
      voice: voiceInput,
      title,
      author: extracted.metadata.author ?? null,
      fullText: extracted.text,
      wordCount: extracted.wordCount,
      pageCount: extracted.metadata.pages,
      chapters: splitChapters(extracted.text),
      storage: getStorage(),
    });

    return NextResponse.json({ jobId: ingested.jobId });
  } catch (err) {
    if (err instanceof PdfExtractError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      err.name === "VoiceSampleError"
    ) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 },
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
