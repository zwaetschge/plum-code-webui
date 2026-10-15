import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Brain, Zap } from 'lucide-react';
import type { AssistantApiProvider } from '@plum-code-webui/shared';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { StepOutContent } from '@/components/motion/StepOutContent';
import { onFrame, SpringValue } from '@/lib/motion/spring';
import { prefersReducedMotion } from '@/lib/motion/reducedMotion';
import { SPRINGS } from '@/lib/motion/tokens';

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
  // Thumb and fill ride one marker spring; rapid re-selection keeps its velocity.
  const rail = useRef<HTMLDivElement>(null);
  const position = useRef<SpringValue | null>(null);
  const stopSpring = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const element = rail.current;
    if (!element) return;
    if (!position.current || prefersReducedMotion()) {
      position.current = position.current ?? new SpringValue(index);
      position.current.jump(index);
      element.style.setProperty('--pos', String(index));
      return;
    }
    const spring = position.current;
    spring.setTarget(index, SPRINGS.marker);
    if (!stopSpring.current)
      stopSpring.current = onFrame((dt) => {
        element.style.setProperty('--pos', String(spring.step(dt)));
        if (spring.settled) {
          stopSpring.current = null;
          return false;
        }
      });
  }, [index]);
  useEffect(() => () => stopSpring.current?.(), []);
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
        ref={rail}
        className="plum-effort-rail is-sprung"
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
      <StepOutContent align="end" className="plum-model-menu">
        <EffortRail
          stops={stops}
          value={value || '__default__'}
          onChange={onChange}
          title={label}
        />
      </StepOutContent>
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
      <StepOutContent align="end" side="top" className="plum-model-menu">
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
      </StepOutContent>
    </DropdownMenu>
  );
}

/** One provider heading in the session model picker; switching provider is part of choosing a model. */
export interface SessionModelGroup {
  providerId: string;
  name: string;
  /** False when the provider is enabled but not configured; its rows stay visible but inert. */
  available: boolean;
  /** Label of the "provider default" row; omitted when the provider has no usable default. */
  defaultLabel?: string;
  models: Array<{ value: string; label: string }>;
}

/** Subagent model override (Claude transport only), shown under "Erweitert". */
export interface SessionSubagentChoice {
  value: string | null;
  groups: Array<{ label: string; models: Array<{ value: string; label: string }> }>;
  onChange: (value: string | null) => void;
  pending?: boolean;
}

/**
 * Chat-bar chip for CLI sessions: models grouped by provider (picking a model
 * of another provider switches the provider), the animated thinking-depth rail
 * below, Codex's Fast tier as a toggle and the subagent model under "Erweitert".
 */
export function SessionModelPicker({
  groups,
  providerId,
  model,
  modelLabel,
  onSelect,
  reasoning,
  fast,
  subagent,
  disabled,
}: {
  groups: SessionModelGroup[];
  providerId: string;
  /** Selected model; '' means the provider default. */
  model: string;
  modelLabel: string;
  onSelect: (providerId: string, model: string) => void;
  reasoning?: {
    title: string;
    options: ReadonlyArray<{ value: string; label: string }>;
    value: string;
    defaultLabel: string;
    onChange: (value: string) => void;
  };
  fast?: { active: boolean; pending?: boolean; onToggle: () => void };
  subagent?: SessionSubagentChoice;
  disabled?: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const stops = reasoning ? reasoningStops(reasoning.options, reasoning.defaultLabel) : [];
  const effortStop = reasoning
    ? stops.find((stop) => stop.id === (reasoning.value || '__default__'))
    : undefined;
  const showEffort = !!effortStop && effortStop.id !== '__default__';
  const subagentLabel = (() => {
    if (!subagent?.value) return 'Standard';
    for (const group of subagent.groups) {
      const hit = group.models.find((entry) => entry.value === subagent.value);
      if (hit) return hit.label;
    }
    return subagent.value;
  })();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="plum-model-trigger plum-chip"
          aria-label="Modell und Denkaufwand"
          title={`${modelLabel}${showEffort ? ` · ${effortStop.label}` : ''}`}
        >
          <span className="plum-model-trigger-name">{modelLabel}</span>
          {showEffort && (
            <span
              className="plum-model-trigger-effort"
              data-special={effortStop.special ? 'true' : 'false'}
            >
              <Brain size={12} aria-hidden />
              {effortStop.label}
            </span>
          )}
          {fast?.active && (
            <span className="plum-model-trigger-effort is-fast">
              <Zap size={12} aria-hidden />
              Schnell
            </span>
          )}
          <ChevronDown size={14} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <StepOutContent align="end" side="top" className="plum-model-menu plum-session-model-menu">
        <div className="plum-model-list" role="listbox" aria-label="Modell">
          {groups.map((group, index) => {
            const rows = [
              ...(group.defaultLabel !== undefined
                ? [{ value: '', label: group.defaultLabel }]
                : []),
              ...group.models,
            ];
            return (
              <div key={group.providerId}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="plum-model-group">
                  {group.name}
                  {!group.available && ' · nicht eingerichtet'}
                </DropdownMenuLabel>
                {rows.map((row) => {
                  const active = group.providerId === providerId && row.value === model;
                  return (
                    <DropdownMenuItem
                      key={`${group.providerId}/${row.value || '__default__'}`}
                      role="option"
                      aria-selected={active}
                      disabled={!group.available && group.providerId !== providerId}
                      className={cn('plum-model-row', active && 'is-active')}
                      onSelect={(event) => {
                        event.preventDefault();
                        if (!active) onSelect(group.providerId, row.value);
                      }}
                    >
                      <span className="truncate">{row.label}</span>
                      {active && <Check size={15} aria-hidden />}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            );
          })}
          {!groups.length && <p className="plum-model-empty">Keine Anbieter verfügbar.</p>}
        </div>
        {reasoning && (
          <>
            <DropdownMenuSeparator />
            <EffortRail
              stops={stops}
              value={reasoning.value || '__default__'}
              onChange={reasoning.onChange}
              title={reasoning.title}
            />
          </>
        )}
        {fast && (
          <DropdownMenuItem
            className={cn('plum-model-row', fast.active && 'is-active')}
            disabled={fast.pending}
            onSelect={(event) => {
              event.preventDefault();
              fast.onToggle();
            }}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Zap size={14} aria-hidden />
              <span className="truncate">Schnellmodus (Codex-Serviceklasse)</span>
            </span>
            {fast.active && <Check size={15} aria-hidden />}
          </DropdownMenuItem>
        )}
        {subagent && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="plum-model-row plum-model-advanced"
              aria-expanded={advancedOpen}
              onSelect={(event) => {
                event.preventDefault();
                setAdvancedOpen((open) => !open);
              }}
            >
              <span className="truncate">Erweitert</span>
              <ChevronDown
                size={14}
                aria-hidden
                className={cn('transition-transform', advancedOpen && 'rotate-180')}
              />
            </DropdownMenuItem>
            {advancedOpen && (
              <div className="plum-model-list" role="listbox" aria-label="Subagent-Modell">
                <DropdownMenuLabel className="plum-model-group">
                  Subagent-Modell · {subagentLabel}
                </DropdownMenuLabel>
                {[
                  {
                    label: '',
                    models: [{ value: '', label: 'Standard (Agent-Definition)' }],
                  },
                  ...subagent.groups,
                ].map((group) => (
                  <div key={group.label || '__default__'}>
                    {group.label && (
                      <DropdownMenuLabel className="plum-model-group">
                        {group.label}
                      </DropdownMenuLabel>
                    )}
                    {group.models.map((entry) => {
                      const active = (subagent.value ?? '') === entry.value;
                      return (
                        <DropdownMenuItem
                          key={`${group.label}/${entry.value || '__default__'}`}
                          role="option"
                          aria-selected={active}
                          disabled={subagent.pending}
                          className={cn('plum-model-row', active && 'is-active')}
                          onSelect={(event) => {
                            event.preventDefault();
                            if (!active) subagent.onChange(entry.value || null);
                          }}
                        >
                          <span className="truncate">{entry.label}</span>
                          {active && <Check size={15} aria-hidden />}
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </StepOutContent>
    </DropdownMenu>
  );
}
