import { all as pgAll, transaction as pgTransaction } from '../db/pg.js';

export type TrackedUsageLimitProvider = 'codex' | 'claude' | 'zai' | 'kimi';
export type UsageLimitHistoryRange = '24h' | '7d' | '30d' | '90d';

export interface UsageLimitWindowSnapshot {
  utilization: number;
  resetsAt: string | null;
  windowSeconds?: number | null;
  used?: number | null;
  limit?: number | null;
  remaining?: number | null;
  unit?: string | null;
}

export interface UsageLimitSnapshotPayload {
  fiveHour: UsageLimitWindowSnapshot | null;
  sevenDay: UsageLimitWindowSnapshot | null;
  sevenDaySonnet: UsageLimitWindowSnapshot | null;
  additional?: Array<{ name: string } & UsageLimitWindowSnapshot>;
  accountUsage?: {
    periodDays: number;
    totalTokens: number;
    totalRequests: number;
  };
  source?: string;
}

export interface UsageLimitHistoryPoint {
  provider: TrackedUsageLimitProvider;
  metricKey: string;
  metricLabel: string;
  utilization: number | null;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  unit: string | null;
  resetsAt: string | null;
  windowSeconds: number | null;
  source: string | null;
  resetDetected: boolean;
  resetEventAt: string | null;
  recordedAt: string;
}

export interface UsageLimitTrackedTokensPoint {
  provider: TrackedUsageLimitProvider;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  recordedAt: string;
}

const RANGE_CONFIG: Record<
  UsageLimitHistoryRange,
  { durationSeconds: number; sampleSeconds: number }
> = {
  '24h': { durationSeconds: 24 * 60 * 60, sampleSeconds: 15 * 60 },
  '7d': { durationSeconds: 7 * 24 * 60 * 60, sampleSeconds: 30 * 60 },
  '30d': { durationSeconds: 30 * 24 * 60 * 60, sampleSeconds: 2 * 60 * 60 },
  '90d': { durationSeconds: 90 * 24 * 60 * 60, sampleSeconds: 6 * 60 * 60 },
};

function toSqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function metricSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function metricLabel(provider: TrackedUsageLimitProvider, key: string, fallback?: string): string {
  if (fallback) return fallback;
  if (key === 'five_hour') {
    if (provider === 'claude') return 'Session';
    if (provider === 'zai') return '5h · Tokens';
    if (provider === 'kimi') return '5h · Coding Plan';
    return '5h · Session';
  }
  if (key === 'seven_day') {
    if (provider === 'claude') return 'Weekly · All';
    if (provider === 'zai') return 'Weekly · Tokens';
    if (provider === 'kimi') return 'Weekly · Coding Plan';
    return 'Weekly · Total';
  }
  if (key === 'seven_day_sonnet') return 'Weekly · Sonnet';
  return key.replace(/_/g, ' ');
}

function flattenPayload(
  provider: TrackedUsageLimitProvider,
  payload: UsageLimitSnapshotPayload
): Array<{
  metricKey: string;
  metricLabel: string;
  window: UsageLimitWindowSnapshot;
}> {
  const metrics: Array<{
    metricKey: string;
    metricLabel: string;
    window: UsageLimitWindowSnapshot;
  }> = [];

  const add = (
    metricKey: string,
    window: UsageLimitWindowSnapshot | null | undefined,
    label?: string
  ) => {
    if (!window) return;
    metrics.push({
      metricKey,
      metricLabel: metricLabel(provider, metricKey, label),
      window,
    });
  };

  add('five_hour', payload.fiveHour);
  add('seven_day', payload.sevenDay);
  add('seven_day_sonnet', payload.sevenDaySonnet);
  for (const limit of payload.additional || []) {
    const slug = metricSlug(limit.name) || 'limit';
    add(`additional_${slug}`, limit, limit.name);
  }

  if (payload.accountUsage) {
    add(
      `account_${payload.accountUsage.periodDays}d_tokens`,
      {
        utilization: 0,
        resetsAt: null,
        used: payload.accountUsage.totalTokens,
        limit: null,
        remaining: null,
        unit: 'tokens',
      },
      `Official account · ${payload.accountUsage.periodDays}d tokens`
    );
    add(
      `account_${payload.accountUsage.periodDays}d_requests`,
      {
        utilization: 0,
        resetsAt: null,
        used: payload.accountUsage.totalRequests,
        limit: null,
        remaining: null,
        unit: 'requests',
      },
      `Official account · ${payload.accountUsage.periodDays}d calls`
    );
  }

  return metrics;
}

function sameNumber(a: number | null, b: number | null): boolean {
  return a === b || (a !== null && b !== null && Math.abs(a - b) < 0.000001);
}

const LATEST_SNAPSHOT_SQL = `
    SELECT
      utilization,
      used_value,
      limit_value,
      remaining_value,
      unit,
      resets_at,
      recorded_at
    FROM usage_limit_snapshots
    WHERE user_id = ? AND provider = ? AND metric_key = ?
    ORDER BY recorded_at DESC, id DESC
    LIMIT 1
  `;

const INSERT_SNAPSHOT_SQL = `
    INSERT INTO usage_limit_snapshots (
      user_id,
      provider,
      metric_key,
      metric_label,
      utilization,
      used_value,
      limit_value,
      remaining_value,
      unit,
      resets_at,
      window_seconds,
      source,
      reset_detected,
      reset_event_at,
      recorded_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

export async function recordUsageLimitSnapshots(
  userId: string,
  provider: TrackedUsageLimitProvider,
  payload: UsageLimitSnapshotPayload,
  now = new Date()
): Promise<number> {
  const metrics = flattenPayload(provider, payload);
  if (metrics.length === 0) return 0;

  const recordedAt = toSqlTimestamp(now);
  let inserted = 0;
  await pgTransaction(async (tx) => {
    for (const metric of metrics) {
      const utilization = metric.metricKey.startsWith('account_')
        ? null
        : finiteOrNull(metric.window.utilization);
      const used = finiteOrNull(metric.window.used);
      const limit = finiteOrNull(metric.window.limit);
      const remaining = finiteOrNull(metric.window.remaining);
      const resetsAt = normalizeIso(metric.window.resetsAt);
      const unit = metric.window.unit || null;
      const previous = (await tx.get(LATEST_SNAPSHOT_SQL, userId, provider, metric.metricKey)) as
        | {
            utilization: number | null;
            used_value: number | null;
            limit_value: number | null;
            remaining_value: number | null;
            unit: string | null;
            resets_at: string | null;
            recorded_at: string;
          }
        | undefined;

      const previousRecordedMs = previous
        ? Date.parse(`${previous.recorded_at.replace(' ', 'T')}Z`)
        : Number.NaN;
      const unchanged =
        previous &&
        sameNumber(previous.utilization, utilization) &&
        sameNumber(previous.used_value, used) &&
        sameNumber(previous.limit_value, limit) &&
        sameNumber(previous.remaining_value, remaining) &&
        previous.unit === unit &&
        normalizeIso(previous.resets_at) === resetsAt;

      // Keep flat portions of the line visible without generating duplicate rows
      // for rapid focus/refetch bursts.
      if (
        unchanged &&
        Number.isFinite(previousRecordedMs) &&
        now.getTime() - previousRecordedMs < 14 * 60_000
      ) {
        continue;
      }

      const utilizationDropped =
        !metric.metricKey.startsWith('account_') &&
        previous?.utilization !== null &&
        previous?.utilization !== undefined &&
        utilization !== null &&
        utilization + 5 <= previous.utilization;
      const usedDropped =
        !metric.metricKey.startsWith('account_') &&
        previous?.used_value !== null &&
        previous?.used_value !== undefined &&
        used !== null &&
        used < previous.used_value;
      const previousResetAt = normalizeIso(previous?.resets_at);
      const resetScheduleAdvanced =
        previousResetAt !== null &&
        resetsAt !== null &&
        previousResetAt !== resetsAt &&
        Date.parse(resetsAt) > Date.parse(previousResetAt) &&
        Date.parse(previousResetAt) <= now.getTime() + 15 * 60_000;
      const resetDetected = Boolean(
        previous && (utilizationDropped || usedDropped || resetScheduleAdvanced)
      );
      const resetEventAt = resetDetected
        ? previousResetAt && Date.parse(previousResetAt) <= now.getTime() + 15 * 60_000
          ? previousResetAt
          : now.toISOString()
        : null;

      await tx.run(
        INSERT_SNAPSHOT_SQL,
        userId,
        provider,
        metric.metricKey,
        metric.metricLabel,
        utilization,
        used,
        limit,
        remaining,
        unit,
        resetsAt,
        finiteOrNull(metric.window.windowSeconds),
        payload.source || null,
        resetDetected ? 1 : 0,
        resetEventAt,
        recordedAt
      );
      inserted += 1;
    }

    // recorded_at is TEXT in the SQLite shape the schema kept, so the cutoff is
    // formatted to match rather than compared as a timestamp.
    await tx.run(
      `DELETE FROM usage_limit_snapshots
        WHERE recorded_at < to_char(now() - interval '180 days', 'YYYY-MM-DD HH24:MI:SS')`
    );
  });
  return inserted;
}

export async function queryUsageLimitHistory(
  userId: string,
  providers: TrackedUsageLimitProvider[],
  range: UsageLimitHistoryRange,
  now = new Date()
): Promise<{
  range: UsageLimitHistoryRange;
  startsAt: string;
  endsAt: string;
  sampledEverySeconds: number;
  points: UsageLimitHistoryPoint[];
  trackedTokens: UsageLimitTrackedTokensPoint[];
  latestAt: string | null;
}> {
  const config = RANGE_CONFIG[range];
  const startsAt = new Date(now.getTime() - config.durationSeconds * 1000);
  const providerPlaceholders = providers.map(() => '?').join(',');
  if (!providerPlaceholders) {
    return {
      range,
      startsAt: startsAt.toISOString(),
      endsAt: now.toISOString(),
      sampledEverySeconds: config.sampleSeconds,
      points: [],
      trackedTokens: [],
      latestAt: null,
    };
  }

  const rows = (await pgAll(
    `
      WITH ranked AS (
        SELECT
          provider,
          metric_key,
          metric_label,
          utilization,
          used_value,
          limit_value,
          remaining_value,
          unit,
          resets_at,
          window_seconds,
          source,
          reset_detected,
          reset_event_at,
          recorded_at,
          ROW_NUMBER() OVER (
            PARTITION BY
              provider,
              metric_key,
              CAST(strftime('%s', recorded_at) / ? AS INTEGER)
            ORDER BY recorded_at DESC, id DESC
          ) AS sample_rank
        FROM usage_limit_snapshots
        WHERE user_id = ?
          AND provider IN (${providerPlaceholders})
          AND recorded_at >= ?
          AND recorded_at <= ?
      )
      SELECT *
      FROM ranked
      WHERE sample_rank = 1 OR reset_detected = 1
      ORDER BY recorded_at ASC, provider ASC, metric_key ASC
    `,
    config.sampleSeconds,
    userId,
    ...providers,
    toSqlTimestamp(startsAt),
    toSqlTimestamp(now)
  )) as unknown as Array<{
    provider: TrackedUsageLimitProvider;
    metric_key: string;
    metric_label: string;
    utilization: number | null;
    used_value: number | null;
    limit_value: number | null;
    remaining_value: number | null;
    unit: string | null;
    resets_at: string | null;
    window_seconds: number | null;
    source: string | null;
    reset_detected: number;
    reset_event_at: string | null;
    recorded_at: string;
  }>;

  const points = rows.map(
    (row): UsageLimitHistoryPoint => ({
      provider: row.provider,
      metricKey: row.metric_key,
      metricLabel: row.metric_label,
      utilization: row.utilization,
      used: row.used_value,
      limit: row.limit_value,
      remaining: row.remaining_value,
      unit: row.unit,
      resetsAt: normalizeIso(row.resets_at),
      windowSeconds: row.window_seconds,
      source: row.source,
      resetDetected: row.reset_detected === 1,
      resetEventAt: normalizeIso(row.reset_event_at),
      recordedAt: `${row.recorded_at.replace(' ', 'T')}Z`,
    })
  );

  const trackedTokenRows = (await pgAll(
    `
      WITH normalized AS (
        SELECT
          CASE
            WHEN lower(provider) = 'codex' THEN 'codex'
            WHEN lower(provider) = 'claude' THEN 'claude'
            WHEN lower(provider) IN ('zai', 'z-ai') THEN 'zai'
            ELSE NULL
          END AS tracked_provider,
          CAST(strftime('%s', created_at) / ? AS INTEGER) * ? AS bucket_epoch,
          input_tokens,
          output_tokens,
          cache_read_tokens,
          cache_creation_tokens,
          total_tokens
        FROM usage_history
        WHERE user_id = ?
          AND created_at >= ?
          AND created_at <= ?
      )
      SELECT
        tracked_provider AS provider,
        bucket_epoch,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_creation_tokens) AS cache_creation_tokens,
        SUM(total_tokens) AS total_tokens
      FROM normalized
      WHERE tracked_provider IN (${providerPlaceholders})
      GROUP BY tracked_provider, bucket_epoch
      ORDER BY bucket_epoch ASC, tracked_provider ASC
    `,
    config.sampleSeconds,
    config.sampleSeconds,
    userId,
    toSqlTimestamp(startsAt),
    toSqlTimestamp(now),
    ...providers
  )) as unknown as Array<{
    provider: TrackedUsageLimitProvider;
    bucket_epoch: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    total_tokens: number;
  }>;
  const trackedTokens = trackedTokenRows.map(
    (row): UsageLimitTrackedTokensPoint => ({
      provider: row.provider,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      totalTokens: row.total_tokens,
      recordedAt: new Date(row.bucket_epoch * 1000).toISOString(),
    })
  );

  return {
    range,
    startsAt: startsAt.toISOString(),
    endsAt: now.toISOString(),
    sampledEverySeconds: config.sampleSeconds,
    points,
    trackedTokens,
    latestAt: points.at(-1)?.recordedAt || null,
  };
}

export function normalizeUsageLimitHistoryRange(value: unknown): UsageLimitHistoryRange {
  return value === '24h' || value === '7d' || value === '30d' || value === '90d' ? value : '24h';
}
