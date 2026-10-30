import { normalizeAuthor } from "@/lib/book/meta";

export function canConfirm(input: {
  jobStatus: string;
  researchedAt: string | null;
  title: string;
  author: string | null;
  pageCount: number;
}):
  | { ok: true; title: string; author: string | null; pageCount: number }
  | { ok: false; reason: string } {
  const title = input.title.trim();
  if (!title) return { ok: false, reason: "Title is required" };
  if (!Number.isInteger(input.pageCount) || input.pageCount < 1) {
    return { ok: false, reason: "Page count must be a positive integer" };
  }
  if (input.jobStatus !== "awaiting_review") {
    return { ok: false, reason: "Job is not awaiting review" };
  }
  if (!input.researchedAt) {
    return { ok: false, reason: "Book research is not ready" };
  }
  return {
    ok: true,
    title,
    author: normalizeAuthor(input.author),
    pageCount: input.pageCount,
  };
}

export function canGenerateAudiobook(input: {
  jobStatus: string;
  title: string;
  author: string | null;
  pageCount: number;
  sectionsComplete: boolean;
  allReviewed: boolean;
  linesHaveText: boolean;
}):
  | { ok: true; title: string; author: string | null; pageCount: number }
  | { ok: false; reason: string } {
  const title = input.title.trim();
  if (!title) return { ok: false, reason: "Title is required" };
  if (!Number.isInteger(input.pageCount) || input.pageCount < 1) {
    return { ok: false, reason: "Page count must be a positive integer" };
  }
  if (input.jobStatus !== "awaiting_annotation" || !input.sectionsComplete) {
    return { ok: false, reason: "Annotation is not ready" };
  }
  if (!input.allReviewed) {
    return { ok: false, reason: "Every section must be checked" };
  }
  if (!input.linesHaveText) {
    return { ok: false, reason: "Every line must have text" };
  }
  return {
    ok: true,
    title,
    author: normalizeAuthor(input.author),
    pageCount: input.pageCount,
  };
}
