import { get as pgGet, all as pgAll } from '../db/pg.js';
import { Router, Request, Response } from 'express';
import {
  estimateModelCost,
  getProviderLabelForUsage,
  getUsageModelKey,
} from '@plum-code-webui/shared';
import { insertUsageHistoryTurn } from '../db/index.js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { nanoid } from 'nanoid';
import type { CLIProvider } from '../services/cli-providers.js';
import {
  fetchCodexUsage,
  getCodexAuth,
  isCodexUsageAuthError,
  mapCodexUsage,
  refreshCodexToken,
  type MappedCodexWindow,
} from '../utils/codexUsage.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MAX_WINDOW_OFFSET = 520;

type AnalyticsPeriod = '24h' | '7d' | '30d' | 'all';
type AnalyticsWindowSource = 'rolling' | 'calendar-week' | 'calendar-month' | 'all';

interface AnalyticsWindow {
  period: AnalyticsPeriod;
  startsAt: string | null;
  endsAt: string | null;
  source: AnalyticsWindowSource;
  label: string;
  offset: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  timezoneOffsetMinutes: number;
  limit: {
    provider: 'codex';
    name: 'weekly';
    utilization: number;
    resetsAt: string | null;
    windowSeconds: number | null;
  } | null;
}

function normalizePeriod(raw: unknown): AnalyticsPeriod {
  const value = typeof raw === 'string' ? raw : '';
  if (value === '24h' || value === '7d' || value === '30d' || value === 'all') return value;
  return '7d';
}

function parseWindowOffset(raw: unknown): number {
  if (typeof raw !== 'string' || raw.trim().length === 0) return 0;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_WINDOW_OFFSET, Math.max(0, value));
}

// Parse a signed-minute TZ offset (e.g. "120" for UTC+2, "-300" for UTC-5).
// Returns 0 on missing/invalid input, so grouping falls back to UTC.
function parseTzOffsetMinutes(raw: unknown): number {
  if (typeof raw !== 'string' || raw.length === 0) return 0;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < -840 || n > 840) return 0;
  return n;
}

function parseTzModifier(raw: unknown): string {
  const n = parseTzOffsetMinutes(raw);
  return `${n >= 0 ? '+' : ''}${n} minutes`;
}

function toSqlTimestamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

function buildDateFilter(window: AnalyticsWindow, column = 'created_at') {
  const clauses: string[] = [];
  const params: string[] = [];
  if (window.startsAt) {
    clauses.push(`AND ${column} >= ?`);
    params.push(toSqlTimestamp(window.startsAt));
  }
  if (window.endsAt) {
    clauses.push(`AND ${column} < ?`);
    params.push(toSqlTimestamp(window.endsAt));
  }
  return {
    sql: clauses.length ? ` ${clauses.join(' ')}` : '',
    params,
  };
}

function localDateParts(now: Date, tzOffsetMinutes: number) {
  const shifted = new Date(now.getTime() + tzOffsetMinutes * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function localMidnightUtc(year: number, month: number, day: number, tzOffsetMinutes: number): Date {
  return new Date(Date.UTC(year, month, day) - tzOffsetMinutes * 60 * 1000);
}

function localWeekWindow(
  now: Date,
  tzOffsetMinutes: number,
  offset = 0
): { startsAt: Date; endsAt: Date } {
  const parts = localDateParts(now, tzOffsetMinutes);
  const daysSinceMonday = (parts.weekday + 6) % 7;
  const startsAt = localMidnightUtc(
    parts.year,
    parts.month,
    parts.day - daysSinceMonday - offset * 7,
    tzOffsetMinutes
  );
  return { startsAt, endsAt: new Date(startsAt.getTime() + WEEK_SECONDS * 1000) };
}

function localMonthWindow(
  now: Date,
  tzOffsetMinutes: number,
  offset = 0
): { startsAt: Date; endsAt: Date } {
  const parts = localDateParts(now, tzOffsetMinutes);
  return {
    startsAt: localMidnightUtc(parts.year, parts.month - offset, 1, tzOffsetMinutes),
    endsAt: localMidnightUtc(parts.year, parts.month - offset + 1, 1, tzOffsetMinutes),
  };
}

async function fetchCodexWeeklyLimit(): Promise<MappedCodexWindow | null> {
  const auth = await getCodexAuth();
  if (!auth?.tokens?.access_token) return null;

  try {
    return mapCodexUsage(await fetchCodexUsage(auth)).sevenDay;
  } catch (err) {
    if (!isCodexUsageAuthError(err)) {
      console.warn('Codex weekly reset lookup failed:', err);
      return null;
    }

    const refreshed = await refreshCodexToken(auth);
    if (!refreshed?.tokens?.access_token) return null;
    try {
      return mapCodexUsage(await fetchCodexUsage(refreshed)).sevenDay;
    } catch (retryErr) {
      console.warn('Codex weekly reset lookup retry failed:', retryErr);
      return null;
    }
  }
}

async function resolveAnalyticsWindow(
  rawPeriod: unknown,
  rawTz: unknown,
  rawOffset: unknown
): Promise<AnalyticsWindow> {
  const period = normalizePeriod(rawPeriod);
  const timezoneOffsetMinutes = parseTzOffsetMinutes(rawTz);
  const offset = period === 'all' ? 0 : parseWindowOffset(rawOffset);
  const now = new Date();
  const navigation = {
    offset,
    canGoPrevious: period !== 'all',
    canGoNext: offset > 0,
  };

  if (period === '24h') {
    const endsAt = new Date(now.getTime() - offset * DAY_MS);
    const startsAt = new Date(endsAt.getTime() - DAY_MS);
    return {
      period,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      source: 'rolling',
      label: offset === 0 ? 'Last 24 hours' : `24h window ${offset} back`,
      ...navigation,
      timezoneOffsetMinutes,
      limit: null,
    };
  }

  if (period === '7d') {
    const weeklyLimit = await fetchCodexWeeklyLimit();
    const week = localWeekWindow(now, timezoneOffsetMinutes, offset);
    return {
      period,
      startsAt: week.startsAt.toISOString(),
      endsAt: week.endsAt.toISOString(),
      source: 'calendar-week',
      label: offset === 0 ? 'This week' : offset === 1 ? 'Previous week' : `Week ${offset} back`,
      ...navigation,
      timezoneOffsetMinutes,
      limit: weeklyLimit
        ? {
            provider: 'codex',
            name: 'weekly',
            utilization: weeklyLimit.utilization,
            resetsAt: weeklyLimit.resetsAt,
            windowSeconds: weeklyLimit.windowSeconds,
          }
        : null,
    };
  }

  if (period === '30d') {
    const month = localMonthWindow(now, timezoneOffsetMinutes, offset);
    return {
      period,
      startsAt: month.startsAt.toISOString(),
      endsAt: month.endsAt.toISOString(),
      source: 'calendar-month',
      label: offset === 0 ? 'This month' : offset === 1 ? 'Previous month' : `Month ${offset} back`,
      ...navigation,
      timezoneOffsetMinutes,
      limit: null,
    };
  }

  return {
    period,
    startsAt: null,
    endsAt: null,
    source: 'all',
    label: 'All time',
    ...navigation,
    timezoneOffsetMinutes,
    limit: null,
  };
}

type ModelSummaryRow = {
  model: string | null;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  cost: number;
  requests: number;
  first_seen: string | null;
  last_seen: string | null;
};

type TokenCostRow = Pick<
  ModelSummaryRow,
  'model' | 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_creation_tokens'
>;

function estimateApiEquivalentCost(row: TokenCostRow) {
  const estimate = estimateModelCost(
    row.model,
    {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
    },
    null
  );
  return estimate;
}

function enrichModelRow(row: ModelSummaryRow) {
  const estimate = estimateApiEquivalentCost(row);
  const apiEquivalentCost = estimate.cost;
  return {
    ...row,
    cost: apiEquivalentCost,
    provider: getProviderLabelForUsage(row.provider, row.model),
    api_equivalent_cost: apiEquivalentCost,
    theoretical_cost: apiEquivalentCost,
    recorded_cost: row.cost,
    cost_delta: row.cost - apiEquivalentCost,
    pricing_known: estimate.known,
    pricing_source: estimate.pricing?.source ?? null,
    pricing_label: estimate.pricing?.label ?? null,
    pricing: estimate.pricing
      ? {
          input: estimate.pricing.input,
          output: estimate.pricing.output,
          cacheRead: estimate.pricing.cacheRead,
          cacheWrite: estimate.pricing.cacheWrite,
        }
      : null,
  };
}

// Get usage summary (totals across all sessions)
router.get('/summary', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  try {
    const window = await resolveAnalyticsWindow(req.query.period, req.query.tz, req.query.offset);
    const dateFilter = buildDateFilter(window);
    // Get totals
    const totals = (await pgGet(
      `
      SELECT
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as total_cache_creation_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as total_cost,
        COUNT(*) as total_requests
      FROM usage_history
      WHERE user_id = ? ${dateFilter.sql}
    `,
      authReq.userId,
      ...dateFilter.params
    )) as unknown as {
      total_input_tokens: number;
      total_output_tokens: number;
      total_cache_read_tokens: number;
      total_cache_creation_tokens: number;
      total_tokens: number;
      total_cost: number;
      total_requests: number;
    };

    // Get per-model breakdown
    const modelRows = (await pgAll(
      `
      SELECT
        model,
        provider,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as cost,
        COUNT(*) as requests,
        MIN(created_at) as first_seen,
        MAX(created_at) as last_seen
      FROM usage_history
      WHERE user_id = ? ${dateFilter.sql}
      GROUP BY provider, model
      ORDER BY cost DESC
    `,
      authReq.userId,
      ...dateFilter.params
    )) as unknown as ModelSummaryRow[];

    const byModel = modelRows
      .map(enrichModelRow)
      .sort(
        (a, b) => b.api_equivalent_cost - a.api_equivalent_cost || b.total_tokens - a.total_tokens
      );
    const byProviderMap = new Map<
      string,
      {
        provider: string;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_creation_tokens: number;
        total_tokens: number;
        cost: number;
        api_equivalent_cost: number;
        theoretical_cost: number;
        recorded_cost: number;
        cost_delta: number;
        requests: number;
        priced_tokens: number;
        unpriced_tokens: number;
        models: number;
      }
    >();
    for (const row of byModel) {
      const current = byProviderMap.get(row.provider) || {
        provider: row.provider,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        total_tokens: 0,
        cost: 0,
        api_equivalent_cost: 0,
        theoretical_cost: 0,
        recorded_cost: 0,
        cost_delta: 0,
        requests: 0,
        priced_tokens: 0,
        unpriced_tokens: 0,
        models: 0,
      };
      current.input_tokens += row.input_tokens;
      current.output_tokens += row.output_tokens;
      current.cache_read_tokens += row.cache_read_tokens;
      current.cache_creation_tokens += row.cache_creation_tokens;
      current.total_tokens += row.total_tokens;
      current.cost += row.api_equivalent_cost;
      current.api_equivalent_cost += row.api_equivalent_cost;
      current.theoretical_cost += row.theoretical_cost;
      current.recorded_cost += row.recorded_cost;
      current.cost_delta += row.cost_delta;
      current.requests += row.requests;
      current.models += 1;
      if (row.pricing_known) current.priced_tokens += row.total_tokens;
      else current.unpriced_tokens += row.total_tokens;
      byProviderMap.set(row.provider, current);
    }
    const byProvider = [...byProviderMap.values()].sort(
      (a, b) => b.api_equivalent_cost - a.api_equivalent_cost || b.total_tokens - a.total_tokens
    );
    const apiEquivalentTotalCost = byModel.reduce((sum, row) => sum + row.api_equivalent_cost, 0);
    const pricedTokens = byModel
      .filter((row) => row.pricing_known)
      .reduce((sum, row) => sum + row.total_tokens, 0);
    const unpricedTokens = byModel
      .filter((row) => !row.pricing_known)
      .reduce((sum, row) => sum + row.total_tokens, 0);
    const missingPricingModels = byModel
      .filter((row) => !row.pricing_known)
      .map((row) => ({
        model: row.model || 'unknown',
        provider: row.provider,
        tokens: row.total_tokens,
        requests: row.requests,
      }));

    // Get per-session breakdown. Capped at 50 so the frontend's paginated
    // "Top Sessions" list has rows to reveal beyond the default 10 — without
    // flooding the response with every session that ever ran a request.
    // Use fully qualified column name for created_at to avoid ambiguity with sessions table
    const sessionDateFilter = buildDateFilter(window, 'uh.created_at');
    const sessionRows = (await pgAll(
      `
      SELECT
        uh.session_id,
        s.name as session_name,
        uh.model,
        COALESCE(SUM(uh.input_tokens), 0) as input_tokens,
        COALESCE(SUM(uh.output_tokens), 0) as output_tokens,
        COALESCE(SUM(uh.cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(uh.cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(uh.total_tokens), 0) as total_tokens,
        COALESCE(SUM(uh.cost_usd), 0) as cost,
        COUNT(*) as requests
      FROM usage_history uh
      LEFT JOIN sessions s ON s.id = uh.session_id
      WHERE uh.user_id = ? ${sessionDateFilter.sql}
      GROUP BY uh.session_id, s.name, uh.model
    `,
      authReq.userId,
      ...sessionDateFilter.params
    )) as unknown as Array<
      TokenCostRow & {
        session_id: string;
        session_name: string | null;
        total_tokens: number;
        cost: number;
        requests: number;
      }
    >;

    const bySessionMap = new Map<
      string,
      {
        session_id: string;
        session_name: string | null;
        total_tokens: number;
        cost: number;
        api_equivalent_cost: number;
        theoretical_cost: number;
        recorded_cost: number;
        cost_delta: number;
        requests: number;
      }
    >();
    for (const row of sessionRows) {
      const apiEquivalentCost = estimateApiEquivalentCost(row).cost;
      const current = bySessionMap.get(row.session_id) || {
        session_id: row.session_id,
        session_name: row.session_name,
        total_tokens: 0,
        cost: 0,
        api_equivalent_cost: 0,
        theoretical_cost: 0,
        recorded_cost: 0,
        cost_delta: 0,
        requests: 0,
      };
      current.total_tokens += row.total_tokens;
      current.cost += apiEquivalentCost;
      current.api_equivalent_cost += apiEquivalentCost;
      current.theoretical_cost += apiEquivalentCost;
      current.recorded_cost += row.cost;
      current.cost_delta += row.cost - apiEquivalentCost;
      current.requests += row.requests;
      bySessionMap.set(row.session_id, current);
    }
    const bySession = [...bySessionMap.values()]
      .sort(
        (a, b) => b.api_equivalent_cost - a.api_equivalent_cost || b.total_tokens - a.total_tokens
      )
      .slice(0, 50);

    const eventRows = (await pgAll(
      `
      SELECT event_type, COUNT(*) as count
      FROM session_events
      WHERE user_id = ? ${dateFilter.sql}
      GROUP BY event_type
    `,
      authReq.userId,
      ...dateFilter.params
    )) as unknown as Array<{
      event_type: string;
      count: number;
    }>;
    const eventCounts = new Map(eventRows.map((row) => [row.event_type, row.count]));
    const latestContext = (await pgGet(
      `
      SELECT
        session_id as sessionId,
        provider,
        model,
        input_tokens as inputTokens,
        output_tokens as outputTokens,
        cache_read_tokens as cacheReadTokens,
        cache_creation_tokens as cacheCreationTokens,
        total_tokens as totalTokens,
        context_window as contextWindow,
        context_used_percent as contextUsedPercent,
        context_exceeded as contextExceeded,
        strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt
      FROM session_events
      WHERE user_id = ? AND event_type = 'context_snapshot' ${dateFilter.sql}
      ORDER BY created_at DESC, seq DESC
      LIMIT 1
    `,
      authReq.userId,
      ...dateFilter.params
    )) as unknown as
      | {
          sessionId: string;
          provider: string | null;
          model: string | null;
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheCreationTokens: number;
          totalTokens: number;
          contextWindow: number;
          contextUsedPercent: number;
          contextExceeded: number;
          createdAt: string;
        }
      | undefined;

    res.json({
      success: true,
      data: {
        period: window.period,
        window,
        totals: {
          inputTokens: totals.total_input_tokens,
          outputTokens: totals.total_output_tokens,
          cacheReadTokens: totals.total_cache_read_tokens,
          cacheCreationTokens: totals.total_cache_creation_tokens,
          totalTokens: totals.total_tokens,
          totalCost: apiEquivalentTotalCost,
          recordedCost: totals.total_cost,
          apiEquivalentCost: apiEquivalentTotalCost,
          theoreticalCost: apiEquivalentTotalCost,
          costDelta: totals.total_cost - apiEquivalentTotalCost,
          pricedTokens,
          unpricedTokens,
          pricingCoveragePercent:
            totals.total_tokens > 0 ? Math.round((pricedTokens / totals.total_tokens) * 100) : 100,
          totalRequests: totals.total_requests,
        },
        byModel,
        byProvider,
        bySession,
        events: {
          contextSnapshots: eventCounts.get('context_snapshot') || 0,
          compactEvents: eventCounts.get('compact') || 0,
          latestContext: latestContext
            ? {
                ...latestContext,
                contextExceeded: Boolean(latestContext.contextExceeded),
              }
            : null,
        },
        pricingAudit: {
          recordedCost: totals.total_cost,
          apiEquivalentCost: apiEquivalentTotalCost,
          theoreticalCost: apiEquivalentTotalCost,
          delta: totals.total_cost - apiEquivalentTotalCost,
          pricedTokens,
          unpricedTokens,
          coveragePercent:
            totals.total_tokens > 0 ? Math.round((pricedTokens / totals.total_tokens) * 100) : 100,
          missingPricingModels,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching analytics summary:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch analytics' } });
  }
});

/**
 * Per-subagent usage inside the selected window.
 *
 * These tokens are a SUBSET of /summary — a turn's usage_history row already
 * includes everything its subagents spent. `parentShare` says how much of the
 * window's total was driven by spawned agents rather than the top-level turn.
 */
router.get('/subagents', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  try {
    const window = await resolveAnalyticsWindow(req.query.period, req.query.tz, req.query.offset);
    const dateFilter = buildDateFilter(window);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);

    const agents = await pgAll(
      `
      SELECT
        agent_id as agentId,
        MAX(agent_type) as agentType,
        MAX(model) as model,
        MAX(parent_agent_id) as parentAgentId,
        provider,
        COUNT(*) as turns,
        COUNT(DISTINCT session_id) as sessions,
        COALESCE(SUM(input_tokens), 0) as inputTokens,
        COALESCE(SUM(output_tokens), 0) as outputTokens,
        COALESCE(SUM(cache_read_tokens), 0) as cacheReadTokens,
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COALESCE(SUM(cost_usd), 0) as costUsd,
        MAX(created_at) as lastUsedAt
      FROM usage_subagent_turns
      WHERE user_id = ? ${dateFilter.sql}
      GROUP BY agent_id, provider
      ORDER BY totalTokens DESC
      LIMIT ?
    `,
      authReq.userId,
      ...dateFilter.params,
      limit
    );

    const totals = (await pgGet(
      `
      SELECT
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COALESCE(SUM(cost_usd), 0) as costUsd,
        COUNT(DISTINCT agent_id) as agentCount,
        COUNT(DISTINCT turn_id) as turnCount
      FROM usage_subagent_turns
      WHERE user_id = ? ${dateFilter.sql}
    `,
      authReq.userId,
      ...dateFilter.params
    )) as unknown as {
      totalTokens: number;
      costUsd: number;
      agentCount: number;
      turnCount: number;
    };

    const overall = (await pgGet(
      `SELECT COALESCE(SUM(total_tokens), 0) as totalTokens
         FROM usage_history
         WHERE user_id = ? ${dateFilter.sql}`,
      authReq.userId,
      ...dateFilter.params
    )) as unknown as { totalTokens: number };

    res.json({
      success: true,
      data: {
        period: window.period,
        agents,
        totals: {
          ...totals,
          windowTotalTokens: overall.totalTokens,
          parentSharePercent:
            overall.totalTokens > 0
              ? Math.round((totals.totalTokens / overall.totalTokens) * 100)
              : 0,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching subagent analytics:', error);
    res
      .status(500)
      .json({ success: false, error: { message: 'Failed to fetch subagent analytics' } });
  }
});

// Get usage over time (for charts)
router.get('/timeline', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  const { granularity = 'day', tz } = req.query;
  const tzModifier = parseTzModifier(tz);

  try {
    const window = await resolveAnalyticsWindow(req.query.period, tz, req.query.offset);
    const dateFilter = buildDateFilter(window);
    let dateFormat = '%Y-%m-%d';
    if (window.period === '24h') {
      dateFormat = granularity === 'hour' ? '%Y-%m-%d %H:00' : '%Y-%m-%d';
    } else if (window.period === 'all') {
      dateFormat = '%Y-%m';
    }

    const timeline = await pgAll(
      `
      SELECT
        strftime('${dateFormat}', created_at, ?) as date,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as requests
      FROM usage_history
      WHERE user_id = ? ${dateFilter.sql}
      GROUP BY strftime('${dateFormat}', created_at, ?)
      ORDER BY date ASC
    `,
      tzModifier,
      authReq.userId,
      ...dateFilter.params,
      tzModifier
    );

    const providerRows = (await pgAll(
      `
      SELECT
        strftime('${dateFormat}', created_at, ?) as date,
        model,
        provider,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as requests
      FROM usage_history
      WHERE user_id = ? ${dateFilter.sql}
      GROUP BY strftime('${dateFormat}', created_at, ?), provider, model
      ORDER BY date ASC
    `,
      tzModifier,
      authReq.userId,
      ...dateFilter.params,
      tzModifier
    )) as unknown as Array<{
      date: string;
      model: string | null;
      provider: string | null;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_creation_tokens: number;
      total_tokens: number;
      requests: number;
    }>;

    const providersByDate = new Map<
      string,
      Record<string, { tokens: number; cost: number; requests: number }>
    >();
    const modelsByDate = new Map<
      string,
      Record<
        string,
        { model: string; provider: string; tokens: number; cost: number; requests: number }
      >
    >();
    const costByDate = new Map<string, number>();
    for (const row of providerRows) {
      const provider = getProviderLabelForUsage(row.provider, row.model);
      const model = row.model || 'Unknown';
      const apiEquivalentCost = estimateApiEquivalentCost(row).cost;
      const current = providersByDate.get(row.date) || {};
      const entry = current[provider] || { tokens: 0, cost: 0, requests: 0 };
      entry.tokens += row.total_tokens;
      entry.cost += apiEquivalentCost;
      entry.requests += row.requests;
      current[provider] = entry;
      providersByDate.set(row.date, current);

      const currentModels = modelsByDate.get(row.date) || {};
      const modelKey = getUsageModelKey(provider, model);
      const modelEntry = currentModels[modelKey] || {
        model,
        provider,
        tokens: 0,
        cost: 0,
        requests: 0,
      };
      modelEntry.tokens += row.total_tokens;
      modelEntry.cost += apiEquivalentCost;
      modelEntry.requests += row.requests;
      currentModels[modelKey] = modelEntry;
      modelsByDate.set(row.date, currentModels);

      costByDate.set(row.date, (costByDate.get(row.date) || 0) + apiEquivalentCost);
    }

    const eventRows = (await pgAll(
      `
      SELECT
        strftime('${dateFormat}', created_at, ?) as date,
        event_type,
        COUNT(*) as count,
        MAX(context_used_percent) as max_context_used_percent
      FROM session_events
      WHERE user_id = ? ${dateFilter.sql}
      GROUP BY strftime('${dateFormat}', created_at, ?), event_type
      ORDER BY date ASC
    `,
      tzModifier,
      authReq.userId,
      ...dateFilter.params,
      tzModifier
    )) as unknown as Array<{
      date: string;
      event_type: string;
      count: number;
      max_context_used_percent: number | null;
    }>;
    const eventsByDate = new Map<
      string,
      { context_snapshots: number; compact_events: number; max_context_used_percent: number | null }
    >();
    for (const row of eventRows) {
      const current = eventsByDate.get(row.date) || {
        context_snapshots: 0,
        compact_events: 0,
        max_context_used_percent: null,
      };
      if (row.event_type === 'context_snapshot') {
        current.context_snapshots += row.count;
        if (typeof row.max_context_used_percent === 'number') {
          current.max_context_used_percent =
            current.max_context_used_percent === null
              ? row.max_context_used_percent
              : Math.max(current.max_context_used_percent, row.max_context_used_percent);
        }
      } else if (row.event_type === 'compact') {
        current.compact_events += row.count;
      }
      eventsByDate.set(row.date, current);
    }

    const timelineByDate = new Map<
      string,
      {
        date: string;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_creation_tokens: number;
        total_tokens: number;
        requests: number;
      }
    >();
    for (const entry of timeline as Array<{
      date: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_creation_tokens: number;
      total_tokens: number;
      requests: number;
    }>) {
      timelineByDate.set(entry.date, entry);
    }
    for (const date of eventsByDate.keys()) {
      if (!timelineByDate.has(date)) {
        timelineByDate.set(date, {
          date,
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          total_tokens: 0,
          requests: 0,
        });
      }
    }

    const timelineWithProviders = [...timelineByDate.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((entry) => ({
        ...entry,
        cost: costByDate.get(entry.date) || 0,
        providers: providersByDate.get(entry.date) || {},
        models: modelsByDate.get(entry.date) || {},
        context_snapshots: eventsByDate.get(entry.date)?.context_snapshots || 0,
        compact_events: eventsByDate.get(entry.date)?.compact_events || 0,
        max_context_used_percent: eventsByDate.get(entry.date)?.max_context_used_percent ?? null,
      }));

    res.json({
      success: true,
      data: timelineWithProviders,
    });
  } catch (error) {
    console.error('Error fetching analytics timeline:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch timeline' } });
  }
});

// Get session-specific analytics
router.get('/sessions/:sessionId', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  const { sessionId } = req.params;

  try {
    // One round-trip: ownership check + totals in a single query. Returns null-row
    // when the session doesn't exist OR doesn't belong to the user.
    const sessionTotals = (await pgGet(
      `
      SELECT
        s.id as session_id,
        s.name as session_name,
        COALESCE(SUM(uh.input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(uh.output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(uh.cache_read_tokens), 0) as total_cache_read_tokens,
        COALESCE(SUM(uh.cache_creation_tokens), 0) as total_cache_creation_tokens,
        COALESCE(SUM(uh.total_tokens), 0) as total_tokens,
        COALESCE(SUM(uh.cost_usd), 0) as total_cost,
        COUNT(uh.id) as total_requests
      FROM sessions s
      LEFT JOIN usage_history uh ON uh.session_id = s.id AND uh.user_id = s.user_id
      WHERE s.id = ? AND s.user_id = ?
      GROUP BY s.id
    `,
      sessionId,
      authReq.userId
    )) as unknown as
      | {
          session_id: string;
          session_name: string;
          total_input_tokens: number;
          total_output_tokens: number;
          total_cache_read_tokens: number;
          total_cache_creation_tokens: number;
          total_tokens: number;
          total_cost: number;
          total_requests: number;
        }
      | undefined;

    if (!sessionTotals) {
      return res.status(404).json({ success: false, error: { message: 'Session not found' } });
    }

    const session = { id: sessionTotals.session_id, name: sessionTotals.session_name };
    const totals = sessionTotals;

    const sessionModelRows = (await pgAll(
      `
      SELECT
        model,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens
      FROM usage_history
      WHERE session_id = ? AND user_id = ?
      GROUP BY model
    `,
      sessionId,
      authReq.userId
    )) as unknown as TokenCostRow[];
    const apiEquivalentTotalCost = sessionModelRows.reduce(
      (sum, row) => sum + estimateApiEquivalentCost(row).cost,
      0
    );

    // Get usage history for this session — scoped by user_id too so a shared
    // session row can't leak rows that belong to another user.
    const historyRows = (await pgAll(
      `
      SELECT
        id,
        provider,
        turn_id,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_creation_tokens,
        total_tokens,
        cost_usd as cost,
        model,
        created_at
      FROM usage_history
      WHERE session_id = ? AND user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `,
      sessionId,
      authReq.userId
    )) as unknown as Array<
      TokenCostRow & {
        id: number;
        provider: string;
        turn_id: string | null;
        total_tokens: number;
        cost: number;
        created_at: string;
      }
    >;
    const history = historyRows.map((row) => {
      const apiEquivalentCost = estimateApiEquivalentCost(row).cost;
      return {
        ...row,
        cost: apiEquivalentCost,
        recorded_cost: row.cost,
        api_equivalent_cost: apiEquivalentCost,
        theoretical_cost: apiEquivalentCost,
        cost_delta: row.cost - apiEquivalentCost,
      };
    });

    const eventRows = (await pgAll(
      `
      SELECT
        id,
        event_type as eventType,
        provider,
        model,
        input_tokens as inputTokens,
        output_tokens as outputTokens,
        cache_read_tokens as cacheReadTokens,
        cache_creation_tokens as cacheCreationTokens,
        total_tokens as totalTokens,
        context_window as contextWindow,
        context_used_percent as contextUsedPercent,
        context_exceeded as contextExceeded,
        reason,
        message,
        summary,
        strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt
      FROM session_events
      WHERE session_id = ? AND user_id = ?
      ORDER BY created_at DESC, seq DESC
      LIMIT 100
    `,
      sessionId,
      authReq.userId
    )) as unknown as Array<{
      id: string;
      eventType: string;
      provider: string | null;
      model: string | null;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      totalTokens: number;
      contextWindow: number;
      contextUsedPercent: number;
      contextExceeded: number;
      reason: string | null;
      message: string | null;
      summary: string | null;
      createdAt: string;
    }>;
    const events = eventRows.map((row) => ({
      ...row,
      contextExceeded: Boolean(row.contextExceeded),
    }));

    res.json({
      success: true,
      data: {
        session: {
          id: session.id,
          name: session.name,
        },
        totals: {
          inputTokens: totals.total_input_tokens,
          outputTokens: totals.total_output_tokens,
          cacheReadTokens: totals.total_cache_read_tokens,
          cacheCreationTokens: totals.total_cache_creation_tokens,
          totalTokens: totals.total_tokens,
          totalCost: apiEquivalentTotalCost,
          recordedCost: totals.total_cost,
          apiEquivalentCost: apiEquivalentTotalCost,
          theoreticalCost: apiEquivalentTotalCost,
          costDelta: totals.total_cost - apiEquivalentTotalCost,
          totalRequests: totals.total_requests,
        },
        history,
        events,
      },
    });
  } catch (error) {
    console.error('Error fetching session analytics:', error);
    res
      .status(500)
      .json({ success: false, error: { message: 'Failed to fetch session analytics' } });
  }
});

// Record usage (internal use - called from ClaudeProcessManager)
router.post('/record', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  const {
    sessionId,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens,
    model,
    turnId: requestedTurnId,
  } = req.body;
  const normalizedTokens = {
    inputTokens: inputTokens || 0,
    outputTokens: outputTokens || 0,
    cacheReadTokens: cacheReadTokens || 0,
    cacheCreationTokens: cacheCreationTokens || 0,
  };
  const normalizedTotalTokens =
    totalTokens ||
    normalizedTokens.inputTokens +
      normalizedTokens.outputTokens +
      normalizedTokens.cacheReadTokens +
      normalizedTokens.cacheCreationTokens;
  const costUsd = estimateModelCost(model, normalizedTokens, null).cost;

  try {
    const session = (await pgGet(
      'SELECT cli_provider as provider FROM sessions WHERE id = ? AND user_id = ?',
      sessionId,
      authReq.userId
    )) as unknown as { provider: CLIProvider | null } | undefined;
    if (!session) {
      return res.status(404).json({ success: false, error: { message: 'Session not found' } });
    }

    const turnId =
      typeof requestedTurnId === 'string' && requestedTurnId.trim()
        ? requestedTurnId.trim()
        : nanoid();
    const provider = session.provider || 'codex';
    const inserted = await insertUsageHistoryTurn({
      userId: authReq.userId,
      sessionId,
      provider,
      turnId,
      inputTokens: normalizedTokens.inputTokens,
      outputTokens: normalizedTokens.outputTokens,
      cacheReadTokens: normalizedTokens.cacheReadTokens,
      cacheCreationTokens: normalizedTokens.cacheCreationTokens,
      totalTokens: normalizedTotalTokens,
      costUsd: costUsd || 0,
      model: model || 'unknown',
    });
    const row = (await pgGet(
      'SELECT id FROM usage_history WHERE session_id = ? AND provider = ? AND turn_id = ?',
      sessionId,
      provider,
      turnId
    )) as unknown as { id: number } | undefined;

    res.json({ success: true, data: { id: row?.id ?? null, turnId, inserted } });
  } catch (error) {
    console.error('Error recording usage:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to record usage' } });
  }
});

export default router;
