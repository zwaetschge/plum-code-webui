import { get as pgGet } from '../../db/pg.js';
import { safeJsonParse } from '../../utils/json.js';
import { liveEvents } from '../liveEvents.js';
import type { BrowserBridge } from './bridge.js';
import { usageLimits, type UsageRow } from './rpc.js';

/**
 * Pushes account usage to connected bridge clients (desktop companion, browser
 * extension) instead of letting them poll: after every booked turn (debounced,
 * so a burst of tool turns sends once and upstream quotas have caught up) and
 * on a slow interval for usage spent outside Plum and for resets.
 *
 * It also raises the alerts the user configured under `usageAlerts`, but only
 * towards these clients: a crossing of the quota threshold, an allowance used
 * up, and a window that reset. Phones and the WebUI keep their own alerting.
 * New approvals and questions are relayed so the popups can refresh.
 */

const TURN_DEBOUNCE_MS = 6_000;
const INTERVAL_MS = 5 * 60_000;
// A window counts as reset when it drops this far below its last reading.
const RESET_DROP = 30;

type Level = 'warning' | 'exhausted' | 'reset';

const pending = new Map<string, NodeJS.Timeout>();
// Last utilization per user → "provider:window"; empty after a restart, so the
// first reading only seeds the state and never alerts.
const lastSeen = new Map<string, Map<string, number>>();

async function alertSettings(userId: string): Promise<{ enabled: boolean; quotaPercent: number }> {
  const row = (await pgGet('SELECT settings_json FROM user_settings WHERE user_id = ?', userId)) as
    | { settings_json?: string | null }
    | undefined;
  const settings = safeJsonParse<Record<string, unknown>>(row?.settings_json ?? '{}', {});
  const alerts = (settings.usageAlerts ?? {}) as Record<string, unknown>;
  const quota = Number(alerts.quotaPercent);
  return {
    enabled: alerts.enabled !== false,
    quotaPercent: Number.isFinite(quota) && quota > 0 && quota <= 100 ? Math.round(quota) : 80,
  };
}

export function usageAlerts(
  previous: Map<string, number>,
  rows: UsageRow[],
  quotaPercent: number
): Array<{ level: Level; provider: string; title: string; body: string }> {
  const alerts: Array<{ level: Level; provider: string; title: string; body: string }> = [];
  for (const row of rows) {
    for (const window of row.windows) {
      const key = `${row.provider}:${window.label}`;
      const now = row.exhausted ? Math.max(100, window.utilization) : window.utilization;
      const before = previous.get(key);
      previous.set(key, now);
      if (before === undefined) continue;
      const name = `${row.label} · ${window.label}`;
      if (before < 100 && now >= 100) {
        alerts.push({
          level: 'exhausted',
          provider: row.provider,
          title: `${row.label}: Limit erreicht`,
          body: `${name} ist aufgebraucht.`,
        });
      } else if (before < quotaPercent && now >= quotaPercent && now < 100) {
        alerts.push({
          level: 'warning',
          provider: row.provider,
          title: `${row.label}: ${now} % genutzt`,
          body: `${name} hat ${quotaPercent} % überschritten.`,
        });
      } else if (before >= quotaPercent && now <= before - RESET_DROP) {
        alerts.push({
          level: 'reset',
          provider: row.provider,
          title: `${row.label}: wieder frei`,
          body: `${name} wurde zurückgesetzt (${now} %).`,
        });
      }
    }
  }
  return alerts;
}

async function push(bridge: BrowserBridge, userId: string): Promise<void> {
  if (!bridge.connectedUserIds().includes(userId)) return;
  const rows = await usageLimits(userId);
  bridge.sendAll(userId, { type: 'usage', rows, at: new Date().toISOString() });
  const settings = await alertSettings(userId);
  const previous = lastSeen.get(userId) ?? new Map<string, number>();
  lastSeen.set(userId, previous);
  const alerts = usageAlerts(previous, rows, settings.quotaPercent);
  if (!settings.enabled) return;
  for (const alert of alerts) bridge.sendAll(userId, { type: 'usage-alert', ...alert });
}

function schedule(bridge: BrowserBridge, userId: string, delay: number): void {
  clearTimeout(pending.get(userId));
  pending.set(
    userId,
    setTimeout(() => {
      pending.delete(userId);
      push(bridge, userId).catch((error) =>
        console.error('[BrowserBridge] usage push failed:', error)
      );
    }, delay)
  );
}

export function startUsagePush(bridge: BrowserBridge): void {
  liveEvents.on('usage', (userId: string) => schedule(bridge, userId, TURN_DEBOUNCE_MS));
  liveEvents.on('notification', (userId: string, payload: Record<string, unknown>) => {
    if (payload.kind !== 'approval' && payload.kind !== 'question') return;
    bridge.sendAll(userId, {
      type: 'notification',
      kind: payload.kind,
      sessionId: payload.sessionId ?? null,
      title: payload.title,
      body: payload.body ?? null,
    });
  });
  const interval = setInterval(() => {
    for (const userId of bridge.connectedUserIds()) schedule(bridge, userId, 0);
  }, INTERVAL_MS);
  interval.unref();
}
