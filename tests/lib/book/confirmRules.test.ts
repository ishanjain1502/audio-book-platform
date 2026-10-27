import { describe, expect, it } from "vitest";
import { canConfirm } from "@/lib/book/confirmRules";

const ready = {
  jobStatus: "awaiting_review",
  researchedAt: "2026-10-27T11:00:00.000Z",
  title: "  Dune  ",
  author: "   ",
  pageCount: 12,
};

describe("canConfirm", () => {
  it("accepts a reviewed book and stores a blank author as null", () => {
    const result = canConfirm(ready);
    expect(result).toEqual({
      ok: true,
      title: "Dune",
      author: null,
      pageCount: 12,
    });
  });

  it("rejects an empty title, a bad page count, a job that is not awaiting review, and missing research", () => {
    expect(canConfirm({ ...ready, title: " " })).toMatchObject({
      ok: false,
      reason: "Title is required",
    });
    expect(canConfirm({ ...ready, pageCount: 1.5 })).toMatchObject({
      ok: false,
      reason: "Page count must be a positive integer",
    });
    expect(canConfirm({ ...ready, jobStatus: "queued" })).toMatchObject({
      ok: false,
      reason: "Job is not awaiting review",
    });
    expect(canConfirm({ ...ready, researchedAt: null })).toMatchObject({
      ok: false,
      reason: "Book research is not ready",
    });
  });
});
