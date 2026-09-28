import { AlertCircle, BarChart3, Gauge, Loader2 } from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import { AnalyticsPanel, Segmented } from './AnalyticsPanel';
import {
  TOTAL_COLOR,
  USAGE_METRICS,
  formatAxisMetric,
  formatMetric,
  type UsageMetric,
} from './analyticsModel';

export interface UsageSeries {
  key: string;
  label: string;
  color: string;
}

export type UsageBucket = Record<string, number | string | null> & { timestamp: number };

function formatTick(value: number, granularity: 'hour' | 'day' | 'month'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (granularity === 'hour') {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (granularity === 'month') {
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTooltipLabel(value: number, granularity: 'hour' | 'day' | 'month'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (granularity === 'hour') {
    return date.toLocaleString(undefined, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (granularity === 'month') {
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Total usage as a filled area with one line per provider on top. Provider
 * quota curves are an opt-in overlay on a 0–100 % axis: useful when chasing a
 * limit, noise the rest of the time.
 */
export function UsageOverTimeCard({
  data,
  providers,
  metric,
  onMetricChange,
  granularity,
  loading,
  error,
  total = { label: 'Total', color: TOTAL_COLOR },
  limitSeries,
  limitsAvailable,
  showLimits,
  onToggleLimits,
  resetEvents,
}: {
  data: UsageBucket[];
  providers: UsageSeries[];
  metric: UsageMetric;
  onMetricChange: (metric: UsageMetric) => void;
  granularity: 'hour' | 'day' | 'month';
  loading: boolean;
  error: boolean;
  total?: { label: string; color: string };
  limitSeries: UsageSeries[];
  /** Quota history loads only once the overlay is switched on. */
  limitsAvailable: boolean;
  showLimits: boolean;
  onToggleLimits: () => void;
  resetEvents: number[];
}) {
  const metricLabel = USAGE_METRICS.find((option) => option.value === metric)?.label ?? 'Usage';
  const hasData = data.some((bucket) => Number(bucket.total) > 0);
  const legend: Array<UsageSeries & { dashed?: boolean; area?: boolean }> = [
    { key: 'total', label: total.label, color: total.color, area: true },
    ...providers,
    ...(showLimits ? limitSeries.map((series) => ({ ...series, dashed: true })) : []),
  ];

  return (
    <AnalyticsPanel
      icon={BarChart3}
      color={total.color}
      title="Usage Over Time"
      subtitle={
        total.label === 'Total'
          ? `Total ${metricLabel.toLowerCase()} across all providers, and each provider on its own.`
          : `${metricLabel} for ${total.label} only.`
      }
      className="analytics-usage-panel"
      actions={
        <>
          {limitsAvailable && (
            <button
              type="button"
              aria-pressed={showLimits}
              onClick={onToggleLimits}
              className={cn('analytics-chip', showLimits && 'is-active')}
              title="Overlay provider quota usage (0–100 %)"
            >
              <Gauge className="h-3.5 w-3.5" />
              {showLimits && limitSeries.length > 0 ? `Limits · ${limitSeries.length}` : 'Limits'}
            </button>
          )}
          <Segmented
            label="Chart metric"
            value={metric}
            onChange={onMetricChange}
            options={USAGE_METRICS.map(({ value, label }) => ({ value, label }))}
          />
        </>
      }
    >
      <div className="analytics-usage-chart">
        {loading ? (
          <div className="analytics-empty">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading timeline…
          </div>
        ) : error ? (
          <div className="analytics-empty text-destructive">
            <AlertCircle className="h-5 w-5" />
            Failed to load timeline
          </div>
        ) : !hasData ? (
          <div className="analytics-empty">No usage in this period</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={220} minWidth={0}>
            <ComposedChart
              data={data}
              margin={{ top: 8, right: showLimits ? 4 : 12, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="analytics-total-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={total.color} stopOpacity={0.42} />
                  <stop offset="100%" stopColor={total.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 4"
                stroke="hsl(var(--border) / 0.55)"
                vertical={false}
              />
              <XAxis
                type="number"
                dataKey="timestamp"
                domain={['dataMin', 'dataMax']}
                scale="time"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatTick(Number(value), granularity)}
                minTickGap={28}
              />
              <YAxis
                yAxisId="usage"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatAxisMetric(metric, Number(value))}
                width={52}
              />
              {showLimits && (
                <YAxis
                  yAxisId="limit"
                  orientation="right"
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${Math.round(value)}%`}
                  width={40}
                />
              )}
              <Tooltip
                cursor={{ stroke: 'hsl(var(--muted-foreground) / 0.5)', strokeDasharray: '3 3' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="analytics-chart-tooltip">
                      <p className="mb-1.5 font-medium">
                        {formatTooltipLabel(Number(label), granularity)}
                      </p>
                      {payload
                        .filter((entry) => entry.value !== null && entry.value !== undefined)
                        .map((entry) => (
                          <p
                            key={String(entry.dataKey)}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: entry.color }}
                            />
                            <span className="text-muted-foreground">{entry.name}</span>
                            <span className="ml-auto pl-4 font-medium tabular-nums">
                              {String(entry.dataKey).startsWith('limit_')
                                ? `${Math.round(Number(entry.value))}%`
                                : formatMetric(metric, Number(entry.value))}
                            </span>
                          </p>
                        ))}
                    </div>
                  );
                }}
              />
              {showLimits &&
                resetEvents.map((timestamp) => (
                  <ReferenceLine
                    key={timestamp}
                    yAxisId="usage"
                    x={timestamp}
                    stroke="#f59e0b"
                    strokeDasharray="4 4"
                    label={{ value: 'Reset', fill: '#f59e0b', fontSize: 10 }}
                  />
                ))}
              <Area
                yAxisId="usage"
                type="monotone"
                dataKey="total"
                name={total.label}
                stroke={total.color}
                strokeWidth={2}
                fill="url(#analytics-total-fill)"
                isAnimationActive={false}
              />
              {providers.map((series) => (
                <Line
                  key={series.key}
                  yAxisId="usage"
                  type="monotone"
                  dataKey={series.key}
                  name={series.label}
                  stroke={series.color}
                  strokeWidth={1.75}
                  strokeDasharray="5 4"
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                />
              ))}
              {showLimits &&
                limitSeries.map((series) => (
                  <Line
                    key={series.key}
                    yAxisId="limit"
                    type="monotone"
                    dataKey={series.key}
                    name={series.label}
                    stroke={series.color}
                    strokeWidth={2}
                    strokeDasharray="2 3"
                    connectNulls
                    dot={false}
                    activeDot={{ r: 3 }}
                    isAnimationActive={false}
                  />
                ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <ul className="analytics-legend" aria-label="Chart legend">
        {legend.map((item) => (
          <li key={item.key}>
            <span
              className={cn('analytics-legend-mark', item.dashed && 'is-dashed')}
              style={{
                backgroundColor: item.dashed ? undefined : item.color,
                borderColor: item.color,
              }}
            />
            {item.label}
          </li>
        ))}
      </ul>
    </AnalyticsPanel>
  );
}
