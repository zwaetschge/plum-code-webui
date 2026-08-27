import { get as pgGet } from '../../db/pg.js';
import type {
  DiscordAlertSeverity,
  DiscordGatewayMode,
  DiscordAlertTransport,
  DiscordIntegrationSettings,
  DiscordMaintenancePolicy,
} from '@plum-code-webui/shared';
import { getAppConfig, setAppConfig } from '../../db/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { safeDecrypt, safeEncrypt } from '../../utils/encryption.js';

const CONFIG_KEYS = {
  enabled: 'discord_alerts_enabled',
  transport: 'discord_alert_transport',
  webhookUrl: 'discord_webhook_url_encrypted',
  botToken: 'discord_bot_token_encrypted',
  channelId: 'discord_channel_id',
  minSeverity: 'discord_alert_min_severity',
  gatewayMode: 'discord_gateway_mode',
  maintenancePolicy: 'discord_maintenance_policy',
  inboundJobsEnabled: 'discord_inbound_jobs_enabled',
  channelLabel: 'discord_channel_label',
  criticalRoleId: 'discord_critical_role_id',
} as const;

const SEVERITY_ORDER: Record<DiscordAlertSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

const VALID_SEVERITIES = new Set<DiscordAlertSeverity>(['info', 'warning', 'error', 'critical']);
const VALID_GATEWAY_MODES = new Set<DiscordGatewayMode>([
  'alerts_only',
  'supervisor',
  'autonomous',
]);
const VALID_MAINTENANCE_POLICIES = new Set<DiscordMaintenancePolicy>([
  'approval_required',
  'session_mode',
  'autonomous_allowed',
]);

function parseBoolean(value: string | null | undefined): boolean | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function parseSeverity(value: string | null | undefined): DiscordAlertSeverity {
  const normalized = value?.trim().toLowerCase();
  return VALID_SEVERITIES.has(normalized as DiscordAlertSeverity)
    ? (normalized as DiscordAlertSeverity)
    : 'warning';
}

function parseTransport(value: string | null | undefined): DiscordAlertTransport {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'bot' ? 'bot' : 'webhook';
}

function parseGatewayMode(value: string | null | undefined): DiscordGatewayMode {
  const normalized = value?.trim().toLowerCase();
  return VALID_GATEWAY_MODES.has(normalized as DiscordGatewayMode)
    ? (normalized as DiscordGatewayMode)
    : 'supervisor';
}

function parseMaintenancePolicy(value: string | null | undefined): DiscordMaintenancePolicy {
  const normalized = value?.trim().toLowerCase();
  return VALID_MAINTENANCE_POLICIES.has(normalized as DiscordMaintenancePolicy)
    ? (normalized as DiscordMaintenancePolicy)
    : 'session_mode';
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeBotTokenText(value: string | null | undefined): string | null {
  let trimmed = value?.trim();
  if (!trimmed) return null;
  const prefixed = trimmed.match(/^(?:Bot|Bearer)\s+(.+)$/i);
  if (prefixed?.[1]) {
    trimmed = prefixed[1].trim();
  }
  return trimmed;
}

function validateWebhookUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppError('Invalid Discord webhook URL', 400, 'INVALID_WEBHOOK_URL');
  }

  const host = url.hostname.toLowerCase();
  const validHost =
    host === 'discord.com' ||
    host === 'discordapp.com' ||
    host === 'canary.discord.com' ||
    host === 'ptb.discord.com';
  if (!validHost || url.protocol !== 'https:' || !url.pathname.startsWith('/api/webhooks/')) {
    throw new AppError('Invalid Discord webhook URL', 400, 'INVALID_WEBHOOK_URL');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 4 || parts[0] !== 'api' || parts[1] !== 'webhooks') {
    throw new AppError('Invalid Discord webhook URL', 400, 'INVALID_WEBHOOK_URL');
  }

  return trimmed;
}

function validateBotToken(value: string): string {
  const trimmed = normalizeBotTokenText(value);
  if (!trimmed || trimmed.length < 20 || trimmed.length > 256 || /\s/.test(trimmed)) {
    throw new AppError('Invalid Discord bot token', 400, 'INVALID_BOT_TOKEN');
  }
  return trimmed;
}

function validateChannelId(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{5,40}$/.test(trimmed)) {
    throw new AppError('Invalid Discord channel ID', 400, 'INVALID_CHANNEL_ID');
  }
  return trimmed;
}

function previewWebhookUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    const webhookId = parts[2];
    return webhookId
      ? `${url.origin}/api/webhooks/${webhookId}/...`
      : `${url.origin}/api/webhooks/...`;
  } catch {
    return 'configured';
  }
}

export interface DiscordRuntimeSettings {
  enabled: boolean;
  transport: DiscordAlertTransport;
  webhookUrl: string | null;
  webhookUrlFromEnv: boolean;
  botToken: string | null;
  botTokenFromEnv: boolean;
  channelId: string | null;
  channelIdFromEnv: boolean;
  minSeverity: DiscordAlertSeverity;
  gatewayMode: DiscordGatewayMode;
  maintenancePolicy: DiscordMaintenancePolicy;
  inboundJobsEnabled: boolean;
  channelLabel: string | null;
  criticalRoleId: string | null;
  configured: boolean;
}

export class DiscordIntegrationService {
  async getRuntimeSettings(): Promise<DiscordRuntimeSettings> {
    const envWebhook = normalizeOptionalText(process.env.DISCORD_WEBHOOK_URL, 2048);
    const envBotToken = normalizeBotTokenText(process.env.DISCORD_BOT_TOKEN);
    const envChannelId = normalizeOptionalText(process.env.DISCORD_CHANNEL_ID, 40);
    const storedWebhook = safeDecrypt(await getAppConfig(CONFIG_KEYS.webhookUrl));
    const storedBotToken = safeDecrypt(await getAppConfig(CONFIG_KEYS.botToken));
    const envEnabled = parseBoolean(process.env.DISCORD_ALERTS_ENABLED);
    const storedEnabled = parseBoolean(await getAppConfig(CONFIG_KEYS.enabled));
    const configuredTransport =
      process.env.DISCORD_ALERT_TRANSPORT || (await getAppConfig(CONFIG_KEYS.transport));
    const minSeverity = parseSeverity(
      process.env.DISCORD_ALERT_MIN_SEVERITY || (await getAppConfig(CONFIG_KEYS.minSeverity))
    );
    const gatewayMode = parseGatewayMode(
      process.env.DISCORD_GATEWAY_MODE || (await getAppConfig(CONFIG_KEYS.gatewayMode))
    );
    const maintenancePolicy = parseMaintenancePolicy(
      process.env.DISCORD_MAINTENANCE_POLICY || (await getAppConfig(CONFIG_KEYS.maintenancePolicy))
    );
    const inboundJobsEnabled =
      parseBoolean(process.env.DISCORD_INBOUND_JOBS_ENABLED) ??
      parseBoolean(await getAppConfig(CONFIG_KEYS.inboundJobsEnabled)) ??
      false;
    const webhookUrl = envWebhook || normalizeOptionalText(storedWebhook, 2048);
    const botToken = envBotToken || normalizeBotTokenText(storedBotToken);
    const channelId =
      envChannelId || normalizeOptionalText(await getAppConfig(CONFIG_KEYS.channelId), 40);
    const transport = configuredTransport
      ? parseTransport(configuredTransport)
      : webhookUrl && !botToken
        ? 'webhook'
        : 'bot';
    const configured = transport === 'bot' ? Boolean(botToken && channelId) : Boolean(webhookUrl);

    return {
      enabled: envEnabled ?? storedEnabled ?? false,
      transport,
      webhookUrl,
      webhookUrlFromEnv: Boolean(envWebhook),
      botToken,
      botTokenFromEnv: Boolean(envBotToken),
      channelId,
      channelIdFromEnv: Boolean(envChannelId),
      minSeverity,
      gatewayMode,
      maintenancePolicy,
      inboundJobsEnabled,
      channelLabel: normalizeOptionalText(
        process.env.DISCORD_CHANNEL_LABEL || (await getAppConfig(CONFIG_KEYS.channelLabel)),
        80
      ),
      criticalRoleId: normalizeOptionalText(
        process.env.DISCORD_CRITICAL_ROLE_ID || (await getAppConfig(CONFIG_KEYS.criticalRoleId)),
        40
      ),
      configured,
    };
  }

  async getSettings(): Promise<DiscordIntegrationSettings> {
    const runtime = await this.getRuntimeSettings();

    const counts = (await pgGet(`SELECT
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
           MAX(sent_at) as lastSentAt
         FROM discord_outbox`)) as unknown as {
      pending: number | null;
      failed: number | null;
      lastSentAt: string | null;
    };
    const latestFailure = (await pgGet(`SELECT error
         FROM discord_outbox
         WHERE error IS NOT NULL AND error != ''
         ORDER BY updated_at DESC
         LIMIT 1`)) as unknown as { error: string | null } | undefined;

    return {
      enabled: runtime.enabled,
      configured: runtime.configured,
      transport: runtime.transport,
      webhookConfigured: Boolean(runtime.webhookUrl),
      webhookUrlPreview: previewWebhookUrl(runtime.webhookUrl),
      webhookUrlFromEnv: runtime.webhookUrlFromEnv,
      botTokenConfigured: Boolean(runtime.botToken),
      botTokenFromEnv: runtime.botTokenFromEnv,
      channelId: runtime.channelId,
      channelIdFromEnv: runtime.channelIdFromEnv,
      channelLabel: runtime.channelLabel,
      minSeverity: runtime.minSeverity,
      gatewayMode: runtime.gatewayMode,
      maintenancePolicy: runtime.maintenancePolicy,
      inboundJobsEnabled: runtime.inboundJobsEnabled,
      criticalRoleId: runtime.criticalRoleId,
      outboxPending: counts.pending ?? 0,
      outboxFailed: counts.failed ?? 0,
      lastSentAt: counts.lastSentAt,
      lastError: latestFailure?.error ?? null,
    };
  }

  updateSettings(input: {
    enabled?: boolean;
    transport?: DiscordAlertTransport;
    webhookUrl?: string | null;
    clearWebhookUrl?: boolean;
    botToken?: string | null;
    clearBotToken?: boolean;
    channelId?: string | null;
    channelLabel?: string | null;
    minSeverity?: DiscordAlertSeverity;
    gatewayMode?: DiscordGatewayMode;
    maintenancePolicy?: DiscordMaintenancePolicy;
    inboundJobsEnabled?: boolean;
    criticalRoleId?: string | null;
  }): Promise<DiscordIntegrationSettings> {
    if (input.enabled !== undefined) {
      setAppConfig(CONFIG_KEYS.enabled, input.enabled ? 'true' : 'false');
    }
    if (input.transport !== undefined) {
      setAppConfig(CONFIG_KEYS.transport, parseTransport(input.transport));
    }
    if (input.minSeverity !== undefined) {
      setAppConfig(CONFIG_KEYS.minSeverity, parseSeverity(input.minSeverity));
    }
    if (input.gatewayMode !== undefined) {
      setAppConfig(CONFIG_KEYS.gatewayMode, parseGatewayMode(input.gatewayMode));
    }
    if (input.maintenancePolicy !== undefined) {
      setAppConfig(CONFIG_KEYS.maintenancePolicy, parseMaintenancePolicy(input.maintenancePolicy));
    }
    if (input.inboundJobsEnabled !== undefined) {
      setAppConfig(CONFIG_KEYS.inboundJobsEnabled, input.inboundJobsEnabled ? 'true' : 'false');
    }
    if (input.channelLabel !== undefined) {
      setAppConfig(CONFIG_KEYS.channelLabel, normalizeOptionalText(input.channelLabel, 80) ?? '');
    }
    if (input.criticalRoleId !== undefined) {
      setAppConfig(
        CONFIG_KEYS.criticalRoleId,
        normalizeOptionalText(input.criticalRoleId, 40) ?? ''
      );
    }
    if (input.clearWebhookUrl) {
      setAppConfig(CONFIG_KEYS.webhookUrl, '');
    } else if (input.webhookUrl !== undefined && input.webhookUrl !== null) {
      const normalized = validateWebhookUrl(input.webhookUrl);
      setAppConfig(CONFIG_KEYS.webhookUrl, safeEncrypt(normalized) ?? normalized);
    }
    if (input.clearBotToken) {
      setAppConfig(CONFIG_KEYS.botToken, '');
    } else if (input.botToken !== undefined && input.botToken !== null) {
      const normalized = validateBotToken(input.botToken);
      setAppConfig(CONFIG_KEYS.botToken, safeEncrypt(normalized) ?? normalized);
    }
    if (input.channelId !== undefined) {
      setAppConfig(
        CONFIG_KEYS.channelId,
        input.channelId ? validateChannelId(input.channelId) : ''
      );
    }

    return this.getSettings();
  }

  async shouldSend(severity: DiscordAlertSeverity): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    if (!runtime.enabled || !runtime.configured) return false;
    return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[runtime.minSeverity];
  }
}

export const discordIntegrationService = new DiscordIntegrationService();
