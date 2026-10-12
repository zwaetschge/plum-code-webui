import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Brain } from 'lucide-react';
import type { AssistantApiProvider } from '@plum-code-webui/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** What the model chat API accepts per turn; `auto` sends nothing and keeps the model default. */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max' | 'ultra';
export type EffortChoice = 'auto' | ReasoningEffort;

/** One stop on the rail; `special` stops get the animated "nebula" treatment. */
export interface EffortStop {
  id: string;
  label: string;
  hint?: string;
  special?: boolean;
}

export const EFFORT_STOPS: EffortStop[] = [
  { id: 'auto', label: 'Automatisch', hint: 'Das Modell entscheidet selbst.' },
  { id: 'low', label: 'Niedrig', hint: 'Schnell und knapp.' },
  { id: 'medium', label: 'Mittel', hint: 'Ausgewogen für die meisten Fragen.' },
  { id: 'high', label: 'Hoch', hint: 'Gründlicher, dauert länger.' },
  {
    id: 'max',
    label: 'Sehr hoch',
    hint: 'Maximale Denktiefe für schwere Aufgaben.',
    special: true,
  },
  {
    id: 'ultra',
    label: 'Ultra',
    hint: 'Größtes Denkbudget, für die schwersten Aufgaben.',
    special: true,
  },
];

/** Levels that switch the rail into its animated nebula look. */
const SPECIAL_LEVELS = new Set(['max', 'xhigh', 'ultra', 'ultrathink', 'ultracode']);

const STORAGE_KEY = 'plum-chat-effort';

/** Remembered per browser so the choice survives the new-chat → chat navigation. */
export function useEffortChoice(): [EffortChoice, (value: EffortChoice) => void] {
  const [value, setValue] = useState<EffortChoice>(() => {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    return EFFORT_STOPS.some((stop) => stop.id === stored) ? (stored as EffortChoice) : 'auto';
  });
  const update = (next: EffortChoice) => {
    setValue(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage may be blocked; the choice then lasts for this page only */
    }
  };
  return [value, update];
}

export const effortPayload = (choice: EffortChoice): { reasoningEffort?: ReasoningEffort } =>
  choice === 'auto' ? {} : { reasoningEffort: choice };

/**
 * Segmented control with a gliding thumb — the stops are discrete, so it is
 * not a slider. The fill shimmers; special stops (max, ultra, ultracode …)
 * turn it into a drifting nebula with twinkling stars.
 */
export function EffortRail({
  stops,
  value,
  onChange,
  disabled,
  title = 'Denkaufwand',
}: {
  stops: EffortStop[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
}) {
  const index = Math.max(
    0,
    stops.findIndex((stop) => stop.id === value)
  );
  const current = stops[index] ?? stops[0]!;
  const [swap, setSwap] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else setSwap((count) => count + 1);
  }, [value]);
  return (
    <div className="plum-effort" data-special={current.special ? 'true' : 'false'}>
      <div className="plum-effort-head">
        <span>{title}</span>
        <strong key={swap} className="plum-effort-label">
          {current.label}
        </strong>
      </div>
      <div
        className="plum-effort-rail"
        role="radiogroup"
        aria-label={title}
        style={{ ['--stops' as string]: stops.length, ['--index' as string]: index }}
      >
        <span className="plum-effort-fill" aria-hidden>
          <i className="plum-effort-stars" />
        </span>
        <span className="plum-effort-thumb" aria-hidden />
        {stops.map((stop) => (
          <button
            key={stop.id}
            type="button"
            role="radio"
            aria-checked={stop.id === value}
            aria-label={stop.label}
            disabled={disabled}
            className="plum-effort-stop"
            onClick={() => onChange(stop.id)}
          >
            <span aria-hidden />
          </button>
        ))}
      </div>
      <div className="plum-effort-foot">
        <span>Schneller</span>
        <span>{current.hint ?? ''}</span>
        <span>Intelligenter</span>
      </div>
    </div>
  );
}

/** Stops for a CLI provider's reasoning options: Default first, top levels animated. */
export function reasoningStops(
  options: ReadonlyArray<{ value: string; label: string }>,
  defaultLabel = 'Standard'
): EffortStop[] {
  return [
    { id: '__default__', label: defaultLabel },
    ...options.map((option) => ({
      id: option.value,
      label: option.label,
      special: SPECIAL_LEVELS.has(option.value.toLowerCase()),
    })),
  ];
}

/** Compact dropdown trigger around the rail for session reasoning / effort. */
export function ReasoningPicker({
  label,
  options,
  value,
  onChange,
  defaultLabel,
  disabled,
  className,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  defaultLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const stops = reasoningStops(options, defaultLabel);
  const selected = stops.find((stop) => stop.id === (value || '__default__')) ?? stops[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn('plum-model-trigger', className)}
          aria-label={label}
          data-special={selected.special ? 'true' : 'false'}
        >
          <Brain size={14} aria-hidden />
          <span className="plum-model-trigger-name">{selected.label}</span>
          <ChevronDown size={14} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="plum-model-menu">
        <EffortRail
          stops={stops}
          value={value || '__default__'}
          onChange={onChange}
          title={label}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One compact trigger for model and thinking depth: providers are headings,
 * models are rows, the effort rail sits underneath. `readOnlyModel` keeps the
 * model of an existing conversation and only exposes the effort.
 */
export function ModelEffortPicker({
  providers,
  providerId,
  model,
  onSelect,
  effort,
  onEffort,
  disabled,
  readOnlyModel,
}: {
  providers: AssistantApiProvider[];
  providerId?: string;
  model?: string;
  onSelect?: (providerId: string, model: string) => void;
  effort: EffortChoice;
  onEffort: (value: EffortChoice) => void;
  disabled?: boolean;
  readOnlyModel?: boolean;
}) {
  const effortStop = EFFORT_STOPS.find((stop) => stop.id === effort);
  const effortLabel = effortStop?.label ?? 'Automatisch';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className="plum-model-trigger" aria-label="Modell und Denkaufwand">
          <span className="plum-model-trigger-name">{model || 'Modell wählen'}</span>
          {effort !== 'auto' && (
            <span
              className="plum-model-trigger-effort"
              data-special={effortStop?.special ? 'true' : 'false'}
            >
              <Brain size={12} aria-hidden />
              {effortLabel}
            </span>
          )}
          <ChevronDown size={14} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="plum-model-menu">
        {!readOnlyModel && (
          <div className="plum-model-list" role="listbox" aria-label="Modell">
            {providers.map((provider, index) => (
              <div key={provider.id}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="plum-model-group">{provider.name}</DropdownMenuLabel>
                {provider.models.map((value) => {
                  const active = provider.id === providerId && value === model;
                  return (
                    <DropdownMenuItem
                      key={value}
                      role="option"
                      aria-selected={active}
                      className={cn('plum-model-row', active && 'is-active')}
                      onSelect={(event) => {
                        event.preventDefault();
                        onSelect?.(provider.id, value);
                      }}
                    >
                      <span className="truncate">{value}</span>
                      {active && <Check size={15} aria-hidden />}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            ))}
            {!providers.length && <p className="plum-model-empty">Keine Modellverbindung.</p>}
          </div>
        )}
        {!readOnlyModel && <DropdownMenuSeparator />}
        <EffortRail
          stops={EFFORT_STOPS}
          value={effort}
          onChange={(next) => onEffort(next as EffortChoice)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
