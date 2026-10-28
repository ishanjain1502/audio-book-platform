import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { PUBLIC_VOICE_IDS } from "@/lib/fish/constants";
import { logFishRequest, voiceSlots } from "@/lib/fish/requestLog";

describe("fish request log", () => {
  const prev = process.env.DATA_DIR;
  let dir: string;

  afterEach(() => {
    process.env.DATA_DIR = prev;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("labels each reference slot with its speaker index and catalog name", () => {
    const slots = voiceSlots([
      PUBLIC_VOICE_IDS.adrian,
      PUBLIC_VOICE_IDS.delia,
      "custom-voice",
    ]);
    expect(slots).toEqual([
      { speaker: 0, voice_id: PUBLIC_VOICE_IDS.adrian, name: "adrian" },
      { speaker: 1, voice_id: PUBLIC_VOICE_IDS.delia, name: "delia" },
      { speaker: 2, voice_id: "custom-voice", name: null },
    ]);
  });

  it("appends one JSON line per call and does not invent an api key field", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fish-log-"));
    process.env.DATA_DIR = dir;
    logFishRequest({
      method: "POST",
      path: "/v1/tts",
      reference_id: voiceSlots([PUBLIC_VOICE_IDS.adrian]),
      text: "<|speaker:0|>Hello",
      status: 400,
    });
    const file = path.join(dir, "logs", "fish-requests.log");
    const line = JSON.parse(fs.readFileSync(file, "utf8").trim());
    expect(line.path).toBe("/v1/tts");
    expect(line.reference_id[0]).toEqual({
      speaker: 0,
      voice_id: PUBLIC_VOICE_IDS.adrian,
      name: "adrian",
    });
    expect(line).not.toHaveProperty("authorization");
    expect(JSON.stringify(line)).not.toContain("Bearer");
  });
});
