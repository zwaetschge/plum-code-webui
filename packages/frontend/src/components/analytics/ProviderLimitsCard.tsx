import { useState, type CSSProperties } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Gauge, Loader2 } from 'lucide-react';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/analyticsFormat';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { AnalyticsPanel } from './AnalyticsPanel';
import { formatCurrency, formatResetDelta } from './analyticsModel';
import {
  USAGE_PROVIDERS,
  USAGE_PROVIDER_COLORS,
  USAGE_PROVIDER_LABELS,
  USAGE_PROVIDER_LOGO,
  USAGE_TRACKER_LABELS,
  limitWindows,
  type LimitWindowView,
  type ProviderLimitEntry,
  type UsageLimitData,
  type UsageLimitTracker,
} from './limitsModel';

function formatMoney(amount: number, currency: 'EUR' | 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatLimitAmount(value?: number | null, unit?: string | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '';
  if (unit === 'usd') return formatCurrency(value);
  if (unit === 'eur') return formatMoney(value, 'EUR');
  if (unit === 'tokens') return `${formatNumber(value)} tokens`;
  if (unit === 'requests') return `${formatNumber(value)} requests`;
  if (unit === 'percent') return `${Math.round(value)}%`;
  return formatNumber(value);
}

function formatUsage(limit: LimitWindowView): string | null {
  if (
    limit.used === undefined ||
    limit.used === null ||
    limit.limit === undefined ||
    limit.limit === null
  ) {
    return null;
  }
  const used = formatLimitAmount(limit.used, limit.unit).replace(/ tokens$| requests$/, '');
  const total = formatLimitAmount(limit.limit, limit.unit);
  return used && total ? `${used} / ${total}` : null;
}

function formatSource(source?: UsageLimitData['source']): string {
  if (source === 'local-estimate') return 'Local estimate';
  if (source === 'local-budget') return 'Local budget';
  return 'Live quota';
}

function barColor(utilization: number, color: string): string {
  if (utilization >= 90) return '#ef4444';
  if (utilization >= 75) return '#f59e0b';
  return color;
}

/**
 * One tile per provider with its most binding quota, so "how close am I to a
 * limit" reads at a glance. "View all" opens every window with its usage and
 * reset time, plus the switches for which providers are tracked.
 */
export function ProviderLimitsCard({
  entries,
  loading,
  enabledTrackers,
  onToggleTracker,
}: {
  entries: ProviderLimitEntry[];
  loading: boolean;
  enabledTrackers: UsageLimitTracker[];
  onToggleTracker: (tracker: UsageLimitTracker) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <AnalyticsPanel
      icon={Gauge}
      color="#38bdf8"
      title="Provider Limits"
      subtitle="Current usage against each provider's quota"
      className="analytics-limits-panel"
      actions={
        <button
          type="button"
          className="analytics-link"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'View all providers →'}
        </button>
      }
    >
      {expanded && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Tracked providers">
          {USAGE_PROVIDERS.map((provider) => {
            const enabled = enabledTrackers.includes(provider);
            return (
              <button
                key={provider}
                type="button"
                aria-pressed={enabled}
                onClick={() => onToggleTracker(provider)}
                className={cn('analytics-chip', enabled && 'is-active')}
                title={`${enabled ? 'Hide' : 'Show'} ${USAGE_TRACKER_LABELS[provider]} limits`}
              >
                <ProviderLogo provider={USAGE_PROVIDER_LOGO[provider]} className="h-3.5 w-3.5" />
                {USAGE_TRACKER_LABELS[provider]}
              </button>
            );
          })}
          {loading && (
            <span className="analytics-chip">
              <Loader2 className="h-3 w-3 animate-spin" />
              Refreshing
            </span>
          )}
        </div>
      )}

      {enabledTrackers.length === 0 ? (
        <div className="analytics-empty h-[96px] text-center">
          All providers are hidden. Quota history keeps recording in the background.
        </div>
      ) : entries.length === 0 ? (
        <div className="analytics-empty h-[96px]">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading limits…
            </>
          ) : (
            'No provider reports a quota right now.'
          )}
        </div>
      ) : expanded ? (
        <div className="analytics-limit-details">
          {entries.map((entry) => (
            <LimitDetail key={entry.tracker} entry={entry} />
          ))}
        </div>
      ) : (
        <div className="analytics-limit-grid">
          {entries.map((entry) => (
            <LimitTile key={entry.tracker} entry={entry} />
          ))}
        </div>
      )}
    </AnalyticsPanel>
  );
}

function LimitTile({ entry }: { entry: ProviderLimitEntry }) {
  const { tracker, provider, data, error } = entry;
  const color = USAGE_PROVIDER_COLORS[provider];
  const windows = limitWindows(provider, data);
  // The window closest to its cap is the one that decides whether work stops.
  const binding = [...windows].sort((a, b) => b.utilization - a.utilization)[0];
  const others = windows.filter((window) => window !== binding).slice(0, 2);

  return (
    <div className="analytics-limit-tile" style={{ '--limit-color': color } as CSSProperties}>
      <div className="flex items-center gap-2.5">
        <ProviderLogo provider={USAGE_PROVIDER_LOGO[tracker]} className="h-7 w-7" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{USAGE_PROVIDER_LABELS[provider]}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {binding ? (formatUsage(binding) ?? binding.title) : formatSource(data.source)}
          </p>
        </div>
      </div>
      {binding ? (
        <>
          <div className="mt-3 flex items-center gap-2.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(binding.utilization, 1))}%`,
                  backgroundColor: barColor(binding.utilization, color),
                }}
              />
            </div>
            <span className="text-xs font-medium tabular-nums">
              {Math.round(binding.utilization)}%
            </span>
          </div>
          <p className="mt-2 truncate text-[11px] text-muted-foreground">
            {binding.resetsAt ? `Resets ${formatResetDelta(binding.resetsAt)}` : binding.title}
            {others
              .map((window) => ` · ${window.title} ${Math.round(window.utilization)}%`)
              .join('')}
          </p>
        </>
      ) : data.planUsage ? (
        <>
          <p className="mt-3 text-sm font-semibold tabular-nums">
            ≈{formatMoney(data.planUsage.spend, data.planUsage.currency)}
            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
              this month · {formatNumber(data.planUsage.tokens)} tokens
            </span>
          </p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            No allowance set · View all providers to add one
          </p>
        </>
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {error?.message ?? 'No quota window reported'}
        </p>
      )}
    </div>
  );
}

/** Pro plan allowances as Mistral's console shows them; both reset on the 1st. */
const MISTRAL_ALLOWANCES = {
  api: { label: 'API / Studio', amount: 25.5 },
  vibe: { label: 'Vibe Code', amount: 255 },
} as const;

/**
 * Mistral has no quota API for Pro plans, so the month is measured against the
 * allowance picked here. A regular API key (what Pi and OpenCode use) draws on
 * API/Studio; a key created under Code › Vibe CLI draws on Vibe Code.
 *
 * The Vibe card is the Vibe allowance by definition, so it locks the choice and
 * writes the dedicated `/api/usage/plan/vibe` budget instead of the shared one.
 */
function MistralBudgetEditor({
  plan,
  lockedAllowance,
}: {
  plan: NonNullable<UsageLimitData['planUsage']>;
  lockedAllowance?: 'vibe';
}) {
  const queryClient = useQueryClient();
  const isVibeAllowance = lockedAllowance === 'vibe';
  const [allowance, setAllowance] = useState<'api' | 'vibe'>(lockedAllowance ?? plan.allowance);
  const [budget, setBudget] = useState(plan.budget ? String(plan.budget) : '');
  const [currency, setCurrency] = useState<'EUR' | 'USD'>(plan.currency);
  const [billingDay, setBillingDay] = useState(String(plan.billingDay));
  const save = useMutation({
    mutationFn: async () => {
      await api.put(isVibeAllowance ? '/api/usage/plan/vibe' : '/api/usage/plan/mistral', {
        monthlyBudget: budget.trim() ? Number(budget.replace(',', '.')) : null,
        currency,
        allowance,
        billingDay: Number(billingDay) || 1,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['usage-limits', isVibeAllowance ? 'vibe' : 'mistral'],
      });
    },
  });
  return (
    <form
      className="grid gap-2 border-t border-border/60 pt-2 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-muted-foreground">
        {isVibeAllowance
          ? "Mistral publishes no quota API for Pro plans. Plum counts the turns booked by the Vibe harness at list prices (€ and $ taken 1:1) against the plan's Vibe Code allowance; usage outside Plum is not included."
          : 'Mistral publishes no quota API for Pro plans. Plum counts its own Mistral turns at list prices (€ and $ taken 1:1); Le Chat, Studio and the Vibe CLI are not included.'}
      </p>
      {isVibeAllowance ? (
        <button
          type="button"
          className="analytics-chip is-active justify-self-start"
          title="Reset to the published Vibe Code allowance"
          aria-label="Use the published Vibe Code allowance (€255)"
          onClick={() => {
            setBudget(String(MISTRAL_ALLOWANCES.vibe.amount));
            setCurrency('EUR');
          }}
        >
          {MISTRAL_ALLOWANCES.vibe.label} · €{MISTRAL_ALLOWANCES.vibe.amount}
        </button>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Allowance">
          {(Object.keys(MISTRAL_ALLOWANCES) as Array<'api' | 'vibe'>).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={allowance === key}
              className={cn('analytics-chip', allowance === key && 'is-active')}
              onClick={() => {
                setAllowance(key);
                setBudget(String(MISTRAL_ALLOWANCES[key].amount));
                setCurrency('EUR');
              }}
            >
              {MISTRAL_ALLOWANCES[key].label} · €{MISTRAL_ALLOWANCES[key].amount}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-muted-foreground">Monthly allowance</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
            placeholder="none"
            className="h-8 w-24 rounded-md border border-border bg-background/60 px-2 tabular-nums"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">Currency</span>
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as 'EUR' | 'USD')}
            className="h-8 rounded-md border border-border bg-background/60 px-2"
          >
            <option value="EUR">€</option>
            <option value="USD">$</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">Resets on day</span>
          <input
            type="number"
            min="1"
            max="28"
            value={billingDay}
            onChange={(event) => setBillingDay(event.target.value)}
            className="h-8 w-14 rounded-md border border-border bg-background/60 px-2 tabular-nums"
          />
        </label>
        <button type="submit" className="analytics-chip is-active h-8" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : 'Save'}
        </button>
      </div>
      {save.isError && <p className="text-destructive">Could not save the allowance.</p>}
    </form>
  );
}

function LimitDetail({ entry }: { entry: ProviderLimitEntry }) {
  const { tracker, provider, data, error } = entry;
  const color = USAGE_PROVIDER_COLORS[provider];
  return (
    <div className="analytics-limit-detail" style={{ '--limit-color': color } as CSSProperties}>
      <div className="flex items-center gap-3">
        <ProviderLogo provider={USAGE_PROVIDER_LOGO[tracker]} className="h-6 w-6" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{USAGE_PROVIDER_LABELS[provider]}</p>
          <p className="text-xs text-muted-foreground">
            {data.subscriptionType || data.rateLimitTier || 'Rate limits'}
          </p>
        </div>
        <span className="ml-auto rounded-md border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {formatSource(data.source)}
        </span>
      </div>

      {error && error.code !== 'NO_BUDGET' && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {data.accountUsage && (
        <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold tabular-nums">
              {formatNumber(data.accountUsage.totalTokens)} tokens
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {formatNumber(data.accountUsage.totalRequests)} calls
            </p>
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Official account total · {data.accountUsage.periodDays} days · day boundary
            Asia/Shanghai (UTC+8), including usage outside Plum
          </p>
        </div>
      )}

      {limitWindows(provider, data).map((window) => (
        <div key={window.key} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {window.title}
              {window.subtitle && (
                <span className="text-muted-foreground/60"> ({window.subtitle})</span>
              )}
            </span>
            <span className="font-medium tabular-nums">{Math.round(window.utilization)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, window.utilization)}%`,
                backgroundColor: barColor(window.utilization, color),
              }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {[formatUsage(window), window.resetsAt && `resets ${formatResetDelta(window.resetsAt)}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      ))}

      {data.planUsage && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground">This month</p>
            <p className="font-medium tabular-nums">
              ≈{formatMoney(data.planUsage.spend, data.planUsage.currency)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Tokens</p>
            <p className="font-medium tabular-nums">{formatNumber(data.planUsage.tokens)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Requests</p>
            <p className="font-medium tabular-nums">
              {data.planUsage.requests.toLocaleString('en-US')}
            </p>
          </div>
        </div>
      )}
      {(provider === 'mistral' || provider === 'vibe') && data.planUsage && (
        <MistralBudgetEditor
          plan={data.planUsage}
          lockedAllowance={provider === 'vibe' ? 'vibe' : undefined}
        />
      )}

      {data.localBudget && (
        <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-2 text-xs">
          <div>
            <p className="text-muted-foreground">24h spend</p>
            <p className="font-medium">
              {formatCurrency(data.localBudget.dailySpendUsd)}
              {data.localBudget.dailyUsd ? ` / ${formatCurrency(data.localBudget.dailyUsd)}` : ''}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Weekly spend</p>
            <p className="font-medium">
              {formatCurrency(data.localBudget.weeklySpendUsd)}
              {data.localBudget.weeklyUsd ? ` / ${formatCurrency(data.localBudget.weeklyUsd)}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
