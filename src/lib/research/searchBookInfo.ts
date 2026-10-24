import { chatText, getCommandcodeModel } from "@/lib/llm/commandcode";

export type SearchBookInfoResult = {
  snippets: string[];
  sourcesFound: number;
};

/**
 * Commandcode-native web research: ask the provider model to search and return
 * concise snippets. If the gateway cannot browse, this returns empty snippets
 * and character-map orchestration falls back to text sampling.
 */
export async function searchBookInfo(
  title: string,
  author: string,
): Promise<SearchBookInfoResult> {
  const query = `${title} ${author} book characters plot summary`;
  const text = await chatText([
    {
      role: "system",
      content:
        "You have web search. Find 3-5 reliable sources about this book (Wikipedia, publisher, Goodreads). Return plain text only: one block per source with URL and 2-4 sentences. No JSON.",
    },
    {
      role: "user",
      content: `Search the web for: ${query}`,
    },
  ]);

  const snippets = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);

  const sourcesFound = snippets.length;
  return { snippets, sourcesFound };
}

export function getSearchModelLabel(): string {
  return getCommandcodeModel();
}
