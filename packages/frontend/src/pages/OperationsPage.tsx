import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  Container,
  ExternalLink,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  ServerCog,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  getContainerInventoryViewState,
  type ContainerInventoryViewState,
} from '@/lib/operationsViewState';
import type {
  ApiResponse,
  ContainerHealthSnapshot,
  ContainerWatchdog,
  DiscordIntegrationSettings,
  DiscordOutboxItem,
  DockerContainerDetail,
  DockerContainerSummary,
  DockerIntegrationStatus,
  SessionDelegation,
} from '@plum-code-webui/shared';

function toneForHealth(health: string, state: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (health === 'healthy') return 'good';
  if (health === 'unhealthy' || state === 'exited' || state === 'dead') return 'bad';
  if (health === 'starting' || state === 'restarting') return 'warn';
  if (state === 'running') return 'good';
  return 'neutral';
}

function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium',
        tone === 'good' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
        tone === 'warn' && 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        tone === 'bad' && 'border-red-500/30 bg-red-500/10 text-red-300',
        tone === 'neutral' && 'border-border bg-muted/40 text-muted-foreground'
      )}
    >
      {children}
    </span>
  );
}

function getApiErrorStatus(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status;
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return undefined;
}

function ContainerInventoryNotice({
  state,
  onRetry,
}: {
  state: Exclude<ContainerInventoryViewState, { kind: 'ready' | 'loading' }>;
  onRetry: () => void;
}) {
  const isProblem =
    state.kind === 'admin-required' ||
    state.kind === 'docker-offline' ||
    state.kind === 'inventory-error';

  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-md border',
          isProblem
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
            : 'border-border bg-muted/40 text-muted-foreground'
        )}
      >
        {isProblem ? <AlertTriangle className="h-5 w-5" /> : <Search className="h-5 w-5" />}
      </div>
      <div>
        <div className="font-medium text-foreground">{state.title}</div>
        <div className="mt-1 max-w-md">{state.description}</div>
      </div>
      {isProblem && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      )}
    </div>
  );
}

export function OperationsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [consultQuestion, setConsultQuestion] = useState(
    'Pruefe den aktuellen Container-Zustand und gib eine knappe Diagnose mit sicheren naechsten Schritten.'
  );

  const dockerStatus = useQuery({
    queryKey: ['docker-status'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DockerIntegrationStatus>>('/api/docker/status');
      return response.data.data;
    },
    refetchInterval: 10_000,
  });

  const containers = useQuery({
    queryKey: ['docker-containers'],
    queryFn: async () => {
      const response =
        await api.get<ApiResponse<DockerContainerSummary[]>>('/api/docker/containers');
      return response.data.data || [];
    },
    enabled: dockerStatus.data?.available === true,
    refetchInterval: 10_000,
  });

  const watchdogs = useQuery({
    queryKey: ['watchdogs'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ContainerWatchdog[]>>('/api/watchdogs');
      return response.data.data || [];
    },
    refetchInterval: 10_000,
  });

  const discordSettings = useQuery({
    queryKey: ['discord-settings'],
    queryFn: async () => {
      const response =
        await api.get<ApiResponse<DiscordIntegrationSettings>>('/api/discord/settings');
      return response.data.data;
    },
    refetchInterval: 15_000,
  });

  const discordOutbox = useQuery({
    queryKey: ['discord-outbox'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DiscordOutboxItem[]>>(
        '/api/discord/outbox?limit=8'
      );
      return response.data.data || [];
    },
    refetchInterval: 15_000,
  });

  const selectedContainer = useMemo(() => {
    if (!selectedContainerId) return null;
    return containers.data?.find((item) => item.id === selectedContainerId) || null;
  }, [containers.data, selectedContainerId]);

  const selectedWatchdog = useMemo(() => {
    if (!selectedContainer) return null;
    return watchdogs.data?.find((item) => item.containerId === selectedContainer.id) || null;
  }, [selectedContainer, watchdogs.data]);

  const containerDetail = useQuery({
    queryKey: ['docker-container', selectedContainerId],
    queryFn: async () => {
      if (!selectedContainerId) return null;
      const response = await api.get<ApiResponse<DockerContainerDetail>>(
        `/api/docker/containers/${encodeURIComponent(selectedContainerId)}`
      );
      return response.data.data || null;
    },
    enabled: !!selectedContainerId,
    refetchInterval: selectedContainerId ? 15_000 : false,
  });

  const filteredContainers = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = containers.data || [];
    if (!term) return list;
    return list.filter((item) =>
      [item.name, item.image, item.state, item.status, item.composeProject, item.composeService]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [containers.data, query]);

  const createWatchdog = useMutation({
    mutationFn: async (containerId: string) => {
      const response = await api.post<ApiResponse<ContainerWatchdog>>('/api/watchdogs', {
        containerId,
      });
      return response.data.data;
    },
    onSuccess: (watchdog) => {
      queryClient.invalidateQueries({ queryKey: ['watchdogs'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast({
        title: 'Watchdog zugewiesen',
        description: watchdog ? `${watchdog.containerName} hat jetzt eine Session.` : undefined,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Watchdog-Zuweisung fehlgeschlagen',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const createSnapshot = useMutation({
    mutationFn: async (containerId: string) => {
      const response = await api.post<ApiResponse<ContainerHealthSnapshot>>(
        `/api/docker/containers/${encodeURIComponent(containerId)}/snapshot`
      );
      return response.data.data;
    },
    onSuccess: (snapshot) => {
      queryClient.invalidateQueries({ queryKey: ['watchdogs'] });
      toast({
        title: 'Snapshot erstellt',
        description: snapshot?.summary?.slice(0, 140),
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Snapshot fehlgeschlagen',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const consultWatchdog = useMutation({
    mutationFn: async ({ watchdogId, question }: { watchdogId: string; question: string }) => {
      const response = await api.post<ApiResponse<SessionDelegation>>(
        `/api/watchdogs/${encodeURIComponent(watchdogId)}/consult`,
        { question }
      );
      return response.data.data;
    },
    onSuccess: (delegation) => {
      queryClient.invalidateQueries({ queryKey: ['watchdogs'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast({
        title: 'Watchdog befragt',
        description: delegation
          ? `Delegation ${delegation.correlationId} an die Watchdog-Session gesendet.`
          : undefined,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Befragung fehlgeschlagen',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const status = dockerStatus.data;
  const detail = containerDetail.data;
  const inventoryState = getContainerInventoryViewState({
    dockerStatusLoading: dockerStatus.isLoading,
    dockerStatusErrorStatus: getApiErrorStatus(dockerStatus.error),
    dockerStatusErrorMessage: status?.error || getErrorMessage(dockerStatus.error),
    dockerAvailable: status?.available,
    containersLoading: containers.isLoading,
    containersErrorStatus: getApiErrorStatus(containers.error),
    containersErrorMessage: getErrorMessage(containers.error),
    totalCount: containers.data?.length || 0,
    filteredCount: filteredContainers.length,
    query,
  });
  const retryContainerInventory = () => {
    dockerStatus.refetch();
    containers.refetch();
  };

  return (
    <div className="operations-shell glass-page operations-dashboard container mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 md:px-6">
      <header className="operations-page-header flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ServerCog className="h-4 w-4" />
            Docker Operations
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
            Container Watchdogs
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              dockerStatus.refetch();
              containers.refetch();
              watchdogs.refetch();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr_0.9fr]">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Docker Host</CardTitle>
                <CardDescription>Read-only inventory and health checks.</CardDescription>
              </div>
              {dockerStatus.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : status?.available ? (
                <StatusPill tone="good">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Connected
                </StatusPill>
              ) : (
                <StatusPill tone="bad">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  Offline
                </StatusPill>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-3">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Server</div>
              <div className="mt-1 font-medium">{status?.serverVersion || 'Unknown'}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Socket</div>
              <div className="mt-1 truncate font-mono text-xs">{status?.socketPath || '-'}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Mode</div>
              <div className="mt-1 font-medium">Read-only in WebUI</div>
            </div>
            {status?.error && (
              <div className="md:col-span-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">
                {status.error}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Safety Boundary</CardTitle>
            <CardDescription>Docker actions stay disabled in this slice.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p className="flex gap-2">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              Inventory, logs, stats, snapshots, and watchdog consults are available. Restart, stop,
              prune, appdata moves, and rebuilds remain approval-gated future work.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Discord Alerts</CardTitle>
                <CardDescription>Outbox status for Plum ops notifications.</CardDescription>
              </div>
              {discordSettings.data?.enabled && discordSettings.data.configured ? (
                <StatusPill tone="good">
                  <Bell className="mr-1 h-3 w-3" />
                  Active
                </StatusPill>
              ) : discordSettings.data?.configured ? (
                <StatusPill tone="warn">Configured</StatusPill>
              ) : (
                <StatusPill tone="neutral">Not set</StatusPill>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Transport</div>
                <div className="mt-1 font-medium">
                  {discordSettings.data?.transport === 'bot' ? 'Bot token' : 'Webhook'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Channel</div>
                <div className="mt-1 truncate font-mono text-xs">
                  {discordSettings.data?.channelId ||
                    discordSettings.data?.webhookUrlPreview ||
                    '-'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Gateway</div>
                <div className="mt-1 font-medium">
                  {discordSettings.data?.gatewayMode?.replace('_', ' ') || '-'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Maintenance</div>
                <div className="mt-1 font-medium">
                  {discordSettings.data?.maintenancePolicy?.replace('_', ' ') || '-'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Inbound jobs</div>
                <div className="mt-1 font-medium">
                  {discordSettings.data?.inboundJobsEnabled ? 'Enabled' : 'Disabled'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Pending</div>
                <div className="mt-1 font-medium">{discordSettings.data?.outboxPending ?? 0}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Failed</div>
                <div className="mt-1 font-medium">{discordSettings.data?.outboxFailed ?? 0}</div>
              </div>
            </div>
            <div className="space-y-2">
              {(discordOutbox.data || []).slice(0, 4).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2 py-1"
                >
                  <span className="min-w-0 truncate">{item.title}</span>
                  <StatusPill
                    tone={
                      item.status === 'sent'
                        ? 'good'
                        : item.status === 'failed' || item.status === 'disabled'
                          ? 'bad'
                          : 'warn'
                    }
                  >
                    {item.status}
                  </StatusPill>
                </div>
              ))}
              {!discordOutbox.data?.length && (
                <div className="text-xs text-muted-foreground">No Discord messages queued yet.</div>
              )}
            </div>
            {discordSettings.data?.lastError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">
                {discordSettings.data.lastError}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="min-h-[560px]">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-base">Containers</CardTitle>
                <CardDescription>{inventoryState.description}</CardDescription>
              </div>
              <div className="relative w-full md:w-80">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search containers..."
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/60">
              {inventoryState.kind === 'loading' ? (
                <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {inventoryState.description}
                </div>
              ) : inventoryState.kind !== 'ready' ? (
                <ContainerInventoryNotice
                  state={inventoryState}
                  onRetry={retryContainerInventory}
                />
              ) : (
                filteredContainers.map((item) => {
                  const tone = toneForHealth(item.health, item.state);
                  const watchdog = watchdogs.data?.find((wd) => wd.containerId === item.id);
                  const selected = selectedContainerId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        'operations-container-row grid w-full gap-3 px-5 py-3 text-left transition md:grid-cols-[minmax(0,1fr)_auto]',
                        selected && 'is-selected'
                      )}
                      onClick={() => setSelectedContainerId(item.id)}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Container className="h-4 w-4 text-muted-foreground" />
                          <span className="truncate font-medium">{item.name}</span>
                          <StatusPill tone={tone}>
                            {item.health !== 'none' ? item.health : item.state}
                          </StatusPill>
                          {watchdog && (
                            <StatusPill tone="neutral">
                              <Bot className="mr-1 h-3 w-3" />
                              Watchdog
                            </StatusPill>
                          )}
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {item.image}
                          {item.composeProject ? ` · ${item.composeProject}` : ''}
                          {item.composeService ? `/${item.composeService}` : ''}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground md:text-right">
                        <div>{item.status}</div>
                        <div className="mt-1 font-mono">{item.shortId}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Selected Container</CardTitle>
              <CardDescription>
                {selectedContainer ? selectedContainer.name : 'Choose a container from the list.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedContainer ? (
                <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  Select a container to inspect details and assign a watchdog.
                </div>
              ) : (
                <>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">State</span>
                      <StatusPill
                        tone={toneForHealth(selectedContainer.health, selectedContainer.state)}
                      >
                        {selectedContainer.health !== 'none'
                          ? selectedContainer.health
                          : selectedContainer.state}
                      </StatusPill>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">Image</span>
                      <span className="max-w-[260px] truncate text-right font-mono text-xs">
                        {selectedContainer.image}
                      </span>
                    </div>
                    {detail?.restartCount !== undefined && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Restarts</span>
                        <span>{detail.restartCount}</span>
                      </div>
                    )}
                    {detail?.appdataCandidates?.length ? (
                      <div>
                        <div className="text-muted-foreground">Appdata candidates</div>
                        <div className="mt-1 space-y-1">
                          {detail.appdataCandidates.slice(0, 3).map((candidate) => (
                            <div
                              key={candidate}
                              className="truncate rounded bg-muted/40 px-2 py-1 font-mono text-xs"
                            >
                              {candidate}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="outline"
                      onClick={() => createSnapshot.mutate(selectedContainer.id)}
                      disabled={createSnapshot.isPending}
                    >
                      {createSnapshot.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Snapshot
                    </Button>
                    {selectedWatchdog ? (
                      <Button variant="outline" asChild>
                        <Link to={`/session/${selectedWatchdog.sessionId}`}>
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Open Watchdog
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        onClick={() => createWatchdog.mutate(selectedContainer.id)}
                        disabled={createWatchdog.isPending}
                      >
                        {createWatchdog.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Bot className="mr-2 h-4 w-4" />
                        )}
                        Assign Watchdog
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Consult Watchdog</CardTitle>
              <CardDescription>
                Sends a snapshot-backed diagnosis request to the assigned session.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={consultQuestion}
                onChange={(event) => setConsultQuestion(event.target.value)}
                rows={5}
                disabled={!selectedWatchdog}
              />
              <Button
                className="w-full"
                disabled={!selectedWatchdog || consultWatchdog.isPending || !consultQuestion.trim()}
                onClick={() => {
                  if (!selectedWatchdog) return;
                  consultWatchdog.mutate({
                    watchdogId: selectedWatchdog.id,
                    question: consultQuestion,
                  });
                }}
              >
                {consultWatchdog.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="mr-2 h-4 w-4" />
                )}
                Send Consult
              </Button>
              {!selectedWatchdog && (
                <p className="text-xs text-muted-foreground">
                  Assign a watchdog to this container before consulting it.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

export default OperationsPage;
