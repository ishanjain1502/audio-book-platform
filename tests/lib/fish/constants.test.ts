import { describe, expect, it } from "vitest";
import {
  DRAMA3_MODEL,
  MAX_SPEAKERS,
  PAIRED_WORD_TAGS,
} from "@/lib/fish/constants";

describe("fish constants", () => {
  it("pins drama-3 model and speaker cap", () => {
    expect(DRAMA3_MODEL).toBe("drama-3");
    expect(MAX_SPEAKERS).toBe(16);
    expect(PAIRED_WORD_TAGS.length).toBeGreaterThan(0);
  });
});
