import { z } from 'zod';

/**
 * Pure SSH connection rules: input validation and `ssh_config` rendering.
 *
 * Kept free of database, config and filesystem imports so the regression
 * script can exercise it without a running backend. Every string that ends up
 * in a generated config or on an `ssh` command line passes one of these
 * patterns first: no whitespace, no newlines, no leading `-` — so a host name
 * can neither inject a second config directive nor be read as an option.
 */

export const SSH_ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;
export const SSH_HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/;
export const SSH_USER_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/;
/** `[user@]host[:port]`, IPv6 only without a port. */
export const SSH_JUMP_PATTERN =
  /^(?:[A-Za-z0-9._][A-Za-z0-9._-]{0,63}@)?[A-Za-z0-9][A-Za-z0-9.-]{0,252}(?::[0-9]{1,5})?$/;
export const SSH_KEY_FILE_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
export const SSH_TAG_PATTERN = /^[\p{L}\p{N}._-]{1,32}$/u;
export const SSH_PRIVATE_KEY_MAX = 16_384;

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    'Name must not contain control characters'
  );

const aliasSchema = z
  .string()
  .trim()
  .regex(SSH_ALIAS_PATTERN, 'Alias: lowercase letters, digits and dashes (max. 41)');
const hostSchema = z.string().trim().regex(SSH_HOST_PATTERN, 'Invalid host');
const userSchema = z.string().trim().regex(SSH_USER_PATTERN, 'Invalid user name');
const portSchema = z.coerce.number().int().min(1).max(65535);
const jumpSchema = z
  .string()
  .trim()
  .max(330)
  .refine((value) => value === '' || isValidJumpHost(value), 'Invalid jump host')
  .transform((value) => value || null)
  .nullable();
const tagsSchema = z
  .array(z.string().trim().regex(SSH_TAG_PATTERN, 'Invalid tag'))
  .max(12)
  .transform((tags) => [...new Set(tags)]);
const keyFileSchema = z
  .string()
  .trim()
  .regex(SSH_KEY_FILE_PATTERN, 'Invalid key file name')
  .nullable();
const privateKeySchema = z.string().max(SSH_PRIVATE_KEY_MAX);

export function isValidJumpHost(value: string): boolean {
  if (!SSH_JUMP_PATTERN.test(value)) return false;
  const port = value.match(/:([0-9]{1,5})$/)?.[1];
  return !port || (Number(port) >= 1 && Number(port) <= 65535);
}

export const createSshConnectionSchema = z.object({
  kind: z.literal('ssh'),
  name: nameSchema,
  alias: aliasSchema,
  host: hostSchema,
  port: portSchema.default(22),
  user: userSchema,
  jumpHost: jumpSchema.optional(),
  tags: tagsSchema.optional(),
  keySource: z.enum(['file', 'upload']),
  keyFile: keyFileSchema.optional(),
  privateKey: privateKeySchema.optional(),
});

export const updateSshConnectionSchema = z.object({
  name: nameSchema.optional(),
  alias: aliasSchema.optional(),
  host: hostSchema.optional(),
  port: portSchema.optional(),
  user: userSchema.optional(),
  jumpHost: jumpSchema.optional(),
  tags: tagsSchema.optional(),
  keySource: z.enum(['file', 'upload']).optional(),
  keyFile: keyFileSchema.optional(),
  privateKey: privateKeySchema.optional(),
  clearKey: z.boolean().optional(),
});

export type SshKeySource = 'file' | 'upload';

/** What is stored in `connections.config_json` for kind `ssh`. */
export interface SshConnectionConfig {
  alias: string;
  host: string;
  port: number;
  user: string;
  jumpHost: string | null;
  tags: string[];
  keySource: SshKeySource;
  keyFile: string | null;
}

/**
 * Accepts the usual OpenSSH and PEM private key encodings and normalises line
 * endings; ssh rejects a key without a trailing newline.
 */
export function normalizePrivateKey(raw: string): string | null {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return null;
  if (
    !/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----\n[\s\S]+\n-----END [A-Z0-9 ]*PRIVATE KEY-----$/.test(
      text
    )
  ) {
    return null;
  }
  return `${text}\n`;
}

export function parseJumpHost(
  jumpHost: string,
  defaults: { user: string }
): { host: string; user: string; port: number } {
  let rest = jumpHost;
  let user = defaults.user;
  const at = rest.indexOf('@');
  if (at > 0) {
    user = rest.slice(0, at);
    rest = rest.slice(at + 1);
  }
  let port = 22;
  const portMatch = rest.match(/^(.*):([0-9]{1,5})$/);
  if (portMatch && !portMatch[1]!.includes(':')) {
    rest = portMatch[1]!;
    port = Number(portMatch[2]);
  }
  return { host: rest, user, port };
}

export interface SshConfigEntry {
  config: SshConnectionConfig;
  /** Absolute path of the materialized 0600 key file, or null for none. */
  keyPath: string | null;
}

/** Host block name for a jump host — outside the alias pattern, so it cannot collide. */
export function jumpAliasFor(alias: string): string {
  return `_jump_${alias}`;
}

function quote(value: string): string {
  if (/["\n\r]/.test(value)) throw new Error('Unsupported character in ssh config path');
  return `"${value}"`;
}

/**
 * Renders one `ssh_config` with a `Host <alias>` block per connection. Batch
 * mode keeps an agent from hanging on a password prompt; accept-new pins a
 * host key on first contact into the user's own known_hosts file.
 */
export function renderSshConfig(
  entries: SshConfigEntry[],
  options: { knownHostsPath: string; header?: string; connectTimeoutSeconds?: number }
): string {
  const lines: string[] = [
    `# ${options.header ?? 'Generated by Plum'} — regenerated automatically, do not edit.`,
  ];
  const common = (keyPath: string | null) => [
    ...(keyPath ? [`  IdentityFile ${quote(keyPath)}`, '  IdentitiesOnly yes'] : []),
    `  UserKnownHostsFile ${quote(options.knownHostsPath)}`,
    '  StrictHostKeyChecking accept-new',
    '  BatchMode yes',
    `  ConnectTimeout ${options.connectTimeoutSeconds ?? 15}`,
    '  ServerAliveInterval 30',
  ];
  for (const { config, keyPath } of entries) {
    for (const value of [config.alias, config.host, config.user]) {
      if (/\s/.test(value)) throw new Error('Whitespace in ssh config value');
    }
    lines.push(
      '',
      `Host ${config.alias}`,
      `  HostName ${config.host}`,
      `  User ${config.user}`,
      `  Port ${config.port}`,
      ...(config.jumpHost ? [`  ProxyJump ${jumpAliasFor(config.alias)}`] : []),
      ...common(keyPath)
    );
    if (config.jumpHost) {
      const jump = parseJumpHost(config.jumpHost, { user: config.user });
      lines.push(
        '',
        `Host ${jumpAliasFor(config.alias)}`,
        `  HostName ${jump.host}`,
        `  User ${jump.user}`,
        `  Port ${jump.port}`,
        ...common(keyPath)
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * ssh's stderr can name the temporary paths it read; strip them and keep the
 * message short. Key material never reaches stderr.
 */
export function sanitizeSshOutput(output: string, secretsToHide: string[]): string {
  let text = output;
  for (const secret of secretsToHide) {
    if (secret) text = text.split(secret).join('…');
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Warning: Permanently added/i.test(line));
  return lines.slice(-4).join('\n').slice(0, 600);
}

export function defaultAliasFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 41)
    .replace(/-+$/g, '');
  return SSH_ALIAS_PATTERN.test(slug) ? slug : 'host';
}
