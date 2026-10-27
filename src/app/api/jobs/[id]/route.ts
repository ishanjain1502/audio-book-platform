import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { readJobReview } from "@/lib/jobs/readJobReview";
import { jobDir, readJobStatus } from "@/lib/jobs/statusFile";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const jobId = Number(id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const status = readJobStatus(jobId);
  if (!status) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const dir = jobDir(jobId);
  const chapters = status.chapters.map((ch) => {
    const file = path.join(dir, `chapter-${ch.idx}.mp3`);
    const ready = fs.existsSync(file);
    return {
      title: ch.title,
      ready,
      downloadUrl: `/api/jobs/${jobId}/chapters/${ch.idx}`,
    };
  });

  const total = chapters.length;
  const readyCount = chapters.filter((c) => c.ready).length;
  const progress =
    status.progress > 0
      ? status.progress
      : total === 0
        ? 0
        : Math.round((readyCount / total) * 100);

  const review = readJobReview(jobId);
  return NextResponse.json({
    id: status.id,
    status: status.status,
    error: status.error ?? null,
    email: status.email,
    progress,
    phase: status.phase ?? null,
    detail: status.detail ?? null,
    chapters,
    ...review,
  });
}
