import { FatalFishError } from "@/lib/fish/retry";

export class CompactRequestError extends FatalFishError {
  constructor(message: string) {
    super(message);
    this.name = "CompactRequestError";
  }
}

export function compactFishRequest(
  text: string,
  referenceIds: string[],
): { text: string; referenceIds: string[] } {
  if (referenceIds.length === 0) {
    throw new CompactRequestError("referenceIds is empty");
  }

  if (!/<\|speaker:\d+\|>/.test(text)) {
    const narrator = referenceIds[0];
    if (!narrator) {
      throw new CompactRequestError("Speaker index 0 has no voice");
    }
    return { text, referenceIds: [narrator] };
  }

  const compact: string[] = [];
  const slotByVoice = new Map<string, number>();
  const rewritten = text.replace(
    /<\|speaker:(\d+)\|>/g,
    (_match, indexText: string) => {
      const index = Number(indexText);
      const voiceId = referenceIds[index];
      if (!voiceId) {
        throw new CompactRequestError(`Speaker index ${index} has no voice`);
      }
      let slot = slotByVoice.get(voiceId);
      if (slot === undefined) {
        slot = compact.length;
        compact.push(voiceId);
        slotByVoice.set(voiceId, slot);
      }
      return `<|speaker:${slot}|>`;
    },
  );

  return { text: rewritten, referenceIds: compact };
}
