import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Boxes, Cpu, Radio, RefreshCw, ScrollText, Server, Sparkles } from 'lucide-react';
import type {
  SwarmAgentGroup,
  SwarmAgentHealth,
  SwarmDirectory,
  SwarmDirectoryAgent,
} from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const SWARM_DIRECTORY_KEY = ['assistant', 'swarm-directory'] as const;

/** The directory the backend builds without a Matrix login; shared by the page and the sidebar. */
export function useSwarmDirectory() {
  const account = useAuthStore((state) => state.user?.id);
  return useQuery({
    queryKey: [...SWARM_DIRECTORY_KEY, account],
    queryFn: async () =>
      (await api.get<{ data: SwarmDirectory }>('/api/assistant/swarm/directory')).data.data,
    refetchInterval: 30000,
  });
}

const GROUPS: Array<{ id: SwarmAgentGroup; label: string; hint: string; icon: typeof Bot }> = [
  { id: 'swarm', label: 'Schwarm-Agenten', hint: 'Nehmen Aufträge vom Hub an', icon: Bot },
  { id: 'watch', label: 'Melder und Wächter', hint: 'Melden Ereignisse an den Hub', icon: Radio },
  {
    id: 'plum',
    label: 'Plum',
    hint: 'CLI-Anbieter, eigene Agenten und Subagenten',
    icon: Sparkles,
  },
  {
    id: 'service',
    label: 'Weitere Dienste',
    hint: 'Agenten-Container ausserhalb des Schwarms',
    icon: Boxes,
  },
];

export const HEALTH_LABEL: Record<SwarmAgentHealth, string> = {
  online: 'Online',
  idle: 'Bereit',
  offline: 'Offline',
  stopped: 'Gestoppt',
  unknown: 'Unbekannt',
};
const HEALTH_TONE: Record<SwarmAgentHealth, string> = {
  online: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  idle: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
  offline: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  stopped: 'bg-destructive/10 text-destructive border-destructive/30',
  unknown: 'bg-muted text-muted-foreground border-border',
};
const PROBLEMS: Record<string, string> = {
  'dead-letter-outbox': 'Nachrichten an Matrix konnten nicht zugestellt werden',
  'dead-letter-inbox': 'Eingehende Nachrichten sind hängen geblieben',
  'outbox-rueckstand': 'Ausgang staut sich',
  'inbox-lag': 'Eingang ist im Rückstand',
};

export function HealthPill({ health }: { health: SwarmAgentHealth }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        HEALTH_TONE[health]
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {HEALTH_LABEL[health]}
    </span>
  );
}

/**
 * Every agent the server can identify, grouped, with its real state.
 * Commands go into the swarm composer (`onCommand`) and need the Matrix
 * account; container actions need an admin account.
 */
export function SwarmDirectoryPanel({
  onCommand,
  onOpenRoom,
}: {
  onCommand?: (command: string) => void;
  onOpenRoom?: (roomId: string) => void;
}) {
  const directory = useSwarmDirectory();
  const [filter, setFilter] = useState<SwarmAgentGroup | 'all'>('all');
  const data = directory.data;
  const counts = useMemo(() => {
    const out: Record<SwarmAgentHealth, number> = {
      online: 0,
      idle: 0,
      offline: 0,
      stopped: 0,
      unknown: 0,
    };
    for (const agent of data?.agents.filter((a) => a.kind === 'hub' || a.kind === 'service') ?? [])
      out[agent.health]++;
    return out;
  }, [data]);

  if (directory.isLoading) return <p role="status">Agenten werden ermittelt …</p>;
  if (directory.error || !data)
    return (
      <p role="alert" className="rounded-md border border-destructive bg-card p-3">
        Agentenverzeichnis nicht erreichbar: {directory.error?.message}
      </p>
    );

  return (
    <section aria-label="Agenten" className="space-y-4">
      <HubBanner directory={data} onCommand={onCommand} />
      <div className="flex flex-wrap items-center gap-2">
        {(['all', ...GROUPS.map((g) => g.id)] as const).map((id) => (
          <Button
            key={id}
            size="sm"
            variant={filter === id ? 'default' : 'outline'}
            onClick={() => setFilter(id)}
          >
            {id === 'all' ? 'Alle' : GROUPS.find((g) => g.id === id)!.label}
            <span className="ml-1 text-xs opacity-70">
              {id === 'all' ? data.agents.length : data.agents.filter((a) => a.group === id).length}
            </span>
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {counts.online} online · {counts.idle} bereit · {counts.offline} offline ·{' '}
          {counts.stopped} gestoppt
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Neu laden"
          disabled={directory.isFetching}
          onClick={() => void directory.refetch()}
        >
          <RefreshCw className={cn('h-4 w-4', directory.isFetching && 'animate-spin')} />
        </Button>
      </div>
      {!data.matrixConnected && (
        <p className="text-sm text-muted-foreground">
          Für Aufträge, Stopp und Räume verbinde unten dein Schwarm-Konto. Zustand und Container
          sind auch ohne sichtbar.
        </p>
      )}
      {!data.containersVisible && (
        <p className="text-sm text-muted-foreground">
          Container-Zustände sind nur mit Adminrechten sichtbar.
        </p>
      )}
      {GROUPS.filter((group) => filter === 'all' || filter === group.id).map((group) => {
        const agents = data.agents.filter((a) => a.group === group.id);
        if (!agents.length) return null;
        const subagents = agents.filter((a) => a.kind === 'subagent');
        const main = agents.filter((a) => a.kind !== 'subagent');
        return (
          <section key={group.id} className="space-y-3">
            <header className="flex items-center gap-2">
              <group.icon className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">{group.label}</h2>
              <span className="text-xs text-muted-foreground">{group.hint}</span>
            </header>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {main.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  containersVisible={data.containersVisible}
                  onCommand={data.matrixConnected ? onCommand : undefined}
                  onOpenRoom={data.matrixConnected ? onOpenRoom : undefined}
                />
              ))}
            </div>
            {subagents.length > 0 && (
              <details className="rounded-lg border bg-card p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {subagents.length} Subagenten für Sitzungen
                </summary>
                <ul className="mt-3 grid gap-2 md:grid-cols-2">
                  {subagents.map((agent) => (
                    <li key={agent.id} className="rounded-md border p-2 text-sm">
                      <span className="font-medium">{agent.name}</span>
                      {agent.model && (
                        <span className="ml-2 text-xs text-muted-foreground">{agent.model}</span>
                      )}
                      {agent.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {agent.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Stand {new Date(data.checkedAt).toLocaleTimeString('de-CH')}. Der Hub entscheidet weiterhin
        über Rechte, Auftragszustand und Freigaben.
      </p>
    </section>
  );
}

function HubBanner({
  directory,
  onCommand,
}: {
  directory: SwarmDirectory;
  onCommand?: (command: string) => void;
}) {
  const { hub } = directory;
  const tone = !hub.reachable
    ? 'border-destructive'
    : hub.frozen
      ? 'border-destructive'
      : hub.ok
        ? 'border-emerald-500/40'
        : 'border-amber-500/50';
  const title = !hub.reachable
    ? 'Hub nicht erreichbar'
    : hub.frozen
      ? 'Schwarm eingefroren'
      : hub.ok
        ? 'Hub läuft'
        : 'Hub läuft mit Warnungen';
  return (
    <article className={cn('space-y-3 rounded-lg border-2 bg-card p-4', tone)}>
      <div className="flex flex-wrap items-center gap-3">
        <Server className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-semibold">{title}</h2>
        {hub.container && (
          <span className="text-xs text-muted-foreground">
            {hub.container.name} · {hub.container.status}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {onCommand && !hub.frozen && (
            <Button size="sm" variant="destructive" onClick={() => onCommand('!stop')}>
              Not-Aus vorbereiten
            </Button>
          )}
          {onCommand && hub.frozen && (
            <Button size="sm" variant="outline" onClick={() => onCommand('!weiter')}>
              Schwarm fortsetzen vorbereiten
            </Button>
          )}
        </div>
      </div>
      {hub.reachable ? (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Offene Aufträge" value={hub.openTasks} />
          <Stat label="Wartende Freigaben" value={hub.approvalsPending} />
          <Stat label="Kosten heute" value={`$${hub.costTodayUsd.toFixed(2)}`} />
          <Stat label="Unzustellbar" value={hub.outboxDead} />
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">{hub.error}</p>
      )}
      {hub.problems.length > 0 && (
        <ul className="space-y-1 text-sm">
          {hub.problems.map((problem) => (
            <li key={problem}>⚠ {PROBLEMS[problem] ?? problem}</li>
          ))}
        </ul>
      )}
      {hub.failures.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">
            {hub.failures.length} gescheiterte Aufträge in 24 h
          </summary>
          <ul className="mt-2 space-y-1">
            {hub.failures.map((failure) => (
              <li key={failure.task} className="text-muted-foreground">
                <span className="font-medium text-foreground">{failure.task}</span> ·{' '}
                {failure.state} · {failure.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function AgentCard({
  agent,
  containersVisible,
  onCommand,
  onOpenRoom,
}: {
  agent: SwarmDirectoryAgent;
  containersVisible: boolean;
  onCommand?: (command: string) => void;
  onOpenRoom?: (roomId: string) => void;
}) {
  const cache = useQueryClient();
  const [logs, setLogs] = useState<{ name: string; lines: string[] } | null>(null);
  const native = agent.kind === 'hub' ? agent.id.slice(4) : null;
  const action = useMutation({
    mutationFn: ({ name, verb }: { name: string; verb: 'start' | 'restart' | 'stop' }) =>
      api.post(`/api/assistant/swarm/containers/${encodeURIComponent(name)}/${verb}`),
    onSettled: () => void cache.invalidateQueries({ queryKey: SWARM_DIRECTORY_KEY }),
  });
  const showLogs = async (name: string) => {
    if (logs?.name === name) return setLogs(null);
    const result = (
      await api.get<{ data: { lines: string[] } }>(
        `/api/docker/containers/${encodeURIComponent(name)}/logs?tail=60`
      )
    ).data.data;
    setLogs({ name, lines: result.lines });
  };
  const meta = [
    agent.mode,
    agent.level,
    agent.trust,
    agent.model,
    agent.runtime && agent.runtime !== agent.containers[0]?.name ? agent.runtime : undefined,
    agent.parallel && agent.parallel > 1 ? `${agent.parallel} parallel` : undefined,
  ].filter(Boolean);
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4">
      <header className="flex items-start gap-2">
        {agent.kind === 'cli' ? (
          <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium">{agent.name}</h3>
          {meta.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">{meta.join(' · ')}</p>
          )}
        </div>
        <HealthPill health={agent.health} />
      </header>
      <p className="text-sm">{agent.healthReason}</p>
      {agent.lastLog && (
        <p className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-words">
          {agent.lastLog}
        </p>
      )}
      {agent.description && <p className="text-sm text-muted-foreground">{agent.description}</p>}
      {agent.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {agent.skills.map((skill) => (
            <span key={skill} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
              {skill}
            </span>
          ))}
        </div>
      )}
      {agent.puppets && (
        <p className="text-xs text-muted-foreground">Stimmen im Rat: {agent.puppets.join(', ')}</p>
      )}
      {agent.budgetUsdDay !== undefined && (
        <p className="text-xs text-muted-foreground">
          Budget heute ${(agent.spentTodayUsd ?? 0).toFixed(2)} von ${agent.budgetUsdDay.toFixed(2)}
        </p>
      )}
      {containersVisible && agent.containers.length > 0 && (
        <ul className="space-y-1 text-xs">
          {agent.containers.map((container) => (
            <li key={container.name} className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  container.running ? 'bg-emerald-500' : 'bg-destructive'
                )}
                aria-hidden="true"
              />
              <span className="font-mono">{container.name}</span>
              <span className="text-muted-foreground">{container.status}</span>
              <span className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => void showLogs(container.name)}
                >
                  <ScrollText className="mr-1 h-3 w-3" />
                  Logs
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  disabled={action.isPending}
                  onClick={() => {
                    const verb = container.running ? 'restart' : 'start';
                    const question = container.running
                      ? `${container.name} neu starten?`
                      : `${container.name} starten?`;
                    if (window.confirm(question)) action.mutate({ name: container.name, verb });
                  }}
                >
                  {container.running ? 'Neustart' : 'Starten'}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {action.error && (
        <p role="alert" className="text-xs text-destructive">
          {action.error.message}
        </p>
      )}
      {logs && (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-snug">
          {logs.lines.join('\n') || 'Keine Ausgabe'}
        </pre>
      )}
      {native && (onCommand || (onOpenRoom && agent.room?.id)) && (
        <div className="mt-auto flex flex-wrap gap-2">
          {onCommand && agent.accepts.includes('auftrag') && (
            <Button size="sm" variant="outline" onClick={() => onCommand(`!auftrag @${native} `)}>
              Auftrag
            </Button>
          )}
          {onOpenRoom && agent.room?.id && (
            <Button size="sm" variant="outline" onClick={() => onOpenRoom(agent.room!.id!)}>
              Raum
            </Button>
          )}
          {onCommand && agent.group === 'swarm' && (
            <>
              <Button size="sm" variant="ghost" onClick={() => onCommand(`!profil @${native}`)}>
                Profil
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onCommand(`!stop @${native}`)}>
                Stoppen
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onCommand(`!weiter @${native}`)}>
                Weiter
              </Button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
