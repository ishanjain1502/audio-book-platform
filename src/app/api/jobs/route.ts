import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { validateVoiceSample } from "@/lib/audio/validateSample";
import { extractPdfText, PdfExtractError } from "@/lib/pdf/extract";
import { prepareJobFromPdf, runJob } from "@/lib/pipeline/runJob";

export const runtime = "nodejs";

function dataDir(): string {
  const raw = process.env.DATA_DIR ?? "./src/data";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

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

    let voicePath: string | null = null;
    if (voice && voice instanceof Blob && voice.size > 0) {
      const voiceBuffer = Buffer.from(await voice.arrayBuffer());
      await validateVoiceSample(voiceBuffer);
      const ext = voice.type.includes("wav") ? ".wav" : ".mp3";
      voicePath = path.join(
        dataDir(),
        "uploads",
        `voice-${Date.now()}${ext}`,
      );
      fs.mkdirSync(path.dirname(voicePath), { recursive: true });
      fs.writeFileSync(voicePath, voiceBuffer);
    }

    const title =
      extracted.metadata.title ??
      path.basename((pdf as File).name ?? "book", ".pdf");
    const author = extracted.metadata.author ?? null;

    const jobId = prepareJobFromPdf({
      pdfBuffer,
      email,
      voicePath,
      title,
      author,
      fullText: extracted.text,
      wordCount: extracted.wordCount,
      pageCount: extracted.metadata.pages,
    });

    void runJob(jobId).catch((err) => {
      console.error(`Job ${jobId} failed`, err);
    });

    return NextResponse.json({ jobId });
  } catch (err) {
    if (err instanceof PdfExtractError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err && typeof err === "object" && "name" in err && err.name === "VoiceSampleError") {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 },
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
