import { concatMp3Buffers } from "@/lib/audio/stitch";
import {
  DEFAULT_FALLBACK_MODEL,
  DRAMA3_MODEL,
  MAX_ANNOTATED_CHARS,
} from "@/lib/fish/constants";
import {
  FatalFishError,
  RetryableError,
  retryWithBackoff,
} from "@/lib/fish/retry";

function fishBaseUrl(): string {
  return process.env.FISH_BASE_URL ?? "https://api.fish.audio";
}

function splitLongText(text: string): string[] {
  if (text.length <= MAX_ANNOTATED_CHARS) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    parts.push(text.slice(start, start + MAX_ANNOTATED_CHARS));
    start += MAX_ANNOTATED_CHARS;
  }
  return parts;
}

export async function synthesize(input: {
  annotatedText: string;
  referenceIds: string[];
  model?: string;
}): Promise<Buffer> {
  const model = input.model ?? DRAMA3_MODEL;
  const chunks = splitLongText(input.annotatedText);
  const buffers: Buffer[] = [];

  for (const chunk of chunks) {
    const buf = await retryWithBackoff(
      async () => {
        const res = await fetch(`${fishBaseUrl()}/v1/tts`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.FISH_API_KEY ?? ""}`,
            "Content-Type": "application/json",
            model,
          },
          body: JSON.stringify({
            text: chunk,
            reference_id: input.referenceIds,
            format: "mp3",
          }),
        });
        if (res.status === 429 || res.status >= 500) {
          throw new RetryableError(res.status, await res.text());
        }
        if (!res.ok) {
          throw new FatalFishError(await res.text());
        }
        return Buffer.from(await res.arrayBuffer());
      },
      { attempts: 5 },
    );
    buffers.push(buf);
  }

  return concatMp3Buffers(buffers);
}

export async function synthesizeWithFallback(input: {
  annotatedText: string;
  referenceIds: string[];
}): Promise<Buffer> {
  try {
    return await synthesize({ ...input, model: DRAMA3_MODEL });
  } catch {
    const fallback =
      process.env.FISH_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL;
    return synthesize({ ...input, model: fallback });
  }
}
