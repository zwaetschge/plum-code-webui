import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Brain, CheckCircle, Hand, Zap, ChevronDown, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';
import { useSessionStore } from '@/stores/sessionStore';
import {
  CLI_PROVIDER_DEFAULT_MODEL,
  CLI_PROVIDER_LIMIT_LABELS,
  USAGE_PROVIDER_SHORT_LABEL,
  getUsageLimitProviderForModel,
  type AccountUsageLimitProvider,
} from '@/lib/providers';
import type { CLIProvider, UsageData } from '@plum-code-webui/shared';

type SessionMode = 'planning' | 'auto-accept' | 'manual' | 'danger';

interface SessionControlsProps {
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
  usage?: UsageData;
  defaultModel?: string;
}

interface UsageLimitData {
  fiveHour: { utilization: number; resetsAt: string | null } | null;
  sevenDay: { utilization: number; resetsAt: string | null } | null;
  sevenDaySonnet: { utilization: number; resetsAt: string | null } | null;
}

interface UsageLimitsResponse {
  success: boolean;
  supported: boolean;
  provider: string;
  data: UsageLimitData | null;
}

interface ContextEventStats {
  contextSnapshots: number;
  compactEvents: number;
}

const modeConfig: Record<
  SessionMode,
  {
    label: string;
    description: string;
    icon: typeof Brain;
    color: string;
    bgColor: string;
  }
> = {
  planning: {
    label: 'Plan Mode',
    description: 'Plans but asks before executing',
    icon: Brain,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10 hover:bg-blue-500/20',
  },
  'auto-accept': {
    label: 'Auto Accept',
    description: 'Automatically approve safe operations',
    icon: CheckCircle,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10 hover:bg-green-500/20',
  },
  manual: {
    label: 'Manual',
    description: 'Approve each operation manually',
    icon: Hand,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10 hover:bg-amber-500/20',
  },
  danger: {
    label: 'YOLO Mode',
    description: 'Skip all confirmations (dangerous!)',
    icon: Zap,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10 hover:bg-red-500/20',
  },
};

function ModeDropdown({
  mode,
  onModeChange,
}: {
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const currentMode = modeConfig[mode];
  const Icon = currentMode.icon;

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
  }, [isOpen]);

  const dropdown = isOpen
    ? createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setIsOpen(false)} />
          <div
            className="glass-panel fixed z-[101] w-56 rounded-xl border-foreground/10 overflow-hidden animate-scale-in"
            style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
          >
            {(Object.entries(modeConfig) as [SessionMode, (typeof modeConfig)[SessionMode]][]).map(
              ([key, config]) => {
                const ModeIcon = config.icon;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      onModeChange(key);
                      setIsOpen(false);
                    }}
                    className={cn(
                      'flex items-start gap-3 w-full p-3 text-left transition-colors hover:bg-muted/50',
                      mode === key && 'bg-muted'
                    )}
                  >
                    <ModeIcon className={cn('h-4 w-4 mt-0.5 shrink-0', config.color)} />
                    <div>
                      <div className={cn('text-sm font-medium', mode === key && config.color)}>
                        {config.label}
                      </div>
                      <div className="text-xs text-muted-foreground">{config.description}</div>
                    </div>
                  </button>
                );
              }
            )}
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className={cn('gap-2 h-8 px-3', currentMode.bgColor, currentMode.color)}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{currentMode.label}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')} />
      </Button>
      {dropdown}
    </div>
  );
}

function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

function cleanModelId(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return null;
  return trimmed;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatResetDelta(iso: string): string {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return '';
  const diffMs = target - Date.now();
  if (diffMs <= 0) return 'now';
  const mins = Math.floor(diffMs / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remainMins = mins % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${remainMins}m`;
  return `in ${remainMins}m`;
}

function formatResetAbsolute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getGradientColor(percent: number): string {
  const p = Math.max(0, Math.min(100, percent));
  if (p <= 50) {
    const ratio = p / 50;
    const r = Math.round(34 + (234 - 34) * ratio);
    const g = Math.round(197 + (179 - 197) * ratio);
    const b = Math.round(94 + (8 - 94) * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const ratio = (p - 50) / 50;
  const r = Math.round(234 + (239 - 234) * ratio);
  const g = Math.round(179 - 179 * ratio);
  const b = Math.round(8 + (68 - 8) * ratio);
  return `rgb(${r}, ${g}, ${b})`;
}

export function ContextPopover({
  usage,
  className,
  showLabel = false,
  contextStats,
  triggerVariant = 'bar',
  placement = 'bottom',
  collapsed = false,
  sessionId,
  sessionProvider,
  sessionModel,
  sessionRuntimeModel,
}: {
  usage: UsageData;
  className?: string;
  showLabel?: boolean;
  contextStats?: ContextEventStats;
  triggerVariant?: 'bar' | 'sidebarUsageBar';
  placement?: 'bottom' | 'right';
  collapsed?: boolean;
  sessionId?: string | null;
  sessionProvider?: CLIProvider | null;
  sessionModel?: string | null;
  sessionRuntimeModel?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Two narrow selectors instead of the whole store: this popover is mounted for
  // the entire session view, and subscribing to the store object woke it for
  // every streaming flush and every tool event of every session.
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const resolvedSessionId = sessionId || activeSessionId;
  const activeSession = useSessionStore((s) => s.sessions.find((x) => x.id === resolvedSessionId));
  const provider: CLIProvider = sessionProvider || activeSession?.cliProvider || 'codex';
  const effectiveModel =
    cleanModelId(sessionRuntimeModel) ||
    cleanModelId(activeSession?.runtime?.model) ||
    cleanModelId(usage.model) ||
    cleanModelId(sessionModel) ||
    cleanModelId(activeSession?.cliModel) ||
    CLI_PROVIDER_DEFAULT_MODEL[provider];
  const usageProvider = getUsageLimitProviderForModel(provider, effectiveModel);
  const limitsSupported = usageProvider !== null;

  const { data: usageLimitResult } = useQuery({
    queryKey: ['usage-limits', usageProvider ?? 'none'],
    queryFn: async () => {
      if (!usageProvider) return null;
      const response = await api.get<UsageLimitsResponse>(
        `/api/usage/limits?provider=${usageProvider}`
      );
      return response.data.success ? response.data : null;
    },
    staleTime: 60000,
    enabled: !!resolvedSessionId && limitsSupported,
  });
  const usageLimits = usageLimitResult?.supported ? usageLimitResult.data : null;
  const responseProvider = usageLimitResult?.provider as AccountUsageLimitProvider | undefined;
  const resolvedUsageProvider =
    responseProvider && responseProvider in CLI_PROVIDER_LIMIT_LABELS
      ? responseProvider
      : usageProvider;

  const hasContextWindow = usage.contextWindow > 0;
  const percent = hasContextWindow ? (usage.contextUsedPercent ?? 0) : 0;
  const rawPercent = hasContextWindow ? (usage.contextUsedPercentRaw ?? percent) : 0;
  const color = getGradientColor(percent);
  const isCritical = percent >= 95;

  // Build limit bars for popover
  const labels = resolvedUsageProvider ? CLI_PROVIDER_LIMIT_LABELS[resolvedUsageProvider] : null;
  const providerShortLabel = resolvedUsageProvider
    ? USAGE_PROVIDER_SHORT_LABEL[resolvedUsageProvider]
    : null;
  const limitBars: Array<{
    key: string;
    label: string;
    sublabel?: string;
    value: number;
    resetsAt: string | null;
  }> = [];
  if (usageLimits && labels) {
    if (usageLimits.fiveHour) {
      limitBars.push({
        key: 'session',
        label: labels.session.title,
        sublabel: labels.session.subtitle,
        value: usageLimits.fiveHour.utilization,
        resetsAt: usageLimits.fiveHour.resetsAt,
      });
    }
    if (usageLimits.sevenDay && labels.weeklyAll) {
      limitBars.push({
        key: 'weekly',
        label: labels.weeklyAll.title,
        sublabel: labels.weeklyAll.subtitle,
        value: usageLimits.sevenDay.utilization,
        resetsAt: usageLimits.sevenDay.resetsAt,
      });
    }
    if (usageLimits.sevenDaySonnet && labels.weeklySonnet) {
      limitBars.push({
        key: 'sonnet',
        label: labels.weeklySonnet.title,
        sublabel: labels.weeklySonnet.subtitle,
        value: usageLimits.sevenDaySonnet.utilization,
        resetsAt: usageLimits.sevenDaySonnet.resetsAt,
      });
    }
  }

  const sidebarMeters = [
    ...(labels && providerShortLabel
      ? [
          {
            key: 'five-hour',
            label: labels.session.title,
            value: usageLimits?.fiveHour?.utilization ?? null,
            title: `${providerShortLabel} ${labels.session.title} limit`,
            tone: 'session',
          },
          {
            key: 'weekly',
            label: 'Weekly',
            value:
              usageLimits?.sevenDay?.utilization ??
              usageLimits?.sevenDaySonnet?.utilization ??
              null,
            title: `${providerShortLabel} weekly limit`,
            tone: 'weekly',
          },
        ]
      : []),
    {
      key: 'context',
      label: 'Context',
      value: rawPercent,
      title: 'Context window',
      tone: 'context',
    },
  ];
  const formatSidebarMeterValue = (value: number | null) =>
    value === null ? '–' : `${Math.round(value)}%`;
  const sidebarMeterTitle = sidebarMeters
    .map((meter) => `${meter.label}: ${formatSidebarMeterValue(meter.value)}`)
    .join(' · ');

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const popoverWidth = 280;
      const estimatedHeight = 360;
      if (placement === 'right') {
        let left = rect.right + 8;
        if (left + popoverWidth > window.innerWidth - 8) {
          left = rect.left - popoverWidth - 8;
        }
        setPosition({
          top: Math.max(8, Math.min(rect.top - 8, window.innerHeight - estimatedHeight - 8)),
          left: Math.max(8, left),
        });
        return;
      }
      let left = rect.left - popoverWidth / 2 + rect.width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));
      setPosition({ top: rect.bottom + 4, left });
    }
  }, [isOpen, placement]);

  const popover = isOpen
    ? createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setIsOpen(false)} />
          <div
            className="glass-panel fixed z-[101] w-[280px] rounded-xl border-foreground/10 p-3 animate-scale-in"
            style={{ top: position.top, left: position.left }}
          >
            <div className="space-y-3">
              {/* Usage Limits */}
              {limitBars.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Rate limits
                  </div>
                  {limitBars.map((bar) => (
                    <div key={bar.key}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">
                          {bar.label}
                          {bar.sublabel ? ` ${bar.sublabel}` : ''}
                        </span>
                        <span
                          className="font-mono font-medium"
                          style={{ color: getGradientColor(bar.value) }}
                        >
                          {bar.value}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(bar.value, 100)}%`,
                            backgroundColor: getGradientColor(bar.value),
                          }}
                        />
                      </div>
                      {bar.resetsAt && (
                        <div
                          className="text-[10px] text-muted-foreground mt-0.5"
                          title={`Resets ${formatResetAbsolute(bar.resetsAt)}`}
                        >
                          Resets {formatResetDelta(bar.resetsAt)}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="border-t border-border/50" />
                </div>
              )}

              {/* Context Bar */}
              {hasContextWindow && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Context Window</span>
                    <span className="font-mono font-medium" style={{ color }}>
                      {rawPercent.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {formatTokens(usage.totalTokens)} / {formatTokens(usage.contextWindow)}
                    {usage.contextExceeded && ' (over reported window)'}
                  </div>
                </div>
              )}

              {/* Token Breakdown */}
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Input</span>
                  <span className="font-mono">{formatTokens(usage.inputTokens)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Output</span>
                  <span className="font-mono">{formatTokens(usage.outputTokens)}</span>
                </div>
                {usage.cacheReadTokens > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cache Read</span>
                    <span className="font-mono">{formatTokens(usage.cacheReadTokens)}</span>
                  </div>
                )}
                {usage.cacheCreationTokens > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cache Write</span>
                    <span className="font-mono">{formatTokens(usage.cacheCreationTokens)}</span>
                  </div>
                )}
              </div>

              {/* Cost + Model */}
              <div className="pt-2 border-t border-border/50 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cost</span>
                  <span className="font-mono">{formatCost(usage.totalCostUsd)}</span>
                </div>
                {contextStats && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Snapshots</span>
                      <span className="font-mono">
                        {contextStats.contextSnapshots.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Compacts</span>
                      <span className="font-mono">
                        {contextStats.compactEvents.toLocaleString()}
                      </span>
                    </div>
                  </>
                )}
                {usage.model && usage.model !== 'unknown' && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Model</span>
                    <span className="font-mono truncate ml-2">{usage.model}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'context-popover-trigger flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer',
          triggerVariant === 'sidebarUsageBar' && 'context-popover-trigger-sidebar',
          collapsed && 'is-collapsed',
          className
        )}
        title={
          triggerVariant === 'sidebarUsageBar'
            ? sidebarMeterTitle
            : hasContextWindow
              ? `Context: ${rawPercent.toFixed(0)}%${
                  contextStats ? ` · ${contextStats.compactEvents} compacts` : ''
                }`
              : limitsSupported
                ? 'Usage limits'
                : 'Context usage'
        }
      >
        {triggerVariant === 'sidebarUsageBar' ? (
          <>
            {!collapsed && (
              <span className="context-sidebar-copy">
                <span className="context-sidebar-meter-grid">
                  {sidebarMeters.map((meter) => (
                    <span
                      key={meter.key}
                      className={cn(
                        'context-sidebar-meter',
                        `is-${meter.tone}`,
                        meter.value === null && 'is-unavailable',
                        (meter.value ?? 0) > 0 && 'has-usage',
                        (meter.value ?? 0) >= 95 && 'is-critical'
                      )}
                      title={`${meter.title}: ${formatSidebarMeterValue(meter.value)}`}
                      style={
                        {
                          '--meter-value': `${Math.min(100, Math.max(0, meter.value ?? 0))}%`,
                          '--meter-color':
                            meter.value === null
                              ? 'hsl(var(--muted-foreground) / 0.28)'
                              : getGradientColor(meter.value),
                        } as CSSProperties
                      }
                    >
                      <span className="context-sidebar-meter-head">
                        <span className="context-sidebar-meter-label">{meter.label}</span>
                        <span className="context-sidebar-meter-value">
                          {formatSidebarMeterValue(meter.value)}
                        </span>
                      </span>
                      <span className="context-sidebar-bar-track" aria-hidden="true">
                        <span className="context-sidebar-bar-fill" />
                      </span>
                    </span>
                  ))}
                </span>
              </span>
            )}
            {collapsed && (
              <span className="context-sidebar-collapsed-bars" aria-hidden="true">
                {sidebarMeters.map((meter) => (
                  <span
                    key={meter.key}
                    className={cn(
                      'context-sidebar-bar-track',
                      meter.value === null && 'is-unavailable',
                      (meter.value ?? 0) > 0 && 'has-usage',
                      (meter.value ?? 0) >= 95 && 'is-critical'
                    )}
                    title={`${meter.title}: ${formatSidebarMeterValue(meter.value)}`}
                    style={
                      {
                        '--meter-value': `${Math.min(100, Math.max(0, meter.value ?? 0))}%`,
                        '--meter-color':
                          meter.value === null
                            ? 'hsl(var(--muted-foreground) / 0.28)'
                            : getGradientColor(meter.value),
                      } as CSSProperties
                    }
                  >
                    <span className="context-sidebar-bar-fill" />
                  </span>
                ))}
              </span>
            )}
          </>
        ) : (
          <>
            <Activity className="h-3 w-3 text-muted-foreground" />
            {showLabel && (
              <span className="context-popover-label">
                {hasContextWindow ? 'Context' : 'Usage'}
              </span>
            )}
            <div className="w-10 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  isCritical && 'animate-pulse'
                )}
                style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }}
              />
            </div>
            <span className="text-[10px] font-mono tabular-nums" style={{ color }}>
              {rawPercent.toFixed(0)}%
            </span>
          </>
        )}
      </button>
      {popover}
    </>
  );
}

export function SessionControls({ mode, onModeChange, usage }: SessionControlsProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap overflow-visible">
      {/* Mode Toggle */}
      <ModeDropdown mode={mode} onModeChange={onModeChange} />

      {/* Context Popover */}
      {usage && (
        <>
          <div className="h-4 w-px bg-border" />
          <ContextPopover usage={usage} />
        </>
      )}
    </div>
  );
}
