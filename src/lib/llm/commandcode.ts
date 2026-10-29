import OpenAI from "openai";
import { wrapOpenAI } from "neatlogs";
import type { z } from "zod";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.COMMANDCODE_API_KEY;
  if (!apiKey) {
    throw new Error("COMMANDCODE_API_KEY is not set");
  }
  client = wrapOpenAI(
    new OpenAI({
      apiKey,
      baseURL:
        process.env.COMMANDCODE_BASE_URL ??
        "https://api.commandcode.ai/provider/v1",
    }),
  );
  return client;
}

export function getCommandcodeModel(): string {
  return process.env.COMMANDCODE_MODEL ?? "deepseek/deepseek-v4-flash";
}

export async function chatJson<T>(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  schema: z.ZodType<T>,
): Promise<T> {
  const client = getClient();
  const model = getCommandcodeModel();

  const attempt = async (extraUser?: string) => {
    const attemptMessages = extraUser
      ? [...messages, { role: "user" as const, content: extraUser }]
      : messages;
    const completion = await client.chat.completions.create({
      model,
      messages: attemptMessages,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as unknown;
    return schema.parse(parsed);
  };

  try {
    return await attempt();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "JSON validation failed";
    return await attempt(
      `Previous response failed validation: ${message}. Return valid JSON only.`,
    );
  }
}

export async function chatText(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<string> {
  const client = getClient();
  const completion = await client.chat.completions.create({
    model: getCommandcodeModel(),
    messages,
  });
  return completion.choices[0]?.message?.content ?? "";
}
