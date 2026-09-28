import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  BarChart3,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  Layers,
  Percent,
  Send,
  Users,
} from 'lucide-react';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/analyticsFormat';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DEFAULT_ANALYTICS_HIDDEN_LIMIT_METRICS, type UserSettings } from '@plum-code-webui/shared';
import { KpiCard, type KpiDelta } from '@/components/analytics/KpiCard';
import { Segmented } from '@/components/analytics/AnalyticsPanel';
import {
  UsageOverTimeCard,
  type UsageBucket,
  type UsageSeries,
} from '@/components/analytics/UsageOverTimeCard';
import { ProviderMixCard } from '@/components/analytics/ProviderMixCard';
import { TopModelsCard } from '@/components/analytics/TopModelsCard';
import { ProviderLimitsCard } from '@/components/analytics/ProviderLimitsCard';
import { PricingHealthCard } from '@/components/analytics/PricingHealthCard';
import { TopSessionsTable } from '@/components/analytics/TopSessionsTable';
import {
  formatCurrency,
  formatWindowDates,
  getProviderColor,
  metricValue,
  percentChange,
  type AnalyticsSummary,
  type ProviderTotals,
  type TimelineData,
  type UsageMetric,
} from '@/components/analytics/analyticsModel';
import {
  HISTORY_PROVIDERS,
  USAGE_PROVIDERS,
  USAGE_PROVIDER_COLORS,
  USAGE_PROVIDER_LIMIT_COLORS,
  USAGE_TRACKER_ANALYTICS_LABEL,
  USAGE_TRACKER_LABELS,
  loadUsageLimitTrackers,
  saveUsageLimitTrackers,
  type ProviderLimitEntry,
  type UsageLimitTracker,
  type UsageLimitsResponse,
} from '@/components/analytics/limitsModel';

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

type AnalyticsPeriod = '24h' | '7d' | '30d' | '90d' | 'all';
type UsageLimitHistoryRange = '24h' | '7d' | '30d' | '90d';

interface UsageLimitHistoryPoint {
  provider: UsageLimitTracker;
  metricKey: string;
  metricLabel: string;
  utilization: number | null;
  resetDetected: boolean;
  resetEventAt: string | null;
  recordedAt: string;
}

interface UsageLimitHistoryData {
  range: UsageLimitHistoryRange;
  points: UsageLimitHistoryPoint[];
}

// "Week" and "Month" are calendar windows (the Codex weekly quota resets on a
// week boundary); 24h and 90d are rolling.
const PERIODS: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: '24h', label: '24H' },
  { value: '7d', label: 'Week' },
  { value: '30d', label: 'Month' },
  { value: '90d', label: '90D' },
  { value: 'all', label: 'All' },
];

const COMPARE_CAPTION: Record<AnalyticsPeriod, string> = {
  '24h': 'vs previous 24h',
  '7d': 'vs same time last week',
  '30d': 'vs same time last month',
  '90d': 'vs previous 90 days',
  all: 'all recorded usage',
};

const MAX_RESET_MARKERS = 24;

function getTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

function parseTimelineLabel(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})(?:-(\d{2})(?:\s+(\d{2}):00)?)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = match[3] ? Number(match[3]) : 1;
  const hour = match[4] ? Number(match[4]) : 0;
  const date = new Date(year, month, day, hour);
  return Number.isNaN(date.getTime()) ? null : date;
}

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildTimelineCsv(rows: TimelineData[]): string {
  const header = [
    'date',
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_creation_tokens',
    'total_tokens',
    'cost',
    'requests',
    'context_snapshots',
    'compact_events',
    'max_context_used_percent',
    'models_json',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.date),
        row.input_tokens,
        row.output_tokens,
        row.cache_read_tokens,
        row.cache_creation_tokens,
        row.total_tokens,
        row.cost,
        row.requests,
        row.context_snapshots ?? 0,
        row.compact_events ?? 0,
        row.max_context_used_percent ?? '',
        csvEscape(row.models ? JSON.stringify(row.models) : ''),
      ].join(',')
    );
  }
  return lines.join('\n');
}

/** Index of the first value >= target in an ascending array. */
function lowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid]! < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function providerKey(provider: string): string {
  return `provider_${provider.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

function sumProviders(rows: ProviderTotals[]) {
  return rows.reduce(
    (total, row) => ({
      cost: total.cost + row.cost,
      tokens: total.tokens + row.total_tokens,
      requests: total.requests + row.requests,
      input: total.input + row.input_tokens,
      cacheRead: total.cacheRead + row.cache_read_tokens,
      cacheCreation: total.cacheCreation + row.cache_creation_tokens,
      providers: total.providers + (row.requests > 0 ? 1 : 0),
    }),
    { cost: 0, tokens: 0, requests: 0, input: 0, cacheRead: 0, cacheCreation: 0, providers: 0 }
  );
}

/** Share of prompt tokens served from cache. */
function cacheRate(input: number, cacheRead: number, cacheCreation: number): number | null {
  const prompt = input + cacheRead + cacheCreation;
  return prompt > 0 ? (cacheRead / prompt) * 100 : null;
}

export function AnalyticsPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('7d');
  const [periodOffset, setPeriodOffset] = useState(0);
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [usageMetric, setUsageMetric] = useState<UsageMetric>('cost');
  const [mixMetric, setMixMetric] = useState<UsageMetric>('cost');
  const [showLimits, setShowLimits] = useState(false);
  const [enabledUsageTrackers, setEnabledUsageTrackers] =
    useState<UsageLimitTracker[]>(loadUsageLimitTrackers);
  // Capture the offset once per mount so query keys stay stable even if the system clock
  // nudges (e.g. DST rollover mid-session would otherwise refetch every render).
  const tzOffsetRef = useRef(getTzOffsetMinutes());
  const tzOffset = tzOffsetRef.current;
  const timelineGranularity = period === '24h' ? 'hour' : 'day';
  const chartGranularity = period === '24h' ? 'hour' : period === 'all' ? 'month' : 'day';
  const usageHistoryRange: UsageLimitHistoryRange = period === 'all' ? '90d' : period;

  const { data: userSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<UserSettings>>('/api/settings');
      return response.data.data;
    },
    staleTime: 60_000,
  });

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    error: summaryErrorObj,
  } = useQuery({
    queryKey: ['analytics-summary', period, periodOffset, tzOffset],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AnalyticsSummary>>(
        `/api/analytics/summary?period=${period}&tz=${tzOffset}&offset=${periodOffset}`
      );
      return response.data.data;
    },
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const {
    data: timeline,
    isLoading: timelineLoading,
    isError: timelineError,
  } = useQuery({
    queryKey: ['analytics-timeline', period, periodOffset, tzOffset, timelineGranularity],
    queryFn: async () => {
      const response = await api.get<ApiResponse<TimelineData[]>>(
        `/api/analytics/timeline?period=${period}&tz=${tzOffset}&offset=${periodOffset}&granularity=${timelineGranularity}`
      );
      return response.data.data;
    },
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  // Fetch usage limits for all supported providers
  const usageLimitsQueries = USAGE_PROVIDERS.map((prov) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQuery({
      queryKey: ['usage-limits', prov],
      queryFn: async () => {
        const response = await api.get<UsageLimitsResponse>(`/api/usage/limits?provider=${prov}`);
        return { cliProvider: prov, ...response.data };
      },
      staleTime: 5 * 60_000,
      refetchInterval: 15 * 60_000,
      retry: 1,
      enabled: enabledUsageTrackers.includes(prov),
    });
  });

  const usageLimitEntries: ProviderLimitEntry[] = usageLimitsQueries
    .filter((q) => q.data?.success && q.data?.supported && q.data?.data)
    .map((q) => ({
      tracker: q.data!.cliProvider,
      provider: q.data!.provider,
      data: q.data!.data!,
      error: q.data!.error,
    }));

  const usageLimitsLoading = usageLimitsQueries.some(
    (q, index) => enabledUsageTrackers.includes(USAGE_PROVIDERS[index]!) && q.isLoading
  );

  // Quota history is only needed for the opt-in limit overlay on the chart,
  // and only providers with an upstream quota have any.
  const historyTrackers = enabledUsageTrackers.filter((tracker) =>
    HISTORY_PROVIDERS.includes(tracker)
  );
  const { data: usageLimitHistory } = useQuery({
    queryKey: ['usage-limit-history', usageHistoryRange, [...historyTrackers].sort().join(',')],
    queryFn: async () => {
      const providers = historyTrackers.join(',');
      const response = await api.get<ApiResponse<UsageLimitHistoryData>>(
        `/api/usage/limit-history?range=${usageHistoryRange}&providers=${encodeURIComponent(providers)}`
      );
      return response.data.data;
    },
    enabled: showLimits && historyTrackers.length > 0 && !usageLimitsLoading,
    staleTime: 60_000,
    refetchInterval: 15 * 60_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const toggleUsageTracker = useCallback((provider: UsageLimitTracker) => {
    setEnabledUsageTrackers((current) => {
      const next = current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider];
      saveUsageLimitTrackers(next);
      return next;
    });
  }, []);

  const [testAlertState, setTestAlertState] = useState<'idle' | 'sending' | 'sent' | 'failed'>(
    'idle'
  );
  const sendTestAlert = useCallback(async () => {
    setTestAlertState('sending');
    try {
      await api.post('/api/workspace/notifications/test', {});
      setTestAlertState('sent');
    } catch {
      setTestAlertState('failed');
    }
  }, []);

  const handlePeriodChange = useCallback((next: AnalyticsPeriod) => {
    setPeriod(next);
    setPeriodOffset(0);
  }, []);

  const hasError = summaryError || timelineError;
  const errorMessage =
    summaryErrorObj instanceof Error ? summaryErrorObj.message : 'Analytics failed to load';
  const analyticsWindow = summary?.window;

  // ── Provider filter ────────────────────────────────────────────────────────
  const allProviders: ProviderTotals[] = useMemo(() => summary?.byProvider ?? [], [summary]);
  const providerNames = allProviders.map((provider) => provider.provider);
  // A filter for a provider that has no usage in the new window would blank
  // the dashboard without saying why; it is dropped instead.
  const activeFilter =
    providerFilter && providerNames.includes(providerFilter) ? providerFilter : null;
  const scopedProviders = activeFilter
    ? allProviders.filter((provider) => provider.provider === activeFilter)
    : allProviders;
  const previousProviders = summary?.comparison
    ? activeFilter
      ? summary.comparison.byProvider.filter((provider) => provider.provider === activeFilter)
      : summary.comparison.byProvider
    : null;

  const current = sumProviders(scopedProviders);
  const previous = previousProviders ? sumProviders(previousProviders) : null;
  const avgCost = current.requests > 0 ? current.cost / current.requests : 0;
  const previousAvgCost =
    previous && previous.requests > 0 ? previous.cost / previous.requests : null;
  const cacheEfficiency = cacheRate(current.input, current.cacheRead, current.cacheCreation);
  const previousCacheEfficiency = previous
    ? cacheRate(previous.input, previous.cacheRead, previous.cacheCreation)
    : null;

  // ── Timeline ──────────────────────────────────────────────────────────────
  const buckets = useMemo(() => {
    return (timeline ?? []).flatMap((entry) => {
      const parsed = parseTimelineLabel(entry.date);
      if (!parsed) return [];
      const providers = entry.providers ?? {};
      const scoped = activeFilter
        ? providers[activeFilter]
          ? { [activeFilter]: providers[activeFilter]! }
          : {}
        : providers;
      const totals = Object.values(scoped).reduce(
        (sum, value) => ({
          cost: sum.cost + value.cost,
          tokens: sum.tokens + value.tokens,
          requests: sum.requests + value.requests,
        }),
        { cost: 0, tokens: 0, requests: 0 }
      );
      return [{ timestamp: parsed.getTime(), entry, scoped, totals }];
    });
  }, [timeline, activeFilter]);

  const sparkline = useMemo(() => {
    const avg = buckets.map(({ totals }) =>
      totals.requests > 0 ? totals.cost / totals.requests : 0
    );
    return {
      cost: buckets.map(({ totals }) => totals.cost),
      tokens: buckets.map(({ totals }) => totals.tokens),
      requests: buckets.map(({ totals }) => totals.requests),
      avgCost: avg,
      // Cache hits per bucket exist only for all providers together.
      cache: activeFilter
        ? []
        : buckets.map(
            ({ entry }) =>
              cacheRate(entry.input_tokens, entry.cache_read_tokens, entry.cache_creation_tokens) ??
              0
          ),
      providers: buckets.map(({ scoped }) => Object.keys(scoped).length),
    };
  }, [buckets, activeFilter]);

  // Filtered to one provider, its line would sit exactly on the total; the
  // total takes its name and colour instead.
  const providerSeries: UsageSeries[] = useMemo(
    () =>
      (activeFilter ? [] : scopedProviders)
        .filter((provider) => metricValue(provider, usageMetric) > 0)
        .map((provider) => ({
          key: providerKey(provider.provider),
          label: provider.provider,
          color: getProviderColor(provider.provider),
        })),
    [scopedProviders, usageMetric, activeFilter]
  );

  // ── Quota overlay ────────────────────────────────────────────────────────
  const limitOverlaySeries = useMemo(() => {
    const providerOrder = new Map(enabledUsageTrackers.map((provider, index) => [provider, index]));
    const groups = new Map<
      string,
      {
        key: string;
        provider: UsageLimitTracker;
        metricKey: string;
        metricLabel: string;
        points: UsageLimitHistoryPoint[];
      }
    >();
    const hiddenLimitMetrics =
      userSettings?.analytics?.hiddenLimitMetrics ?? DEFAULT_ANALYTICS_HIDDEN_LIMIT_METRICS;
    for (const point of usageLimitHistory?.points || []) {
      if (!providerOrder.has(point.provider) || point.utilization === null) continue;
      if (
        point.provider !== 'alibaba' &&
        point.provider !== 'mistral' &&
        point.provider !== 'vibe' &&
        hiddenLimitMetrics[point.provider]?.includes(point.metricKey)
      ) {
        continue;
      }
      if (activeFilter && USAGE_TRACKER_ANALYTICS_LABEL[point.provider] !== activeFilter) continue;
      const groupKey = `${point.provider}\u001f${point.metricKey}`;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.points.push(point);
        continue;
      }
      groups.set(groupKey, {
        key: `limit_${point.provider}_${point.metricKey.replace(/[^a-z0-9]+/gi, '_')}`,
        provider: point.provider,
        metricKey: point.metricKey,
        metricLabel: point.metricLabel,
        points: [point],
      });
    }
    const metricPriority = (metricKey: string) => {
      if (metricKey === 'five_hour') return 0;
      if (metricKey === 'seven_day') return 1;
      return 2;
    };
    const metricIndexByProvider = new Map<UsageLimitTracker, number>();
    return Array.from(groups.values())
      .sort(
        (a, b) =>
          (providerOrder.get(a.provider) ?? 99) - (providerOrder.get(b.provider) ?? 99) ||
          metricPriority(a.metricKey) - metricPriority(b.metricKey) ||
          a.metricLabel.localeCompare(b.metricLabel)
      )
      .map((series) => {
        const metricIndex = metricIndexByProvider.get(series.provider) || 0;
        metricIndexByProvider.set(series.provider, metricIndex + 1);
        const palette = USAGE_PROVIDER_LIMIT_COLORS[series.provider];
        const points = series.points
          .map((point) => ({ point, at: Date.parse(point.recordedAt) }))
          .filter(({ at }) => Number.isFinite(at))
          .sort((a, b) => a.at - b.at);
        return {
          ...series,
          label: `${USAGE_TRACKER_LABELS[series.provider]} · ${series.metricLabel}`,
          color: palette[metricIndex % palette.length] || USAGE_PROVIDER_COLORS[series.provider],
          points: points.map(({ point }) => point),
          // Parsed once: the resampling below runs per bucket and per series.
          times: points.map(({ at }) => at),
        };
      });
  }, [
    usageLimitHistory,
    enabledUsageTrackers,
    userSettings?.analytics?.hiddenLimitMetrics,
    activeFilter,
  ]);
  const visibleLimitOverlaySeries = useMemo(
    () => (showLimits ? limitOverlaySeries : []),
    [showLimits, limitOverlaySeries]
  );

  const chartData: UsageBucket[] = useMemo(() => {
    let usageBuckets: UsageBucket[] = buckets.map(({ timestamp, entry, scoped, totals }) => {
      const bucket: UsageBucket = {
        timestamp,
        date: entry.date,
        total: metricValue(totals, usageMetric),
      };
      providerSeries.forEach((series) => {
        const stats = scoped[series.label];
        bucket[series.key] = stats ? metricValue(stats, usageMetric) : 0;
      });
      return bucket;
    });

    // The API omits hours without usage. A time-series chart must not bridge
    // those gaps with a smoothed area because that invents token volume across
    // inactive hours. Build the complete 24-hour grid and explicitly represent
    // missing hours as zero; quota samples can then align to real clock time.
    if (period === '24h' && analyticsWindow?.startsAt && analyticsWindow?.endsAt) {
      const usageByTimestamp = new Map(usageBuckets.map((bucket) => [bucket.timestamp, bucket]));
      const start = new Date(analyticsWindow.startsAt);
      const end = new Date(analyticsWindow.endsAt);
      start.setMinutes(0, 0, 0);
      end.setMinutes(0, 0, 0);
      const hourlyBuckets: UsageBucket[] = [];
      for (
        let timestamp = start.getTime();
        Number.isFinite(timestamp) && timestamp <= end.getTime();
        timestamp += 60 * 60 * 1000
      ) {
        const existing = usageByTimestamp.get(timestamp);
        if (existing) {
          hourlyBuckets.push(existing);
          continue;
        }
        const emptyBucket: UsageBucket = { timestamp, total: 0 };
        providerSeries.forEach((series) => {
          emptyBucket[series.key] = 0;
        });
        hourlyBuckets.push(emptyBucket);
      }
      usageBuckets = hourlyBuckets;
    }

    const sortedBuckets = usageBuckets.sort((a, b) => a.timestamp - b.timestamp);
    const previousInterval =
      sortedBuckets.length > 1
        ? Number(sortedBuckets.at(-1)?.timestamp) - Number(sortedBuckets.at(-2)?.timestamp)
        : 60 * 60 * 1000;

    // Keep the analytics buckets authoritative. Injecting every 30-minute
    // quota sample into the usage series makes Recharts treat the missing
    // values as zero and destroys the curve. Instead, take the opening quota
    // sample for completed buckets and the latest quota sample for the
    // still-running bucket. Using the end-of-day sample at the day's start
    // shifts the limit line left by up to 24 hours.
    return sortedBuckets.map((bucket, index) => {
      const bucketStart = bucket.timestamp;
      const bucketEnd =
        index + 1 < sortedBuckets.length
          ? Number(sortedBuckets[index + 1]?.timestamp)
          : bucketStart + Math.max(previousInterval, 1);
      const isCurrentBucket = index === sortedBuckets.length - 1 && periodOffset === 0;
      const combinedBucket = { ...bucket };
      visibleLimitOverlaySeries.forEach((series) => {
        // Samples are sorted; the bucket's slice is [first >= start, first >= end).
        const from = lowerBound(series.times, bucketStart);
        const to = lowerBound(series.times, bucketEnd);
        const samplesInBucket = series.points.slice(from, to);
        const limitSample = isCurrentBucket ? samplesInBucket.at(-1) : samplesInBucket[0];
        combinedBucket[series.key] = limitSample?.utilization ?? null;
      });
      return combinedBucket;
    });
  }, [
    buckets,
    providerSeries,
    usageMetric,
    visibleLimitOverlaySeries,
    periodOffset,
    period,
    analyticsWindow,
  ]);

  // Over 90 days every 5-hour quota resets hundreds of times: that many
  // labelled lines cost seconds to draw and read as a solid wall. Markers
  // show only while they can still be told apart.
  const overlayResetEvents = useMemo(() => {
    const events = Array.from(
      new Set(
        visibleLimitOverlaySeries
          .flatMap((series) => series.points)
          .filter((point) => point.resetDetected && point.resetEventAt)
          .map((point) => Date.parse(point.resetEventAt!))
          .filter(Number.isFinite)
      )
    );
    return events.length <= MAX_RESET_MARKERS ? events : [];
  }, [visibleLimitOverlaySeries]);

  // ── Lists ────────────────────────────────────────────────────────────────
  const scopedModels = useMemo(
    () =>
      (summary?.byModel ?? []).filter((model) => !activeFilter || model.provider === activeFilter),
    [summary, activeFilter]
  );
  const scopedSessions = useMemo(
    () =>
      (summary?.bySession ?? []).filter(
        (session) => !activeFilter || !session.provider || session.provider === activeFilter
      ),
    [summary, activeFilter]
  );
  const scopedLimitEntries = useMemo(() => {
    if (!activeFilter) return usageLimitEntries;
    const matching = usageLimitEntries.filter(
      (entry) => USAGE_TRACKER_ANALYTICS_LABEL[entry.tracker] === activeFilter
    );
    return matching.length > 0 ? matching : usageLimitEntries;
  }, [usageLimitEntries, activeFilter]);

  // A cost figure alone says nothing about whether an alert is about to fire,
  // so show the newest bucket against the account threshold — same panel the
  // Android client shows, fed from the same account setting.
  const spendLimit = userSettings?.usageAlerts?.enabled
    ? (userSettings.usageAlerts.dailyCostUsd ?? 0)
    : 0;
  const latestBucketCost = timeline?.length ? (timeline[timeline.length - 1]?.cost ?? 0) : 0;

  // ── Export ───────────────────────────────────────────────────────────────
  const exportJson = useCallback(() => {
    if (!summary && !timeline) return;
    const payload = {
      period,
      offset: periodOffset,
      exportedAt: new Date().toISOString(),
      tzOffsetMinutes: tzOffset,
      summary: summary ?? null,
      timeline: timeline ?? [],
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    triggerDownload(
      JSON.stringify(payload, null, 2),
      `analytics-${period}-offset-${periodOffset}-${stamp}.json`,
      'application/json'
    );
  }, [summary, timeline, period, periodOffset, tzOffset]);

  const exportCsv = useCallback(() => {
    if (!timeline || timeline.length === 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    triggerDownload(
      buildTimelineCsv(timeline),
      `analytics-${period}-offset-${periodOffset}-${stamp}.csv`,
      'text/csv'
    );
  }, [timeline, period, periodOffset]);

  const compareCaption = summary?.comparison ? COMPARE_CAPTION[period] : COMPARE_CAPTION.all;
  const delta = (
    value: number,
    before: number | null | undefined,
    tone: 'lower-better' | 'neutral'
  ): KpiDelta | null =>
    summary?.comparison
      ? {
          percent: percentChange(value, before),
          lowerIsBetter: tone === 'lower-better',
          neutral: tone === 'neutral',
        }
      : null;
  const events = summary?.events;
  const tokenHint = [
    `${formatNumber(current.input)} input`,
    `${formatNumber(current.tokens - current.input - current.cacheRead - current.cacheCreation)} output`,
    `${formatNumber(current.cacheRead)} cache reads`,
    events ? `${events.contextSnapshots.toLocaleString()} context snapshots` : null,
    events ? `${events.compactEvents} compactions` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="analytics-shell glass-page analytics-dashboard analytics-v2 container mx-auto">
      <header className="analytics-header">
        <span className="analytics-header-icon">
          <BarChart3 className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1>Analytics</h1>
          <p>Usage, spend and limits across all your AI providers.</p>
        </div>
        <div className="analytics-header-controls">
          <div className="analytics-range" aria-label="Time window">
            <button
              type="button"
              onClick={() => setPeriodOffset((value) => value + 1)}
              disabled={period === 'all'}
              aria-label="Previous time window"
              title="Previous time window"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="analytics-range-label" title={analyticsWindow?.label}>
              <Calendar className="h-3.5 w-3.5 opacity-70" />
              {formatWindowDates(analyticsWindow?.startsAt, analyticsWindow?.endsAt)}
            </span>
            <button
              type="button"
              onClick={() => setPeriodOffset((value) => Math.max(0, value - 1))}
              disabled={period === 'all' || periodOffset === 0}
              aria-label="Next time window"
              title="Next time window"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {periodOffset > 0 && (
              <button
                type="button"
                className="analytics-range-now"
                onClick={() => setPeriodOffset(0)}
                title="Jump to the current time window"
              >
                Now
              </button>
            )}
          </div>
          <Segmented
            label="Time period"
            value={period}
            onChange={handlePeriodChange}
            options={PERIODS}
          />
          <DropdownMenu>
            <DropdownMenuTrigger className="analytics-select is-wide" aria-label="Provider filter">
              {activeFilter ? (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: getProviderColor(activeFilter) }}
                />
              ) : (
                <Layers className="h-3.5 w-3.5 opacity-70" />
              )}
              {activeFilter ?? 'All providers'}
              <ChevronDown className="ml-auto h-3.5 w-3.5 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[11rem]">
              <DropdownMenuItem onSelect={() => setProviderFilter(null)}>
                <Check className={cn('mr-2 h-3.5 w-3.5', activeFilter ? 'opacity-0' : '')} />
                All providers
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {providerNames.map((provider) => (
                <DropdownMenuItem key={provider} onSelect={() => setProviderFilter(provider)}>
                  <Check
                    className={cn('mr-2 h-3.5 w-3.5', activeFilter === provider ? '' : 'opacity-0')}
                  />
                  <span
                    className="mr-2 h-2 w-2 rounded-full"
                    style={{ backgroundColor: getProviderColor(provider) }}
                  />
                  {provider}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger className="analytics-export" aria-label="Export analytics">
              <Download className="h-4 w-4" />
              Export
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[12rem]">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {analyticsWindow?.label ?? 'Current window'}
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={exportCsv} disabled={!timeline || timeline.length === 0}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Timeline as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={exportJson} disabled={!summary && !timeline}>
                <FileJson className="mr-2 h-4 w-4" />
                Everything as JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {hasError && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className={cn('analytics-kpis', summaryLoading && 'is-loading')}>
        <KpiCard
          icon={Coins}
          color="#a78bfa"
          label="Total Spend"
          value={formatCurrency(current.cost)}
          delta={delta(current.cost, previous?.cost, 'lower-better')}
          caption={compareCaption}
          series={sparkline.cost}
          hint="API-equivalent cost: what these tokens would cost at list API prices"
        />
        <KpiCard
          icon={Database}
          color="#38bdf8"
          label="Total Tokens"
          value={formatNumber(current.tokens)}
          delta={delta(current.tokens, previous?.tokens, 'neutral')}
          caption={compareCaption}
          series={sparkline.tokens}
          hint={tokenHint}
        />
        <KpiCard
          icon={Send}
          color="#c084fc"
          label="Requests"
          value={current.requests.toLocaleString('en-US')}
          delta={delta(current.requests, previous?.requests, 'neutral')}
          caption={compareCaption}
          series={sparkline.requests}
        />
        <KpiCard
          icon={Percent}
          color="#34d399"
          label="Avg Cost / Request"
          value={formatCurrency(avgCost)}
          delta={delta(avgCost, previousAvgCost, 'lower-better')}
          caption={compareCaption}
          series={sparkline.avgCost}
        />
        <KpiCard
          icon={Database}
          color="#fbbf24"
          label="Cache Efficiency"
          value={cacheEfficiency === null ? '—' : `${Math.round(cacheEfficiency)}%`}
          delta={
            summary?.comparison && cacheEfficiency !== null && previousCacheEfficiency !== null
              ? {
                  percent: cacheEfficiency - previousCacheEfficiency,
                  label: `${Math.abs(cacheEfficiency - previousCacheEfficiency).toFixed(1)} pt`,
                }
              : null
          }
          caption="of prompt tokens served from cache"
          series={sparkline.cache}
        />
        <KpiCard
          icon={Users}
          color="#60a5fa"
          label="Active Providers"
          value={String(current.providers)}
          delta={
            previous
              ? {
                  percent: current.providers - previous.providers,
                  neutral: true,
                  label:
                    current.providers === previous.providers
                      ? '±0'
                      : `${current.providers > previous.providers ? '+' : '−'}${Math.abs(current.providers - previous.providers)}`,
                }
              : null
          }
          caption={activeFilter ? `filtered to ${activeFilter}` : 'with usage in this window'}
          series={sparkline.providers}
        />
      </div>

      <div className="analytics-grid">
        <div className="analytics-area-usage">
          <UsageOverTimeCard
            data={chartData}
            providers={providerSeries}
            metric={usageMetric}
            onMetricChange={setUsageMetric}
            granularity={chartGranularity}
            loading={timelineLoading}
            error={timelineError}
            total={
              activeFilter
                ? { label: activeFilter, color: getProviderColor(activeFilter) }
                : undefined
            }
            limitSeries={limitOverlaySeries.map(({ key, label, color }) => ({ key, label, color }))}
            limitsAvailable={historyTrackers.length > 0}
            showLimits={showLimits}
            onToggleLimits={() => setShowLimits((value) => !value)}
            resetEvents={overlayResetEvents}
          />
        </div>
        <div className="analytics-area-mix">
          <ProviderMixCard
            providers={allProviders}
            metric={mixMetric}
            onMetricChange={setMixMetric}
            selectedProvider={activeFilter}
            onSelectProvider={setProviderFilter}
          />
        </div>
        <div className="analytics-area-models">
          <TopModelsCard models={scopedModels} />
        </div>
        <div className="analytics-area-limits">
          <ProviderLimitsCard
            entries={scopedLimitEntries}
            loading={usageLimitsLoading}
            enabledTrackers={enabledUsageTrackers}
            onToggleTracker={toggleUsageTracker}
          />
        </div>
        <div className="analytics-area-health">
          <PricingHealthCard
            audit={summary?.pricingAudit}
            coveragePercent={summary?.totals.pricingCoveragePercent ?? 100}
            spendAlert={
              spendLimit > 0
                ? {
                    limitUsd: spendLimit,
                    todayUsd: latestBucketCost,
                    onTest: () => void sendTestAlert(),
                    testState: testAlertState,
                  }
                : null
            }
          />
        </div>
        <div className="analytics-area-sessions">
          <TopSessionsTable sessions={scopedSessions} />
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {summaryLoading ? 'Loading analytics' : ''}
      </span>
    </div>
  );
}
