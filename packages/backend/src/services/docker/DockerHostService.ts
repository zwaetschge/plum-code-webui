import { execFile } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import type {
  DockerContainerDetail,
  DockerContainerLogs,
  DockerContainerStats,
  DockerContainerSummary,
  DockerHealthState,
  DockerIntegrationStatus,
  DockerMountSummary,
  DockerPortBinding,
} from '@plum-code-webui/shared';

const execFileAsync = promisify(execFile);

const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const DOCKER_HOST = process.env.DOCKER_HOST?.trim() || null;
const DOCKER_TIMEOUT_MS = Number(process.env.DOCKER_INTEGRATION_TIMEOUT_MS || 12_000);
const DOCKER_MAX_BUFFER = 4 * 1024 * 1024;
const LOG_MAX_BUFFER = 512 * 1024;
const SECRET_KEY_RE = /(token|secret|password|passwd|api[_-]?key|authorization|cookie|session)/i;
const DOCKER_PS_FORMAT = [
  '{{.ID}}',
  '{{.Names}}',
  '{{.Image}}',
  '{{.Status}}',
  '{{.State}}',
  '{{.RunningFor}}',
  '{{.CreatedAt}}',
  '{{.Ports}}',
  '{{.Networks}}',
  '{{.Mounts}}',
  '{{.Labels}}',
  '{{.Command}}',
].join('\t');

export type DockerCommandRunner = (
  args: string[],
  opts?: { maxBuffer?: number; timeout?: number }
) => Promise<{ stdout: string; stderr: string }>;

interface DockerHostServiceOptions {
  runner?: DockerCommandRunner;
}

interface DockerPsTemplateRow {
  ID: string;
  Names: string;
  Image: string;
  Status: string;
  State: string;
  RunningFor: string;
  CreatedAt: string;
  Ports: string;
  Networks: string;
  Mounts: string;
  Labels: string;
  Command: string;
}

function integrationEnabled(): boolean {
  const raw = (process.env.DOCKER_INTEGRATION_ENABLED || 'auto').trim().toLowerCase();
  return !['0', 'false', 'no', 'off', 'disabled'].includes(raw);
}

function normalizeHealth(status: string | undefined): DockerHealthState {
  const value = (status || '').toLowerCase();
  if (value.includes('healthy') && !value.includes('unhealthy')) return 'healthy';
  if (value.includes('unhealthy')) return 'unhealthy';
  if (value.includes('starting')) return 'starting';
  if (!value || value === 'none') return 'none';
  return 'unknown';
}

function parseLabels(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'string') return {};
  const result: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key && !SECRET_KEY_RE.test(key)) result[key] = redactText(value);
  }
  return result;
}

function redactText(input: string): string {
  return input
    .replace(
      /\b(authorization|token|secret|password|passwd|api[_-]?key|cookie|session)\b\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/gi,
      '$1=[redacted]'
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@/g, '[redacted]@');
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parsePorts(raw: unknown): DockerPortBinding[] {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((entry) => ({ raw: entry }));
}

function parseNetworks(raw: unknown): string[] {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function parseMountList(raw: unknown): DockerMountSummary[] {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((source) => ({ source }));
}

function parseJsonLines<T>(stdout: string): T[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function parseDockerPsTemplateLines(stdout: string): DockerPsTemplateRow[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        ID = '',
        Names = '',
        Image = '',
        Status = '',
        State = '',
        RunningFor = '',
        CreatedAt = '',
        Ports = '',
        Networks = '',
        Mounts = '',
        Labels = '',
        ...commandParts
      ] = line.split('\t');
      return {
        ID,
        Names,
        Image,
        Status,
        State,
        RunningFor,
        CreatedAt,
        Ports,
        Networks,
        Mounts,
        Labels,
        Command: commandParts.join('\t'),
      };
    });
}

function parseSizeToBytes(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^([\d.]+)\s*([kmgt]?i?b|b)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] || 'b').toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
  };
  return Math.round(amount * (multipliers[unit] || 1));
}

function parseMemoryUsage(memoryUsageText: string | undefined): {
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
} {
  if (!memoryUsageText) return { memoryBytes: null, memoryLimitBytes: null };
  const [used, limit] = memoryUsageText.split('/').map((part) => part.trim());
  return {
    memoryBytes: parseSizeToBytes(used),
    memoryLimitBytes: parseSizeToBytes(limit),
  };
}

function normalizeInspectMounts(mounts: unknown): DockerMountSummary[] {
  if (!Array.isArray(mounts)) return [];
  return mounts.slice(0, 60).map((mount) => {
    const record = mount && typeof mount === 'object' ? (mount as Record<string, unknown>) : {};
    return {
      type: safeString(record.Type) || undefined,
      source: safeString(record.Source) || undefined,
      destination: safeString(record.Destination) || undefined,
      mode: safeString(record.Mode) || undefined,
      rw: typeof record.RW === 'boolean' ? record.RW : undefined,
    };
  });
}

function findAppdataCandidates(mounts: DockerMountSummary[]): string[] {
  const candidates = new Set<string>();
  for (const mount of mounts) {
    const source = mount.source || '';
    if (/\/appdata(\/|$)/i.test(source) || /\/mnt\/(cache|user)\//i.test(source)) {
      candidates.add(source);
    }
  }
  return Array.from(candidates).slice(0, 12);
}

function normalizeInspectContainer(raw: Record<string, unknown>): DockerContainerDetail {
  const state = (
    raw.State && typeof raw.State === 'object' ? (raw.State as Record<string, unknown>) : {}
  ) as Record<string, unknown>;
  const config = (
    raw.Config && typeof raw.Config === 'object' ? (raw.Config as Record<string, unknown>) : {}
  ) as Record<string, unknown>;
  const hostConfig = (
    raw.HostConfig && typeof raw.HostConfig === 'object'
      ? (raw.HostConfig as Record<string, unknown>)
      : {}
  ) as Record<string, unknown>;
  const restartPolicy =
    hostConfig.RestartPolicy && typeof hostConfig.RestartPolicy === 'object'
      ? (hostConfig.RestartPolicy as Record<string, unknown>)
      : {};
  const networkSettings =
    raw.NetworkSettings && typeof raw.NetworkSettings === 'object'
      ? (raw.NetworkSettings as Record<string, unknown>)
      : {};
  const networksObj =
    networkSettings.Networks && typeof networkSettings.Networks === 'object'
      ? (networkSettings.Networks as Record<string, unknown>)
      : {};
  const labels =
    config.Labels && typeof config.Labels === 'object'
      ? Object.fromEntries(
          Object.entries(config.Labels as Record<string, unknown>)
            .filter(([key]) => !SECRET_KEY_RE.test(key))
            .map(([key, value]) => [key, redactText(String(value ?? ''))])
        )
      : {};
  const mounts = normalizeInspectMounts(raw.Mounts);
  const id = String(raw.Id || '');
  const name = String(raw.Name || '').replace(/^\//, '') || id.slice(0, 12);
  const status = String(state.Status || 'unknown');
  const healthObj =
    state.Health && typeof state.Health === 'object'
      ? (state.Health as Record<string, unknown>)
      : {};

  return {
    id,
    shortId: id.slice(0, 12),
    name,
    image: String(config.Image || raw.Image || ''),
    imageId: safeString(raw.Image),
    command: Array.isArray(config.Cmd) ? config.Cmd.join(' ') : safeString(config.Cmd),
    state: status,
    status,
    health: normalizeHealth(safeString(healthObj.Status) || status),
    createdAt: safeString(raw.Created),
    runningFor: null,
    ports: [],
    networks: Object.keys(networksObj).sort(),
    mounts,
    composeProject: labels['com.docker.compose.project'] || null,
    composeService: labels['com.docker.compose.service'] || null,
    startedAt: safeString(state.StartedAt),
    finishedAt: safeString(state.FinishedAt),
    restartCount: typeof raw.RestartCount === 'number' ? raw.RestartCount : 0,
    restartPolicy: safeString(restartPolicy.Name),
    labels,
    appdataCandidates: findAppdataCandidates(mounts),
  };
}

export class DockerHostService {
  private readonly runner: DockerCommandRunner;

  constructor(options: DockerHostServiceOptions = {}) {
    this.runner =
      options.runner ||
      (async (args, opts = {}) => {
        const result = await execFileAsync('docker', args, {
          timeout: opts.timeout ?? DOCKER_TIMEOUT_MS,
          maxBuffer: opts.maxBuffer ?? DOCKER_MAX_BUFFER,
          env: process.env,
        });
        return {
          stdout: String(result.stdout || ''),
          stderr: String(result.stderr || ''),
        };
      });
  }

  private async docker(args: string[], opts: { maxBuffer?: number; timeout?: number } = {}) {
    if (!integrationEnabled()) {
      throw new Error('Docker integration is disabled');
    }
    return this.runner(args, opts);
  }

  async status(): Promise<DockerIntegrationStatus> {
    const enabled = integrationEnabled();
    if (!enabled) {
      return {
        enabled,
        available: false,
        serverVersion: null,
        socketPath: DOCKER_SOCKET_PATH,
        error: 'Docker integration is disabled',
      };
    }
    if (!DOCKER_HOST && !fs.existsSync(DOCKER_SOCKET_PATH)) {
      return {
        enabled,
        available: false,
        serverVersion: null,
        socketPath: DOCKER_SOCKET_PATH,
        error: `Docker socket not found at ${DOCKER_SOCKET_PATH}`,
      };
    }
    try {
      const { stdout } = await this.docker(['version', '--format', '{{.Server.Version}}']);
      return {
        enabled,
        available: true,
        serverVersion: stdout.trim() || null,
        socketPath: DOCKER_SOCKET_PATH,
        error: null,
      };
    } catch (err) {
      return {
        enabled,
        available: false,
        serverVersion: null,
        socketPath: DOCKER_SOCKET_PATH,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listContainers(): Promise<DockerContainerSummary[]> {
    const { stdout } = await this.docker([
      'ps',
      '--all',
      '--no-trunc',
      '--format',
      DOCKER_PS_FORMAT,
    ]);
    return parseDockerPsTemplateLines(stdout)
      .map((row) => {
        const labels = parseLabels(row.Labels);
        const id = String(row.ID || '');
        const status = String(row.Status || '');
        return {
          id,
          shortId: id.slice(0, 12),
          name: String(row.Names || id.slice(0, 12)),
          image: String(row.Image || ''),
          imageId: null,
          command: safeString(row.Command),
          state: String(row.State || 'unknown'),
          status,
          health: normalizeHealth(status),
          createdAt: safeString(row.CreatedAt),
          runningFor: safeString(row.RunningFor),
          ports: parsePorts(row.Ports),
          networks: parseNetworks(row.Networks),
          mounts: parseMountList(row.Mounts),
          composeProject: labels['com.docker.compose.project'] || null,
          composeService: labels['com.docker.compose.service'] || null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async inspectContainer(containerId: string): Promise<DockerContainerDetail> {
    const { stdout } = await this.docker(['inspect', containerId]);
    const parsed = JSON.parse(stdout) as Record<string, unknown>[];
    const first = parsed[0];
    if (!first) throw new Error('Container not found');
    return normalizeInspectContainer(first);
  }

  async getContainerStats(containerId: string): Promise<DockerContainerStats> {
    const { stdout } = await this.docker([
      'stats',
      containerId,
      '--no-stream',
      '--format',
      '{{json .}}',
    ]);
    const row = parseJsonLines<Record<string, unknown>>(stdout)[0] || {};
    return {
      containerId,
      name: String(row.Name || containerId),
      cpuPercentText: safeString(row.CPUPerc) || undefined,
      memoryUsageText: safeString(row.MemUsage) || undefined,
      memoryPercentText: safeString(row.MemPerc) || undefined,
      networkIoText: safeString(row.NetIO) || undefined,
      blockIoText: safeString(row.BlockIO) || undefined,
      pids: safeString(row.PIDs) || undefined,
      sampledAt: new Date().toISOString(),
    };
  }

  /** Start, stop or restart one container; callers decide which names are allowed. */
  async containerAction(containerId: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
    await this.docker([action, containerId], { timeout: 90_000 });
  }

  async getContainerLogs(containerId: string, tail = 120): Promise<DockerContainerLogs> {
    const boundedTail = Math.max(1, Math.min(500, Math.floor(tail)));
    const { stdout, stderr } = await this.docker(
      ['logs', '--timestamps', '--tail', String(boundedTail), containerId],
      { maxBuffer: LOG_MAX_BUFFER, timeout: 10_000 }
    );
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    const lines = combined
      .split(/\r?\n/)
      .map((line) => redactText(line).slice(0, 2000))
      .filter(Boolean);
    return {
      containerId,
      tail: boundedTail,
      lines: lines.slice(-boundedTail),
      truncated: lines.length > boundedTail,
      capturedAt: new Date().toISOString(),
    };
  }

  parseStatsNumbers(stats: DockerContainerStats): {
    cpuPercent: number | null;
    memoryBytes: number | null;
    memoryLimitBytes: number | null;
  } {
    const cpuPercent =
      stats.cpuPercentText && stats.cpuPercentText.endsWith('%')
        ? Number(stats.cpuPercentText.replace('%', ''))
        : null;
    const memory = parseMemoryUsage(stats.memoryUsageText);
    return {
      cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : null,
      ...memory,
    };
  }
}

export const dockerHost = new DockerHostService();
