import { NextResponse } from "next/server";
import { updateJobBook } from "@/lib/jobs/updateJobBook";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const jobId = Number((await context.params).id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const body = (await request.json()) as {
    title?: string;
    author?: string | null;
    pageCount?: number;
  };
  const result = updateJobBook(jobId, {
    title: body.title ?? "",
    author: body.author ?? null,
    pageCount: body.pageCount ?? 0,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
