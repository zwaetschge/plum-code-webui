import { useState } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, HeartPulse } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/analyticsFormat';
import { AnalyticsPanel } from './AnalyticsPanel';
import { formatCurrency, formatSignedCurrency, type AnalyticsSummary } from './analyticsModel';

/**
 * Whether the spend figures can be trusted: every model priced, stored costs
 * matching the current rate card. When a daily spend alert is configured, its
 * current standing lives here too.
 */
export function PricingHealthCard({
  audit,
  coveragePercent,
  spendAlert,
}: {
  audit?: AnalyticsSummary['pricingAudit'];
  coveragePercent: number;
  spendAlert: {
    limitUsd: number;
    todayUsd: number;
    onTest: () => void;
    testState: 'idle' | 'sending' | 'sent' | 'failed';
  } | null;
}) {
  const [showMissing, setShowMissing] = useState(false);
  const missing = audit?.missingPricingModels ?? [];
  const delta = audit ? audit.recordedCost - audit.apiEquivalentCost : 0;
  // Repricing runs as a migration; a tiny residue is rounding, not drift.
  const drift = audit ? Math.abs(delta) > Math.max(0.01, audit.apiEquivalentCost * 0.005) : false;
  const healthy = missing.length === 0 && !drift;

  return (
    <AnalyticsPanel
      icon={HeartPulse}
      color={healthy ? '#10b981' : '#f59e0b'}
      title="Pricing Health"
      subtitle="Whether spend figures match the current price table"
      className="analytics-health-panel"
      actions={
        <span className={cn('analytics-status', healthy ? 'is-good' : 'is-warn')}>
          {healthy ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          {healthy ? 'Healthy' : 'Check'}
        </span>
      }
    >
      <div className={cn('analytics-health-box', healthy ? 'is-good' : 'is-warn')}>
        {healthy ? (
          <CheckCircle2 className="h-5 w-5 shrink-0" />
        ) : (
          <AlertTriangle className="h-5 w-5 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {missing.length > 0
              ? `${missing.length} model${missing.length === 1 ? '' : 's'} without a price`
              : drift
                ? 'Stored costs differ from the price table'
                : 'All provider pricing is up to date'}
          </p>
          <p className="text-xs opacity-80">
            {coveragePercent}% of tokens priced
            {audit && ` · stored vs. recalculated ${formatSignedCurrency(delta)}`}
          </p>
        </div>
        {missing.length > 0 && (
          <button
            type="button"
            className="analytics-link ml-auto shrink-0"
            aria-expanded={showMissing}
            onClick={() => setShowMissing((value) => !value)}
          >
            {showMissing ? 'Hide' : 'Show'}
          </button>
        )}
      </div>

      {showMissing && missing.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {missing.map((model) => (
            <span key={`${model.provider}:${model.model}`} className="ui-pill ui-pill-subtle">
              <span className="max-w-[180px] truncate">{model.model}</span>
              <span className="text-muted-foreground">{formatNumber(model.tokens)} tokens</span>
            </span>
          ))}
        </div>
      )}

      {spendAlert && (
        <div className="analytics-alert-row">
          <BellRing className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-muted-foreground">Spend alert · latest bucket</span>
              <span className="font-medium tabular-nums">
                {formatCurrency(spendAlert.todayUsd)} / {formatCurrency(spendAlert.limitUsd)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (spendAlert.todayUsd / spendAlert.limitUsd) * 100)}%`,
                  backgroundColor:
                    spendAlert.todayUsd >= spendAlert.limitUsd ? '#ef4444' : '#10b981',
                }}
              />
            </div>
          </div>
          <button
            type="button"
            className="analytics-link shrink-0"
            onClick={spendAlert.onTest}
            disabled={spendAlert.testState === 'sending'}
          >
            {spendAlert.testState === 'sending'
              ? 'Sending…'
              : spendAlert.testState === 'sent'
                ? 'Sent'
                : spendAlert.testState === 'failed'
                  ? 'Failed · retry'
                  : 'Test alert'}
          </button>
        </div>
      )}
    </AnalyticsPanel>
  );
}
