import { useMemo } from 'react';
import { PieChart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnalyticsPanel, PanelSelect } from './AnalyticsPanel';
import {
  USAGE_METRICS,
  formatMetric,
  getProviderColor,
  metricValue,
  type ProviderTotals,
  type UsageMetric,
} from './analyticsModel';

/**
 * Share per provider as a donut. The legend doubles as the provider filter:
 * clicking a provider narrows the whole dashboard to it, clicking it again
 * clears the filter.
 */
export function ProviderMixCard({
  providers,
  metric,
  onMetricChange,
  selectedProvider,
  onSelectProvider,
}: {
  providers: ProviderTotals[];
  metric: UsageMetric;
  onMetricChange: (metric: UsageMetric) => void;
  selectedProvider: string | null;
  onSelectProvider: (provider: string | null) => void;
}) {
  const rows = useMemo(
    () =>
      providers
        .map((provider) => ({ provider: provider.provider, value: metricValue(provider, metric) }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value),
    [providers, metric]
  );
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  const gradient = useMemo(() => {
    if (total <= 0) return 'conic-gradient(hsl(var(--muted)) 0 100%)';
    let cursor = 0;
    const stops = rows.map((row) => {
      const start = cursor;
      cursor += (row.value / total) * 100;
      const color = getProviderColor(row.provider);
      const dimmed = selectedProvider && selectedProvider !== row.provider;
      // A hairline gap between segments keeps small shares distinguishable.
      return `${dimmed ? `${color}55` : color} ${start}% ${Math.max(start, cursor - 0.4)}%, transparent ${Math.max(start, cursor - 0.4)}% ${cursor}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }, [rows, total, selectedProvider]);

  const metricOption = USAGE_METRICS.find((option) => option.value === metric);

  return (
    <AnalyticsPanel
      icon={PieChart}
      title="Provider Mix"
      subtitle={`Share of total ${metricOption?.label.toLowerCase() ?? 'usage'}`}
      className="analytics-mix-panel"
      actions={
        <PanelSelect
          label="Provider mix metric"
          value={metric}
          onChange={onMetricChange}
          options={USAGE_METRICS.map(({ value, by }) => ({ value, label: by }))}
        />
      }
    >
      {rows.length === 0 ? (
        <div className="analytics-empty h-[180px]">No usage in this period</div>
      ) : (
        <div className="analytics-mix">
          <div className="analytics-donut" style={{ background: gradient }}>
            <div className="analytics-donut-core">
              <strong>{formatMetric(metric, total)}</strong>
              <span>Total {metricOption?.label.toLowerCase()}</span>
            </div>
          </div>
          <ul className="analytics-mix-list">
            {rows.map((row) => {
              const share = (row.value / total) * 100;
              const active = selectedProvider === row.provider;
              return (
                <li key={row.provider}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectProvider(active ? null : row.provider)}
                    className={cn(
                      selectedProvider && !active && 'opacity-50',
                      active && 'is-active'
                    )}
                    title={`${row.provider}: ${formatMetric(metric, row.value)} — click to ${active ? 'show all providers' : 'filter to this provider'}`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: getProviderColor(row.provider) }}
                    />
                    <span className="truncate">{row.provider}</span>
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      {share < 0.1 ? '<0.1' : share.toFixed(1)}%
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </AnalyticsPanel>
  );
}
