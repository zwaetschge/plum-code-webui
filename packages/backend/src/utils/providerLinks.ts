import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getOpenCodeBuildAgentPrompt,
  getOpenCodePrimaryAgent,
  isOpenCodeManagedBuildAgentPrompt,
} from '../services/opencode/sessionContext.js';
import {
  getOpenCodeCredentialEnvVars,
  readOpenCodeProvidersForUser,
  type OpenCodeProvider,
} from './opencodeProviderKeys.js';
import { getOpenCodeProviderCatalog, type OpenCodeProviderCatalog } from './opencodeCatalog.js';

const ZAI_VISION_MCP_NAME = 'zai-vision';
const ZAI_VISION_MCP_MARKER = 'zai-vision-v1';

function getClaudeConfigHome(): string {
  return (
    process.env.WEBUI_CONFIG_HOME ||
    process.env.CLAUDE_CONFIG_HOME ||
    path.join(os.homedir(), '.claude')
  );
}

function getOpenCodeConfigDir(): string {
  return process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.opencode', 'config');
}

type ZaiVisionMcpPolicy = 'auto' | 'always' | 'off';

// Claude Code tool names (PascalCase) → OpenCode tool names (lowercase).
// OpenCode validates this list strictly; unlisted Claude tools are omitted.
const OPENCODE_TOOL_MAP: Record<string, string> = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  Glob: 'glob',
  Grep: 'grep',
  Bash: 'bash',
  WebFetch: 'webfetch',
  TodoWrite: 'todowrite',
  Task: 'task',
};

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

interface Parsed {
  fields: Record<string, string>;
  body: string;
}

interface ClaudeMcpServer {
  type?: 'stdio' | 'http' | string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface ClaudeSettings {
  mcpServers?: Record<string, ClaudeMcpServer>;
}

export interface ProviderLinksSyncResult {
  opencodeAgents: { converted: number; skipped: number };
  opencodeConfig: { updated: boolean; mcpCount: number };
}

interface OpenCodeConfigProviderBlock {
  api?: string;
  name?: string;
  env?: string[];
  npm?: string;
  options?: Record<string, unknown>;
  models?: Record<string, unknown>;
}

function parseFrontmatter(source: string): Parsed | null {
  const m = source.match(FRONTMATTER_RE);
  if (!m) return null;
  const raw = m[1] ?? '';
  const body = m[2] ?? '';
  const fields: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    fields[key] = value;
  }
  return { fields, body };
}

function parseToolList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((tool) => tool.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function firstBodyLine(body: string): string {
  return (
    body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('#')) || ''
  );
}

function readClaudeSettings(claudeSettingsPath?: string): ClaudeSettings | null {
  const settingsPath = claudeSettingsPath || path.join(os.homedir(), '.claude/settings.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as ClaudeSettings;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function getClaudeMcpServers(claudeSettingsPath?: string): Record<string, ClaudeMcpServer> {
  return readClaudeSettings(claudeSettingsPath)?.mcpServers || {};
}

function writeIfChanged(filePath: string, content: string): boolean {
  let existing: string | null = null;
  try {
    existing = fs.readFileSync(filePath, 'utf8');
  } catch {
    existing = null;
  }
  if (existing === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or invalid config gets replaced with a minimal valid object.
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatOpenCodeProviderModelName(modelId: string): string {
  return modelId
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((segment) => {
      if (/^\d/.test(segment)) return segment;
      if (segment.toLowerCase() === 'glm') return 'GLM';
      if (segment.toLowerCase() === 'qwen') return 'Qwen';
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');
}

function mergeStringArrays(...lists: Array<string[] | undefined>): string[] {
  const values = new Set<string>();
  for (const list of lists) {
    for (const item of list || []) {
      const normalized = typeof item === 'string' ? item.trim() : '';
      if (normalized) values.add(normalized);
    }
  }
  return [...values];
}

export function buildWebuiOpenCodeProviderConfig(
  provider: OpenCodeProvider,
  catalog: OpenCodeProviderCatalog = getOpenCodeProviderCatalog(),
  existing?: Record<string, unknown>
): OpenCodeConfigProviderBlock | null {
  const catalogProvider = catalog[provider.id];
  const baseUrl = provider.baseUrl || catalogProvider?.api;
  if (!provider.enabled || !baseUrl) return null;

  const existingBlock = isRecord(existing) ? existing : {};
  const existingOptions = isRecord(existingBlock.options) ? existingBlock.options : {};
  const existingModels = isRecord(existingBlock.models)
    ? (existingBlock.models as Record<string, unknown>)
    : {};
  const modelIds = catalogProvider?.models || [];
  const models: Record<string, unknown> = { ...existingModels };

  for (const modelId of modelIds) {
    if (models[modelId]) continue;
    models[modelId] = {
      id: modelId,
      name: formatOpenCodeProviderModelName(modelId),
      tool_call: true,
      temperature: true,
    };
  }

  const envVars = getOpenCodeCredentialEnvVars(provider.id, catalog);
  const existingEnv = Array.isArray(existingBlock.env)
    ? existingBlock.env.filter((value): value is string => typeof value === 'string')
    : undefined;
  const existingApiKey =
    typeof existingOptions.apiKey === 'string' && existingOptions.apiKey.trim()
      ? existingOptions.apiKey
      : undefined;

  return {
    ...existingBlock,
    name: provider.name || catalogProvider?.name || String(existingBlock.name || provider.id),
    env: mergeStringArrays(existingEnv, envVars),
    api: baseUrl,
    npm:
      typeof existingBlock.npm === 'string' && existingBlock.npm.trim()
        ? existingBlock.npm
        : '@ai-sdk/openai-compatible',
    options: {
      ...existingOptions,
      baseURL: baseUrl,
      apiKey: existingApiKey || `{env:${envVars[0]}}`,
    },
    models,
  };
}

async function applyWebuiOpenCodeProviderConfig(
  config: Record<string, unknown>,
  userId?: string,
  storedProvidersOverride?: OpenCodeProvider[]
): Promise<void> {
  if (!userId && !storedProvidersOverride) return;

  const catalog = getOpenCodeProviderCatalog();
  const storedProviders = (
    storedProvidersOverride || (await readOpenCodeProvidersForUser(userId!))
  ).filter((provider) => provider.enabled && (provider.baseUrl || catalog[provider.id]?.api));
  if (storedProviders.length === 0) return;

  const providers = isRecord(config.provider) ? config.provider : {};

  for (const stored of storedProviders) {
    const block = buildWebuiOpenCodeProviderConfig(
      stored,
      catalog,
      isRecord(providers[stored.id]) ? (providers[stored.id] as Record<string, unknown>) : undefined
    );
    if (!block) continue;
    providers[stored.id] = block;
  }

  config.provider = providers;
}

export function resolveZaiVisionMcpPolicy(
  value: string | null | undefined = process.env.OPENCODE_ZAI_VISION_MCP
): ZaiVisionMcpPolicy {
  const normalized = (value || 'auto').trim().toLowerCase();
  if (['0', 'false', 'off', 'disable', 'disabled', 'none'].includes(normalized)) {
    return 'off';
  }
  if (['1', 'true', 'on', 'enable', 'enabled', 'always'].includes(normalized)) {
    return 'always';
  }
  return 'auto';
}

function isZaiCodingProvider(provider: OpenCodeProvider): boolean {
  const id = provider.id.trim().toLowerCase();
  return id === 'z-ai' || id === 'zai';
}

function hasEnabledZaiCodingProviderKey(providers: OpenCodeProvider[]): boolean {
  return providers.some(
    (provider) => provider.enabled !== false && isZaiCodingProvider(provider) && !!provider.apiKey
  );
}

function hasInheritedZaiVisionKey(env: Record<string, string | undefined>): boolean {
  return typeof env.Z_AI_API_KEY === 'string' && env.Z_AI_API_KEY.trim().length > 0;
}

function isManagedZaiVisionMcpEntry(entry: unknown): boolean {
  return isRecord(entry) && entry.webuiManaged === ZAI_VISION_MCP_MARKER;
}

function buildZaiVisionMcpEntry(): Record<string, unknown> {
  return {
    type: 'local',
    command: ['npx', '-y', '@z_ai/mcp-server@latest'],
    environment: {
      Z_AI_MODE: 'ZAI',
    },
    enabled: true,
    webuiManaged: ZAI_VISION_MCP_MARKER,
  };
}

export function applyZaiVisionMcpConfig(
  config: Record<string, unknown>,
  opts: {
    policy?: string | null;
    providers?: OpenCodeProvider[];
    inheritedEnv?: Record<string, string | undefined>;
  } = {}
): void {
  const policy = resolveZaiVisionMcpPolicy(opts.policy);
  const providersWereProvided = opts.providers !== undefined;
  const providers = opts.providers || [];
  const inheritedEnv = opts.inheritedEnv || process.env;
  const mcp = isRecord(config.mcp) ? config.mcp : {};
  const existing = mcp[ZAI_VISION_MCP_NAME];
  const existingIsManaged = isManagedZaiVisionMcpEntry(existing);

  if (policy === 'off') {
    if (existingIsManaged) delete mcp[ZAI_VISION_MCP_NAME];
    config.mcp = mcp;
    return;
  }

  const active =
    policy === 'always'
      ? hasEnabledZaiCodingProviderKey(providers) || hasInheritedZaiVisionKey(inheritedEnv)
      : hasEnabledZaiCodingProviderKey(providers);

  if (!active) {
    if (existingIsManaged && providersWereProvided) delete mcp[ZAI_VISION_MCP_NAME];
    config.mcp = mcp;
    return;
  }

  if (existing && !existingIsManaged) {
    config.mcp = mcp;
    return;
  }

  mcp[ZAI_VISION_MCP_NAME] = buildZaiVisionMcpEntry();
  config.mcp = mcp;
}

export function applyOpenCodePrimaryAgentConfig(config: Record<string, unknown>): void {
  const primaryAgentName = getOpenCodePrimaryAgent();
  if (!primaryAgentName) return;

  const agent = isRecord(config.agent) ? config.agent : {};
  const primaryAgent = isRecord(agent[primaryAgentName])
    ? (agent[primaryAgentName] as Record<string, unknown>)
    : {};

  if (typeof primaryAgent.description !== 'string' || primaryAgent.description.trim() === '') {
    primaryAgent.description = 'Primary Plum Code WebUI coding agent.';
  }
  if (typeof primaryAgent.mode !== 'string' || primaryAgent.mode.trim() === '') {
    primaryAgent.mode = 'primary';
  }

  const managedPrompt = getOpenCodeBuildAgentPrompt();
  const existingPrompt = typeof primaryAgent.prompt === 'string' ? primaryAgent.prompt : '';
  const hasManagedPrompt = isOpenCodeManagedBuildAgentPrompt(existingPrompt);
  if (managedPrompt) {
    if (!existingPrompt || hasManagedPrompt) {
      primaryAgent.prompt = managedPrompt;
    }
  } else if (hasManagedPrompt) {
    delete primaryAgent.prompt;
  }

  agent[primaryAgentName] = primaryAgent;
  config.agent = agent;
}

// Claude agents declare `tools: Read, Write, Edit` (CSV string). OpenCode
// expects a YAML record (`tools:\n  read: true\n  write: true`). Convert and
// filter to OpenCode's whitelist.
function toOpencodeAgent(claudeSource: string): string | null {
  const parsed = parseFrontmatter(claudeSource);
  if (!parsed) return null;

  const { fields, body } = parsed;
  const allowed = parseToolList(fields.tools)
    .map((tool) => OPENCODE_TOOL_MAP[tool])
    .filter((tool): tool is string => Boolean(tool));

  const description = fields.description || firstBodyLine(body) || fields.name || '';

  const lines: string[] = ['---'];
  if (fields.name) lines.push(`name: ${fields.name}`);
  lines.push(`description: ${description.replace(/"/g, '\\"')}`);
  lines.push('mode: subagent');
  if (allowed.length > 0) {
    lines.push('tools:');
    for (const tool of allowed) lines.push(`  ${tool}: true`);
  }
  lines.push('---');
  lines.push('');
  lines.push(body.trimStart());

  return lines.join('\n');
}

export function syncOpencodeAgents(opts: { quiet?: boolean; destinationDir?: string } = {}): {
  converted: number;
  skipped: number;
} {
  const srcDir = path.join(getClaudeConfigHome(), 'agents');
  const dstDir = opts.destinationDir || path.join(getOpenCodeConfigDir(), 'agents');

  if (!fs.existsSync(srcDir)) return { converted: 0, skipped: 0 };

  // If the dst is a stale symlink from an earlier build, drop it so we can
  // write real files in its place.
  try {
    const st = fs.lstatSync(dstDir);
    if (st.isSymbolicLink()) fs.unlinkSync(dstDir);
  } catch {
    // doesn't exist
  }

  fs.mkdirSync(dstDir, { recursive: true });

  const entries = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'));
  let converted = 0;
  let skipped = 0;

  for (const file of entries) {
    try {
      const source = fs.readFileSync(path.join(srcDir, file), 'utf8');
      const output = toOpencodeAgent(source);
      if (!output) {
        skipped += 1;
        continue;
      }
      writeIfChanged(path.join(dstDir, file), output);
      converted += 1;
    } catch (err) {
      console.error(`[init] Failed to convert OpenCode agent ${file}:`, err);
      skipped += 1;
    }
  }

  // Prune dst files whose source no longer exists.
  const srcNames = new Set(entries);
  for (const existing of fs.readdirSync(dstDir)) {
    if (existing.endsWith('.md') && !srcNames.has(existing)) {
      try {
        fs.unlinkSync(path.join(dstDir, existing));
      } catch {
        /* ignore */
      }
    }
  }

  if (!opts.quiet) {
    console.log(`[init] OpenCode agents synced: ${converted} converted, ${skipped} skipped`);
  }
  return { converted, skipped };
}

function toOpenCodeMcpConfig(server: ClaudeMcpServer): Record<string, unknown> | null {
  if (server.url) {
    const entry: Record<string, unknown> = {
      type: 'remote',
      url: server.url,
      enabled: true,
    };
    if (server.headers && Object.keys(server.headers).length > 0) {
      entry.headers = server.headers;
    }
    return entry;
  }
  if (server.command) {
    const entry: Record<string, unknown> = {
      type: 'local',
      command: [server.command, ...(server.args || [])],
      enabled: true,
    };
    if (server.env && Object.keys(server.env).length > 0) {
      entry.environment = server.env;
    }
    return entry;
  }
  return null;
}

async function syncOpenCodeConfig(
  opts: {
    quiet?: boolean;
    claudeSettingsPath?: string;
    userId?: string;
    configPath?: string;
  } = {}
): Promise<{ updated: boolean; mcpCount: number }> {
  const configPath = opts.configPath || path.join(getOpenCodeConfigDir(), 'opencode.json');
  const config = readJsonObject(configPath);
  if (!config.$schema) {
    config.$schema = 'https://opencode.ai/config.json';
  }

  const skills = isRecord(config.skills) ? config.skills : {};
  const paths = Array.isArray(skills.paths)
    ? skills.paths.filter((value): value is string => typeof value === 'string')
    : [];
  const claudeSkillsDir = path.join(getClaudeConfigHome(), 'skills');
  if (!paths.includes(claudeSkillsDir)) paths.push(claudeSkillsDir);
  skills.paths = paths;
  config.skills = skills;

  const mcp = isRecord(config.mcp) ? config.mcp : {};
  let mcpCount = 0;
  for (const [name, server] of Object.entries(getClaudeMcpServers(opts.claudeSettingsPath))) {
    const entry = toOpenCodeMcpConfig(server);
    if (!entry) continue;
    mcp[name] = entry;
    mcpCount += 1;
  }
  config.mcp = mcp;
  const storedProviders = opts.userId ? await readOpenCodeProvidersForUser(opts.userId) : undefined;
  applyZaiVisionMcpConfig(config, storedProviders ? { providers: storedProviders } : undefined);
  applyOpenCodePrimaryAgentConfig(config);
  await applyWebuiOpenCodeProviderConfig(config, opts.userId, storedProviders);

  const next = `${JSON.stringify(config, null, 2)}\n`;
  const updated = writeIfChanged(configPath, next);
  if (!opts.quiet) {
    console.log(
      `[init] OpenCode config synced: ${mcpCount} MCP servers, skills path ${updated ? 'updated' : 'ok'}`
    );
  }
  return { updated, mcpCount };
}

export async function syncProviderLinks(
  opts: {
    quiet?: boolean;
    userId?: string;
    opencodeConfigPath?: string;
    opencodeAgentsDir?: string;
  } = {}
): Promise<ProviderLinksSyncResult> {
  const opencodeAgents = syncOpencodeAgents({
    quiet: true,
    destinationDir: opts.opencodeAgentsDir,
  });
  const opencodeConfig = await syncOpenCodeConfig({
    quiet: true,
    userId: opts.userId,
    configPath: opts.opencodeConfigPath,
  });

  if (!opts.quiet) {
    console.log(
      `[init] Provider links synced: OpenCode agents ${opencodeAgents.converted}/${opencodeAgents.skipped}, ` +
        `MCP OpenCode=${opencodeConfig.mcpCount}`
    );
  }

  return { opencodeAgents, opencodeConfig };
}
