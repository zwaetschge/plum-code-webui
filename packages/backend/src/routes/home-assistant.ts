import { get as pgGet, run as pgRun } from '../db/pg.js';
import { Router } from 'express';
import { z } from 'zod';
import type {
  HomeAssistantIntegrationSettingsUpdate,
  HomeAssistantStatus,
} from '@plum-code-webui/shared';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin, requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { homeAssistantStatusLights } from '../services/home-assistant/index.js';

const router = Router();

router.use(requireAuth);

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().trim().max(512).optional(),
  accessToken: z.string().trim().max(4096).optional(),
  clearAccessToken: z.boolean().optional(),
});

const testConnectionSchema = z.object({
  baseUrl: z.string().trim().max(512).optional(),
  accessToken: z.string().trim().max(4096).optional(),
});

const lightAssignmentSchema = z.object({
  entityId: z.string().trim().max(255).nullable(),
});

const statusSchema = z.object({
  status: z.enum(['success', 'problem', 'question']),
});

router.get('/settings', (_req, res) => {
  res.json({ success: true, data: homeAssistantStatusLights.getSettings() });
});

router.put('/settings', requireAdmin, (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success)
    throw new AppError('Invalid Home Assistant settings', 400, 'VALIDATION_ERROR');
  try {
    const settings = homeAssistantStatusLights.updateSettings(
      parsed.data as HomeAssistantIntegrationSettingsUpdate
    );
    res.json({ success: true, data: settings });
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : 'Could not save Home Assistant settings',
      400,
      'HOME_ASSISTANT_SETTINGS_ERROR'
    );
  }
});

router.post(
  '/test',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = testConnectionSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError('Invalid connection settings', 400, 'VALIDATION_ERROR');
    try {
      const result = await homeAssistantStatusLights.testConnection(parsed.data);
      res.json({ success: true, data: result });
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Home Assistant is not reachable',
        502,
        'HOME_ASSISTANT_UNREACHABLE'
      );
    }
  })
);

router.get(
  '/lights',
  asyncHandler(async (_req, res) => {
    try {
      const lights = await homeAssistantStatusLights.listLights();
      res.json({ success: true, data: lights });
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Could not load Home Assistant lights',
        502,
        'HOME_ASSISTANT_LIGHTS_ERROR'
      );
    }
  })
);

router.put(
  '/sessions/:sessionId/light',
  asyncHandler(async (req, res) => {
    const parsed = lightAssignmentSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Invalid light entity', 400, 'VALIDATION_ERROR');
    const userId = (req as AuthenticatedRequest).userId;

    const session = (await pgGet(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
      req.params.sessionId,
      userId
    )) as unknown as { id: string } | undefined;
    if (!session) throw new AppError('Session not found', 404, 'NOT_FOUND');

    const entityId = parsed.data.entityId || null;
    if (entityId) {
      try {
        await homeAssistantStatusLights.validateLightEntity(entityId);
      } catch (error) {
        throw new AppError(
          error instanceof Error ? error.message : 'Home Assistant light is not available',
          400,
          'INVALID_HOME_ASSISTANT_LIGHT'
        );
      }
    }

    await pgRun(
      `UPDATE sessions
       SET home_assistant_entity_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      entityId,
      req.params.sessionId,
      userId
    );
    res.json({ success: true, data: { entityId } });
  })
);

router.post(
  '/sessions/:sessionId/test',
  asyncHandler(async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Invalid status', 400, 'VALIDATION_ERROR');
    const userId = (req as AuthenticatedRequest).userId;
    try {
      await homeAssistantStatusLights.previewSession(
        req.params.sessionId as string,
        userId,
        parsed.data.status as HomeAssistantStatus
      );
      res.status(202).json({ success: true, data: { started: true } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start light preview';
      throw new AppError(
        message,
        message === 'Session not found' ? 404 : 400,
        'HOME_ASSISTANT_PREVIEW_ERROR'
      );
    }
  })
);

export default router;
