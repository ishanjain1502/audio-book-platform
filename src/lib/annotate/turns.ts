export type AnnotationTurn = { speakerIndex: number; text: string };

export class AnnotationTurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnotationTurnError";
  }
}

const TAG = /<\|speaker:(\d+)\|>/g;

export function parseAnnotationTurns(annotated: string): AnnotationTurn[] {
  const turns: AnnotationTurn[] = [];
  const re = new RegExp(TAG.source, "g");
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(annotated))) {
    const between = annotated.slice(cursor, match.index);
    if (turns.length === 0) {
      if (between.length > 0) turns.push({ speakerIndex: 0, text: between });
    } else {
      turns[turns.length - 1].text += between;
    }
    turns.push({ speakerIndex: Number(match[1]), text: "" });
    cursor = match.index + match[0].length;
  }
  const rest = annotated.slice(cursor);
  if (turns.length === 0) {
    if (rest.length > 0) turns.push({ speakerIndex: 0, text: rest });
  } else {
    turns[turns.length - 1].text += rest;
  }
  return turns;
}

export function replaceSpeakerTurn(
  annotated: string,
  turnIdx: number,
  speakerIndex: number,
): string {
  const turns = parseAnnotationTurns(annotated);
  if (turnIdx < 0 || turnIdx >= turns.length) {
    throw new AnnotationTurnError("Turn not found");
  }
  const leading = annotated.length > 0 && !annotated.startsWith("<|speaker:");
  const tagOrdinal = leading ? turnIdx - 1 : turnIdx;
  if (tagOrdinal < 0) throw new AnnotationTurnError("Turn has no speaker tag");
  let seen = 0;
  return annotated.replace(/<\|speaker:\d+\|>/g, (tag) => {
    if (seen++ !== tagOrdinal) return tag;
    return `<|speaker:${speakerIndex}|>`;
  });
}
