import voices from "@/lib/voices/voices.json";
import type { Character } from "@/lib/research/types";

export type VoiceEntry = {
  id: string;
  name: string;
  gender: string;
  age_impression: string;
  language: string;
  tags: string[];
  reserved_for: string | null;
};

const ROLE_ORDER: Record<Character["role"], number> = {
  protagonist: 0,
  antagonist: 1,
  supporting: 2,
  narrator: -1,
};

function tagOverlap(characterTags: string[], voiceTags: string[]): number {
  const a = new Set(characterTags.map((t) => t.toLowerCase()));
  let score = 0;
  for (const t of voiceTags) {
    if (a.has(t.toLowerCase())) score += 1;
  }
  return score;
}

export type AssignedCharacter = Character & {
  speaker_index: number;
  voice_id: string;
};

export function assignVoices(
  characters: Character[],
  narratorVoiceId?: string | null,
): AssignedCharacter[] {
  const library = voices as VoiceEntry[];
  const used = new Set<string>();

  const narratorChar = characters.find((c) => c.role === "narrator");
  const others = characters.filter((c) => c.role !== "narrator");

  const sorted = [...others].sort((a, b) => {
    const ra = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
    if (ra !== 0) return ra;
    return a.name.localeCompare(b.name);
  });

  const assigned: AssignedCharacter[] = [];

  let narratorVoice =
    narratorVoiceId ??
    library.find((v) => v.reserved_for === "narrator")?.id ??
    library[0].id;
  used.add(narratorVoice);

  if (narratorChar) {
    assigned.push({
      ...narratorChar,
      speaker_index: 0,
      voice_id: narratorVoice,
    });
  }

  let nextIndex = 1;
  for (const character of sorted) {
    const candidates = library
      .filter((v) => !used.has(v.id))
      .map((v) => ({
        v,
        score: tagOverlap(character.tonality, v.tags),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.v.id.localeCompare(b.v.id);
      });

    const pick = candidates[0]?.v ?? library.find((v) => !used.has(v.id));
    if (!pick) {
      const fallback = library[0];
      assigned.push({
        ...character,
        speaker_index: nextIndex++,
        voice_id: fallback.id,
      });
      continue;
    }

    used.add(pick.id);
    assigned.push({
      ...character,
      speaker_index: nextIndex++,
      voice_id: pick.id,
    });
  }

  return assigned.sort((a, b) => a.speaker_index - b.speaker_index);
}

export function speakerMapForChapter(
  assigned: AssignedCharacter[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const c of assigned) {
    map[c.name] = c.speaker_index;
    for (const alias of c.aliases ?? []) {
      map[alias] = c.speaker_index;
    }
  }
  return map;
}

export function referenceIdsInOrder(
  assigned: AssignedCharacter[],
): string[] {
  const maxIndex = Math.max(...assigned.map((c) => c.speaker_index));
  const ids: string[] = [];
  for (let i = 0; i <= maxIndex; i++) {
    const char = assigned.find((c) => c.speaker_index === i);
    ids[i] = char?.voice_id ?? assigned[0].voice_id;
  }
  return ids;
}
