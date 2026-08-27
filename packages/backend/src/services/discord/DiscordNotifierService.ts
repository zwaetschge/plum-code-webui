import { get as pgGet, all as pgAll, run as pgRun } from '../../db/pg.js';
import { nanoid } from 'nanoid';
import type {
  DiscordAlertEventType,
  DiscordAlertSeverity,
  DiscordOutboxItem,
} from '@plum-code-webui/shared';
import {
  redactDiscordField,
  redactDiscordMetadata,
  redactDiscordText,
  redactDiscordTitle,
} from './discordRedaction.js';
import { discordIntegrationService } from './DiscordIntegrationService.js';

const COLOR_BY_SEVERITY: Record<DiscordAlertSeverity, number> = {
  info: 0x60a5fa,
  warning: 0xf59e0b,
  error: 0xef4444,
  critical: 0xdc2626,
};

interface DiscordFieldInput {
  name: string;
  value: unknown;
  inline?: boolean;
}

interface QueueAlertInput {
  eventType: DiscordAlertEventType;
  severity: DiscordAlertSeverity;
  title: string;
  summary: string;
  userId?: string | null;
  sessionId?: string | null;
  fields?: DiscordFieldInput[];
  metadata?: Record<string, unknown>;
}

interface QueueOptions {
  force?: boolean;
}

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordWebhookPayload {
  content?: string;
  username: string;
  allowed_mentions: {
    parse: string[];
    roles?: string[];
  };
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    timestamp: string;
    footer: { text: string };
    fields?: DiscordEmbedField[];
  }>;
}

function buildPlainTextContent(input: {
  title: string;
  summary: string;
  severity: DiscordAlertSeverity;
  eventType: DiscordAlertEventType;
  criticalRoleId: string | null;
}): string {
  const prefix = input.criticalRoleId ? `<@&${input.criticalRoleId}> ` : '';
  const text = `${prefix}[${input.severity}] ${input.title}\n${input.summary}\nEvent: ${input.eventType}`;
  return text.slice(0, 1900);
}

function rowToOutboxItem(row: Record<string, unknown>): DiscordOutboxItem {
  return {
    id: row.id as string,
    userId: (row.userId as string | null) ?? null,
    sessionId: (row.sessionId as string | null) ?? null,
    eventType: row.eventType as DiscordAlertEventType,
    severity: row.severity as DiscordAlertSeverity,
    status: row.status as DiscordOutboxItem['status'],
    title: row.title as string,
    summary: row.summary as string,
    attempts: row.attempts as number,
    nextAttemptAt: (row.nextAttemptAt as string | null) ?? null,
    sentAt: (row.sentAt as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

async function buildPayload(input: QueueAlertInput): Promise<{
  title: string;
  summary: string;
  payload: DiscordWebhookPayload;
}> {
  const runtime = await discordIntegrationService.getRuntimeSettings();
  const title = redactDiscordTitle(input.title || input.eventType);
  const summary = redactDiscordText(input.summary || 'No summary provided.');
  const fields: DiscordEmbedField[] = [
    { name: 'Event', value: input.eventType, inline: true },
    { name: 'Severity', value: input.severity, inline: true },
  ];

  if (input.sessionId) {
    fields.push({ name: 'Session', value: redactDiscordField(input.sessionId), inline: true });
  }
  for (const field of input.fields || []) {
    const name = redactDiscordField(field.name).slice(0, 256) || 'Field';
    const value = redactDiscordField(field.value) || '-';
    fields.push({ name, value, inline: field.inline });
  }
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    fields.push({
      name: 'Metadata',
      value: `\`\`\`json\n${redactDiscordMetadata(input.metadata)}\n\`\`\``,
      inline: false,
    });
  }

  const payload: DiscordWebhookPayload = {
    username: 'Plum Code',
    content: buildPlainTextContent({
      title,
      summary,
      severity: input.severity,
      eventType: input.eventType,
      criticalRoleId: input.severity === 'critical' ? runtime.criticalRoleId : null,
    }),
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title,
        description: summary,
        color: COLOR_BY_SEVERITY[input.severity],
        timestamp: new Date().toISOString(),
        footer: {
          text: runtime.channelLabel
            ? `Plum Code Alerts · ${runtime.channelLabel}`
            : 'Plum Code Alerts',
        },
        fields: fields.slice(0, 12),
      },
    ],
  };

  if (input.severity === 'critical' && runtime.criticalRoleId) {
    payload.allowed_mentions.roles = [runtime.criticalRoleId];
  }

  return { title, summary, payload };
}

export class DiscordNotifierService {
  async queueAlert(
    input: QueueAlertInput,
    options: QueueOptions = {}
  ): Promise<DiscordOutboxItem | null> {
    if (!options.force && !discordIntegrationService.shouldSend(input.severity)) {
      return null;
    }

    const runtime = await discordIntegrationService.getRuntimeSettings();
    if (!runtime.configured) {
      return null;
    }

    const id = nanoid();
    const { title, summary, payload } = await buildPayload(input);
    await pgRun(
      `INSERT INTO discord_outbox
          (id, user_id, session_id, event_type, severity, status, title, summary, payload_json)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      id,
      input.userId ?? null,
      input.sessionId ?? null,
      input.eventType,
      input.severity,
      title,
      summary,
      JSON.stringify(payload)
    );

    return this.getOutboxItem(id);
  }

  queueTest(userId: string | null): Promise<DiscordOutboxItem | null> {
    return this.queueAlert(
      {
        eventType: 'discord.test',
        severity: 'info',
        title: 'Plum Code Discord test',
        summary: 'Discord alerts are configured. This is a manual test message from Plum Code.',
        userId,
        fields: [{ name: 'Source', value: 'Settings -> Integrations', inline: true }],
      },
      { force: true }
    );
  }

  async listOutbox(limit = 50): Promise<DiscordOutboxItem[]> {
    const rows = (await pgAll(
      `SELECT id, user_id as userId, session_id as sessionId, event_type as eventType,
                severity, status, title, summary, attempts,
                strftime('%Y-%m-%dT%H:%M:%fZ', next_attempt_at) as nextAttemptAt,
                strftime('%Y-%m-%dT%H:%M:%fZ', sent_at) as sentAt,
                error,
                strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
                strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
         FROM discord_outbox
         ORDER BY created_at DESC
         LIMIT ?`,
      Math.max(1, Math.min(200, limit))
    )) as unknown as Array<Record<string, unknown>>;
    return rows.map(rowToOutboxItem);
  }

  async getOutboxItem(id: string): Promise<DiscordOutboxItem> {
    const row = (await pgGet(
      `SELECT id, user_id as userId, session_id as sessionId, event_type as eventType,
                severity, status, title, summary, attempts,
                strftime('%Y-%m-%dT%H:%M:%fZ', next_attempt_at) as nextAttemptAt,
                strftime('%Y-%m-%dT%H:%M:%fZ', sent_at) as sentAt,
                error,
                strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
                strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
         FROM discord_outbox
         WHERE id = ?`,
      id
    )) as unknown as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Discord outbox item not found: ${id}`);
    return rowToOutboxItem(row);
  }
}

export const discordNotifier = new DiscordNotifierService();
