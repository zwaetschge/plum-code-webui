import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { auditFromRequest } from '../utils/auditLog.js';
import { watchdogService } from '../services/watchdogs/WatchdogService.js';

const router = Router();

router.use(requireAuth, requireAdmin);

function authUserId(req: Request): string {
  return (req as unknown as AuthenticatedRequest).userId;
}

const createWatchdogSchema = z.object({
  containerId: z.string().trim().min(1).max(160),
});

const consultWatchdogSchema = z.object({
  question: z.string().trim().min(1).max(20_000),
});

router.get('/', async (req, res) => {
  const userId = authUserId(req);
  res.json({ success: true, data: await watchdogService.list(userId) });
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createWatchdogSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Invalid watchdog payload', 400, 'VALIDATION_ERROR');
    const userId = authUserId(req);
    const watchdog = await watchdogService.create(userId, parsed.data.containerId);
    await auditFromRequest(req, 'watchdog.created', {
      resourceType: 'container_watchdog',
      resourceId: watchdog.id,
      metadata: { containerId: watchdog.containerId, sessionId: watchdog.sessionId },
    });
    res.status(201).json({ success: true, data: watchdog });
  })
);

router.get('/:id', async (req, res) => {
  const userId = authUserId(req);
  res.json({ success: true, data: await watchdogService.get(req.params.id!, userId) });
});

router.post(
  '/:id/snapshot',
  asyncHandler(async (req, res) => {
    const userId = authUserId(req);
    const watchdog = await watchdogService.get(req.params.id!, userId);
    const snapshot = await watchdogService.snapshot(watchdog.id, userId, watchdog.containerId);
    res.json({ success: true, data: snapshot });
  })
);

router.post(
  '/:id/consult',
  asyncHandler(async (req, res) => {
    const parsed = consultWatchdogSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Invalid consult payload', 400, 'VALIDATION_ERROR');
    const userId = authUserId(req);
    const delegation = await watchdogService.consult(req.params.id!, userId, parsed.data.question);
    await auditFromRequest(req, 'watchdog.consulted', {
      resourceType: 'container_watchdog',
      resourceId: req.params.id,
      metadata: { delegationId: delegation.id },
    });
    res.status(202).json({ success: true, data: delegation });
  })
);

export default router;
