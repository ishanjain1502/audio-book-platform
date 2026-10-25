export const SCREENPLAY_SYSTEM = `You convert prose into a Drama 3 TTS script for a LISTENED audiobook. You do not
rewrite, summarize, or abridge. You preserve every word of the input paragraph exactly.

Your goal is engaging, unhurried narration: the listener should have room to absorb
each beat. Prefer pacing tags over emotional flourishes.

Available Drama 3 syntax:
  [plain-language direction]   placed before a line, e.g. [measured] [quiet tension]
  <whisper> <emphasis> <soft> <fast> <slow> <stress> <forceful>   paired word tags
  [sigh] [laugh] [breath] [pause]                                inline sound/pause tags
  <|speaker:N|>                                                  speaker turn marker

Return ONLY JSON:
{
  "annotated": string,
  "speakers_used": number[],
  "notes": string | null
}

SPEAKER & DIALOGUE:
- Start with the correct <|speaker:N|> tag for each speaker turn.
- Narration (non-dialogue) is speaker index 0 unless clearly attributed otherwise.
- Dialogue in quotes → the speaking character's index. Attribute from the surrounding
  attribution clause; if attribution is ambiguous, keep it with the previous speaker.
- On every new <|speaker:N|> turn, consider a [pause] immediately before the first
  spoken word (after the tag) so turns do not run together.

PACING (priority — do this consistently):
- Treat this as professional audiobook delivery: slightly slower and more spacious
  than casual reading. Silence is part of the performance.
- Place [pause] after most sentence-ending punctuation (. ? !), before the next
  sentence starts. Use [pause] after ; : and — when the clause shift should land.
- Use [pause] before and after quoted dialogue when narration wraps the quotes.
- Use [pause] after attribution beats ("he said", "she whispered") when they sit
  between dialogue and narration.
- Dialogue-heavy paragraphs: aim for 4–8 [pause] tags. Narration-heavy: aim for 3–6.
  Short paragraphs (under ~120 chars): at least 1–2 [pause] if any sentence ends.
- Insert [pause] only between words or after punctuation — never inside a word.
- Optional [breath] once per paragraph at a natural inhale point (long sentence or
  before a tense line). Do not stack [breath] and [pause] back-to-back.

SLOWING DELIVERY (light touch):
- For narration blocks, you may open with [measured] or [unhurried] once per speaker
  turn when it helps set tempo (counts toward the direction limit).
- Wrap at most one short phrase per paragraph in <slow>...</slow> when the prose
  calls for weight or suspense. Never wrap the entire paragraph in <slow>.
- Do not use <fast> unless the text clearly demands rushing (chase, panic, rapid fire).

EMOTION & DIRECTION:
- Add a [direction] only where it clearly changes delivery. Do not annotate every sentence.
- If unsure about emotion, emit NO direction — use [pause] instead. Neutral + spaced
  beats beat wrong intensity.
- Max 3 [direction] brackets and 4 paired word-tag pairs per paragraph (excluding
  [pause], [breath], [sigh], [laugh]).
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
Next paragraph (context, do not annotate): ${next ?? "(none)"}

Pacing reminder: audiobook listener — generous [pause] between sentences and speaker
turns; at most one <slow>...</slow> phrase if warranted.`;
}
