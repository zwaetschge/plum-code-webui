/**
 * The Schwarm tab's agent directory. It works without a Matrix login and
 * merges what the server can see for itself:
 *
 * - the hub's agent file (`agents.swarm.yaml`), the configuration the hub loads;
 * - the hub's /health (reachable, frozen, connected workers, budgets, failures);
 * - the real container state from Docker (admin only);
 * - lobby agent cards cached by the Matrix client, when the account is linked;
 * - Plum's own agents: enabled CLI providers, custom agents, subagent files;
 * - further agent containers on the host that are not swarm members.
 *
 * The hub stays the authority over tasks and rights; this only reports.
 */
import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import type {
  DockerContainerSummary,
  SwarmContainerState,
  SwarmDirectory,
  SwarmDirectoryAgent,
  SwarmHubState,
} from '@plum-code-webui/shared';
import { all, get } from '../../db/pg.js';
import { dockerHost } from '../docker/index.js';
import { getProviderStatuses } from '../cli-providers.js';
import { getEnabledCliProvidersForUser } from '../../routes/settings.js';
import { matrixStatus } from './matrix.js';

const AGENTS_FILE =
  process.env.PLUM_SWARM_AGENTS_FILE ??
  '/mnt/cache/AI/plum-code/bot-council/ops/matrix/agents.swarm.yaml';
const HEALTH_URL = process.env.PLUM_SWARM_HEALTH_URL ?? 'http://plum-swarm-coordinator:4700/health';
const HUB_CONTAINER = 'plum-swarm-coordinator';

/** Containers per hub agent; the first one is the agent itself, the rest are its helpers. */
const AGENT_CONTAINERS: Record<string, string[]> = {
  brian: ['hermes', 'brian-restarter', 'brian-ntfy', 'hermes-vocarium-relay'],
  trader: [
    'schwarm-trader',
    'hermes-trader',
    'trader-worker',
    'trader-api',
    'trader-mcp',
    'trader-admin',
  ],
  autoupdater: ['hermes-autoupdater'],
  unraid: ['unraid-control-plane'],
  git: ['schwarm-git'],
  sicherheit: ['schwarm-sicherheitswache'],
  'claude-code': ['schwarm-claude'],
  'codex-host': ['codex-bot'],
  betrieb: ['schwarm-betrieb'],
  plum: ['plum-bridge', 'schwarm-plum-relay'],
};
const OFF_BOX = new Set(['hermes-phone']);

/** Agent containers on the host that are not swarm members. */
const SERVICES: Array<{ container: string; name: string; description: string }> = [
  { container: 'hoerspiele-agent', name: 'Hörspiel-Agent', description: 'Erzeugt Hörspiele' },
  { container: 'roman-writer', name: 'Roman-Autor', description: 'Schreibt Romane und Kapitel' },
  { container: 'lora-fleet', name: 'LoRA-Flotte', description: 'Trainiert und verwaltet LoRAs' },
  {
    container: 'plumos-companion',
    name: 'PlumOS-Begleiter',
    description: 'Begleiter für PlumOS-Geräte',
  },
  { container: 'codex-remote', name: 'Codex Remote', description: 'Codex-Fernzugang' },
  { container: 'council-probe', name: 'Rat-Sonde', description: 'Prüft den Rat von aussen' },
  {
    container: 'plum-ha-status',
    name: 'Statuslicht',
    description: 'Zeigt Plum-Zustand in Home Assistant',
  },
  {
    container: 'traefik-tuersteher',
    name: 'Türsteher',
    description: 'Sperrt auffällige IPs an Traefik',
  },
  {
    container: 'schwarm-worker-relay',
    name: 'Worker-Relay',
    description: 'Leitet externe Worker zum Hub',
  },
  { container: 'repair-bot', name: 'Reparatur-Bot', description: 'Baut Plum neu und repariert es' },
];

const WATCH_MODES = new Set(['notify']);

interface HubHealth {
  ok?: boolean;
  frozen?: boolean;
  open_tasks?: number;
  problems?: string[];
  outbox?: { dead?: number };
  rooms?: Record<string, string>;
  betrieb?: {
    freigaben?: { pending?: number };
    fehlschlaege?: Array<{ task?: string; state?: string; grund?: string; at?: string }>;
    worker?: { verbunden?: string[]; offline?: string[] };
    kosten_heute_usd?: number;
    budget?: Array<{ agent?: string; heute?: number }>;
  };
}

async function hubHealth(): Promise<{ health: HubHealth | null; error?: string }> {
  try {
    // /health answers 503 while it reports problems; the body is still the report.
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(4000) });
    return { health: (await response.json()) as HubHealth };
  } catch (error) {
    return { health: null, error: error instanceof Error ? error.message : String(error) };
  }
}

interface HubAgentConfig {
  name?: string;
  level?: string;
  trust?: string;
  mode?: string;
  room?: string;
  runtime?: string;
  model?: string;
  skills?: unknown;
  accepts?: unknown;
  limits?: { parallel?: number; budget_usd_day?: number };
  puppets?: unknown;
}

async function hubAgents(): Promise<Record<string, HubAgentConfig>> {
  try {
    const doc = parse(await readFile(AGENTS_FILE, 'utf8')) as {
      agents?: Record<string, HubAgentConfig>;
    } | null;
    return doc?.agents ?? {};
  } catch {
    return {};
  }
}

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

function containerState(row: DockerContainerSummary): SwarmContainerState {
  return {
    name: row.name,
    state: row.state,
    status: row.status,
    running: row.state === 'running',
    health: row.health,
  };
}

/** Agent card status per agent id from the lobby state the Matrix client cached. */
async function cardStatuses(userId: string): Promise<Map<string, string>> {
  const rows: Array<{ state_json: string }> = await all(
    'SELECT state_json FROM assistant_matrix_rooms WHERE user_id = ?',
    userId
  ).catch(() => []);
  const out = new Map<string, string>();
  for (const row of rows) {
    let events: Array<{
      type?: string;
      sender?: string;
      state_key?: string;
      content?: Record<string, unknown>;
    }>;
    try {
      events = JSON.parse(row.state_json);
    } catch {
      continue;
    }
    for (const event of events) {
      if (event.type !== 'ch.zwaetschge.swarm.agent' || !event.sender?.startsWith('@schwarm:'))
        continue;
      const id = String(event.content?.id ?? event.state_key ?? '');
      if (id && typeof event.content?.status === 'string') out.set(id, event.content.status);
    }
  }
  return out;
}

async function subagentFiles(): Promise<
  Array<{ name: string; description: string; model?: string }>
> {
  const dir = path.join(os.homedir(), '.claude', 'agents');
  const files = await readdir(dir).catch(() => [] as string[]);
  const out = [];
  for (const file of files.filter((f) => f.endsWith('.md')).sort()) {
    const text = await readFile(path.join(dir, file), 'utf8').catch(() => '');
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    const field = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(front)?.[1]?.trim();
    const body =
      text
        .slice(text.indexOf('---', 3) + 3)
        .trim()
        .split('\n')[0] ?? '';
    const model = field('model');
    out.push({
      name: field('name') ?? file.replace(/\.md$/, ''),
      description: field('description') ?? body,
      ...(model && model !== 'inherit' ? { model } : {}),
    });
  }
  return out;
}

function hubAgentHealth(
  id: string,
  cfg: HubAgentConfig,
  hub: HubHealth | null,
  containers: SwarmContainerState[],
  docker: boolean,
  card: string | undefined
): Pick<SwarmDirectoryAgent, 'health' | 'healthReason' | 'worker'> {
  const own = containers[0];
  const connected = hub?.betrieb?.worker?.verbunden ?? [];
  const offline = hub?.betrieb?.worker?.offline ?? [];
  if (cfg.mode === 'worker') {
    const worker = connected.includes(id)
      ? 'connected'
      : offline.includes(id)
        ? 'offline'
        : undefined;
    if (worker === 'connected')
      return { health: 'online', healthReason: 'Am Hub verbunden', worker };
    if (OFF_BOX.has(id))
      return {
        health: 'offline',
        healthReason: 'Nicht verbunden; läuft ausserhalb des Servers',
        worker,
      };
    if (own && !own.running)
      return {
        health: 'stopped',
        healthReason: `Container ${own.name} gestoppt (${own.status})`,
        worker,
      };
    if (own)
      return {
        health: 'offline',
        healthReason: 'Container läuft, Worker aber nicht am Hub verbunden',
        worker,
      };
    if (!hub) return { health: 'unknown', healthReason: 'Hub nicht erreichbar', worker };
    return { health: 'offline', healthReason: 'Nicht am Hub verbunden', worker };
  }
  if (card === 'unresponsive')
    return { health: 'offline', healthReason: 'Reagiert nicht (Hub-Karte)' };
  if (own && !own.running)
    return { health: 'stopped', healthReason: `Container ${own.name} gestoppt (${own.status})` };
  if (cfg.mode === 'native') {
    if (own)
      return { health: 'online', healthReason: card ? `Läuft · Karte ${card}` : 'Container läuft' };
    return card === 'online'
      ? { health: 'online', healthReason: 'Online (Hub-Karte)' }
      : {
          health: 'unknown',
          healthReason: docker
            ? 'Kein Container gefunden'
            : 'Zustand nur mit Adminrechten sichtbar',
        };
  }
  if (cfg.mode === 'notify') {
    if (own) return { health: 'idle', healthReason: 'Bereit; meldet sich bei Ereignissen' };
    return hub
      ? { health: 'idle', healthReason: 'Läuft im Hub; meldet sich bei Ereignissen' }
      : { health: 'unknown', healthReason: 'Hub nicht erreichbar' };
  }
  // council and gateway live inside the hub.
  return hub
    ? { health: 'online', healthReason: 'Läuft im Hub' }
    : { health: 'unknown', healthReason: 'Hub nicht erreichbar' };
}

async function isAdmin(userId: string) {
  const row: { role?: string } | undefined = await get(
    'SELECT role FROM users WHERE id = ?',
    userId
  ).catch(() => undefined);
  return row?.role === 'admin';
}

/** Every container name the directory may start, stop or restart. */
export function directoryContainers(): Set<string> {
  return new Set([
    HUB_CONTAINER,
    ...Object.values(AGENT_CONTAINERS).flat(),
    ...SERVICES.map((s) => s.container),
  ]);
}

export async function swarmDirectory(userId: string): Promise<SwarmDirectory> {
  const admin = await isAdmin(userId);
  const [
    { health, error },
    configs,
    containerRows,
    matrix,
    cards,
    providers,
    enabled,
    custom,
    subagents,
  ] = await Promise.all([
    hubHealth(),
    hubAgents(),
    admin ? dockerHost.listContainers().catch(() => null) : Promise.resolve(null),
    matrixStatus(userId).catch(() => ({ connected: false })),
    cardStatuses(userId),
    getProviderStatuses().catch(
      () => ({}) as Record<string, { installed?: boolean; version?: string }>
    ),
    getEnabledCliProvidersForUser(userId).catch(() => [] as string[]),
    all(
      'SELECT id, name, description, model, enabled FROM custom_agents WHERE user_id = ? ORDER BY name',
      userId
    ).catch(() => []) as Promise<
      Array<{
        id: string;
        name: string;
        description: string | null;
        model: string | null;
        enabled: number;
      }>
    >,
    subagentFiles(),
  ]);
  const byName = new Map((containerRows ?? []).map((row) => [row.name, containerState(row)]));
  const docker = !!containerRows;
  const rooms = health?.rooms ?? {};
  const spent = new Map((health?.betrieb?.budget ?? []).map((b) => [b.agent, b.heute ?? 0]));

  const agents: SwarmDirectoryAgent[] = [];
  for (const [id, cfg] of Object.entries(configs)) {
    const containers = (AGENT_CONTAINERS[id] ?? []).flatMap((name) => byName.get(name) ?? []);
    const card = cards.get(id);
    agents.push({
      id: `hub:${id}`,
      name: cfg.name ?? id,
      group: WATCH_MODES.has(cfg.mode ?? '') ? 'watch' : 'swarm',
      kind: 'hub',
      mode: cfg.mode,
      level: cfg.level,
      trust: cfg.trust,
      runtime: cfg.runtime,
      model: cfg.model,
      skills: strings(cfg.skills),
      accepts: strings(cfg.accepts),
      parallel: cfg.limits?.parallel,
      budgetUsdDay: cfg.limits?.budget_usd_day,
      spentTodayUsd: spent.get(id),
      room: cfg.room ? { alias: cfg.room, id: rooms[cfg.room] } : undefined,
      cardStatus: card,
      offBox: OFF_BOX.has(id) || undefined,
      puppets: strings(cfg.puppets).length ? strings(cfg.puppets) : undefined,
      containers,
      ...hubAgentHealth(id, cfg, health, containers, docker, card),
    });
  }

  const installed = providers as Record<
    string,
    { installed?: boolean; version?: string } | undefined
  >;
  for (const provider of enabled) {
    const status = installed[provider];
    agents.push({
      id: `cli:${provider}`,
      name: provider,
      group: 'plum',
      kind: 'cli',
      description: status?.version ? `CLI ${status.version}` : 'CLI-Anbieter für Plum-Sitzungen',
      skills: ['sitzungen', 'werkzeuge', 'dateien'],
      accepts: [],
      health: status?.installed ? 'idle' : 'offline',
      healthReason: status?.installed ? 'Installiert; startet pro Sitzung' : 'Nicht installiert',
      containers: [],
    });
  }
  for (const agent of custom) {
    agents.push({
      id: `custom:${agent.id}`,
      name: agent.name,
      group: 'plum',
      kind: 'custom',
      description: agent.description ?? undefined,
      model: agent.model ?? undefined,
      skills: [],
      accepts: [],
      health: Number(agent.enabled) ? 'idle' : 'offline',
      healthReason: Number(agent.enabled)
        ? 'Eigener Agent; startet in einer Sitzung'
        : 'Deaktiviert',
      containers: [],
    });
  }
  for (const sub of subagents) {
    agents.push({
      id: `subagent:${sub.name}`,
      name: sub.name,
      group: 'plum',
      kind: 'subagent',
      description: sub.description,
      model: sub.model,
      skills: [],
      accepts: [],
      health: 'idle',
      healthReason: 'Subagent; wird von einer Sitzung gestartet',
      containers: [],
    });
  }

  if (docker) {
    for (const service of SERVICES) {
      const state = byName.get(service.container);
      if (!state) continue;
      agents.push({
        id: `service:${service.container}`,
        name: service.name,
        group: 'service',
        kind: 'service',
        description: service.description,
        runtime: service.container,
        skills: [],
        accepts: [],
        health: state.running ? 'online' : 'stopped',
        healthReason: state.running ? `Läuft (${state.status})` : `Gestoppt (${state.status})`,
        containers: [state],
      });
    }
  }

  // A worker whose container runs but never connects usually says why in its log.
  await Promise.all(
    agents
      .filter((a) => a.worker === 'offline' && a.containers[0]?.running)
      .map(async (a) => {
        const logs = await dockerHost.getContainerLogs(a.containers[0]!.name, 5).catch(() => null);
        const line = logs?.lines
          .at(-1)
          ?.replace(/^(?:\S+Z\s+)+/, '')
          .trim();
        if (line) a.lastLog = line.slice(0, 300);
      })
  );

  const hub: SwarmHubState = {
    reachable: !!health,
    ok: health?.ok === true,
    frozen: health?.frozen === true,
    problems: health?.problems ?? [],
    openTasks: health?.open_tasks ?? 0,
    approvalsPending: health?.betrieb?.freigaben?.pending ?? 0,
    outboxDead: health?.outbox?.dead ?? 0,
    costTodayUsd: health?.betrieb?.kosten_heute_usd ?? 0,
    failures: (health?.betrieb?.fehlschlaege ?? []).map((f) => ({
      task: String(f.task ?? ''),
      state: String(f.state ?? ''),
      reason: String(f.grund ?? ''),
      at: String(f.at ?? ''),
    })),
    container: byName.get(HUB_CONTAINER),
    ...(error ? { error } : {}),
  };
  return {
    hub,
    agents,
    matrixConnected: matrix.connected === true,
    containersVisible: docker,
    checkedAt: new Date().toISOString(),
  };
}
