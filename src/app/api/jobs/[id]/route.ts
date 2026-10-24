import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";

function dataDir(): string {
  const raw = process.env.DATA_DIR ?? "./src/data";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const jobId = Number(id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as
    | {
        id: number;
        status: string;
        error: string | null;
        email: string;
      }
    | undefined;

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const chapters = db
    .prepare(
      "SELECT idx, title FROM chapters WHERE job_id = ? ORDER BY idx",
    )
    .all(jobId) as { idx: number; title: string }[];

  const jobDir = path.join(dataDir(), "jobs", String(jobId));
  const downloads = chapters.map((ch) => {
    const file = path.join(jobDir, `chapter-${ch.idx}.mp3`);
    return {
      title: ch.title,
      ready: fs.existsSync(file),
      downloadUrl: `/api/jobs/${jobId}/chapters/${ch.idx}`,
    };
  });

  const total = chapters.length;
  const ready = downloads.filter((d) => d.ready).length;
  const progress =
    total === 0 ? 0 : Math.round((ready / total) * 100);

  return NextResponse.json({
    id: job.id,
    status: job.status,
    error: job.error,
    email: job.email,
    progress,
    chapters: downloads,
  });
}
