/** Pinned from https://docs.fish.audio/features/text-to-speech/drama-3 (2026-03-24). */

export const DRAMA3_MODEL = "drama-3";
export const DEFAULT_FALLBACK_MODEL = "s2.1-pro";
export const MAX_SPEAKERS = 16;
export const MAX_ANNOTATED_CHARS = 2000;

export const PAIRED_WORD_TAGS = [
  "whisper",
  "emphasis",
  "soft",
  "fast",
  "slow",
  "stress",
  "forceful",
] as const;

export const INLINE_SOUND_TAGS = ["sigh", "laugh", "breath", "pause"] as const;

export const SPEAKER_TAG_RE = /<\|speaker:(\d+)\|>/g;

export const PUBLIC_VOICE_IDS = {
  adrian: "bf322df2096a46f18c579d0baa36f41d",
  delia: "c70cfb98867a4bfb9ae20d2401257b92",
  sheila: "f3a2b90078d54a65af4b95f63bc7798e",
} as const;
