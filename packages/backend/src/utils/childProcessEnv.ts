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
]);

export function stripBackendSecretsFromEnv(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (BACKEND_SECRET_ENV_KEYS.has(key)) continue;
    // Catch-all for anything secret-shaped that was added later.
    if (/(^|_)(SECRET|PRIVATE_KEY)$/.test(key)) continue;
    env[key] = value;
  }
  return env;
}

export { BACKEND_SECRET_ENV_KEYS };
