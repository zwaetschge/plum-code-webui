/** Host-bound Docker access for the existing admin-only Schwarm directory. */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { DockerContainerSummary, SwarmContainerState } from '@plum-code-webui/shared';
import { DockerHostService, dockerHost } from '../docker/index.js';
import type { DockerCommandRunner } from '../docker/DockerHostService.js';
import { AppError } from '../../middleware/errorHandler.js';

const execFileAsync = promisify(execFile);
const CONFIG_FILE = process.env.PLUM_SWARM_HOSTS_FILE ??
  '/mnt/cache/AI/plum-code/bot-council/ops/matrix/plum-swarm-hosts.json';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const schema = z.object({
  hosts: z.array(z.object({
    id, label: z.string().min(1).max(80),
    ssh: z.object({
      target: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*$/),
      identityFile: z.string().startsWith('/'),
      knownHostsFile: z.string().startsWith('/'),
    }).optional(),
  })).min(1).max(8),
  containers: z.array(z.object({
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
    host: id,
    sessionId: id.optional(),
    actions: z.array(z.enum(['start', 'stop', 'restart'])).default([]),
  })).max(200),
});
export type DirectoryHostConfig = z.infer<typeof schema>;
type Binding = DirectoryHostConfig['containers'][number];
type Row = DockerContainerSummary & Pick<SwarmContainerState,
  'host' | 'hostLabel' | 'ownerSessionId' | 'actions'>;

export function parseHostConfig(input: unknown): DirectoryHostConfig {
  const value = schema.parse(input);
  const hosts = new Set(value.hosts.map((host) => host.id));
  if (hosts.size !== value.hosts.length) throw new Error('Doppelte Hostkennung');
  // Current agent cards refer to a unique container name. Never pick a host by accident.
  const names = new Set<string>();
  for (const binding of value.containers) {
    if (!hosts.has(binding.host) || names.has(binding.name)) throw new Error('Mehrdeutige Hostzuordnung');
    names.add(binding.name);
  }
  return value;
}

export async function hostConfig(names: Set<string>): Promise<DirectoryHostConfig> {
  let text: string;
  try { text = await readFile(CONFIG_FILE, 'utf8'); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // Existing single-host installations retain their original contract.
    return { hosts: [{ id: 'local', label: 'Lokal' }], containers: [...names].map((name) => ({
      name, host: 'local', actions: name === 'plum-swarm-coordinator' ? ['start', 'restart'] : ['start', 'stop', 'restart'],
    })) };
  }
  return parseHostConfig(JSON.parse(text));
}

const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/** All remote arguments remain one explicitly quoted command; never a caller-supplied shell. */
export function remoteRunner(host: NonNullable<DirectoryHostConfig['hosts'][number]['ssh']>,
  execute: typeof execFileAsync = execFileAsync): DockerCommandRunner {
  return async (args, opts = {}) => {
    const result = await execute('ssh', [
      '-i', host.identityFile, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${host.knownHostsFile}`,
      host.target, 'docker ' + args.map(quote).join(' '),
    ], { timeout: opts.timeout ?? 12_000, maxBuffer: opts.maxBuffer ?? 4 * 1024 * 1024 });
    return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
  };
}

export function hostClient(config: DirectoryHostConfig, hostId: string): DockerHostService {
  const host = config.hosts.find((h) => h.id === hostId);
  if (!host) throw new AppError('Host nicht gefunden', 404, 'NOT_FOUND');
  return host.ssh ? new DockerHostService({ runner: remoteRunner(host.ssh) }) : dockerHost;
}

export function resolveBinding(config: DirectoryHostConfig, names: Set<string>, name: string, host?: string): Binding {
  const binding = config.containers.find((c) => c.name === name && (!host || c.host === host));
  if (!names.has(name) || !binding) {
    throw new AppError('Komponente auf diesem Host nicht freigegeben', 404, 'NOT_FOUND');
  }
  return binding;
}

export function assertAction(binding: Binding, action: 'start' | 'stop' | 'restart') {
  if (!binding.actions.includes(action) || (binding.name === 'plum-swarm-coordinator' && action === 'stop')) {
    throw new AppError('Betriebsaktion für diese Komponente nicht freigegeben', 403, 'FORBIDDEN');
  }
}

export async function directorySnapshot(names: Set<string>): Promise<{ rows: Row[]; errors: string[] }> {
  const config = await hostConfig(names);
  const results = await Promise.all(config.hosts.map(async (host) => {
    try {
      const rows = await hostClient(config, host.id).listContainers();
      return { rows: rows.flatMap((row): Row[] => {
        const binding = config.containers.find((c) => c.host === host.id && c.name === row.name && names.has(c.name));
        return binding ? [{ ...row, host: host.id, hostLabel: host.label,
          ownerSessionId: binding.sessionId, actions: binding.actions }] : [];
      }), errors: [] as string[] };
    } catch { return { rows: [] as Row[], errors: [`${host.label}: Container-Zustand nicht erreichbar`] }; }
  }));
  return { rows: results.flatMap((r) => r.rows), errors: results.flatMap((r) => r.errors) };
}

export async function directoryLogs(names: Set<string>, name: string, host?: string, tail = 60) {
  const config = await hostConfig(names);
  const binding = resolveBinding(config, names, name, host);
  return hostClient(config, binding.host).getContainerLogs(name, tail);
}

export async function directoryAction(names: Set<string>, name: string, action: 'start' | 'stop' | 'restart', host?: string) {
  const config = await hostConfig(names);
  const binding = resolveBinding(config, names, name, host);
  assertAction(binding, action);
  await hostClient(config, binding.host).containerAction(name, action);
  return { name, host: binding.host, action };
}
