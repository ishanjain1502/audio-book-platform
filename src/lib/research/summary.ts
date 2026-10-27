export type CharacterSummary = {
  name: string;
  role: string;
  tonality: string[];
};

export function toCharacterSummaries(
  characters: { name: string; role: string; tonality: string[] }[],
): CharacterSummary[] {
  return characters.map((character) => ({
    name: character.name,
    role: character.role,
    tonality: character.tonality,
  }));
}
