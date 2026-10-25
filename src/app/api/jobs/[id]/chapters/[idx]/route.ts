import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

import { jobDir } from "@/lib/jobs/statusFile";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; idx: string }> },
) {
  const { id, idx } = await context.params;
  const file = path.join(jobDir(Number(id)), `chapter-${idx}.mp3`);
  if (!fs.existsSync(file)) {
    return NextResponse.json({ error: "Not ready" }, { status: 404 });
  }

  const stat = fs.statSync(file);
  const size = stat.size;
  const download = new URL(request.url).searchParams.get("download") === "1";

  const baseHeaders: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
  };
  if (download) {
    baseHeaders["Content-Disposition"] =
      `attachment; filename="chapter-${idx}.mp3"`;
  }

  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (match) {
      const start = Number.parseInt(match[1], 10);
      const end = match[2]
        ? Number.parseInt(match[2], 10)
        : size - 1;
      if (start >= size || end >= size || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      const length = end - start + 1;
      const chunk = Buffer.alloc(length);
      const fd = fs.openSync(file, "r");
      fs.readSync(fd, chunk, 0, length, start);
      fs.closeSync(fd);
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Length": String(length),
          "Content-Range": `bytes ${start}-${end}/${size}`,
        },
      });
    }
  }

  const buf = fs.readFileSync(file);
  return new NextResponse(buf, {
    headers: {
      ...baseHeaders,
      "Content-Length": String(size),
    },
  });
}
