import fs from "fs";
import { FatalFishError } from "@/lib/fish/retry";

function fishBaseUrl(): string {
  return process.env.FISH_BASE_URL ?? "https://api.fish.audio";
}

/** Upload narrator reference clip via Fish references API. */
export async function cloneVoiceFromFile(
  filePath: string,
  referenceId: string,
  transcript: string,
): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("id", referenceId);
  form.append(
    "audio",
    new Blob([fileBuffer]),
    filePath.endsWith(".wav") ? "sample.wav" : "sample.mp3",
  );
  form.append("text", transcript);

  const res = await fetch(`${fishBaseUrl()}/v1/references/add`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FISH_API_KEY ?? ""}`,
    },
    body: form,
  });

  if (!res.ok) {
    throw new FatalFishError(await res.text());
  }
  return referenceId;
}
