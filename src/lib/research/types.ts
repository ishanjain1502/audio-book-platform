import { z } from "zod";

export const characterSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  role: z.enum(["narrator", "protagonist", "antagonist", "supporting"]),
  speaks: z.boolean(),
  gender_presentation: z.string().nullable(),
  age_impression: z
    .enum(["child", "young-adult", "adult", "mature", "elderly"])
    .nullable(),
  tonality: z.array(z.string()),
  confidence: z.number(),
  source: z.string(),
});

export const characterMapResponseSchema = z.object({
  book_title: z.string(),
  author: z.string(),
  mode: z.enum(["web_research", "text_sample"]),
  sources_found: z.number(),
  characters: z.array(characterSchema),
});

export type CharacterMapResult = z.infer<typeof characterMapResponseSchema>;
export type Character = z.infer<typeof characterSchema>;
