import { NextResponse } from "next/server";
import { ensureBookResearch } from "@/lib/research/ensureBookResearch";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const jobId = Number((await context.params).id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const result = await ensureBookResearch(jobId);
  return NextResponse.json(result);
}
