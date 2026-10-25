import { z } from 'zod';

export const CHAT_OPTIONS = z
  .object({
    webSearch: z.boolean().default(false),
    mcpServerIds: z.array(z.string().min(1).max(300)).max(6).default([]),
    allowToolWrites: z.boolean().default(false),
    comparisonModels: z
      .array(
        z
          .object({ providerId: z.string().min(1).max(200), model: z.string().min(1).max(200) })
          .strict()
      )
      .max(3)
      .default([]),
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().min(128).max(32768).default(8192),
    contextTurns: z.number().int().min(1).max(100).default(20),
    fullDocuments: z.boolean().default(false),
  })
  .strict();
export type ChatOptions = z.infer<typeof CHAT_OPTIONS>;
export const chatOptions = (body: Record<string, unknown>) =>
  CHAT_OPTIONS.parse(body.chatOptions ?? {});
