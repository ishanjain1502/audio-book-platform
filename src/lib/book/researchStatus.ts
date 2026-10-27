export const RESEARCH_LOCK_MS = 10 * 60 * 1000;

export type ResearchStatus = "idle" | "running" | "ready" | "failed";

export function deriveResearchStatus(
  book: {
    researchedAt: string | null;
    researchStartedAt: string | null;
    researchError: string | null;
  },
  now: Date,
): ResearchStatus {
  if (book.researchedAt) return "ready";
  if (book.researchStartedAt) {
    const started = Date.parse(book.researchStartedAt);
    if (Number.isFinite(started) && now.getTime() - started < RESEARCH_LOCK_MS) {
      return "running";
    }
  }
  if (book.researchError) return "failed";
  return "idle";
}
