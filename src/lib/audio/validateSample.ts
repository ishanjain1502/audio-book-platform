import { parseBuffer } from "music-metadata";

export class VoiceSampleError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "VoiceSampleError";
  }
}

const MIN_SEC = 15.0;
const MAX_SEC = 20.0;

export async function validateVoiceSample(
  buffer: Buffer,
): Promise<{ durationSec: number }> {
  let durationSec: number;
  try {
    const meta = await parseBuffer(buffer, undefined, { duration: true });
    durationSec = meta.format.duration ?? 0;
  } catch {
    throw new VoiceSampleError("Unsupported audio format");
  }

  if (durationSec < MIN_SEC || durationSec > MAX_SEC) {
    const rounded = Math.round(durationSec * 10) / 10;
    throw new VoiceSampleError(
      `Voice sample must be 15–20 seconds. Yours is ${rounded}s.`,
    );
  }

  return { durationSec };
}
