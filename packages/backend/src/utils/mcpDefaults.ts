import fs from 'fs/promises';
import os from 'os';
import path from 'path';

interface ClaudeMcpServer {
  type?: 'stdio' | 'http' | 'sse' | string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

interface ClaudeSettings {
  mcpServers?: Record<string, ClaudeMcpServer>;
  env?: Record<string, string>;
  [key: string]: unknown;
}

// Z.AI is configured per WebUI user and injected only into `zai` child
// processes. Legacy installs stored these overrides in the shared Claude Code
// settings file, which makes native Claude subscription sessions silently use
// the Z.AI endpoint as well.
export const CLAUDE_PROVIDER_OVERRIDE_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
] as const;

export const WEBUI_DEFAULT_MCP_SERVERS: Record<string, ClaudeMcpServer> = {
  godot: {
    type: 'stdio',
    command: 'node',
    args: ['/app/scripts/mcp-servers/godot.mjs'],
  },
  blender: {
    type: 'stdio',
    command: 'node',
    args: ['/app/scripts/mcp-servers/blender.mjs'],
  },
  subagents: {
    type: 'stdio',
    command: 'node',
    args: ['/app/scripts/mcp-servers/subagents.mjs'],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getDefaultClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

export async function sanitizeClaudeSettingsProviderEnv(
  opts: { settingsPath?: string } = {}
): Promise<{ updated: boolean; removed: string[]; settingsPath: string }> {
  const settingsPath = opts.settingsPath || getDefaultClaudeSettingsPath();
  let settings: ClaudeSettings;

  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      throw new Error('settings.json root must be an object');
    }
    settings = parsed as ClaudeSettings;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { updated: false, removed: [], settingsPath };
    }
    throw err;
  }

  if (!isRecord(settings.env)) {
    return { updated: false, removed: [], settingsPath };
  }

  const removed: string[] = [];
  for (const key of CLAUDE_PROVIDER_OVERRIDE_ENV_KEYS) {
    if (!Object.hasOwn(settings.env, key)) continue;
    delete settings.env[key];
    removed.push(key);
  }

  if (removed.length === 0) {
    return { updated: false, removed, settingsPath };
  }

  if (Object.keys(settings.env).length === 0) {
    delete settings.env;
  }
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return { updated: true, removed, settingsPath };
}

export async function ensureDefaultClaudeMcpServers(
  opts: { settingsPath?: string; servers?: Record<string, ClaudeMcpServer> } = {}
): Promise<{ updated: boolean; added: string[]; settingsPath: string }> {
  const settingsPath = opts.settingsPath || getDefaultClaudeSettingsPath();
  const defaults = opts.servers || WEBUI_DEFAULT_MCP_SERVERS;
  let settings: ClaudeSettings = {};

  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      throw new Error('settings.json root must be an object');
    }
    settings = parsed as ClaudeSettings;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }

  if (!isRecord(settings.mcpServers)) {
    settings.mcpServers = {};
  }

  const added: string[] = [];
  for (const [name, server] of Object.entries(defaults)) {
    if (settings.mcpServers[name]) continue;
    settings.mcpServers[name] = server;
    added.push(name);
  }

  if (added.length === 0) {
    return { updated: false, added, settingsPath };
  }

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return { updated: true, added, settingsPath };
}
