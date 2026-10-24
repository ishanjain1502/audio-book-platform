import type { AssignedCharacter } from "@/lib/voices/assign";
import { getDb } from "@/lib/db/client";

export function loadCharacterMaps(
  bookId: number,
): AssignedCharacter[] | null {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT name, aliases_json, role, speaks, gender_presentation, age_impression,
              tonality_json, confidence, source, speaker_index, voice_id
       FROM character_maps WHERE book_id = ? ORDER BY speaker_index`,
    )
    .all(bookId) as {
    name: string;
    aliases_json: string | null;
    role: string;
    speaks: number;
    gender_presentation: string | null;
    age_impression: string | null;
    tonality_json: string;
    confidence: number;
    source: string;
    speaker_index: number;
    voice_id: string;
  }[];

  if (!rows.length) return null;

  return rows.map((r) => ({
    name: r.name,
    aliases: r.aliases_json ? JSON.parse(r.aliases_json) : [],
    role: r.role as AssignedCharacter["role"],
    speaks: Boolean(r.speaks),
    gender_presentation: r.gender_presentation,
    age_impression: r.age_impression as AssignedCharacter["age_impression"],
    tonality: JSON.parse(r.tonality_json) as string[],
    confidence: r.confidence,
    source: r.source,
    speaker_index: r.speaker_index,
    voice_id: r.voice_id,
  }));
}

export function saveCharacterMaps(
  bookId: number,
  characters: AssignedCharacter[],
  mode: string,
): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR REPLACE INTO character_maps
     (book_id, name, aliases_json, role, speaks, gender_presentation, age_impression,
      tonality_json, confidence, source, mode, speaker_index, voice_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of characters) {
    insert.run(
      bookId,
      c.name,
      JSON.stringify(c.aliases ?? []),
      c.role,
      c.speaks ? 1 : 0,
      c.gender_presentation,
      c.age_impression,
      JSON.stringify(c.tonality),
      c.confidence,
      c.source,
      mode,
      c.speaker_index,
      c.voice_id,
    );
  }
}
