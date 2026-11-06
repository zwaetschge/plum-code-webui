import { z } from 'zod';
/** Accepted only on an authenticated owner's !auftrag event. Legacy text commands remain unchanged. */
const schema = z
  .object({
    v: z.literal(1),
    assignee: z.string().regex(/^[-a-zA-Z0-9_/]+$/),
    goal: z.string().trim().min(1).max(50000),
    context: z.string().max(120000).optional(),
    deliverables: z.array(z.string().max(200)).max(30).default([]),
    budgetUsd: z
      .union([
        z.number(),
        z
          .string()
          .regex(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i)
          .transform(Number),
      ])
      .pipe(z.number().finite().nonnegative().max(100000))
      .optional(),
    deadline: z.string().datetime().optional(),
  })
  .strict();
export function parsePlumTaskRequest(input: unknown, assignee: string) {
  if (input === undefined) return null;
  const parsed = schema.parse(input);
  if (parsed.assignee !== assignee)
    throw new Error('Plum-Auftrag und nativer Agent stimmen nicht überein');
  return parsed;
}
