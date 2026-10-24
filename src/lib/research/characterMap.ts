import { chatJson } from "@/lib/llm/commandcode";
import {
  CHARACTER_MAP_SYSTEM,
  characterMapUserMessage,
} from "@/lib/research/prompts/characterMap";
import { searchBookInfo } from "@/lib/research/searchBookInfo";
import {
  type CharacterMapResult,
  characterMapResponseSchema,
} from "@/lib/research/types";
import { splitChapters } from "@/lib/pdf/chapters";

function dialogueScore(chapterText: string): number {
  return (chapterText.match(/"/g) ?? []).length;
}

export function buildTextSample(fullText: string): string {
  const words = fullText.split(/\s+/).filter(Boolean);
  const firstPortion = words.slice(0, Math.ceil(words.length * 0.2)).join(" ");
  const chapters = splitChapters(fullText);
  const dense = [...chapters]
    .sort((a, b) => dialogueScore(b.rawText) - dialogueScore(a.rawText))
    .slice(0, 5)
    .map((c) => c.rawText)
    .join("\n\n");
  return `${firstPortion}\n\n--- dialogue-heavy chapters ---\n\n${dense}`;
}

async function runCharacterMapPrompt(
  title: string,
  author: string,
  mode: "web_research" | "text_sample",
  body: string,
  sourcesFound: number,
): Promise<CharacterMapResult> {
  const result = await chatJson(
    [
      { role: "system", content: CHARACTER_MAP_SYSTEM },
      {
        role: "user",
        content: characterMapUserMessage(title, author, mode, body),
      },
    ],
    characterMapResponseSchema,
  );
  return {
    ...result,
    mode,
    sources_found: mode === "web_research" ? sourcesFound : 0,
    characters: result.characters.map((c) => ({
      ...c,
      aliases: c.aliases ?? [],
    })),
  };
}

function averageConfidence(characters: CharacterMapResult["characters"]): number {
  if (!characters.length) return 0;
  return (
    characters.reduce((sum, c) => sum + c.confidence, 0) / characters.length
  );
}

export async function buildCharacterMap(input: {
  title: string;
  author: string;
  fullText: string;
}): Promise<CharacterMapResult> {
  const { snippets, sourcesFound } = await searchBookInfo(
    input.title,
    input.author,
  );

  let webResult: CharacterMapResult | null = null;
  if (snippets.length > 0) {
    webResult = await runCharacterMapPrompt(
      input.title,
      input.author,
      "web_research",
      snippets.join("\n\n"),
      sourcesFound,
    );
  }

  const webOk =
    webResult &&
    webResult.sources_found >= 2 &&
    averageConfidence(webResult.characters) >= 0.5;

  if (webOk) return webResult!;

  const sample = buildTextSample(input.fullText);
  return runCharacterMapPrompt(
    input.title,
    input.author,
    "text_sample",
    sample,
    0,
  );
}
