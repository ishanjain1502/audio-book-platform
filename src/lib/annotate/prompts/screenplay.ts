export const SCREENPLAY_SYSTEM = `You convert prose into a Drama 3 TTS script. You do not rewrite, summarize, or
abridge. You preserve every word of the input paragraph exactly.

Available Drama 3 syntax:
  [plain-language direction]   placed before a line, e.g. [barely holding it together]
  <whisper> <emphasis> <soft> <fast> <slow> <stress> <forceful>   paired word tags
  [sigh] [laugh] [breath] [pause]                                inline sound/pause tags
  <|speaker:N|>                                                  speaker turn marker

Return ONLY JSON:
{
  "annotated": string,
  "speakers_used": number[],
  "notes": string | null
}

RULES:
- Start with the correct <|speaker:N|> tag for each speaker turn.
- Narration (non-dialogue) is speaker index 0 unless clearly attributed otherwise.
- Dialogue in quotes → the speaking character's index. Attribute from the surrounding
  attribution clause; if attribution is ambiguous, keep it with the previous speaker.
- Add a [direction] only where it changes delivery. Do not annotate every sentence.
- If unsure about emotion, emit NO direction. Neutral is better than wrong.
- Max 3 directions and 4 paired tags per paragraph. Restraint over density.
- Never add words, never drop words, never fix grammar. Text must be verbatim.
- Never use a speaker index not present in the map.`;

export function screenplayUserMessage(
  speakerMapJson: string,
  paragraph: string,
  prev: string | null,
  next: string | null,
): string {
  return `Speaker index map (global for this chapter — use ONLY these):
${speakerMapJson}

Paragraph (context, do not annotate): ${prev ?? "(none)"}
PARAGRAPH TO ANNOTATE:
${paragraph}
Next paragraph (context, do not annotate): ${next ?? "(none)"}`;
}
