import { NextResponse } from "next/server";
import { readAnnotation } from "@/lib/jobs/readAnnotation";
import {
  replaceParagraphTurns,
  setSectionReviewed,
  setTurnSpeaker,
} from "@/lib/jobs/updateAnnotation";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const jobId = Number((await context.params).id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const view = readAnnotation(jobId);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const jobId = Number((await context.params).id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const body = (await request.json()) as {
    chapterIdx?: number;
    reviewed?: boolean;
    paragraphIdx?: number;
    turnIdx?: number;
    speakerIndex?: number;
    turns?: { speakerIndex: number; text: string }[];
  };
  if (
    body.chapterIdx != null &&
    body.paragraphIdx != null &&
    Array.isArray(body.turns)
  ) {
    const result = replaceParagraphTurns(jobId, {
      chapterIdx: body.chapterIdx,
      paragraphIdx: body.paragraphIdx,
      turns: body.turns,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      paragraphIdx: result.paragraphIdx,
      turns: result.turns,
    });
  }
  if (
    body.paragraphIdx != null &&
    body.turnIdx != null &&
    body.speakerIndex != null &&
    body.chapterIdx != null
  ) {
    const result = setTurnSpeaker(jobId, {
      chapterIdx: body.chapterIdx,
      paragraphIdx: body.paragraphIdx,
      turnIdx: body.turnIdx,
      speakerIndex: body.speakerIndex,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ speakerIndex: result.speakerIndex, speakerName: result.speakerName });
  }
  if (body.chapterIdx != null && typeof body.reviewed === "boolean") {
    const result = setSectionReviewed(jobId, body.chapterIdx, body.reviewed);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ reviewed: result.reviewed });
  }
  return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
}
