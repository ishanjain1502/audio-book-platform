import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function dataDir(): string {
  const raw = process.env.DATA_DIR ?? "./src/data";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; idx: string }> },
) {
  const { id, idx } = await context.params;
  const file = path.join(dataDir(), "jobs", id, `chapter-${idx}.mp3`);
  if (!fs.existsSync(file)) {
    return NextResponse.json({ error: "Not ready" }, { status: 404 });
  }
  const buf = fs.readFileSync(file);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": `attachment; filename="chapter-${idx}.mp3"`,
    },
  });
}
