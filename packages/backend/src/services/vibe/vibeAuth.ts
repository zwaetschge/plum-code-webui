import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ClientSideConnection,
  PROTOCOL_VERSION as ACP_PROTOCOL_VERSION,
  ndJsonStream,
  type Client as AcpClient,
} from '@agentclientprotocol/sdk';
import { CLI_PROVIDERS, buildVibeEnv, resolveVibeHome } from '../cli-providers.js';

/**
 * Mistral Vibe sign-in.
 *
 * Vibe is a Python CLI whose ACP agent advertises a delegated browser sign-in:
 * the client asks for a sign-in URL, hands it to the user, and then exchanges
 * the attempt for an API key that Vibe persists itself in `$VIBE_HOME/.env`.
 * That key is what draws on the plan's Vibe Code allowance (€255/month on Pro)
 * instead of the small API/Studio allowance a regular console key uses.
 *
 * Plum therefore never handles the OAuth exchange: it relays the URL, polls for
 * completion, and lets Vibe write its own credential file. A pasted key is
 * supported too, because the console also issues Vibe-scoped keys under
 * Code › Vibe CLI.
 */

const ACP_AUTH_METHOD = 'browser-auth-delegated';
const POLL_INTERVAL_MS = 4000;
const MAX_LOGIN_MS = 10 * 60 * 1000;
/** Mistral keys are alphanumeric; rejecting anything else keeps `.env` safe. */
const API_KEY_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

export interface VibeAuthState {
  installed: boolean;
  authenticated: boolean;
  /** Where the key came from: Vibe's own `.env`, the process env, or nowhere. */
  source: 'dot-env' | 'process-env' | 'none';
  authState?: string;
  home: string;
}

export interface VibeBrowserLogin {
  signInUrl: string;
  attemptId: string;
  expiresAt: string | null;
  cancel: () => void;
  /** Resolves once Vibe persisted the key, or rejects on a fatal auth error. */
  completed: Promise<void>;
}

function envFilePath(): string {
  return path.join(resolveVibeHome(), '.env');
}

function readEnvFile(): string {
  try {
    return fs.readFileSync(envFilePath(), 'utf-8');
  } catch {
    return '';
  }
}

function hasKeyIn(text: string): boolean {
  return /^\s*MISTRAL_API_KEY\s*=\s*['"]?[^'"\s]+/m.test(text);
}

function resolveVibeBinary(): string | null {
  const command = CLI_PROVIDERS.vibe.command;
  if (!command) return null;
  const resolved = command.replace('~', os.homedir());
  if (resolved.includes('/') && !fs.existsSync(resolved)) return null;
  return resolved;
}

export function readVibeAuthState(): VibeAuthState {
  const installed = Boolean(resolveVibeBinary());
  const fromFile = hasKeyIn(readEnvFile());
  const fromProcess = Boolean(process.env.MISTRAL_API_KEY && process.env.MISTRAL_API_KEY.trim());
  return {
    installed,
    authenticated: fromFile || fromProcess,
    // Vibe prefers a non-empty process value over `.env`, so report what wins.
    source: fromProcess ? 'process-env' : fromFile ? 'dot-env' : 'none',
    home: resolveVibeHome(),
  };
}

/**
 * Ask the running agent whether it considers itself signed in. Falls back to
 * the file/env probe when `vibe-acp` is missing or does not answer.
 */
export async function readVibeAuthStateFromAgent(timeoutMs = 20000): Promise<VibeAuthState> {
  const base = readVibeAuthState();
  if (!base.installed) return base;
  const child = spawnVibeAcp();
  if (!child) return base;
  try {
    const connection = connect(child);
    await withTimeout(
      connection.initialize({
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientInfo: { name: 'Plum Code WebUI', version: '1' },
        clientCapabilities: {},
      }),
      timeoutMs,
      'initialize'
    );
    const status = (await withTimeout(
      extMethod(connection, '_auth/status', {}),
      timeoutMs,
      'auth/status'
    )) as { authenticated?: boolean; authState?: string };
    return {
      ...base,
      authenticated: Boolean(status?.authenticated) || base.authenticated,
      authState: typeof status?.authState === 'string' ? status.authState : base.authState,
    };
  } catch (error) {
    console.warn('[VIBE] auth/status probe failed:', error);
    return base;
  } finally {
    kill(child);
  }
}

function spawnVibeAcp(): ChildProcessWithoutNullStreams | null {
  const command = resolveVibeBinary();
  if (!command) {
    console.warn('[VIBE] vibe-acp is not installed; cannot sign in');
    return null;
  }
  const child = spawn(command, [], {
    cwd: os.homedir(),
    env: { ...process.env, ...buildVibeEnv() } as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (text) console.warn('[VIBE ACP stderr]', text.slice(0, 500));
  });
  return child;
}

function connect(child: ChildProcessWithoutNullStreams): ClientSideConnection {
  const client: AcpClient = {
    // A sign-in process never opens a session, so both callbacks are no-ops.
    requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    sessionUpdate: async () => undefined,
  };
  return new ClientSideConnection(
    () => client,
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
  );
}

function extMethod(
  connection: ClientSideConnection,
  method: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const ext = connection as unknown as {
    extMethod?: (m: string, p: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  if (typeof ext.extMethod !== 'function') {
    return Promise.reject(new Error('The ACP SDK does not expose extension methods.'));
  }
  return ext.extMethod(method, params);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function kill(child: ChildProcess): void {
  try {
    child.kill('SIGTERM');
  } catch {
    // Already gone.
  }
}

function metaOf(response: unknown): Record<string, unknown> {
  const record = (response ?? {}) as Record<string, unknown>;
  const meta = (record._meta ?? {}) as Record<string, unknown>;
  const nested = meta[ACP_AUTH_METHOD];
  return nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : meta;
}

/**
 * Start the delegated browser sign-in. The returned URL is what the user opens;
 * `completed` resolves once Vibe wrote the key to `$VIBE_HOME/.env`.
 */
export async function startVibeBrowserLogin(): Promise<VibeBrowserLogin> {
  const child = spawnVibeAcp();
  if (!child) {
    throw new Error('Mistral Vibe is not installed in this deployment.');
  }
  const connection = connect(child);

  let pollTimer: NodeJS.Timeout | undefined;
  let deadline: NodeJS.Timeout | undefined;
  let settled = false;

  const cleanup = () => {
    if (pollTimer) clearInterval(pollTimer);
    if (deadline) clearTimeout(deadline);
    pollTimer = undefined;
    deadline = undefined;
    kill(child);
  };

  try {
    await withTimeout(
      connection.initialize({
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientInfo: { name: 'Plum Code WebUI', version: '1' },
        // The flag is what makes Vibe advertise the delegated method: the
        // client, not the headless agent, shows the sign-in page.
        clientCapabilities: { _meta: { [`${ACP_AUTH_METHOD}`]: true } } as never,
      }),
      20000,
      'initialize'
    );

    const start = metaOf(
      await withTimeout(
        connection.authenticate({
          methodId: ACP_AUTH_METHOD,
          action: 'start',
        } as never),
        30000,
        'authenticate'
      )
    );
    const signInUrl = typeof start.signInUrl === 'string' ? start.signInUrl : '';
    const attemptId = typeof start.attemptId === 'string' ? start.attemptId : '';
    const expiresAt = typeof start.expiresAt === 'string' ? start.expiresAt : null;
    if (!signInUrl || !attemptId) {
      throw new Error('Mistral Vibe did not return a sign-in URL.');
    }

    const completed = new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };

      pollTimer = setInterval(() => {
        if (settled) return;
        connection
          .authenticate({
            methodId: ACP_AUTH_METHOD,
            action: 'complete',
            attemptId,
          } as never)
          .then(() => finish())
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            // While the user has not finished in the browser, Vibe answers the
            // exchange with a poll/exchange failure and keeps the attempt alive.
            if (/timed? ?out|timeout/i.test(message) && !/attempt/i.test(message)) {
              finish(new Error(message));
              return;
            }
            if (/unknown browser sign-in attempt|missing browser sign-in/i.test(message)) {
              finish(new Error(message));
            }
          });
      }, POLL_INTERVAL_MS);

      const expiresMs = expiresAt ? Date.parse(expiresAt) - Date.now() : NaN;
      const lifetime = Number.isFinite(expiresMs)
        ? Math.min(Math.max(expiresMs, 30000), MAX_LOGIN_MS)
        : MAX_LOGIN_MS;
      deadline = setTimeout(
        () => finish(new Error('The Mistral sign-in link expired. Start the login again.')),
        lifetime
      );

      child.on('exit', (code) => {
        if (!settled) {
          finish(
            new Error(
              `The Mistral Vibe sign-in process ended (code ${code ?? 'unknown'}) before completing.`
            )
          );
        }
      });
    });

    // An unhandled rejection here would crash the process once the caller has
    // already answered the HTTP request; the route awaits it explicitly.
    completed.catch(() => undefined);

    return { signInUrl, attemptId, expiresAt, cancel: cleanup, completed };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * Store a pasted key the same way `vibe --setup` does: `MISTRAL_API_KEY` in
 * `$VIBE_HOME/.env`, readable only by the CLI user.
 */
export function writeVibeApiKey(apiKey: string): void {
  const trimmed = apiKey.trim();
  if (!API_KEY_PATTERN.test(trimmed)) {
    throw new Error('That does not look like a Mistral API key.');
  }
  const home = resolveVibeHome();
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = envFilePath();
  const existing = readEnvFile();
  const line = `MISTRAL_API_KEY=${trimmed}`;
  const next = hasKeyIn(existing)
    ? existing.replace(/^\s*MISTRAL_API_KEY\s*=.*$/m, line)
    : `${existing.trimEnd()}${existing.trim() ? '\n' : ''}${line}\n`;
  fs.writeFileSync(file, next, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // A mounted volume may refuse chmod; the write mode already asked for 0600.
  }
}

/** Remove a stored key (sign out). A key in the process env is not ours. */
export function clearVibeApiKey(): boolean {
  const file = envFilePath();
  const existing = readEnvFile();
  if (!hasKeyIn(existing)) return false;
  const next = existing
    .split('\n')
    .filter((line) => !/^\s*MISTRAL_API_KEY\s*=/.test(line))
    .join('\n')
    .replace(/^\n+/, '');
  fs.writeFileSync(file, next, { mode: 0o600 });
  return true;
}
