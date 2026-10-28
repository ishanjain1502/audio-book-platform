import fs from "fs";
import path from "path";
import { PUBLIC_VOICE_IDS } from "@/lib/fish/constants";

const NAME_BY_ID = new Map<string, string>(
  Object.entries(PUBLIC_VOICE_IDS).map(([name, id]) => [id, name]),
);

export type FishVoiceSlot = {
  speaker: number;
  voice_id: string;
  name: string | null;
};

export function voiceSlots(referenceIds: string[]): FishVoiceSlot[] {
  return referenceIds.map((voiceId, speaker) => ({
    speaker,
    voice_id: voiceId,
    name: NAME_BY_ID.get(voiceId) ?? null,
  }));
}

function logPath(): string {
  const raw = process.env.DATA_DIR ?? "./src/data";
  const base = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  return path.join(base, "logs", "fish-requests.log");
}

/** One JSON line per Fish HTTP call. Never pass the API key or audio bytes. */
export function logFishRequest(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  console.info(`[fish] ${line}`);
  const file = logPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line + "\n");
}
