import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hammer, Loader2, Network, Play, RefreshCw, RotateCw } from 'lucide-react';
import type {
  ApiResponse,
  HermesAgent,
  HermesAgentContainer,
  HermesStatus,
} from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { HealthPill } from '@/components/assistant/SwarmDirectoryPanel';
import { cn } from '@/lib/utils';

export const HERMES_QUERY_KEY = ['hermes', 'status'] as const;

/** Shared by the page and the sidebar section: one cache, one poll. */
export function useHermesStatus() {
  return useQuery({
    queryKey: HERMES_QUERY_KEY,
    queryFn: async () => (await api.get<ApiResponse<HermesStatus>>('/api/hermes')).data.data!,
    // An update recreates a container within minutes: follow it closely, otherwise relax.
    refetchInterval: (query) =>
      query.state.data?.agents.some((agent) => agent.update?.running) ? 5_000 : 60_000,
  });
}

const GROUPS: Array<{ id: string; label: string }> = [
  { id: 'swarm', label: 'Schwarm' },
  { id: 'watch', label: 'Melder und Wächter' },
];

const PLATFORM_LABEL: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  matrix: 'Matrix',
  api_server: 'API',
};

/** The version a card shows: Hermes' own, else the image tag. */
export function agentVersion(agent: HermesAgent): string | null {
  if (agent.hermes) {
    return agent.hermes.version?.match(/v\d+(?:\.\d+)+/)?.[0] ?? agent.hermes.tag;
  }
  return null;
}

/** "node:22-alpine", "lokal gebaut" for an untagged local image. */
function imageLabel(image: string | null): string {
  if (!image) return '';
  if (image.startsWith('sha256:')) return 'lokal gebaut';
  return image.replace(/^.*\//, '');
}

export function agentDot(agent: HermesAgent): 'online' | 'live-idle' | 'offline' | 'error' {
  if (agent.hermes?.platforms.some((platform) => platform.needsAttention)) return 'error';
  if (agent.health === 'online') return 'online';
  if (agent.health === 'idle') return 'live-idle';
  if (agent.health === 'stopped') return 'error';
  return 'offline';
}

function ContainerRow({
  container,
  onAction,
  busy,
}: {
  container: HermesAgentContainer;
  onAction: (container: HermesAgentContainer, verb: 'start' | 'restart') => void;
  busy: boolean;
}) {
  const verb = container.running ? 'restart' : 'start';
  return (
    <li className="flex items-center gap-2 text-xs">
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          container.running ? 'bg-emerald-500' : 'bg-muted-foreground/50'
        )}
        aria-hidden
      />
      <span className="truncate font-medium">{container.name}</span>
      <span className="truncate text-muted-foreground">
        {imageLabel(container.image)} · {container.status}
      </span>
      {container.actions.includes(verb) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction(container, verb)}
          className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          title={verb === 'restart' ? 'Neu starten' : 'Starten'}
        >
          {verb === 'restart' ? (
            <RotateCw className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </li>
  );
}

function AgentCard({
  agent,
  latestTag,
  onUpdate,
  onAction,
  pending,
}: {
  agent: HermesAgent;
  latestTag: string | null;
  onUpdate: (agent: HermesAgent) => void;
  onAction: (container: HermesAgentContainer, verb: 'start' | 'restart') => void;
  pending: boolean;
}) {
  const [showLog, setShowLog] = useState(false);
  const version = agentVersion(agent);
  const update = agent.update;
  const updateLabel = !update
    ? null
    : update.kind === 'hermes'
      ? update.available
        ? `Aktualisieren auf ${update.target ?? latestTag}`
        : 'Aktuell'
      : 'Neu bauen';

  return (
    <section className="flex flex-col rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <span
          className={cn('sidebar-session-run-dot', `is-${agentDot(agent)}`, 'is-visible')}
          aria-hidden
        />
        <h3 className="font-semibold">{agent.name}</h3>
        {version && <span className="text-sm text-muted-foreground">{version}</span>}
        <span className="ml-auto">
          <HealthPill health={agent.health} />
        </span>
      </div>
      {agent.description && (
        <p className="mt-1 text-xs text-muted-foreground">{agent.description}</p>
      )}

      {agent.hermes && agent.hermes.platforms.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {agent.hermes.platforms.map((platform) => (
            <li
              key={platform.id}
              title={platform.error ?? undefined}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px]',
                platform.state === 'connected'
                  ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                  : platform.needsAttention
                    ? 'border-destructive/50 text-destructive'
                    : 'text-muted-foreground'
              )}
            >
              {PLATFORM_LABEL[platform.id] ?? platform.id}:{' '}
              {platform.state === 'connected'
                ? 'verbunden'
                : platform.state === 'disconnected'
                  ? 'getrennt'
                  : platform.state}
            </li>
          ))}
        </ul>
      )}

      {agent.containers.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {agent.containers.map((container) => (
            <ContainerRow
              key={container.name}
              container={container}
              onAction={onAction}
              busy={pending}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          {agent.id === 'hermes-phone' ? 'Läuft auf dem Handy.' : 'Kein eigener Container.'}
        </p>
      )}

      {update && (
        <div className="mt-auto flex items-center gap-2 pt-4">
          <Button
            size="sm"
            variant={update.kind === 'hermes' && update.available ? 'default' : 'outline'}
            disabled={pending || update.running || (update.kind === 'hermes' && !update.available)}
            onClick={() => onUpdate(agent)}
          >
            {update.running ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Läuft …
              </>
            ) : (
              <>
                {update.kind === 'rebuild' && <Hammer className="mr-1 h-3.5 w-3.5" />}
                {updateLabel}
              </>
            )}
          </Button>
          {update.log.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowLog((value) => !value)}
            >
              {showLog ? 'Protokoll ausblenden' : 'Protokoll'}
            </button>
          )}
        </div>
      )}
      {update && (showLog || update.running) && update.log.length > 0 && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-[10px] leading-relaxed">
          {update.log.slice(-20).join('\n')}
        </pre>
      )}
    </section>
  );
}

/**
 * The Hermes area (formerly Schwarm in the mode pill): every Schwarm agent on
 * the Unraid host with its containers, Hermes version, update and restart.
 * The Schwarm's rooms and orders stay reachable from here.
 */
export function HermesPage() {
  const cache = useQueryClient();
  const status = useHermesStatus();
  const data = status.data;

  const update = useMutation({
    mutationFn: async (agent: HermesAgent) => {
      if (
        agent.update?.kind === 'rebuild' &&
        !window.confirm(`${agent.name} neu bauen und neu starten?`)
      ) {
        return null;
      }
      return (
        await api.post<ApiResponse<HermesStatus>>(
          `/api/hermes/agents/${encodeURIComponent(agent.id)}/update`
        )
      ).data.data!;
    },
    onSuccess: (next) => next && cache.setQueryData(HERMES_QUERY_KEY, next),
  });
  const action = useMutation({
    mutationFn: async ({
      container,
      verb,
    }: {
      container: HermesAgentContainer;
      verb: 'start' | 'restart';
    }) => {
      await api.post(
        `/api/assistant/swarm/containers/${encodeURIComponent(container.name)}/${verb}`,
        {
          host: container.host ?? undefined,
        }
      );
      return (await api.get<ApiResponse<HermesStatus>>('/api/hermes?fresh=1')).data.data!;
    },
    onSuccess: (next) => cache.setQueryData(HERMES_QUERY_KEY, next),
  });
  const autoUpdate = useMutation({
    mutationFn: async (paused: boolean) =>
      (await api.put<ApiResponse<HermesStatus>>('/api/hermes/auto-update', { paused })).data.data!,
    onSuccess: (next) => cache.setQueryData(HERMES_QUERY_KEY, next),
  });
  const refresh = async () => {
    const fresh = (await api.get<ApiResponse<HermesStatus>>('/api/hermes?fresh=1')).data.data!;
    cache.setQueryData(HERMES_QUERY_KEY, fresh);
  };
  const error = status.error ?? update.error ?? action.error ?? autoUpdate.error;
  const pending = update.isPending || action.isPending;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-8">
      <header>
        <Link to="/" className="text-sm text-primary">
          Plum
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Hermes</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Alle Agenten deines Schwarms: Zustand, Kanäle, Updates und Neustart.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-md border border-destructive bg-card p-3 text-sm">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      {status.isLoading && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Agenten werden abgefragt …
        </p>
      )}

      {data && (
        <>
          <section className="flex flex-wrap items-start gap-4 rounded-lg border bg-card p-4">
            <div className="min-w-0">
              <h2 className="font-semibold">Hermes {data.latestTag ?? ''}</h2>
              <p className="text-sm text-muted-foreground">
                Neueste Version von Hermes Agent. Updates sichern vorher und fallen bei Fehlern auf
                die alte Version zurück.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Switch
                id="hermes-auto-update"
                checked={!data.autoUpdate.paused}
                disabled={autoUpdate.isPending}
                onCheckedChange={(on) => autoUpdate.mutate(!on)}
              />
              <div className="max-w-xs">
                <Label htmlFor="hermes-auto-update">Brian täglich automatisch aktualisieren</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {data.autoUpdate.paused
                    ? (data.autoUpdate.reason?.split('\n')[0] ?? 'Pausiert.')
                    : 'Läuft jede Nacht.'}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => void refresh()}
              title="Neu prüfen"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </section>

          {GROUPS.map((group) => {
            const agents = data.agents.filter((agent) => agent.group === group.id);
            if (agents.length === 0) return null;
            return (
              <section key={group.id} className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground">{group.label}</h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {agents.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      latestTag={data.latestTag}
                      onUpdate={(target) => update.mutate(target)}
                      onAction={(container, verb) => action.mutate({ container, verb })}
                      pending={pending}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      <Link
        to="/swarm"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <Network className="h-4 w-4" /> Räume und Aufträge des Schwarms
      </Link>
    </main>
  );
}
