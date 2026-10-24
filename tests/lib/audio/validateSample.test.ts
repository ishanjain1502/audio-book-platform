import { describe, expect, it } from "vitest";
import {
  validateVoiceSample,
  VoiceSampleError,
} from "@/lib/audio/validateSample";

describe("validateVoiceSample", () => {
  it("rejects non-audio buffer", async () => {
    await expect(validateVoiceSample(Buffer.from("not audio"))).rejects.toThrow(
      VoiceSampleError,
    );
  });
});
