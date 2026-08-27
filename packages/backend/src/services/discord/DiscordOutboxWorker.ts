import { get as pgGet, all as pgAll, run as pgRun } from '../../db/pg.js';
import { discordIntegrationService } from './DiscordIntegrationService.js';

const MAX_ATTEMPTS = 5;
const DEFAULT_INTERVAL_MS = 15_000;

interface OutboxRow {
  id: string;
  payloadJson: string;
  attempts: number;
}

export interface DiscordSendResult {
  sent: boolean;
  error: string | null;
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(900, Math.max(10, 2 ** Math.max(0, attempts - 1) * 10));
}

async function responseBody(response: Response): Promise<Record<string, unknown> | string | null> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text.slice(0, 700);
  }
}

function retryAfterSeconds(
  response: Response,
  body: Record<string, unknown> | string | null
): number {
  const header = response.headers.get('retry-after');
  const headerSeconds = header ? Number.parseFloat(header) : Number.NaN;
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) return Math.ceil(headerSeconds);
  if (body && typeof body === 'object') {
    const retryAfter = body.retry_after;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
      return Math.ceil(retryAfter);
    }
  }
  return 60;
}

function formatDiscordError(
  response: Response,
  body: Record<string, unknown> | string | null
): string {
  if (!body) return `Discord returned HTTP ${response.status}`;
  if (typeof body === 'string') return `Discord returned HTTP ${response.status}: ${body}`;
  const message =
    typeof body.message === 'string' ? body.message : JSON.stringify(body).slice(0, 700);
  return `Discord returned HTTP ${response.status}: ${message}`;
}

function botMessageBody(payloadJson: string): string {
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  delete payload.username;
  return JSON.stringify(payload);
}

export class DiscordOutboxWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.processDue().catch((err) => {
        console.warn('[DISCORD] Outbox worker failed:', err);
      });
    }, DEFAULT_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async processDue(limit = 10): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;
    try {
      const rows = (await pgAll(
        `SELECT id
           FROM discord_outbox
           WHERE status IN ('pending', 'failed')
             AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
           ORDER BY created_at ASC
           LIMIT ?`,
        Math.max(1, Math.min(25, limit))
      )) as unknown as Array<{ id: string }>;
      let sent = 0;
      for (const row of rows) {
        const result = await this.processNow(row.id);
        if (result.sent) sent += 1;
      }
      return sent;
    } finally {
      this.processing = false;
    }
  }

  async processNow(
    id: string,
    options: { ignoreEnabled?: boolean } = {}
  ): Promise<DiscordSendResult> {
    await pgRun(
      `UPDATE discord_outbox
       SET status = 'sending', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('pending', 'failed', 'sending')`,
      id
    );

    const row = (await pgGet(
      `SELECT id, payload_json as payloadJson, attempts
         FROM discord_outbox
         WHERE id = ?`,
      id
    )) as unknown as OutboxRow | undefined;
    if (!row) return { sent: false, error: 'Outbox item not found' };

    const runtime = discordIntegrationService.getRuntimeSettings();
    if (!runtime.configured) {
      const error =
        runtime.transport === 'bot'
          ? 'Discord bot token or channel ID is not configured'
          : 'Discord webhook URL is not configured';
      await this.markDisabled(id, error);
      return { sent: false, error };
    }
    if (!runtime.enabled && !options.ignoreEnabled) {
      await this.markDisabled(id, 'Discord alerts are disabled');
      return { sent: false, error: 'Discord alerts are disabled' };
    }

    try {
      const isBotTransport = runtime.transport === 'bot';
      const response = await fetch(
        isBotTransport
          ? `https://discord.com/api/v10/channels/${runtime.channelId}/messages`
          : runtime.webhookUrl!,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(isBotTransport ? { Authorization: `Bot ${runtime.botToken}` } : {}),
          },
          body: isBotTransport ? botMessageBody(row.payloadJson) : row.payloadJson,
        }
      );

      if (response.ok) {
        await pgRun(
          `UPDATE discord_outbox
           SET status = 'sent',
               sent_at = CURRENT_TIMESTAMP,
               error = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          id
        );
        return { sent: true, error: null };
      }

      const body = await responseBody(response);
      if (response.status === 429) {
        const seconds = retryAfterSeconds(response, body);
        await this.markRetry(id, row.attempts + 1, seconds, formatDiscordError(response, body));
        return { sent: false, error: `Discord rate limited; retrying in ${seconds}s` };
      }

      const error =
        isBotTransport && response.status === 401
          ? 'Discord returned HTTP 401: Unauthorized. Check the Discord bot token; paste the raw Bot token, not the public key, application ID, or client secret.'
          : formatDiscordError(response, body);
      if (response.status === 401 || response.status === 403) {
        discordIntegrationService.updateSettings({ enabled: false });
        await this.markDisabled(id, error);
        return { sent: false, error };
      }

      if (response.status >= 400 && response.status < 500) {
        await this.markFailed(id, row.attempts + 1, error);
        return { sent: false, error };
      }

      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await this.markFailed(id, attempts, error);
      } else {
        await this.markRetry(id, attempts, retryDelaySeconds(attempts), error);
      }
      return { sent: false, error };
    } catch (err) {
      const attempts = row.attempts + 1;
      const error = err instanceof Error ? err.message : String(err);
      if (attempts >= MAX_ATTEMPTS) {
        await this.markFailed(id, attempts, error);
      } else {
        await this.markRetry(id, attempts, retryDelaySeconds(attempts), error);
      }
      return { sent: false, error };
    }
  }

  private async markRetry(
    id: string,
    attempts: number,
    seconds: number,
    error: string
  ): Promise<void> {
    await pgRun(
      `UPDATE discord_outbox
         SET status = 'pending',
             attempts = ?,
             next_attempt_at = datetime('now', ?),
             error = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      attempts,
      `+${Math.max(1, seconds)} seconds`,
      error.slice(0, 700),
      id
    );
  }

  private async markFailed(id: string, attempts: number, error: string): Promise<void> {
    await pgRun(
      `UPDATE discord_outbox
         SET status = 'failed',
             attempts = ?,
             error = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      attempts,
      error.slice(0, 700),
      id
    );
  }

  private async markDisabled(id: string, error: string): Promise<void> {
    await pgRun(
      `UPDATE discord_outbox
         SET status = 'disabled',
             error = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      error.slice(0, 700),
      id
    );
  }
}

export const discordOutboxWorker = new DiscordOutboxWorker();

export function initDiscordOutboxWorker(): void {
  discordOutboxWorker.start();
}
