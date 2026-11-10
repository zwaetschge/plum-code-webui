import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INHERITED_CHILD_ENV_KEYS = [
  'HOME',
  'PATH',
  'SHELL',
  'USER',
  'LOGNAME',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
] as const;

/**
 * Build an environment for user-configurable commands without copying the
 * backend's credentials (JWT/session/encryption keys, provider API tokens,
 * database configuration, hook secrets, etc.). Explicit per-tool values are
 * still honoured because they are part of that tool's own configuration.
 */
export function buildRestrictedChildEnv(
  explicit: Record<string, string> = {},
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_CHILD_ENV_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) env[key] = value;
  }
  return { ...env, ...explicit };
}

export { INHERITED_CHILD_ENV_KEYS };

/**
 * The backend's own secrets, which a coding-agent child never needs. Stripped
 * from the inherited environment of CLI/ACP children so one prompt injection
 * cannot read the JWT/session/encryption keys, the database password or the
 * OAuth and push secrets out of its own `process.env` and forge admin access.
 * Provider API keys and the per-session hook secret are added back explicitly
 * by the spawner where a child legitimately needs them.
 */
const BACKEND_SECRET_ENV_KEYS = new Set([
  'JWT_SECRET',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'ENCRYPTION_SALT',
  'WEBUI_HOOK_SECRET',
  'PGPASSWORD',
  'POSTGRES_PASSWORD',
  'DATABASE_URL',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_SECRET',
  'VAPID_PRIVATE_KEY',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'SEED_USER_PASSWORD',
  'BASIC_AUTH_PASSWORD',
  // The backend's own Mistral key (voice, billing). Left in a session's
  // environment it is the only provider a `pi` started from the agent's shell
  // knows, so such a run lands on Mistral whatever model was meant: 13 runs
  // meant for DeepSeek emptied the Mistral budget that way. Pi and Vibe
  // sessions and the subagents bridge get their keys explicitly.
  'MISTRAL_API_KEY',
  'MISTRAL_VOICE_API_KEY',
]);

const AGENT_DATABASE_KEYS = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'] as const;
const AGENT_DATABASE_FILE = 'agent-test-db.env';

let agentDatabaseCache: { file: string; mtimeMs: number; env: Record<string, string> } | null =
  null;

/**
 * The database an agent process may use: a role that can create its own
 * `test_*` schemas and has no access to the application's tables.
 *
 * A session used to inherit the application's database user without the
 * password, and test runs picked a password up from a local `.env` — so tests
 * started by agents ran as the application's own role against the live
 * database. An operator who creates such a role puts its connection settings
 * into `<data dir>/agent-test-db.env` (PGHOST, PGPORT, PGDATABASE, PGUSER,
 * PGPASSWORD); without the file nothing changes.
 */
export function readAgentDatabaseEnv(
  dataDirectory: string | undefined = process.env.WEBUI_DATA_DIR
): Record<string, string> | null {
  // Same rule as db/index.ts: WEBUI_DATA_DIR, else the package's own data directory.
  const directory = dataDirectory
    ? path.resolve(dataDirectory)
    : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
  const file = path.join(directory, AGENT_DATABASE_FILE);
  try {
    const { mtimeMs } = fs.statSync(file);
    if (agentDatabaseCache?.file === file && agentDatabaseCache.mtimeMs === mtimeMs) {
      return agentDatabaseCache.env;
    }
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match?.[1] || match[2] === undefined) continue;
      if ((AGENT_DATABASE_KEYS as readonly string[]).includes(match[1])) env[match[1]] = match[2];
    }
    // Half a configuration would mix this role with the application's settings.
    if (!env.PGUSER || !env.PGPASSWORD) return null;
    agentDatabaseCache = { file, mtimeMs, env };
    return env;
  } catch {
    return null;
  }
}

export function stripBackendSecretsFromEnv(
  source: NodeJS.ProcessEnv = process.env,
  agentDatabase: Record<string, string> | null = readAgentDatabaseEnv()
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (BACKEND_SECRET_ENV_KEYS.has(key)) continue;
    // Catch-all for anything secret-shaped that was added later.
    if (/(^|_)(SECRET|PRIVATE_KEY)$/.test(key)) continue;
    env[key] = value;
  }
  // The agent's own database role replaces the application's user name.
  if (agentDatabase) Object.assign(env, agentDatabase);
  return env;
}

export { BACKEND_SECRET_ENV_KEYS };
