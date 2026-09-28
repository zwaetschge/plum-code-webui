import { useMemo, useState } from 'react';
import { Boxes } from 'lucide-react';
import { formatNumber } from '@/lib/analyticsFormat';
import { getProviderLabelForModel } from '@plum-code-webui/shared';
import { AnalyticsPanel, PanelSelect } from './AnalyticsPanel';
import {
  PROVIDER_FALLBACK_COLOR,
  USAGE_METRICS,
  formatCurrency,
  formatMetric,
  getProviderColor,
  metricValue,
  withAlpha,
  type AnalyticsSummary,
  type UsageMetric,
} from './analyticsModel';

const RANKED = 4;

interface ProviderModels {
  provider: string;
  cost: number;
  tokens: number;
  requests: number;
  unpricedTokens: number;
  models: Array<{
    model: string;
    cost: number;
    tokens: number;
    requests: number;
    pricingKnown?: boolean;
  }>;
}

/**
 * The four biggest models and the rest as "Others". "All models" opens the
 * full list grouped by provider, so variants such as gpt-6-sol and gpt-6-luna
 * stay distinguishable.
 */
export function TopModelsCard({ models }: { models: AnalyticsSummary['byModel'] }) {
  const [metric, setMetric] = useState<UsageMetric>('cost');
  const [expanded, setExpanded] = useState(false);

  const ranked = useMemo(() => {
    const rows = models
      .map((model) => ({
        key: `${model.provider}:${model.model ?? 'unknown'}`,
        model: model.model || 'Unknown',
        provider: model.provider || getProviderLabelForModel(model.model),
        value: metricValue({ ...model, tokens: model.total_tokens }, metric),
      }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    const top = rows.slice(0, RANKED);
    const rest = rows.slice(RANKED);
    const others = rest.reduce((sum, row) => sum + row.value, 0);
    return {
      total,
      rows: [
        ...top,
        ...(others > 0
          ? [{ key: 'others', model: `Others (${rest.length})`, provider: '', value: others }]
          : []),
      ],
    };
  }, [models, metric]);

  const providerSummary = useMemo<ProviderModels[]>(() => {
    const map = new Map<string, ProviderModels>();
    models.forEach((model) => {
      const provider = model.provider || getProviderLabelForModel(model.model);
      const current = map.get(provider) || {
        provider,
        cost: 0,
        tokens: 0,
        requests: 0,
        unpricedTokens: 0,
        models: [],
      };
      current.cost += model.cost;
      current.tokens += model.total_tokens;
      current.requests += model.requests;
      if (!model.pricing_known) current.unpricedTokens += model.total_tokens;
      current.models.push({
        model: model.model || 'Unknown',
        cost: model.cost,
        tokens: model.total_tokens,
        requests: model.requests,
        pricingKnown: model.pricing_known,
      });
      map.set(provider, current);
    });
    return Array.from(map.values())
      .map((entry) => ({
        ...entry,
        // Every used model, ordered by token volume: the full list is the
        // point of this view, so nothing is cut after the first few.
        models: entry.models.sort((a, b) => b.tokens - a.tokens),
      }))
      .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  }, [models]);

  const metricOption = USAGE_METRICS.find((option) => option.value === metric);
  const peak = ranked.rows[0]?.value ?? 0;

  return (
    <AnalyticsPanel
      icon={Boxes}
      title="Top Models"
      subtitle={`Highest ${metricOption?.label.toLowerCase()} by model`}
      className="analytics-models-panel"
      actions={
        <PanelSelect
          label="Top models metric"
          value={metric}
          onChange={setMetric}
          options={USAGE_METRICS.map(({ value, by }) => ({ value, label: by }))}
        />
      }
    >
      {ranked.rows.length === 0 ? (
        <div className="analytics-empty h-[140px]">No model usage in this period</div>
      ) : (
        <ol className="analytics-rank">
          {ranked.rows.map((row, index) => {
            const color = row.provider ? getProviderColor(row.provider) : PROVIDER_FALLBACK_COLOR;
            const share = ranked.total > 0 ? (row.value / ranked.total) * 100 : 0;
            return (
              <li key={row.key} title={row.provider ? `${row.model} · ${row.provider}` : row.model}>
                <span className="analytics-rank-index">{index + 1}</span>
                <span className="analytics-rank-name">{row.model}</span>
                <span className="analytics-rank-bar">
                  <span
                    style={{
                      width: `${peak > 0 ? Math.max(3, (row.value / peak) * 100) : 0}%`,
                      backgroundColor: color,
                    }}
                  />
                </span>
                <span className="analytics-rank-value">{formatMetric(metric, row.value)}</span>
                <span className="analytics-rank-share">
                  {share < 0.1 ? '<0.1' : share.toFixed(1)}%
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {providerSummary.length > 0 && (
        <button
          type="button"
          className="analytics-link mt-3"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Hide model breakdown' : 'All models by provider →'}
        </button>
      )}

      {expanded && (
        <div className="analytics-breakdown">
          {providerSummary.map((provider) => {
            const color = getProviderColor(provider.provider);
            return (
              <div key={provider.provider} className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="font-medium">{provider.provider}</span>
                  <span className="text-muted-foreground">
                    {formatCurrency(provider.cost)} · {formatNumber(provider.tokens)} tokens ·{' '}
                    {provider.requests} req
                  </span>
                  {provider.unpricedTokens > 0 && (
                    <span className="text-amber-500">
                      {formatNumber(provider.unpricedTokens)} unpriced
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {provider.models.map((model) => (
                    <span
                      key={model.model}
                      className="ui-pill ui-pill-subtle"
                      title={`${model.model}: ${formatNumber(model.tokens)} tokens (${model.requests} requests) · ${formatCurrency(model.cost)}`}
                      style={{
                        borderColor: withAlpha(color, '40'),
                        backgroundColor: withAlpha(color, '0f'),
                      }}
                    >
                      <span className="max-w-[140px] truncate">{model.model}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatNumber(model.tokens)} tokens
                      </span>
                      {model.pricingKnown === false && (
                        <span className="text-amber-500">no price</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AnalyticsPanel>
  );
}
