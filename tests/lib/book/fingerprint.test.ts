import { describe, expect, it } from "vitest";
import { computeFingerprint } from "@/lib/book/fingerprint";

describe("computeFingerprint", () => {
  it("is stable for same title and opening text", () => {
    const text = "word ".repeat(6000);
    const a = computeFingerprint("My Book", text);
    const b = computeFingerprint("My Book", text);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("changes when title changes", () => {
    const text = "hello world ".repeat(100);
    expect(computeFingerprint("A", text)).not.toBe(
      computeFingerprint("B", text),
    );
  });
});
