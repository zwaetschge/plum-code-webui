import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Card frame shared by every analytics panel: icon tile, title, subtitle, actions. */
export function AnalyticsPanel({
  icon: Icon,
  color,
  title,
  subtitle,
  actions,
  className,
  children,
}: {
  icon: LucideIcon;
  color?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn('analytics-panel', className)}
      style={color ? ({ '--panel-color': color } as CSSProperties) : undefined}
    >
      <header className="analytics-panel-head">
        <span className="analytics-panel-icon">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="analytics-panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** A compact "By spend ▾" style picker. */
export function PanelSelect<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="analytics-select" aria-label={label}>
        {current?.label}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value)}>
            <Check
              className={cn(
                'mr-2 h-3.5 w-3.5',
                option.value === value ? 'opacity-100' : 'opacity-0'
              )}
            />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Segmented control (radio group) used for metric and period switches. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('analytics-segmented', className)}>
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            const step =
              event.key === 'ArrowRight' || event.key === 'ArrowDown'
                ? 1
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                  ? -1
                  : 0;
            if (!step) return;
            event.preventDefault();
            const next = options[(index + step + options.length) % options.length];
            if (next) onChange(next.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
