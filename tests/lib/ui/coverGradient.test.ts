import { describe, expect, it } from "vitest";
import { coverGradientFromSeed } from "@/lib/ui/coverGradient";

describe("coverGradientFromSeed", () => {
  it("returns stable colors for the same seed", () => {
    const a = coverGradientFromSeed("chapter-1");
    const b = coverGradientFromSeed("chapter-1");
    expect(a).toEqual(b);
    expect(a.from).toMatch(/^#/);
    expect(a.to).toMatch(/^#/);
  });

  it("returns different colors for different seeds", () => {
    const a = coverGradientFromSeed("alpha");
    const b = coverGradientFromSeed("beta");
    expect(a.from).not.toBe(b.from);
  });
});
