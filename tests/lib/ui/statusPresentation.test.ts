import { describe, expect, it } from "vitest";
import { statusPresentation } from "@/lib/ui/statusPresentation";

describe("statusPresentation", () => {
  it("marks completed jobs as done", () => {
    expect(statusPresentation("completed").tone).toBe("done");
  });

  it("marks failed jobs as error", () => {
    expect(statusPresentation("failed").tone).toBe("error");
  });

  it("defaults unknown statuses to neutral", () => {
    expect(statusPresentation("queued").tone).toBe("neutral");
  });
});
