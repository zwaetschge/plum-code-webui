import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  GitBranch,
  Loader2,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
  SquareTerminal,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type {
  ApiResponse,
  GitStatus,
  Message,
  SessionQueueData,
  SessionStatus,
  SubagentRun,
  ToolExecution,
  UsageData,
} from '@plum-code-webui/shared';
import { useSessionStore } from '@/stores/sessionStore';
import type { ActivityState, TodoItem } from '@/stores/sessionStore';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

interface RunCockpitProps {
  workingDirectory: string;
  providerLabel: string;
  sessionStatus: SessionStatus;
  messages: Message[];
  streamingSessionId: string;
  activity: ActivityState;
  todos: TodoItem[];
  tools: ToolExecution[];
  agents: SubagentRun[];
  usage?: UsageData;
  queue?: SessionQueueData | null;
  onClose: () => void;
  onInterrupt: () => void;
  onRestart: () => void;
  onReviewChanges: () => void;
  onJumpToMessage?: (messageId: string) => void;
  presentation?: 'rail' | 'dock';
  activeSection?: RunCockpitSection;
  focusVersion?: number;
}

type RunTone = 'neutral' | 'good' | 'warn' | 'bad' | 'live';
export type RunCockpitSection =
  | 'overview'
  | 'queue'
  | 'agents'
  | 'diff'
  | 'verify'
  | 'turns'
  | 'tools';

function stripPreview(content: string, max = 92): string {
  const compact = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > max ? `${compact.slice(0, max).trim()}...` : compact;
}

function timeShort(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function durationShort(start: number, end?: number): string {
  const totalSeconds = Math.max(0, Math.floor(((end ?? Date.now()) - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function inputPreview(input: unknown): string {
  if (!input) return '';
  if (typeof input === 'string') return input;
  const obj = input as Record<string, unknown>;
  return String(obj.command || obj.file_path || obj.path || obj.pattern || obj.query || '');
}

function StatPill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: RunTone;
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-2.5 py-2',
        tone === 'live' && 'border-primary/30 bg-primary/10',
        tone === 'good' && 'border-emerald-500/25 bg-emerald-500/10',
        tone === 'warn' && 'border-amber-500/25 bg-amber-500/10',
        tone === 'bad' && 'border-red-500/25 bg-red-500/10',
        tone === 'neutral' && 'border-border/50 bg-foreground/[0.025]'
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border/45 px-4 py-4">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </section>
  );
}

function GateRow({ tone, label, detail }: { tone: RunTone; label: string; detail: string }) {
  const Icon =
    tone === 'bad'
      ? AlertCircle
      : tone === 'warn'
        ? Circle
        : tone === 'live'
          ? Loader2
          : CheckCircle2;
  return (
    <div className="flex items-start gap-2.5 rounded-md px-2 py-2">
      <Icon
        className={cn(
          'mt-0.5 h-3.5 w-3.5 shrink-0',
          tone === 'bad' && 'text-red-500',
          tone === 'warn' && 'text-amber-500',
          tone === 'live' && 'animate-spin text-primary',
          tone === 'good' && 'text-emerald-500',
          tone === 'neutral' && 'text-muted-foreground'
        )}
      />
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

export function RunCockpit({
  workingDirectory,
  providerLabel,
  sessionStatus,
  messages,
  streamingSessionId,
  activity,
  todos,
  tools,
  agents,
  usage,
  queue,
  onClose,
  onInterrupt,
  onRestart,
  onReviewChanges,
  onJumpToMessage,
  presentation = 'rail',
  activeSection = 'overview',
  focusVersion = 0,
}: RunCockpitProps) {
  // Subscribed here, not passed down: the string flushes every 50ms while
  // streaming and must only re-render this cockpit, never the session page.
  const streamingContent = useSessionStore((s) => s.streamingContent[streamingSessionId] ?? '');
  const railRef = useRef<HTMLElement | null>(null);
  const overviewRef = useRef<HTMLDivElement | null>(null);
  const queueRef = useRef<HTMLDivElement | null>(null);
  const agentsRef = useRef<HTMLDivElement | null>(null);
  const diffRef = useRef<HTMLDivElement | null>(null);
  const verifyRef = useRef<HTMLDivElement | null>(null);
  const turnsRef = useRef<HTMLDivElement | null>(null);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const activeAgents = agents.filter((agent) => agent.status === 'started');
  const completedAgents = agents.filter((agent) => agent.status !== 'started');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedAgent = selectedAgentId
    ? (agents.find((agent) => agent.id === selectedAgentId) ?? null)
    : null;
  const isLive =
    sessionStatus === 'running' ||
    activity.type === 'thinking' ||
    activity.type === 'tool' ||
    activeAgents.length > 0 ||
    streamingContent.length > 0;

  const { data: gitStatus, isFetching: gitFetching } = useQuery({
    queryKey: ['run-cockpit-git-status', workingDirectory],
    queryFn: async () => {
      try {
        const response = await api.get<ApiResponse<GitStatus>>(
          `/api/git/status?path=${encodeURIComponent(workingDirectory)}`
        );
        return response.data.data ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!workingDirectory,
    refetchInterval: isLive ? 4000 : 10000,
  });

  // Which whole CLIs this session may hand work to through the `subagents` MCP
  // tool. Independent of the provider running the session and of the Claude
  // model router, so it is listed for every harness — otherwise a configured
  // target (pi, say) is invisible until it happens to be running.
  const { data: cliSubagents = [] } = useQuery({
    queryKey: ['cli-subagents'],
    queryFn: async () => {
      try {
        const response = await api.get<
          ApiResponse<Array<{ label: string; provider: string; enabled: boolean }>>
        >('/api/settings/cli-subagents');
        return response.data.data ?? [];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  const delegationTargets = useMemo(
    () => [
      ...new Set(
        cliSubagents
          .filter((entry) => entry.enabled)
          .map((entry) => entry.provider)
          .filter(Boolean)
      ),
    ],
    [cliSubagents]
  );

  const changedFiles = useMemo(() => {
    if (!gitStatus) return [];
    return Array.from(
      new Set([...gitStatus.staged, ...gitStatus.unstaged, ...gitStatus.untracked])
    );
  }, [gitStatus]);

  const pendingTodos = todos.filter((todo) => todo.status !== 'completed');
  const runningTools = tools.filter((tool) => tool.status === 'started');
  const failedTools = tools.filter((tool) => tool.status === 'error');
  const lastVerifyTool = [...tools]
    .reverse()
    .find(
      (tool) =>
        tool.toolName === 'Bash' &&
        /(test|typecheck|lint|build|tsc|eslint|vitest|jest|playwright|pnpm|npm)/i.test(
          inputPreview(tool.input)
        )
    );

  const lastAssistantIndex = [...messages]
    .reverse()
    .findIndex((message) => message.role === 'assistant');
  const assistantBoundary =
    lastAssistantIndex === -1 ? -1 : messages.length - 1 - lastAssistantIndex;
  const openUserMessages = messages
    .slice(assistantBoundary + 1)
    .filter((message) => message.role === 'user');
  const derivedQueued = isLive ? openUserMessages.slice(1) : [];
  const queuedItems =
    queue && queue.depth > 0
      ? queue.items
      : derivedQueued.map((message) => ({
          id: message.id,
          preview: stripPreview(message.content, 120),
          createdAt: message.createdAt,
        }));

  const turnEvents = useMemo(
    () =>
      messages
        .filter(
          (message) =>
            (message.role === 'user' || message.role === 'assistant') &&
            !message.id?.startsWith('compact-')
        )
        .map((message) => ({
          id: message.id,
          role: message.role,
          kind: message.role === 'user' ? 'You' : providerLabel,
          text: stripPreview(message.content, 120),
          ts: new Date(message.createdAt).getTime(),
        })),
    [messages, providerLabel]
  );

  const runEvents = useMemo(() => {
    const toolEvents = tools.map((tool) => ({
      id: `t-${tool.toolId}`,
      kind: tool.toolName,
      text: inputPreview(tool.input) || tool.status,
      ts: tool.timestamp,
      icon: tool.toolName === 'Bash' ? SquareTerminal : Wrench,
    }));
    return toolEvents
      .filter((event) => event.text)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 8);
  }, [tools]);

  const runTone: RunTone =
    sessionStatus === 'error' ? 'bad' : isLive ? 'live' : failedTools.length > 0 ? 'warn' : 'good';
  const runLabel = sessionStatus === 'error' ? 'Error' : isLive ? 'Running' : 'Ready';
  const dirtyCount = changedFiles.length;

  useEffect(() => {
    const rail = railRef.current;
    const target =
      activeSection === 'overview'
        ? overviewRef.current
        : activeSection === 'queue'
          ? queueRef.current
          : activeSection === 'diff'
            ? diffRef.current
            : activeSection === 'agents'
              ? agentsRef.current
              : activeSection === 'verify'
                ? verifyRef.current
                : activeSection === 'turns'
                  ? turnsRef.current
                  : toolsRef.current;

    if (!rail || !target) return;

    const railRect = rail.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = targetRect.top - railRect.top + rail.scrollTop - 8;
    rail.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
  }, [activeSection, focusVersion]);

  useEffect(() => {
    if (selectedAgentId && !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(null);
    }
  }, [agents, selectedAgentId]);

  return (
    <aside
      ref={railRef}
      className={cn(presentation === 'dock' ? 'run-cockpit-dock-panel' : 'run-cockpit-rail')}
    >
      <div ref={overviewRef} className="flex items-start justify-between gap-3 px-4 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                runTone === 'live' && 'animate-pulse bg-primary',
                runTone === 'good' && 'bg-emerald-500',
                runTone === 'warn' && 'bg-amber-500',
                runTone === 'bad' && 'bg-red-500'
              )}
            />
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Run
            </h3>
          </div>
          <div className="mt-1 text-lg font-semibold tracking-display text-foreground">
            {runLabel}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{providerLabel}</div>
        </div>
        <button type="button" className="rail-close" onClick={onClose} title="Close run panel">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 px-4 pb-4">
        <StatPill
          label="Tools"
          value={runningTools.length || tools.length}
          tone={isLive ? 'live' : 'neutral'}
        />
        <StatPill
          label="Agents"
          value={activeAgents.length || agents.length}
          tone={activeAgents.length ? 'live' : 'neutral'}
        />
        <StatPill
          label="Queue"
          value={queue?.depth ?? queuedItems.length}
          tone={queuedItems.length ? 'warn' : 'neutral'}
        />
        <StatPill label="Files" value={dirtyCount} tone={dirtyCount ? 'warn' : 'good'} />
      </div>

      <div className="flex gap-2 px-4 pb-4">
        <button
          type="button"
          onClick={onInterrupt}
          disabled={!isLive}
          className="panel-trigger h-8 flex-1 justify-center disabled:pointer-events-none disabled:opacity-45"
        >
          <Zap className="h-3.5 w-3.5" />
          <span>Stop</span>
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="panel-trigger h-8 flex-1 justify-center"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Restart</span>
        </button>
      </div>

      <div ref={queueRef}>
        <Section title="Queue" icon={<MessageSquare className="h-3.5 w-3.5" />}>
          {queuedItems.length === 0 ? (
            <div className="rounded-md border border-border/45 bg-foreground/[0.02] px-3 py-2 text-xs text-muted-foreground">
              Empty
            </div>
          ) : (
            <div className="space-y-2">
              {queuedItems.slice(0, 3).map((item, index) => (
                <div
                  key={item.id}
                  className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-amber-600 dark:text-amber-300">
                    <span>Next {index + 1}</span>
                    <span>{timeShort(item.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-foreground">
                    {stripPreview(item.preview, 120)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div ref={agentsRef}>
        <Section title="Subagents" icon={<Brain className="h-3.5 w-3.5" />}>
          {/* The delegable CLIs are a property of the account, not of the run, so
              they stay listed while agents are running -- otherwise the whole
              list disappears the moment the first subagent starts. */}
          <div className="mb-2 rounded-md border border-border/45 bg-foreground/[0.02] px-3 py-2 text-xs text-muted-foreground">
            {delegationTargets.length > 0 ? (
              <>
                <span>Delegierbar per </span>
                <code className="text-[11px]">run_subagent</code>
                <span>:</span>
                <span className="mt-1 block font-medium text-foreground/80">
                  {delegationTargets.join(' · ')}
                </span>
              </>
            ) : (
              'Keine CLI-Subagenten aktiviert'
            )}
          </div>
          {agents.length === 0 ? (
            <div className="rounded-md border border-border/45 bg-foreground/[0.02] px-3 py-2 text-xs text-muted-foreground">
              Keiner läuft.
            </div>
          ) : (
            <div className="space-y-2">
              {[...activeAgents, ...completedAgents].slice(0, 10).map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-left transition-colors',
                    agent.status === 'started' &&
                      'border-primary/35 bg-primary/10 hover:bg-primary/15',
                    agent.status === 'completed' &&
                      'border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10',
                    agent.status === 'error' &&
                      'border-red-500/25 bg-red-500/10 hover:bg-red-500/15',
                    selectedAgentId === agent.id && 'ring-1 ring-primary/50'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {agent.status === 'started' ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                        ) : agent.status === 'error' ? (
                          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        )}
                        <span className="truncate text-xs font-semibold text-foreground">
                          {agent.agentType}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-muted-foreground">
                        {agent.description || agent.result || agent.error || 'No detail yet'}
                      </div>
                    </div>
                    <div className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      {agent.status === 'started'
                        ? durationShort(agent.startedAt)
                        : timeShort(agent.completedAt ?? agent.startedAt)}
                    </div>
                  </div>
                </button>
              ))}

              {selectedAgent && (
                <div className="rounded-md border border-border/50 bg-foreground/[0.025] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground">
                        {selectedAgent.agentType}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {selectedAgent.status === 'started'
                          ? `Running for ${durationShort(selectedAgent.startedAt)}`
                          : `${selectedAgent.status} after ${durationShort(
                              selectedAgent.startedAt,
                              selectedAgent.completedAt
                            )}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rail-close"
                      onClick={() => setSelectedAgentId(null)}
                      title="Close agent details"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-3 space-y-2 text-xs">
                    <GateRow
                      tone="live"
                      label="Started"
                      detail={timeShort(selectedAgent.startedAt)}
                    />
                    <GateRow
                      tone={
                        selectedAgent.status === 'started'
                          ? 'live'
                          : selectedAgent.status === 'error'
                            ? 'bad'
                            : 'good'
                      }
                      label="Status"
                      detail={selectedAgent.status}
                    />
                    {selectedAgent.externalAgentId && (
                      <GateRow
                        tone="neutral"
                        label="Agent ID"
                        detail={selectedAgent.externalAgentId}
                      />
                    )}
                    {selectedAgent.description && (
                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Brief
                        </div>
                        <pre className="max-h-32 overflow-auto rounded-md border border-border/45 bg-muted/35 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                          {selectedAgent.description}
                        </pre>
                      </div>
                    )}
                    {(selectedAgent.result || selectedAgent.error) && (
                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {selectedAgent.error ? 'Error' : 'Result'}
                        </div>
                        <pre className="max-h-48 overflow-auto rounded-md border border-border/45 bg-muted/35 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                          {selectedAgent.error || selectedAgent.result}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </Section>
      </div>

      <div ref={diffRef}>
        <Section title="Diff" icon={<GitBranch className="h-3.5 w-3.5" />}>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {gitStatus ? gitStatus.branch : gitFetching ? 'Checking' : 'No git repo'}
              </div>
              <button
                type="button"
                onClick={onReviewChanges}
                disabled={!gitStatus || dirtyCount === 0}
                className="panel-trigger h-7 px-2 text-[11px] disabled:pointer-events-none disabled:opacity-45"
              >
                <ShieldCheck className="h-3 w-3" />
                Review
              </button>
            </div>
            {changedFiles.length === 0 ? (
              <div className="rounded-md border border-border/45 bg-foreground/[0.02] px-3 py-2 text-xs text-muted-foreground">
                Clean
              </div>
            ) : (
              <div className="space-y-1">
                {changedFiles.slice(0, 6).map((file) => (
                  <div
                    key={file}
                    className="flex items-center gap-2 rounded-md bg-foreground/[0.025] px-2 py-1.5 text-xs"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono">{file}</span>
                  </div>
                ))}
                {changedFiles.length > 6 && (
                  <div className="px-2 pt-1 text-[11px] text-muted-foreground">
                    +{changedFiles.length - 6}
                  </div>
                )}
              </div>
            )}
          </div>
        </Section>
      </div>

      <div ref={verifyRef}>
        <Section title="Verify" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
          <div className="space-y-1">
            <GateRow
              tone={activeAgents.length || isLive ? 'live' : 'good'}
              label="Agent"
              detail={
                activeAgents.length
                  ? `${activeAgents.length} subagent${activeAgents.length === 1 ? '' : 's'} running`
                  : isLive
                    ? activity.message || activity.toolName || 'Working'
                    : 'Idle'
              }
            />
            <GateRow
              tone={failedTools.length ? 'bad' : runningTools.length ? 'live' : 'good'}
              label="Tools"
              detail={
                failedTools.length
                  ? `${failedTools.length} failed`
                  : runningTools.length
                    ? `${runningTools.length} running`
                    : `${tools.length} recorded`
              }
            />
            <GateRow
              tone={pendingTodos.length ? 'warn' : 'good'}
              label="Tasks"
              detail={pendingTodos.length ? `${pendingTodos.length} open` : 'Complete'}
            />
            <GateRow
              tone={
                !lastVerifyTool
                  ? 'neutral'
                  : lastVerifyTool.status === 'error'
                    ? 'bad'
                    : lastVerifyTool.status === 'started'
                      ? 'live'
                      : 'good'
              }
              label="Check"
              detail={
                lastVerifyTool
                  ? inputPreview(lastVerifyTool.input) || lastVerifyTool.status
                  : 'Not run in this session'
              }
            />
          </div>
        </Section>
      </div>

      <div ref={turnsRef}>
        <Section title="Turns" icon={<MessageSquare className="h-3.5 w-3.5" />}>
          <div className="space-y-1">
            {turnEvents.length === 0 ? (
              <div className="rounded-md border border-border/45 bg-foreground/[0.02] px-3 py-2 text-xs text-muted-foreground">
                Empty
              </div>
            ) : (
              turnEvents.map((event, index) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onJumpToMessage?.(event.id)}
                  className="grid w-full grid-cols-[16px_1fr_auto] gap-2 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-foreground/[0.045]"
                >
                  <span
                    className={cn(
                      'mt-1.5 h-1.5 w-1.5 rounded-full',
                      event.role === 'user' ? 'bg-foreground' : 'bg-primary'
                    )}
                  />
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block truncate text-xs font-medium text-foreground',
                        event.role === 'assistant' && 'text-primary'
                      )}
                    >
                      {index + 1}. {event.kind}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {event.text || '(empty)'}
                    </span>
                  </span>
                  <span className="pt-0.5 text-[10px] tabular-nums text-muted-foreground">
                    {timeShort(event.ts)}
                  </span>
                </button>
              ))
            )}
          </div>
        </Section>
      </div>

      <div ref={toolsRef}>
        <Section title="Recent Tools" icon={<Clock3 className="h-3.5 w-3.5" />}>
          <div className="space-y-1">
            {runEvents.length === 0 ? (
              <div className="rounded-md border border-border/45 bg-foreground/[0.02] px-3 py-2 text-xs text-muted-foreground">
                Empty
              </div>
            ) : (
              runEvents.map((event) => {
                const Icon = event.icon;
                return (
                  <div key={event.id} className="grid grid-cols-[16px_1fr_auto] gap-2 px-1 py-1.5">
                    <Icon className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-foreground">
                        {event.kind}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{event.text}</div>
                    </div>
                    <div className="pt-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {timeShort(event.ts)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Section>
      </div>

      {usage && (
        <div className="mt-auto border-t border-border/45 px-4 py-3 text-[11px] text-muted-foreground">
          <span className="tabular-nums">{usage.totalTokens.toLocaleString()}</span> ctx
          <span className="mx-2">/</span>
          <span className="tabular-nums">
            {usage.totalCostUsd < 0.01
              ? `$${usage.totalCostUsd.toFixed(4)}`
              : `$${usage.totalCostUsd.toFixed(2)}`}
          </span>
        </div>
      )}
    </aside>
  );
}
