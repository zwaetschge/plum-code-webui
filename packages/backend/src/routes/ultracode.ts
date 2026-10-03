import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireHookSecret } from '../middleware/hookSecret.js';
import { getProcessManager } from '../websocket/index.js';

/**
 * Internal endpoint of Vibe's Ultracode workflow server
 * (scripts/mcp-servers/vibe-ultracode.mjs). The server runs inside the Vibe
 * process tree and reports its agents here, so they show up as subagent cards
 * while the workflow tool is still running, and books their tokens.
 */
const router = Router();

const progressSchema = z.object({
  details: z.record(z.string(), z.unknown()),
  usage: z
    .object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cached: z.number().nonnegative(),
    })
    .optional(),
});

router.post('/internal/progress', requireHookSecret, (req: Request, res: Response) => {
  const parsed = progressSchema.safeParse(req.body);
  const sessionId = req.header('x-webui-session-id') || '';
  if (!parsed.success || !sessionId) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error?.message ?? 'session id missing' },
    });
    return;
  }
  const applied = getProcessManager().applyVibeWorkflowProgress(sessionId, parsed.data);
  res.json({ success: true, data: { applied } });
});

export default router;
