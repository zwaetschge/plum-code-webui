import { Router } from 'express';
import { z } from 'zod';
import type { ApiResponse, HermesStatus } from '@plum-code-webui/shared';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  hermesStatus,
  setHermesAutoUpdatePaused,
  startAgentUpdate,
} from '../services/hermes/hermesAgent.js';

/**
 * The Hermes area: every Schwarm agent with its containers, Hermes version and
 * update. Reading is open to signed-in users; updates and the autoupdate pause
 * recreate or reconfigure host containers, so they are admin-only. Start and
 * restart go through the Schwarm directory's container actions.
 */
const router = Router();

const send = (res: import('express').Response, data: HermesStatus) =>
  res.json({ success: true, data } satisfies ApiResponse<HermesStatus>);
const user = (req: import('express').Request) => (req as AuthenticatedRequest).userId;

router.get('/', requireAuth, async (req, res) => {
  send(res, await hermesStatus(user(req), req.query.fresh === '1'));
});

const agentId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);

router.post('/agents/:id/update', requireAuth, requireAdmin, async (req, res) => {
  const parsed = agentId.safeParse(req.params.id);
  if (!parsed.success) throw new AppError('Invalid agent', 400, 'VALIDATION_ERROR');
  send(res, await startAgentUpdate(user(req), parsed.data));
});

/** App 1.9.13 updates Brian through this route. */
router.post('/update', requireAuth, requireAdmin, async (req, res) => {
  send(res, await startAgentUpdate(user(req), 'brian'));
});

const autoUpdateSchema = z.object({ paused: z.boolean() });

router.put('/auto-update', requireAuth, requireAdmin, async (req, res) => {
  const parsed = autoUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  send(res, await setHermesAutoUpdatePaused(user(req), parsed.data.paused));
});

export default router;
