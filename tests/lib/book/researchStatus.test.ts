import { describe, expect, it } from "vitest";
import { deriveResearchStatus } from "@/lib/book/researchStatus";

const now = new Date("2026-10-27T12:00:00.000Z");

describe("deriveResearchStatus", () => {
  it("is ready when researched_at is set", () => {
    expect(
      deriveResearchStatus(
        {
          researchedAt: "2026-10-27T11:00:00.000Z",
          researchStartedAt: "2026-10-27T11:59:00.000Z",
          researchError: "old",
        },
        now,
      ),
    ).toBe("ready");
  });

  it("is running when the lock is younger than 10 minutes", () => {
    expect(
      deriveResearchStatus(
        {
          researchedAt: null,
          researchStartedAt: "2026-10-27T11:51:00.000Z",
          researchError: null,
        },
        now,
      ),
    ).toBe("running");
  });

  it("treats a lock older than 10 minutes as stale", () => {
    expect(
      deriveResearchStatus(
        {
          researchedAt: null,
          researchStartedAt: "2026-10-27T11:49:00.000Z",
          researchError: "boom",
        },
        now,
      ),
    ).toBe("failed");
    expect(
      deriveResearchStatus(
        {
          researchedAt: null,
          researchStartedAt: "2026-10-27T11:49:00.000Z",
          researchError: null,
        },
        now,
      ),
    ).toBe("idle");
  });

  it("is failed when an error is saved and idle otherwise", () => {
    expect(
      deriveResearchStatus(
        { researchedAt: null, researchStartedAt: null, researchError: "boom" },
        now,
      ),
    ).toBe("failed");
    expect(
      deriveResearchStatus(
        { researchedAt: null, researchStartedAt: null, researchError: null },
        now,
      ),
    ).toBe("idle");
  });
});
