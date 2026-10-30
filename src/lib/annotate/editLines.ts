import type { AnnotationTurn } from "@/lib/annotate/turns";

export function withDraft(
  lines: AnnotationTurn[],
  turnIdx: number,
  draft: string | null,
): AnnotationTurn[] {
  if (draft == null) return lines.map((line) => ({ ...line }));
  return lines.map((line, index) =>
    index === turnIdx ? { ...line, text: draft } : { ...line },
  );
}

export function addLine(lines: AnnotationTurn[], turnIdx: number): AnnotationTurn[] {
  const current = lines[turnIdx];
  const next = lines.map((line) => ({ ...line }));
  next.splice(turnIdx + 1, 0, { speakerIndex: current.speakerIndex, text: "" });
  return next;
}

export function splitLine(
  lines: AnnotationTurn[],
  turnIdx: number,
  cursor: number,
): AnnotationTurn[] {
  const current = lines[turnIdx];
  const next = lines.map((line) => ({ ...line }));
  next.splice(
    turnIdx,
    1,
    { speakerIndex: current.speakerIndex, text: current.text.slice(0, cursor) },
    { speakerIndex: current.speakerIndex, text: current.text.slice(cursor) },
  );
  return next;
}

export function deleteLine(
  lines: AnnotationTurn[],
  turnIdx: number,
): AnnotationTurn[] | null {
  if (lines.length < 2) return null;
  return lines.filter((_, index) => index !== turnIdx).map((line) => ({ ...line }));
}

export function changeSpeaker(
  lines: AnnotationTurn[],
  turnIdx: number,
  speakerIndex: number,
): AnnotationTurn[] {
  return lines.map((line, index) =>
    index === turnIdx ? { ...line, speakerIndex } : { ...line },
  );
}

function paragraphOrder<T extends { paragraphIdx: number }>(
  messages: T[],
  extra: number | null,
): number[] {
  const order: number[] = [];
  for (const message of messages) {
    if (!order.includes(message.paragraphIdx)) order.push(message.paragraphIdx);
  }
  if (extra != null && !order.includes(extra)) order.push(extra);
  return order;
}

export function retainOpenParagraph<T extends { paragraphIdx: number }>(
  previous: T[],
  incoming: T[],
  openParagraphIdx: number | null,
): T[] {
  if (openParagraphIdx == null) return incoming;
  return paragraphOrder(incoming, openParagraphIdx).flatMap((paragraphIdx) =>
    paragraphIdx === openParagraphIdx
      ? previous.filter((message) => message.paragraphIdx === paragraphIdx)
      : incoming.filter((message) => message.paragraphIdx === paragraphIdx),
  );
}

export function replaceParagraphMessages<T extends { paragraphIdx: number }>(
  messages: T[],
  paragraphIdx: number,
  replacement: T[],
): T[] {
  return paragraphOrder(messages, paragraphIdx).flatMap((idx) =>
    idx === paragraphIdx
      ? replacement
      : messages.filter((message) => message.paragraphIdx === idx),
  );
}
