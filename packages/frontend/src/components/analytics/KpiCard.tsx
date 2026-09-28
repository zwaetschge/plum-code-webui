import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sparkline } from './Sparkline';

export interface KpiDelta {
  /** Relative change in percent, or null when the previous window has no data. */
  percent: number | null;
  /** Spend and cost per request improve when they fall. */
  lowerIsBetter?: boolean;
  /** Volume (tokens, requests) is neither good nor bad; shown without judgement. */
  neutral?: boolean;
  /** Shown instead of a percentage, e.g. "+1" for a provider count. */
  label?: string;
}

/** One headline number: value, change against the previous window, and its trend. */
export function KpiCard({
  icon: Icon,
  color,
  label,
  value,
  delta,
  caption,
  series,
  hint,
}: {
  icon: LucideIcon;
  color: string;
  label: string;
  value: string;
  delta?: KpiDelta | null;
  caption: string;
  series: number[];
  hint?: string;
}) {
  const percent = delta?.percent ?? null;
  const flat = percent !== null && Math.abs(percent) < 0.5;
  const rising = percent !== null && percent > 0;
  const good = flat || (delta?.lowerIsBetter ? !rising : rising);
  const DeltaIcon = flat ? Minus : rising ? ArrowUpRight : ArrowDownRight;
  const deltaText =
    delta?.label ??
    (percent === null
      ? null
      : `${Math.abs(percent) >= 100 ? Math.round(Math.abs(percent)) : Math.abs(percent).toFixed(Math.abs(percent) < 10 ? 1 : 0)}%`);

  return (
    <section
      className="analytics-kpi"
      style={{ '--kpi-color': color } as CSSProperties}
      title={hint}
      aria-label={`${label}: ${value}`}
    >
      <header className="analytics-kpi-head">
        <span className="analytics-kpi-icon">
          <Icon className="h-4 w-4" />
        </span>
        <span className="analytics-kpi-label">{label}</span>
      </header>
      <div className="analytics-kpi-value">
        <strong>{value}</strong>
        {deltaText && (
          <span
            className={cn(
              'analytics-kpi-delta',
              flat ? 'is-flat' : delta?.neutral ? 'is-neutral' : good ? 'is-good' : 'is-bad'
            )}
          >
            <DeltaIcon className="h-3.5 w-3.5" />
            {deltaText}
          </span>
        )}
      </div>
      <p className="analytics-kpi-caption">{caption}</p>
      <Sparkline values={series} color={color} className="analytics-kpi-spark" />
    </section>
  );
}
