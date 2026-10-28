import { concatMp3Buffers } from "@/lib/audio/stitch";
import {
  CompactRequestError,
  compactFishRequest,
} from "@/lib/fish/compactRequest";
import {
  DEFAULT_FALLBACK_MODEL,
  DRAMA3_MODEL,
  MAX_ANNOTATED_CHARS,
} from "@/lib/fish/constants";
import { logFishRequest, voiceSlots } from "@/lib/fish/requestLog";
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
    const compacted = compactFishRequest(chunk, input.referenceIds);
    const buf = await retryWithBackoff(
      async () => {
        const body = {
          text: compacted.text,
          reference_id: compacted.referenceIds,
          format: "mp3",
        };
        const res = await fetch(`${fishBaseUrl()}/v1/tts`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.FISH_API_KEY ?? ""}`,
            "Content-Type": "application/json",
            model,
          },
          body: JSON.stringify(body),
        });
        const responseText = res.ok ? null : await res.text();
        logFishRequest({
          method: "POST",
          path: "/v1/tts",
          model,
          format: body.format,
          text: body.text,
          reference_id: voiceSlots(body.reference_id),
          status: res.status,
          response: responseText,
        });
        if (res.status === 429 || res.status >= 500) {
          throw new RetryableError(res.status, responseText ?? "");
        }
        if (!res.ok) {
          throw new FatalFishError(responseText ?? "");
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
  } catch (err) {
    if (err instanceof CompactRequestError) throw err;
    const fallback =
      process.env.FISH_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL;
    return synthesize({ ...input, model: fallback });
  }
}
