import { SPEAKER_TAG_RE } from "@/lib/fish/constants";

const TAG_RE =
  /<\/?(?:whisper|emphasis|soft|fast|slow|stress|forceful)>|\[[^\]]+\]/gi;

export function stripAnnotationTags(text: string): string {
  return text.replace(SPEAKER_TAG_RE, "").replace(TAG_RE, "");
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isVerbatimParagraph(
  original: string,
  annotated: string,
): boolean {
  return (
    normalizeWhitespace(stripAnnotationTags(annotated)) ===
    normalizeWhitespace(original)
  );
}
