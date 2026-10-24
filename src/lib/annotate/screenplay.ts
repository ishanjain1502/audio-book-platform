import { z } from "zod";
import { chatJson } from "@/lib/llm/commandcode";
import { isVerbatimParagraph } from "@/lib/annotate/verbatim";
import {
  SCREENPLAY_SYSTEM,
  screenplayUserMessage,
} from "@/lib/annotate/prompts/screenplay";
import { MAX_SPEAKERS, SPEAKER_TAG_RE } from "@/lib/fish/constants";

const screenplaySchema = z.object({
  annotated: z.string(),
  speakers_used: z.array(z.number()).default([]),
  notes: z.string().nullable().optional(),
});

export function fallbackAnnotation(
  paragraph: string,
  defaultSpeaker = 0,
): string {
  return `<|speaker:${defaultSpeaker}|>${paragraph}`;
}

function validateSpeakers(
  annotated: string,
  speakerMap: Record<string, number>,
): boolean {
  const allowed = new Set(Object.values(speakerMap));
  const matches = annotated.matchAll(SPEAKER_TAG_RE);
  for (const m of matches) {
    const n = Number(m[1]);
    if (!allowed.has(n) || n >= MAX_SPEAKERS) return false;
  }
  return true;
}

export async function annotateParagraph(input: {
  paragraph: string;
  prev: string | null;
  next: string | null;
  speakerMap: Record<string, number>;
}): Promise<{ annotated: string; speakersUsed: number[] }> {
  const speakerMapJson = JSON.stringify(input.speakerMap);

  const run = async (extra?: string) => {
    const messages = [
      { role: "system" as const, content: SCREENPLAY_SYSTEM },
      {
        role: "user" as const,
        content:
          screenplayUserMessage(
            speakerMapJson,
            input.paragraph,
            input.prev,
            input.next,
          ) + (extra ? `\n\n${extra}` : ""),
      },
    ];
    return chatJson(messages, screenplaySchema);
  };

  try {
    let result = await run();
    if (
      !isVerbatimParagraph(input.paragraph, result.annotated) ||
      !validateSpeakers(result.annotated, input.speakerMap)
    ) {
      result = await run(
        "Your annotated text must be verbatim when tags are stripped.",
      );
    }
    if (
      !isVerbatimParagraph(input.paragraph, result.annotated) ||
      !validateSpeakers(result.annotated, input.speakerMap)
    ) {
      return {
        annotated: fallbackAnnotation(input.paragraph),
        speakersUsed: [0],
      };
    }
    return {
      annotated: result.annotated,
      speakersUsed: result.speakers_used ?? [],
    };
  } catch {
    return {
      annotated: fallbackAnnotation(input.paragraph),
      speakersUsed: [0],
    };
  }
}
