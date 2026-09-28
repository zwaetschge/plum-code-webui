import { formatNumber } from '@/lib/analyticsFormat';

/**
 * Shared shapes, colours and formatting for the analytics dashboard. The page
 * owns the queries; the cards below only render what they are handed.
 */

export interface LimitWindowData {
  utilization: number;
  resetsAt: string | null;
  windowSeconds?: number | null;
  used?: number | null;
  limit?: number | null;
  remaining?: number | null;
  unit?: string | null;
}

export interface ProviderTotals {
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  cost: number;
  requests: number;
}

export interface AnalyticsSummary {
  period: string;
  window?: {
    period: string;
    startsAt: string | null;
    endsAt: string | null;
    source: 'rolling' | 'calendar-week' | 'calendar-month' | 'all';
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
  };
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    totalCost: number;
    recordedCost: number;
    apiEquivalentCost: number;
    theoreticalCost: number;
    costDelta: number;
    pricedTokens: number;
    unpricedTokens: number;
    pricingCoveragePercent: number;
    totalRequests: number;
  };
  byModel: Array<{
    model: string | null;
    provider: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    total_tokens: number;
    cost: number;
    recorded_cost: number;
    api_equivalent_cost: number;
    theoretical_cost: number;
    cost_delta: number;
    pricing_known: boolean;
    pricing_source: string | null;
    pricing_label: string | null;
    pricing: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
    requests: number;
    first_seen: string | null;
    last_seen: string | null;
  }>;
  byProvider: Array<
    ProviderTotals & {
      recorded_cost: number;
      api_equivalent_cost: number;
      theoretical_cost: number;
      cost_delta: number;
      priced_tokens: number;
      unpriced_tokens: number;
      models: number;
    }
  >;
  bySession: SessionUsage[];
  /** The previous window, cut to the same elapsed time; null for "All". */
  comparison?: {
    startsAt: string;
    endsAt: string;
    totals: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      totalTokens: number;
      totalCost: number;
      totalRequests: number;
    };
    byProvider: ProviderTotals[];
  } | null;
  pricingAudit: {
    recordedCost: number;
    apiEquivalentCost: number;
    theoreticalCost: number;
    delta: number;
    pricedTokens: number;
    unpricedTokens: number;
    coveragePercent: number;
    missingPricingModels: Array<{
      model: string;
      provider: string;
      tokens: number;
      requests: number;
    }>;
  };
  events?: {
    contextSnapshots: number;
    compactEvents: number;
    latestContext: {
      sessionId: string;
      provider: string | null;
      model: string | null;
      contextUsedPercent: number;
      createdAt: string;
    } | null;
  };
}

export interface SessionUsage {
  session_id: string;
  session_name: string | null;
  total_tokens: number;
  cost: number;
  requests: number;
  provider?: string | null;
  last_active?: string | null;
}

export interface TimelineData {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  cost: number;
  requests: number;
  providers?: Record<string, { tokens: number; cost: number; requests: number }>;
  models?: Record<
    string,
    { model: string; provider: string; tokens: number; cost: number; requests: number }
  >;
  context_snapshots?: number;
  compact_events?: number;
  max_context_used_percent?: number | null;
}

export type UsageMetric = 'cost' | 'tokens' | 'requests';

export const USAGE_METRICS: Array<{ value: UsageMetric; label: string; by: string }> = [
  { value: 'cost', label: 'Spend', by: 'By spend' },
  { value: 'tokens', label: 'Tokens', by: 'By tokens' },
  { value: 'requests', label: 'Requests', by: 'By requests' },
];

export const PROVIDER_FALLBACK_COLOR = '#94a3b8';

export const PROVIDER_COLORS: Record<string, string> = {
  Codex: '#22c55e',
  Kimi: '#2582ed',
  // Kimi already owns blue; OpenCode needs a hue that stays apart from it.
  OpenCode: '#f472b6',
  Pi: '#a855f7',
  'Z.AI': '#14b8a6',
  Vibe: '#fa520f',
  Claude: '#f97316',
  Other: PROVIDER_FALLBACK_COLOR,
};

/** The "total" series; the provider colours above stay reserved for providers. */
export const TOTAL_COLOR = '#8b7cf6';

export function getProviderColor(provider?: string | null): string {
  return PROVIDER_COLORS[provider || ''] ?? PROVIDER_FALLBACK_COLOR;
}

export function withAlpha(hex: string, alpha: string): string {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  if (normalized.length !== 6) return hex;
  return `#${normalized}${alpha}`;
}

/** Cents from a dollar up; four decimals only where cents would read as $0.00. */
export function formatCurrency(amount: number): string {
  const abs = Math.abs(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: abs >= 1 || abs === 0 ? 2 : 4,
  }).format(amount);
}

export function formatSignedCurrency(amount: number): string {
  if (Math.abs(amount) < 0.00005) return formatCurrency(0);
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount))}`;
}

export function formatAxisCurrency(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: value < 10 ? 1 : 0 })}`;
}

export function formatMetric(metric: UsageMetric, value: number): string {
  if (metric === 'cost') return formatCurrency(value);
  if (metric === 'requests') return Math.round(value).toLocaleString('en-US');
  return formatNumber(value);
}

export function formatAxisMetric(metric: UsageMetric, value: number): string {
  if (metric === 'cost') return formatAxisCurrency(value);
  return formatNumber(value);
}

export function metricValue(
  entry: { cost: number; tokens?: number; total_tokens?: number; requests: number },
  metric: UsageMetric
): number {
  if (metric === 'cost') return entry.cost;
  if (metric === 'requests') return entry.requests;
  return entry.tokens ?? entry.total_tokens ?? 0;
}

/** Relative change in percent; null when there is nothing to compare with. */
export function percentChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return '—';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatResetDelta(iso?: string | null): string {
  if (!iso) return '';
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return '';
  const diffMs = target - Date.now();
  if (diffMs <= 0) return 'now';
  const mins = Math.floor(diffMs / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins % 60}m`;
  return `in ${mins % 60}m`;
}

/** "Sep 21 – Sep 28, 2026" for a window; the end is exclusive, so it shows the last day. */
export function formatWindowDates(startsAt?: string | null, endsAt?: string | null): string {
  if (!startsAt || !endsAt) return 'All time';
  const start = new Date(startsAt);
  const end = new Date(Date.parse(endsAt) - 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'All time';
  const sameDay = start.toDateString() === end.toDateString();
  const day = (date: Date, withYear: boolean) =>
    date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  if (sameDay) {
    const time = (date: Date) =>
      date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${day(start, false)}, ${time(start)} – ${time(new Date(Date.parse(endsAt)))}`;
  }
  // A rolling 24h window spans two days; keep the times so it stays readable.
  if (end.getTime() - start.getTime() < 36 * 3600_000) {
    const stamp = (date: Date) =>
      date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    return `${stamp(start)} – ${stamp(new Date(Date.parse(endsAt)))}`;
  }
  return `${day(start, start.getFullYear() !== end.getFullYear())} – ${day(end, true)}`;
}
