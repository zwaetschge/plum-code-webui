/**
 * The Hermes area: every Schwarm agent of the directory, managed from Plum.
 *
 * Agents and their containers come from the Schwarm directory (the same list
 * the Schwarm view shows). Each agent gets one update path:
 *
 * - Brian runs the compose project `hermes-agent-compose`, whose
 *   `hermes-autoupdater` already updates safely (compose backup, new tag,
 *   recreate, gateway/channel smoke test, model probe, rollback). Plum starts
 *   that script's `once` run; the scheduled daily run honours a pause file.
 * - A Hermes gateway started by a script (the trader's `hermes-trader`) gets
 *   the new image pulled, its script's IMAGE line moved, the script rerun and
 *   the gateway checked; a gateway that does not answer rolls back.
 * - Every other agent is a compose project under the Plum projects; "Neu
 *   bauen" rebuilds it from its sources and recreates it.
 *
 * Plum talks to the Unraid host over the directory's SSH host (`unraid`).
 * Scripts are fixed here; the only inputs are container, project and file
 * names that the directory or Docker reported, each checked against a strict
 * pattern before it reaches a shell.
 */
import { spawn } from 'node:child_process';
import type {
  HermesAgent,
  HermesAgentContainer,
  HermesInstance,
  HermesPlatformState,
  HermesStatus,
  SwarmDirectoryAgent,
} from '@plum-code-webui/shared';
import { AppError } from '../../middleware/errorHandler.js';
import { hostConfig } from '../assistant/swarmContainers.js';
import { swarmDirectory } from '../assistant/swarmDirectory.js';

const COMPOSE_DIR = '/mnt/user/appdata/hermes-agent-compose';
const LOG_DIR = `${COMPOSE_DIR}/logs`;
const UPDATER = 'hermes-autoupdater';
const BRIAN = 'hermes';
const IMAGE_REPO = 'nousresearch/hermes-agent';
const TAGS_URL = `https://registry.hub.docker.com/v2/repositories/${IMAGE_REPO}/tags?page_size=100`;

/** Hermes gateways that a script (not compose) creates, by container name. */
const START_SCRIPTS: Record<string, string> = {
  'hermes-trader': '/mnt/user/appdata/hermes-trader/start.sh',
};

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const SAFE_PATH = /^\/mnt\/[A-Za-z0-9_./-]+\.ya?ml$/;
const SAFE_TAG = /^v\d+(\.\d+){2,3}$/;

let latestCache: { tag: string | null; at: number } | null = null;
let statusCache: { value: HermesStatus; at: number } | null = null;

/** Runs a fixed bash script as root on the Unraid host. */
async function unraidShell(script: string, timeoutMs = 60_000): Promise<string> {
  const config = await hostConfig(new Set());
  const host = config.hosts.find((entry) => entry.id === 'unraid');
  if (!host?.ssh) {
    throw new AppError('Kein Unraid-Host für Hermes konfiguriert.', 503, 'HERMES_HOST_MISSING');
  }
  const ssh = host.ssh;
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ssh',
      [
        '-i',
        ssh.identityFile,
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=5',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        `UserKnownHostsFile=${ssh.knownHostsFile}`,
        ssh.target,
        'bash -s',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else
        reject(
          new AppError(
            `Unraid antwortet nicht wie erwartet (${code ?? 'Abbruch'}): ${err.trim().slice(-200)}`,
            502,
            'HERMES_HOST_FAILED'
          )
        );
    });
    child.stdin.end(script);
  });
}

/**
 * Newest release tag. Hermes switched from date tags (v2026.9.24) to semver
 * (v0.22.7) in October, and a version sort ranks the old scheme higher, so
 * date tags are left out; release candidates and desktop builds never match.
 */
export function pickLatestTag(names: string[]): string | null {
  const tags = names
    .filter((name) => /^v\d+\.\d+\.\d+(\.\d+)?$/.test(name))
    .filter((name) => !/^v20\d\d\./.test(name));
  tags.sort((a, b) => {
    const pa = a.slice(1).split('.').map(Number);
    const pb = b.slice(1).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff) return diff;
    }
    return 0;
  });
  return tags.at(-1) ?? null;
}

async function latestTag(): Promise<string | null> {
  if (latestCache && Date.now() - latestCache.at < 30 * 60_000) return latestCache.tag;
  let tag: string | null = null;
  try {
    const response = await fetch(TAGS_URL, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const body = (await response.json()) as { results?: Array<{ name?: string }> };
      tag = pickLatestTag((body.results ?? []).map((entry) => String(entry.name ?? '')));
    }
  } catch {
    tag = null;
  }
  // A failed lookup is retried after a minute, not after half an hour.
  latestCache = { tag, at: tag ? Date.now() : Date.now() - 29 * 60_000 };
  return tag;
}

export function parsePlatforms(raw: string): {
  platforms: HermesPlatformState[];
  active: number | null;
} {
  try {
    const state = JSON.parse(raw) as {
      active_agents?: number;
      platforms?: Record<
        string,
        { state?: string; needs_attention?: boolean; error_message?: string | null }
      >;
    };
    const platforms = Object.entries(state.platforms ?? {}).map(([id, entry]) => ({
      id,
      state: String(entry.state ?? 'unknown'),
      needsAttention: entry.needs_attention === true,
      error: entry.error_message ?? null,
    }));
    return {
      platforms,
      active: typeof state.active_agents === 'number' ? state.active_agents : null,
    };
  } catch {
    return { platforms: [], active: null };
  }
}

/** Splits `@@name` / `@@name:key` delimited output into its sections. */
export function sections(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  let current = '';
  for (const line of output.split('\n')) {
    const marker = /^@@([a-z]+(?::[A-Za-z0-9_.-]+)?)$/.exec(line);
    if (marker) {
      current = marker[1]!;
      result[current] = '';
    } else if (current) {
      result[current] += (result[current] ? '\n' : '') + line;
    }
  }
  for (const key of Object.keys(result)) result[key] = result[key]!.replace(/\n+$/, '');
  return result;
}

interface Inspected {
  image: string;
  startedAt: string | null;
  project: string | null;
  configFile: string | null;
  service: string | null;
}

/** `name|image|startedAt|project|configFiles|service` lines of `docker inspect`. */
export function parseInspect(raw: string): Map<string, Inspected> {
  const rows = new Map<string, Inspected>();
  for (const line of raw.split('\n')) {
    const [name, image, startedAt, project, files, service] = line.split('|');
    if (!name || !image) continue;
    rows.set(name.replace(/^\//, ''), {
      image: image.replace(/@sha256:[0-9a-f]+$/, ''),
      startedAt: startedAt || null,
      project: project || null,
      configFile: files?.split(',')[0] || null,
      service: service || null,
    });
  }
  return rows;
}

const tagOf = (image: string) =>
  image.includes(':') ? image.slice(image.lastIndexOf(':') + 1) : null;

/**
 * The rebuild a compose agent gets: only its own service, since several agents
 * share a project (the autoupdater sits next to Brian, the probe in bot-council).
 * Null when Docker reported no usable host path.
 */
export function rebuildTarget(
  inspected: Inspected | undefined
): { project: string; file: string; service: string } | null {
  if (!inspected?.project || !inspected.configFile || !inspected.service) return null;
  if (!SAFE_NAME.test(inspected.project) || !SAFE_NAME.test(inspected.service)) return null;
  if (!SAFE_PATH.test(inspected.configFile) || inspected.configFile.includes('..')) return null;
  return { project: inspected.project, file: inspected.configFile, service: inspected.service };
}

function probeScript(names: string[], agentIds: string[]): string {
  return [
    `cd ${LOG_DIR} || exit 0`,
    'echo @@paused; cat ../hermes-autoupdate.paused 2>/dev/null',
    'echo @@brianlock; test -d ../hermes-autoupdate.lock && echo yes',
    `echo @@inspect; docker inspect --format '{{.Name}}|{{.Config.Image}}|{{.State.StartedAt}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.service"}}' ${names.join(' ')} 2>/dev/null`,
    `for c in ${names.join(' ')}; do`,
    `  case "$(docker inspect --format '{{.Config.Image}}' "$c" 2>/dev/null)" in ${IMAGE_REPO}:*)`,
    '    echo "@@version:$c"; docker exec "$c" /opt/hermes/bin/hermes --version 2>/dev/null | head -n 1',
    '    echo "@@state:$c"; docker exec "$c" cat /opt/data/gateway_state.json 2>/dev/null; echo ;;',
    '  esac',
    'done',
    `for a in ${agentIds.join(' ')}; do`,
    '  echo "@@log:$a"; tail -n 40 "plum-$a.log" 2>/dev/null',
    '  echo "@@running:$a"; test -e "plum-$a.running" && echo yes',
    'done',
    'true',
  ].join('\n');
}

function container(
  row: SwarmDirectoryAgent['containers'][number],
  inspected: Inspected | undefined
): HermesAgentContainer {
  return {
    name: row.name,
    host: row.host ?? null,
    running: row.running,
    state: row.state,
    status: row.status,
    health: row.health,
    image: inspected?.image ?? null,
    actions: row.actions ?? [],
  };
}

export async function hermesStatus(userId: string, fresh = false): Promise<HermesStatus> {
  if (!fresh && statusCache && Date.now() - statusCache.at < 15_000) return statusCache.value;
  const directory = await swarmDirectory(userId);
  const hubAgents = directory.agents.filter((agent) => agent.kind === 'hub');
  const agentIds = hubAgents
    .map((agent) => agent.id.replace(/^hub:/, ''))
    .filter((id) => SAFE_NAME.test(id));
  const names = [
    ...new Set(
      hubAgents
        .flatMap((agent) => agent.containers)
        .filter((row) => row.host === 'unraid')
        .map((row) => row.name)
        .filter((name) => SAFE_NAME.test(name))
    ),
  ];
  const [probe, latest] = await Promise.all([
    unraidShell(probeScript(names, agentIds)).catch(() => ''),
    latestTag(),
  ]);
  const parts = sections(probe);
  const inspected = parseInspect(parts.inspect ?? '');
  const brianBusy = (parts.brianlock ?? '').trim() === 'yes';

  const agents: HermesAgent[] = hubAgents.map((agent) => {
    const id = agent.id.replace(/^hub:/, '');
    const containers = agent.containers.map((row) => container(row, inspected.get(row.name)));
    const gateway = containers.find((row) => row.image?.startsWith(`${IMAGE_REPO}:`));
    let hermes: HermesInstance | null = null;
    if (gateway) {
      const details = inspected.get(gateway.name);
      const state = parsePlatforms(parts[`state:${gateway.name}`] ?? '');
      hermes = {
        id: gateway.name,
        label: agent.name,
        managed: gateway.name === BRIAN || gateway.name in START_SCRIPTS,
        running: gateway.running,
        health: gateway.health && gateway.health !== 'unknown' ? gateway.health : null,
        startedAt: details?.startedAt ?? null,
        tag: gateway.image ? tagOf(gateway.image) : null,
        version: parts[`version:${gateway.name}`]?.split('\n')[0]?.trim() || null,
        platforms: state.platforms,
        activeAgents: state.active,
      };
    }
    const log = (parts[`log:${id}`] ?? '').split('\n').filter((line) => line.trim().length > 0);
    const running = (parts[`running:${id}`] ?? '').trim() === 'yes';
    let update: HermesAgent['update'] = null;
    if (hermes?.managed) {
      update = {
        kind: 'hermes',
        target: latest,
        available: Boolean(latest && hermes.tag && latest !== hermes.tag),
        running: hermes.id === BRIAN ? brianBusy : running,
        log,
      };
    } else if (containers[0] && rebuildTarget(inspected.get(containers[0].name))) {
      update = { kind: 'rebuild', target: null, available: true, running, log };
    }
    return {
      id,
      name: agent.name,
      group: agent.group,
      health: agent.health,
      description: agent.description ?? null,
      containers,
      hermes,
      update,
    };
  });

  const brian = agents.find((agent) => agent.hermes?.id === BRIAN);
  const reason = parts.paused?.trim() ?? '';
  const value: HermesStatus = {
    agents,
    latestTag: latest,
    autoUpdate: { paused: reason.length > 0, reason: reason || null },
    checkedAt: new Date().toISOString(),
    instances: agents.flatMap((agent) => (agent.hermes ? [agent.hermes] : [])),
    updateAvailable: brian?.update?.available ?? false,
    update: { running: brian?.update?.running ?? false, log: brian?.update?.log ?? [] },
  };
  statusCache = { value, at: Date.now() };
  return value;
}

/** Background job on the host: log and a running marker per agent. */
function job(agentId: string, body: string[]): string {
  const log = `${LOG_DIR}/plum-${agentId}.log`;
  const marker = `${LOG_DIR}/plum-${agentId}.running`;
  return [
    `touch ${marker}`,
    `setsid nohup bash -c '`,
    `trap "rm -f ${marker}" EXIT`,
    'stamp() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }',
    ...body,
    `' > ${log} 2>&1 < /dev/null &`,
    'echo started',
  ].join('\n');
}

/** Moves a script-started Hermes gateway to `tag`; rolls back if it does not answer. */
export function hermesScriptJob(
  agentId: string,
  containerName: string,
  script: string,
  tag: string
): string {
  const dir = script.slice(0, script.lastIndexOf('/'));
  const file = script.slice(script.lastIndexOf('/') + 1);
  return job(agentId, [
    'set -u',
    `cd ${dir} || exit 1`,
    `old=$(sed -n "s#^IMAGE=\\"${IMAGE_REPO}:\\(.*\\)\\"\\$#\\1#p" ${file})`,
    `stamp "${containerName}: Hermes $old -> ${tag}"`,
    `if [ "$old" = "${tag}" ]; then stamp "läuft bereits auf ${tag}"; exit 0; fi`,
    `docker pull ${IMAGE_REPO}:${tag} || { stamp "Image nicht ladbar, nichts geändert"; exit 1; }`,
    `backup=${file}.bak-plum-$(date -u +%Y%m%dT%H%M%SZ)`,
    `cp -p ${file} "$backup"`,
    `sed -i "s#^IMAGE=\\"${IMAGE_REPO}:.*\\"\\$#IMAGE=\\"${IMAGE_REPO}:${tag}\\"#" ${file}`,
    `ok=""`,
    `if bash ${file}; then`,
    '  for i in $(seq 1 24); do sleep 5;',
    `    if docker exec ${containerName} /opt/hermes/bin/hermes gateway status >/dev/null 2>&1; then ok=1; break; fi`,
    '  done',
    'fi',
    'if [ -z "$ok" ]; then',
    `  stamp "Gateway antwortet nicht, Rückfall auf $old"`,
    `  cp -p "$backup" ${file}; bash ${file}`,
    '  exit 1',
    'fi',
    `stamp "$(docker exec ${containerName} /opt/hermes/bin/hermes --version 2>/dev/null | head -n 1)"`,
    'stamp "Update fertig, Gateway antwortet"',
  ]);
}

/** Rebuilds one compose service from its sources and recreates only that container. */
export function rebuildJob(
  agentId: string,
  target: { project: string; file: string; service: string }
): string {
  return job(agentId, [
    'set -u',
    `stamp "Neu bauen: ${target.service} (${target.project})"`,
    `if docker compose -p ${target.project} -f ${target.file} up -d --build --force-recreate --no-deps ${target.service}; then`,
    '  stamp "fertig"',
    'else',
    '  stamp "fehlgeschlagen, die bisherigen Container laufen weiter, sofern das Bauen scheiterte"',
    '  exit 1',
    'fi',
  ]);
}

export async function startAgentUpdate(userId: string, agentId: string): Promise<HermesStatus> {
  const status = await hermesStatus(userId, true);
  const agent = status.agents.find((entry) => entry.id === agentId);
  if (!agent || !agent.update) {
    throw new AppError('Für diesen Agenten gibt es kein Update.', 404, 'HERMES_NO_UPDATE');
  }
  if (agent.update.running) {
    throw new AppError(
      'Für diesen Agenten läuft bereits ein Update.',
      409,
      'HERMES_UPDATE_RUNNING'
    );
  }
  if (agent.update.kind === 'hermes') {
    const tag = status.latestTag;
    if (!tag || !SAFE_TAG.test(tag)) {
      throw new AppError(
        'Die neueste Hermes-Version ist nicht bekannt.',
        503,
        'HERMES_TAG_UNKNOWN'
      );
    }
    if (agent.hermes?.id === BRIAN) {
      await unraidShell(
        `docker exec -d ${UPDATER} sh -c 'sh ${COMPOSE_DIR}/hermes-autoupdate.sh once > ${LOG_DIR}/plum-${agent.id}.log 2>&1'`
      );
    } else {
      const name = agent.hermes!.id;
      const script = START_SCRIPTS[name];
      if (!script)
        throw new AppError('Kein Startskript für diesen Hermes.', 404, 'HERMES_NO_UPDATE');
      await unraidShell(hermesScriptJob(agent.id, name, script, tag));
    }
  } else {
    const directory = await unraidShell(
      `docker inspect --format '{{.Name}}|{{.Config.Image}}|{{.State.StartedAt}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.service"}}' ${agent.containers[0]!.name}`
    );
    const target = rebuildTarget(parseInspect(directory).get(agent.containers[0]!.name));
    if (!target) throw new AppError('Kein Compose-Projekt gefunden.', 404, 'HERMES_NO_UPDATE');
    await unraidShell(rebuildJob(agent.id, target));
  }
  statusCache = null;
  return hermesStatus(userId, true);
}

export async function setHermesAutoUpdatePaused(
  userId: string,
  paused: boolean
): Promise<HermesStatus> {
  const file = `${COMPOSE_DIR}/hermes-autoupdate.paused`;
  await unraidShell(
    paused
      ? `printf '%s\\n' "Automatische Hermes-Updates in Plum pausiert am $(date -u +%Y-%m-%d)." > ${file} && chown 1000:1000 ${file}`
      : `rm -f ${file}`
  );
  statusCache = null;
  return hermesStatus(userId, true);
}
