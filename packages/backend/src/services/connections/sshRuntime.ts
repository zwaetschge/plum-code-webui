import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getDataDirectory } from '../../db/index.js';
import { getRunnerAccessDecision } from '../../utils/runnerAccess.js';
import {
  SSH_KEY_FILE_PATTERN,
  normalizePrivateKey,
  renderSshConfig,
  sanitizeSshOutput,
  type SshConfigEntry,
} from './sshConfig.js';
import {
  decryptPrivateKey,
  listSessionConnectionRows,
  parseSshConfig,
  type ConnectionRow,
} from './store.js';

/**
 * Turns stored SSH connections into files ssh can use: 0600 key copies and a
 * generated `ssh_config`, in directories only the backend user can read.
 *
 * Key material is read from the read-only `~/.ssh` mount or decrypted from the
 * database, written with mode 0600, and never logged or returned. Session
 * bundles live under `<data>/ssh/sessions/<id>` and are removed when the
 * session process ends; test bundles live in a fresh temp dir per probe.
 */

const NON_KEY_FILES = new Set([
  'known_hosts',
  'known_hosts.old',
  'config',
  'authorized_keys',
  'authorized_keys2',
  'environment',
  'rc',
]);

export function sshKeysDirectory(): string {
  return process.env.PLUM_SSH_KEYS_DIR?.trim() || path.join(os.homedir(), '.ssh');
}

function sshDataRoot(): string {
  return path.join(getDataDirectory(), 'ssh');
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'x';
}

function sessionBundleDir(sessionId: string): string {
  return path.join(sshDataRoot(), 'sessions', safeSegment(sessionId));
}

async function knownHostsPathFor(userId: string): Promise<string> {
  const dir = path.join(sshDataRoot(), 'known_hosts');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, safeSegment(userId));
  await fs.appendFile(file, '', { mode: 0o600 });
  return file;
}

/**
 * Reads a private key from the `~/.ssh` mount. The name must match the key
 * file pattern and resolve to a regular file directly inside that directory,
 * so neither `..` nor a symlink can reach anything else.
 */
async function readKeyFile(name: string): Promise<string | null> {
  if (!SSH_KEY_FILE_PATTERN.test(name) || name.endsWith('.pub') || NON_KEY_FILES.has(name)) {
    return null;
  }
  const dir = sshKeysDirectory();
  try {
    const realDir = await fs.realpath(dir);
    const file = path.join(realDir, name);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 32_768) return null;
    if (path.dirname(await fs.realpath(file)) !== realDir) return null;
    return normalizePrivateKey(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Names of private key files in `~/.ssh`. Contents are read only to classify. */
export async function listSshKeyFiles(): Promise<{ available: boolean; files: string[] }> {
  let names: string[];
  try {
    names = await fs.readdir(sshKeysDirectory());
  } catch {
    return { available: false, files: [] };
  }
  const files: string[] = [];
  for (const name of names.sort()) {
    if (await readKeyFile(name)) files.push(name);
  }
  return { available: true, files };
}

export async function keyFileExists(name: string): Promise<boolean> {
  return !!(await readKeyFile(name));
}

async function privateKeyFor(row: ConnectionRow): Promise<string | null> {
  const config = parseSshConfig(row);
  if (config.keySource === 'upload') {
    const decrypted = decryptPrivateKey(row);
    return decrypted ? normalizePrivateKey(decrypted) : null;
  }
  return config.keyFile ? readKeyFile(config.keyFile) : null;
}

/** Writes keys and the config into `dir` (created 0700) and returns the config path. */
async function writeBundle(
  dir: string,
  userId: string,
  rows: ConnectionRow[],
  header: string,
  connectTimeoutSeconds?: number
): Promise<{ configPath: string; missingKeys: string[] }> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  const keysDir = path.join(dir, 'keys');
  await fs.rm(keysDir, { recursive: true, force: true });
  await fs.mkdir(keysDir, { mode: 0o700 });

  const entries: SshConfigEntry[] = [];
  const missingKeys: string[] = [];
  for (const row of rows) {
    const config = parseSshConfig(row);
    const key = await privateKeyFor(row);
    let keyPath: string | null = null;
    if (key) {
      keyPath = path.join(keysDir, config.alias);
      await fs.writeFile(keyPath, key, { mode: 0o600 });
      await fs.chmod(keyPath, 0o600);
    } else {
      missingKeys.push(config.alias);
    }
    entries.push({ config, keyPath });
  }
  const configPath = path.join(dir, 'config');
  const text = renderSshConfig(entries, {
    knownHostsPath: await knownHostsPathFor(userId),
    header,
    connectTimeoutSeconds,
  });
  await fs.writeFile(configPath, text, { mode: 0o600 });
  await fs.chmod(configPath, 0o600);
  return { configPath, missingKeys };
}

export interface SshTestResult {
  ok: boolean;
  message: string;
  durationMs: number;
}

/**
 * `ssh -F <generated> <alias> true` with batch mode and an 8 s connect
 * timeout. The generated config carries the key (also for the jump host, which
 * a bare `-i` would not reach) and the per-user known_hosts file.
 */
export async function testSshConnection(
  userId: string,
  row: ConnectionRow
): Promise<SshTestResult> {
  const started = Date.now();
  const config = parseSshConfig(row);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-ssh-test-'));
  try {
    const { configPath, missingKeys } = await writeBundle(dir, userId, [row], 'Plum SSH test', 8);
    if (missingKeys.length) {
      return {
        ok: false,
        message: 'Kein verwendbarer Schlüssel hinterlegt (Datei fehlt oder Schlüssel ungültig).',
        durationMs: Date.now() - started,
      };
    }
    const result = await new Promise<{ code: number | null; stderr: string; stdout: string }>(
      (resolve) => {
        execFile(
          'ssh',
          [
            '-F',
            configPath,
            '-o',
            'BatchMode=yes',
            '-o',
            'ConnectTimeout=8',
            '-o',
            'StrictHostKeyChecking=accept-new',
            '-o',
            'LogLevel=ERROR',
            '-T',
            config.alias,
            'true',
          ],
          {
            timeout: 25_000,
            maxBuffer: 64 * 1024,
            env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir },
          },
          (error, stdout, stderr) => {
            const code =
              error && typeof (error as NodeJS.ErrnoException).code === 'number'
                ? (error as unknown as { code: number }).code
                : error
                  ? (error as NodeJS.ErrnoException).code === 'ENOENT'
                    ? 127
                    : -1
                  : 0;
            resolve({ code, stderr: String(stderr ?? ''), stdout: String(stdout ?? '') });
          }
        );
      }
    );
    const durationMs = Date.now() - started;
    if (result.code === 0) {
      return {
        ok: true,
        message: `Verbindung zu ${config.user}@${config.host} erfolgreich.`,
        durationMs,
      };
    }
    if (result.code === 127) {
      return { ok: false, message: 'ssh ist im Container nicht installiert.', durationMs };
    }
    const detail = sanitizeSshOutput(`${result.stderr}\n${result.stdout}`, [dir, os.tmpdir()]);
    return {
      ok: false,
      message:
        detail ||
        (result.code === -1 ? 'Zeitüberschreitung beim Verbinden.' : 'Verbindung fehlgeschlagen.'),
      durationMs,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface SessionSshBundle {
  configPath: string;
  aliases: Array<{ alias: string; target: string; name: string }>;
  missingKeys: string[];
}

/**
 * (Re)materializes the session's SSH bundle. Returns null — and removes any old
 * bundle — when nothing is attached or the user may not run CLI agents.
 */
export async function prepareSessionSsh(
  sessionId: string,
  userId: string
): Promise<SessionSshBundle | null> {
  const rows = await listSessionConnectionRows(sessionId, userId);
  if (!rows.length) {
    await cleanupSessionSsh(sessionId);
    return null;
  }
  const access = await getRunnerAccessDecision(userId).catch(() => ({ allowed: false }));
  if (!access.allowed) {
    await cleanupSessionSsh(sessionId);
    return null;
  }
  try {
    const { configPath, missingKeys } = await writeBundle(
      sessionBundleDir(sessionId),
      userId,
      rows,
      `Plum SSH connections for session ${safeSegment(sessionId)}`
    );
    return {
      configPath,
      missingKeys,
      aliases: rows.map((row) => {
        const config = parseSshConfig(row);
        return {
          alias: config.alias,
          name: row.name,
          target: `${config.user}@${config.host}${config.port === 22 ? '' : `:${config.port}`}`,
        };
      }),
    };
  } catch (error) {
    console.error(
      `[ssh] Could not prepare SSH connections for session ${sessionId}:`,
      error instanceof Error ? error.message : 'unknown error'
    );
    return null;
  }
}

/** Re-renders an existing bundle after attach/detach or an edit, if one is live. */
export async function refreshSessionSshIfPresent(sessionId: string, userId: string): Promise<void> {
  try {
    await fs.access(sessionBundleDir(sessionId));
  } catch {
    return;
  }
  await prepareSessionSsh(sessionId, userId);
}

export async function cleanupSessionSsh(sessionId: string): Promise<void> {
  await fs.rm(sessionBundleDir(sessionId), { recursive: true, force: true }).catch(() => {});
}

/** Boot: no session process survives a restart, so no materialized key should either. */
export async function resetSessionSshBundles(): Promise<void> {
  await fs
    .rm(path.join(sshDataRoot(), 'sessions'), { recursive: true, force: true })
    .catch(() => {});
}

export async function buildSshEnvForSession(
  sessionId: string,
  userId?: string
): Promise<Record<string, string>> {
  if (!userId) return {};
  const bundle = await prepareSessionSsh(sessionId, userId);
  return bundle ? { PLUM_SSH_CONFIG: bundle.configPath } : {};
}

/** Stable key for "has the agent been told about this set yet". */
export function sshContextSignature(bundle: SessionSshBundle | null): string | null {
  return bundle ? bundle.aliases.map((entry) => `${entry.alias}=${entry.target}`).join(',') : null;
}

export function formatSshContext(bundle: SessionSshBundle): string {
  const list = bundle.aliases
    .map(
      (entry) =>
        `${entry.alias} (${entry.target}${entry.name !== entry.alias ? `, ${entry.name}` : ''})`
    )
    .join(', ');
  const cfg = bundle.configPath;
  return `<system-reminder>
Verfügbare SSH-Verbindungen: ${list} (ssh -F $PLUM_SSH_CONFIG <alias>)
The SSH config for this Plum session is ${cfg} (also in $PLUM_SSH_CONFIG when the process started after the hosts were attached). Always pass it explicitly: \`ssh -F ${cfg} <alias> '<command>'\`, \`scp -F ${cfg} …\`, \`rsync -e "ssh -F ${cfg}" …\`. Batch mode is on, so commands never prompt; host keys are pinned on first contact. Do not print, copy or read the key files under that directory.${
    bundle.missingKeys.length
      ? `\nNo usable key is configured for: ${bundle.missingKeys.join(', ')} — tell the user to fix it in Einstellungen → Verbindungen.`
      : ''
  }
</system-reminder>`;
}
