import { Brain, Check, CheckCircle, ChevronDown, Hand, Zap } from 'lucide-react';
import type { SessionMode } from '@plum-code-webui/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** Execution modes available in the session side menu. */
export const SESSION_MODE_CHOICES: Array<{
  value: SessionMode;
  label: string;
  icon: typeof Brain;
}> = [
  {
    value: 'planning',
    label: 'Planen',
    icon: Brain,
  },
  {
    value: 'manual',
    label: 'Manuell',
    icon: Hand,
  },
  {
    value: 'auto-accept',
    label: 'Auto-Accept',
    icon: CheckCircle,
  },
  {
    value: 'danger',
    label: 'YOLO',
    icon: Zap,
  },
];

/** Execution mode control for the side menu of a Task or Code session. */
export function SessionModeMenu({
  value,
  onChange,
  disabled,
}: {
  value: SessionMode;
  onChange: (mode: SessionMode) => void;
  disabled?: boolean;
}) {
  const current =
    SESSION_MODE_CHOICES.find((option) => option.value === value) ?? SESSION_MODE_CHOICES[2]!;
  const CurrentIcon = current.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="session-side-menu-item"
          aria-label={`Ausführungsmodus: ${current.label}`}
        >
          <span className="session-side-menu-icon">
            <CurrentIcon size={16} aria-hidden />
          </span>
          <span className="session-side-menu-label">Ausführung</span>
          <span className="flex items-center gap-1 text-xs">
            {current.label}
            <ChevronDown size={14} aria-hidden />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="plum-model-menu">
        <DropdownMenuLabel className="plum-model-group">Ausführungsmodus</DropdownMenuLabel>
        {SESSION_MODE_CHOICES.map((option) => {
          const Icon = option.icon;
          const active = option.value === current.value;
          return (
            <DropdownMenuItem
              key={option.value}
              role="menuitemradio"
              aria-checked={active}
              className={cn('plum-model-row', active && 'is-active')}
              onSelect={() => {
                if (!active) onChange(option.value);
              }}
            >
              <span className="flex min-w-0 items-start gap-2.5">
                <Icon size={15} aria-hidden className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                </span>
              </span>
              {active && <Check size={15} aria-hidden />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
