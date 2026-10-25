import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { validateVoiceSample } from "@/lib/audio/validateSample";
import { extractPdfText, PdfExtractError } from "@/lib/pdf/extract";
import { splitChapters } from "@/lib/pdf/chapters";
import {
  allocateJobId,
  jobDir,
  writeJobStatus,
} from "@/lib/jobs/statusFile";

export const runtime = "nodejs";

function spawnJobRunner(jobId: number): void {
  const script = path.join(process.cwd(), "scripts", "run-job.ts");
  const child = spawn("npx", ["tsx", script, String(jobId)], {
    cwd: process.cwd(),
    detached: true,
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
  child.unref();
  child.on("error", (err) => {
    console.error(`Failed to spawn job ${jobId}`, err);
  });
}

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

    const jobId = allocateJobId();
    const dir = jobDir(jobId);
    fs.mkdirSync(dir, { recursive: true });

    const pdfPath = path.join(dir, "input.pdf");
    fs.writeFileSync(pdfPath, pdfBuffer);

    let voicePath: string | null = null;
    if (voice && voice instanceof Blob && voice.size > 0) {
      const voiceBuffer = Buffer.from(await voice.arrayBuffer());
      await validateVoiceSample(voiceBuffer);
      const ext = voice.type.includes("wav") ? ".wav" : ".mp3";
      voicePath = path.join(dir, `voice${ext}`);
      fs.writeFileSync(voicePath, voiceBuffer);
    }

    const title =
      extracted.metadata.title ??
      path.basename((pdf as File).name ?? "book", ".pdf");
    const author = extracted.metadata.author ?? null;

    const chapters = splitChapters(extracted.text).map((ch, idx) => ({
      idx,
      title: ch.title,
      ready: false,
    }));

    fs.writeFileSync(
      path.join(dir, "upload.json"),
      JSON.stringify({
        email,
        pdfPath,
        voicePath,
        title,
        author,
      }),
    );

    writeJobStatus({
      id: jobId,
      status: "queued",
      email,
      progress: 0,
      chapters,
    });

    spawnJobRunner(jobId);

    return NextResponse.json({ jobId });
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
