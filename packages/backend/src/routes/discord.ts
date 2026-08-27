import { Router, type Request } from 'express';
import { z } from 'zod';
import type {
  DiscordAlertSeverity,
  DiscordIntegrationSettingsUpdate,
  DiscordTestResult,
} from '@plum-code-webui/shared';
import { requireAdmin, requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { auditFromRequest } from '../utils/auditLog.js';
import {
  discordIntegrationService,
  discordNotifier,
  discordOutboxWorker,
} from '../services/discord/index.js';

const router = Router();

router.use(requireAuth, requireAdmin);

const severitySchema = z.enum(['info', 'warning', 'error', 'critical']);
const gatewayModeSchema = z.enum(['alerts_only', 'supervisor', 'autonomous']);
const maintenancePolicySchema = z.enum(['approval_required', 'session_mode', 'autonomous_allowed']);

const updateSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  transport: z.enum(['webhook', 'bot']).optional(),
  webhookUrl: z.string().trim().min(1).max(2048).nullable().optional(),
  clearWebhookUrl: z.boolean().optional(),
  botToken: z.string().trim().min(20).max(256).nullable().optional(),
  clearBotToken: z.boolean().optional(),
  channelId: z
    .string()
    .trim()
    .regex(/^\d{5,40}$/)
    .nullable()
    .optional(),
  channelLabel: z.string().trim().max(80).nullable().optional(),
  minSeverity: severitySchema.optional(),
  gatewayMode: gatewayModeSchema.optional(),
  maintenancePolicy: maintenancePolicySchema.optional(),
  inboundJobsEnabled: z.boolean().optional(),
  criticalRoleId: z
    .string()
    .trim()
    .regex(/^\d{5,40}$/)
    .nullable()
    .optional(),
});

const outboxQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function authUserId(req: Request): string {
  return (req as AuthenticatedRequest).userId;
}

router.get('/settings', async (_req, res) => {
  res.json({ success: true, data: await discordIntegrationService.getSettings() });
});

router.put('/settings', async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid Discord settings payload', 400, 'VALIDATION_ERROR');
  }

  const payload: DiscordIntegrationSettingsUpdate = parsed.data;
  const settings = await discordIntegrationService.updateSettings({
    ...payload,
    minSeverity: payload.minSeverity as DiscordAlertSeverity | undefined,
  });
  await auditFromRequest(req, 'discord.settings.updated', {
    resourceType: 'discord_integration',
    metadata: {
      enabled: settings.enabled,
      configured: settings.configured,
      minSeverity: settings.minSeverity,
      webhookUrlFromEnv: settings.webhookUrlFromEnv,
    },
  });
  res.json({ success: true, data: settings });
});

router.post(
  '/test',
  asyncHandler(async (req, res) => {
    const settings = await discordIntegrationService.getSettings();
    if (!settings.configured) {
      throw new AppError(
        settings.transport === 'bot'
          ? 'Discord bot token or channel ID is not configured'
          : 'Discord webhook URL is not configured',
        400,
        'DISCORD_NOT_CONFIGURED'
      );
    }

    const item = await discordNotifier.queueTest(authUserId(req));
    if (!item) {
      throw new AppError('Discord test message could not be queued', 500, 'DISCORD_QUEUE_FAILED');
    }
    const result = await discordOutboxWorker.processNow(item.id, { ignoreEnabled: true });
    const response: DiscordTestResult = {
      queued: true,
      sent: result.sent,
      outboxId: item.id,
      error: result.error,
    };
    await auditFromRequest(req, 'discord.test.sent', {
      resourceType: 'discord_outbox',
      resourceId: item.id,
      metadata: { sent: result.sent, error: result.error },
    });
    res.json({ success: true, data: response });
  })
);

router.get('/outbox', async (req, res) => {
  const parsed = outboxQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError('Invalid outbox query', 400, 'VALIDATION_ERROR');
  }
  res.json({ success: true, data: await discordNotifier.listOutbox(parsed.data.limit) });
});

export default router;
