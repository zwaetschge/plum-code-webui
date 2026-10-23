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
  // Session-scoped: set from the sessions row at spawn, never inherited.
  'CLAUDE_CODE_SUBAGENT_MODEL',
] as const;

const REA_NATIVE = '/home/node/.npm-global/tools/rea-native';
const REA_JDK = `${REA_NATIVE}/zulu21.52.203-ca-jdk21.0.12.1-linux_musl_x64`;

export const WEBUI_DEFAULT_MCP_SERVERS: Record<string, ClaudeMcpServer> = {
  assistant: { type: 'stdio', command: 'node', args: ['/app/scripts/mcp-servers/assistant.mjs'] },
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
  firefox: {
    type: 'stdio',
    command: 'node',
    args: ['/app/scripts/mcp-servers/firefox.mjs'],
  },
  rea: {
    type: 'stdio',
    command: 'npx',
    args: ['--yes', 'rea-agents@6.7.0', 'mcp'],
    // The npm-global volume survives rebuilds; the pinned release is cached
    // there and its engines live under tools/rea-native. `rea setup` refuses
    // Alpine, so Ghidra, the musl JDK and the JADX bridge are wired here.
    env: {
      npm_config_cache: '/home/node/.npm-global/cache',
      GHIDRA_INSTALL_DIR: `${REA_NATIVE}/ghidra_12.1.4_PUBLIC`,
      JAVA_HOME: REA_JDK,
      REA_JADX_MCP_JAR: `${REA_NATIVE}/jadx/jadx-headless-mcp-0.7.1-all.jar`,
      // Open alternatives to Hopper and IDA: Kuna as a deep provider, Rizin CLI tools.
      REA_KUNA_COMMAND: `${REA_NATIVE}/kuna/kuna-v1.833-linux-x86_64-musl/kuna`,
      PATH: `${REA_JDK}/bin:${REA_NATIVE}/procps/bin:${REA_NATIVE}/rizin/bin:/home/node/.local/bin:/home/node/.npm-global/bin:/opt/plum-cli/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    },
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
