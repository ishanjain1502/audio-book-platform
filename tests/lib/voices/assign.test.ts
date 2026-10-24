import { describe, expect, it } from "vitest";
import { assignVoices } from "@/lib/voices/assign";
import type { Character } from "@/lib/research/types";

const base: Character[] = [
  {
    name: "Narrator",
    aliases: [],
    role: "narrator",
    speaks: true,
    gender_presentation: null,
    age_impression: "adult",
    tonality: ["warm", "storytelling"],
    confidence: 1,
    source: "test",
  },
  {
    name: "Hero",
    aliases: [],
    role: "protagonist",
    speaks: true,
    gender_presentation: "male",
    age_impression: "adult",
    tonality: ["authoritative"],
    confidence: 1,
    source: "test",
  },
];

describe("assignVoices", () => {
  it("assigns distinct voices and narrator index 0", () => {
    const assigned = assignVoices(base);
    const narrator = assigned.find((c) => c.role === "narrator");
    expect(narrator?.speaker_index).toBe(0);
    const ids = new Set(assigned.map((c) => c.voice_id));
    expect(ids.size).toBe(assigned.length);
  });
});
