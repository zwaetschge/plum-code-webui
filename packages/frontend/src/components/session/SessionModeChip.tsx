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

/** Execution modes in the order the chat bar offers them. */
export const SESSION_MODE_CHOICES: Array<{
  value: SessionMode;
  label: string;
  description: string;
  icon: typeof Brain;
}> = [
  {
    value: 'planning',
    label: 'Planen',
    description: 'Durchdenken, ohne etwas zu ändern',
    icon: Brain,
  },
  {
    value: 'manual',
    label: 'Manuell',
    description: 'Vor jedem Werkzeug nachfragen',
    icon: Hand,
  },
  {
    value: 'auto-accept',
    label: 'Auto-Accept',
    description: 'Sichere Schritte ohne Rückfrage ausführen',
    icon: CheckCircle,
  },
  {
    value: 'danger',
    label: 'YOLO',
    description: 'Alle Freigaben überspringen',
    icon: Zap,
  },
];

/** Chat-bar chip for the execution mode of a Task or Code session. */
export function SessionModeChip({
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
          className={cn('plum-model-trigger plum-chip plum-mode-chip', `is-${current.value}`)}
          aria-label={`Ausführungsmodus: ${current.label}`}
          title={current.description}
        >
          <CurrentIcon size={14} aria-hidden />
          <span className="plum-model-trigger-name">{current.label}</span>
          <ChevronDown size={14} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="plum-model-menu">
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
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
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
