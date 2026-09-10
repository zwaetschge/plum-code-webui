import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getOpenCodeProviderCatalog,
  refreshOpenCodeModelsCache,
  type OpenCodeProviderCatalog,
} from './opencodeCatalog.js';
import {
  getOpenCodeCredentialEnvVars,
  readOpenCodeProvidersForUser,
  type OpenCodeProvider,
} from './opencodeProviderKeys.js';
import {
  ensureOpenCodeTenantDirectories,
  resolveOpenCodeTenantPaths,
} from '../services/opencode/tenantPaths.js';
import { syncProviderLinks } from './providerLinks.js';
import { lookupContextWindow } from './contextWindow.js';
import { writeFileAtomicSync } from './atomicWrite.js';

const CLAUDE_AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const PI_ROOT = path.join(os.homedir(), '.pi', 'webui-users');
/** Headroom Pi keeps before auto-compaction (`contextWindow - reserveTokens`). */
export const PI_COMPACTION_RESERVE_TOKENS = 40_000;
/** Upper bound for `maxTokens` written into Pi's models.json. */
export const PI_MAX_TOKENS_CAP = 32_768;

interface ClaudeMcpServer {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface ClaudeSettings {
  mcpServers?: Record<string, ClaudeMcpServer>;
}

export interface PiConfigSyncResult {
  agentDir: string;
  modelCount: number;
  providerCount: number;
  mcpCount: number;
  agentCount: number;
  extensions: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function writeJsonIfChanged(filePath: string, value: unknown): void {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  let current = '';
  try {
    current = fs.readFileSync(filePath, 'utf8');
  } catch {
    // Created below.
  }
  if (current === next) return;
  writeFileAtomicSync(filePath, next, { mode: 0o600 });
}

function writeTextIfChanged(filePath: string, value: string): void {
  let current = '';
  try {
    current = fs.readFileSync(filePath, 'utf8');
  } catch {
    // Created below.
  }
  if (current === value) return;
  writeFileAtomicSync(filePath, value, { mode: 0o644 });
}

function safeUserSegment(userId: string): string {
  const safe = userId.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
  return safe || 'default';
}

function inferPiApi(
  providerId: string
): 'anthropic-messages' | 'openai-completions' | 'openai-responses' | 'google-generative-ai' {
  const id = providerId.toLowerCase();
  if (id === 'anthropic' || id.includes('claude')) return 'anthropic-messages';
  if (id === 'google' || id.includes('gemini')) return 'google-generative-ai';
  if (id === 'openai') return 'openai-responses';
  return 'openai-completions';
}

function modelSupportsReasoning(modelId: string): boolean {
  return /(?:reason|thinking|(^|[-_/])o[134](?:[-_/]|$)|gpt-5|glm-5|kimi|deepseek-r)/i.test(
    modelId
  );
}

function modelSupportsImages(modelId: string): boolean {
  return /(?:vision|vl|gpt-4o|gpt-5|claude|gemini|glm-4\.5v)/i.test(modelId);
}

function humanizeModel(modelId: string): string {
  return modelId
    .replace(/[-_]/g, ' ')
    .replace(/\bglm\b/gi, 'GLM')
    .replace(/\bgpt\b/gi, 'GPT')
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

export function isPiRunnableModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  return !(
    /^wan\d/.test(id) ||
    id.includes('happyhorse') ||
    /(^|[-_/])(?:image|video|i2v|t2v|r2v)(?:[-_.:/]|$)/.test(id)
  );
}

export function buildPiProviderConfig(
  provider: OpenCodeProvider,
  catalog: OpenCodeProviderCatalog = getOpenCodeProviderCatalog(),
  configuredModelIds: string[] = []
): Record<string, unknown> | null {
  const catalogProvider = catalog[provider.id];
  const baseUrl = provider.baseUrl || catalogProvider?.api;
  // Union, not either/or. Pi used to take the OpenCode tenant file when it had
  // an entry and the catalog otherwise, so a provider listed in one source hid
  // every model known only to the other — and a provider missing from the
  // catalog (a self-hosted or newly added endpoint) existed for Pi only as long
  // as OpenCode had written a config for it.
  const modelIds = [
    ...new Set([
      ...(provider.models ?? []),
      ...configuredModelIds,
      ...(catalogProvider?.models ?? []),
    ]),
  ].filter(isPiRunnableModel);
  if (!provider.enabled || !baseUrl || modelIds.length === 0) return null;

  const envVar = getOpenCodeCredentialEnvVars(provider.id, catalog)[0];
  if (!envVar) return null;

  return {
    baseUrl,
    api: inferPiApi(provider.id),
    apiKey: `$${envVar}`,
    authHeader: true,
    models: modelIds.map((modelId) => {
      // Pi defaults an unspecified window to 128k. Without this every
      // WebUI-provisioned model compacted at ~112k and the context tracker read
      // 128k no matter which model ran. Catalog limits win; otherwise the shared
      // family table; unknown families stay unset so Pi's conservative default
      // applies rather than a guess.
      const limit = catalogProvider?.modelLimits?.[modelId];
      const contextWindow = limit?.context ?? lookupContextWindow(`${provider.id}/${modelId}`);
      return {
        id: modelId,
        name: humanizeModel(modelId),
        reasoning: modelSupportsReasoning(modelId),
        input: modelSupportsImages(modelId) ? ['text', 'image'] : ['text'],
        ...(contextWindow ? { contextWindow } : {}),
        // models.dev's `output` is the model's ceiling (131k for Qwen Max). Some
        // OpenAI-compatible endpoints reserve `max_tokens` out of the window up
        // front, so keep the request budget modest; Pi's own default is 16k.
        ...(limit?.output ? { maxTokens: Math.min(limit.output, PI_MAX_TOKENS_CAP) } : {}),
      };
    }),
  };
}

export function parsePiProviderModels(config: unknown): Record<string, string[]> {
  if (!isRecord(config) || !isRecord(config.provider)) return {};

  const providers: Record<string, string[]> = {};
  for (const [providerId, rawProvider] of Object.entries(config.provider)) {
    if (!isRecord(rawProvider) || !isRecord(rawProvider.models)) continue;
    const models = Object.keys(rawProvider.models).filter((modelId) => modelId.trim().length > 0);
    if (models.length > 0) providers[providerId] = models;
  }
  return providers;
}

function readPiProviderModelsForUser(userId: string): Record<string, string[]> {
  const tenantPaths = resolveOpenCodeTenantPaths(userId);
  const config = readJsonObject(path.join(tenantPaths.configDir, 'opencode.json'));
  return parsePiProviderModels(config);
}

export function buildPiModelCatalog(
  storedProviders: OpenCodeProvider[],
  catalog: OpenCodeProviderCatalog,
  configuredModels: Record<string, string[]>
): {
  piProviders: Record<string, unknown>;
  models: string[];
} {
  const piProviders: Record<string, unknown> = {};
  const models: string[] = [];

  for (const provider of storedProviders.filter((entry) => entry.enabled)) {
    const entry = buildPiProviderConfig(provider, catalog, configuredModels[provider.id]);
    if (!entry) continue;
    piProviders[provider.id] = entry;
    const entryModels = Array.isArray(entry.models)
      ? (entry.models as Array<{ id?: unknown }>)
          .map((model) => (typeof model.id === 'string' ? model.id.trim() : ''))
          .filter((modelId) => modelId.length > 0)
      : [];
    models.push(...entryModels.map((modelId) => `${provider.id}/${modelId}`));
  }

  return {
    piProviders,
    models: [...new Set(models)],
  };
}

async function buildPiProvidersForUser(userId: string): Promise<{
  storedProviders: OpenCodeProvider[];
  piProviders: Record<string, unknown>;
  models: string[];
}> {
  const storedProviders = (await readOpenCodeProvidersForUser(userId)).filter(
    (provider) => provider.enabled
  );
  const resolved = buildPiModelCatalog(
    storedProviders,
    getOpenCodeProviderCatalog(),
    readPiProviderModelsForUser(userId)
  );
  return { storedProviders, ...resolved };
}

export async function getPiModelsForUser(userId: string): Promise<string[]> {
  const models = (await buildPiProvidersForUser(userId)).models;
  // Extension-provided models are not in the registry, so append them — but only
  // once this user has actually completed `/login antigravity`. Offering them on
  // extension presence alone put seven models in the picker that every account
  // could select and none could use: the turn failed with an unknown-provider
  // error deep in Pi, far from the dropdown that suggested it.
  if (!hasPiAntigravityExtension() || !hasPiAntigravityLogin(userId)) return models;
  return [...new Set([...models, ...PI_ANTIGRAVITY_MODELS])];
}

function readClaudeMcpServers(): Record<string, ClaudeMcpServer> {
  const settings = readJsonObject(CLAUDE_SETTINGS_PATH) as ClaudeSettings;
  return settings.mcpServers && typeof settings.mcpServers === 'object' ? settings.mcpServers : {};
}

function shouldEnableZaiVision(providers: OpenCodeProvider[]): boolean {
  const policy = (process.env.OPENCODE_ZAI_VISION_MCP || 'auto').trim().toLowerCase();
  if (['0', 'false', 'off', 'disabled', 'none'].includes(policy)) return false;
  const hasStoredKey = providers.some(
    (provider) =>
      provider.enabled && ['z-ai', 'zai'].includes(provider.id.toLowerCase()) && !!provider.apiKey
  );
  if (hasStoredKey) return true;
  return (
    ['1', 'true', 'on', 'always'].includes(policy) &&
    typeof process.env.Z_AI_API_KEY === 'string' &&
    process.env.Z_AI_API_KEY.trim().length > 0
  );
}

function buildPiMcpConfig(providers: OpenCodeProvider[]): Record<string, unknown> {
  const mcpServers: Record<string, unknown> = { ...readClaudeMcpServers() };
  if (shouldEnableZaiVision(providers) && !mcpServers['zai-vision']) {
    mcpServers['zai-vision'] = {
      command: 'npx',
      args: ['-y', '@z_ai/mcp-server@latest'],
      env: { Z_AI_MODE: 'ZAI' },
    };
  }
  return {
    settings: {
      toolPrefix: 'server',
      idleTimeout: 10,
      outputGuard: true,
    },
    mcpServers,
  };
}

const PI_TOOL_MAP: Record<string, string> = {
  read: 'read',
  write: 'write',
  edit: 'edit',
  glob: 'find',
  grep: 'grep',
  bash: 'bash',
  webfetch: 'mcp',
  websearch: 'mcp',
  task: 'subagent',
  todowrite: 'write',
  ls: 'ls',
};

function convertAgentForPi(source: string): string {
  return source.replace(/^tools:\s*(.+)$/m, (_line, raw: string) => {
    const tools = raw
      .split(',')
      .map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
      .map((value) => PI_TOOL_MAP[value.toLowerCase()])
      .filter((value): value is string => !!value);
    return tools.length > 0
      ? `tools: ${[...new Set(tools)].join(', ')}`
      : 'tools: read, grep, find, ls';
  });
}

function syncPiAgents(agentDir: string): number {
  const targetDir = path.join(agentDir, 'agents');
  fs.mkdirSync(targetDir, { recursive: true });
  const sourceFiles = fs.existsSync(CLAUDE_AGENTS_DIR)
    ? fs.readdirSync(CLAUDE_AGENTS_DIR).filter((name) => name.endsWith('.md'))
    : [];
  const names = new Set(sourceFiles);

  for (const name of sourceFiles) {
    const source = fs.readFileSync(path.join(CLAUDE_AGENTS_DIR, name), 'utf8');
    writeTextIfChanged(path.join(targetDir, name), convertAgentForPi(source));
  }

  for (const name of fs.readdirSync(targetDir)) {
    if (name.endsWith('.md') && !names.has(name)) {
      fs.unlinkSync(path.join(targetDir, name));
    }
  }
  return sourceFiles.length;
}

function firstExisting(candidates: string[]): string | null {
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function resolvePiExtensionPaths(): string[] {
  const prefixes = ['/home/node/.npm-global', '/opt/plum-cli'];
  const mcp = firstExisting(
    prefixes.map((prefix) => path.join(prefix, 'lib', 'node_modules', 'pi-mcp-adapter', 'index.ts'))
  );
  const subagent = firstExisting(
    prefixes.map((prefix) =>
      path.join(
        prefix,
        'lib',
        'node_modules',
        '@earendil-works',
        'pi-coding-agent',
        'examples',
        'extensions',
        'subagent',
        'index.ts'
      )
    )
  );
  const permission = firstExisting([
    path.resolve(process.cwd(), 'scripts', 'pi-webui-extension.ts'),
    '/app/scripts/pi-webui-extension.ts',
  ]);
  // Pi removed built-in Google Antigravity in 0.71.0. The extension registers
  // the provider again, with its own OAuth flow; Pi stores the tokens in the
  // per-user agent dir like any other login.
  // Image copy first, unlike the others: a separately installed copy brings its
  // own nested @earendil-works/pi-agent-core, and the duplicate module makes Pi
  // silently ignore the provider registration ("Unknown provider antigravity").
  // The copy installed next to pi-coding-agent shares that core.
  const antigravity = firstExisting(
    [...prefixes]
      .reverse()
      .map((prefix) =>
        path.join(prefix, 'lib', 'node_modules', 'pi-antigravity', 'src', 'index.ts')
      )
  );
  return [mcp, subagent, permission, antigravity].filter((value): value is string => !!value);
}

/**
 * Models the Antigravity extension registers under the `antigravity` provider.
 *
 * Mirrored here rather than read from the package: the WebUI resolves the Pi
 * model list from the provider registry, and an extension's catalog only
 * materialises inside Pi's own process. Without this the models exist but
 * cannot be picked in the UI. Keep in sync with pi-antigravity's models.ts
 * when bumping PI_ANTIGRAVITY_VERSION in the Dockerfile.
 */
export const PI_ANTIGRAVITY_MODELS = [
  'antigravity/gemini-3.7-flash',
  'antigravity/gemini-3.6-flash',
  'antigravity/gemini-3.5-flash',
  'antigravity/gemini-3.1-pro',
  'antigravity/claude-opus-4-6',
  'antigravity/claude-sonnet-4-6',
  'antigravity/gpt-oss-120b',
] as const;

/** True when the Antigravity extension is actually present in this image. */
export function hasPiAntigravityExtension(): boolean {
  return resolvePiExtensionPaths().some((entry) => entry.includes('pi-antigravity'));
}

/**
 * True when this user has completed `/login antigravity`.
 *
 * Pi has no CLI-level login for it — the OAuth flow runs inside a session — and
 * stores the result in the per-user agent dir's auth.json alongside every other
 * credential, so the presence of the provider key is the only signal available
 * outside Pi's own process.
 */
export function hasPiAntigravityLogin(userId: string): boolean {
  const authFile = path.join(PI_ROOT, safeUserSegment(userId), 'agent', 'auth.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(authFile, 'utf8')) as unknown;
    if (!isRecord(parsed)) return false;
    return Object.keys(parsed).some((key) => key.toLowerCase().startsWith('antigravity'));
  } catch {
    return false;
  }
}

export async function syncPiConfig(userId: string): Promise<PiConfigSyncResult> {
  const agentDir = path.join(PI_ROOT, safeUserSegment(userId), 'agent');
  fs.mkdirSync(agentDir, { recursive: true });
  // Per-model context windows come from models.dev; make sure the cache exists
  // before the catalog is read. Bounded by a 20 s timeout, silent on failure.
  await refreshOpenCodeModelsCache();

  const tenantPaths = resolveOpenCodeTenantPaths(userId);
  ensureOpenCodeTenantDirectories(tenantPaths);
  await syncProviderLinks({
    quiet: true,
    userId,
    opencodeConfigPath: path.join(tenantPaths.configDir, 'opencode.json'),
    opencodeAgentsDir: path.join(tenantPaths.configDir, 'agents'),
  });
  const { storedProviders, piProviders, models } = await buildPiProvidersForUser(userId);

  writeJsonIfChanged(path.join(agentDir, 'models.json'), { providers: piProviders });

  const mcpConfig = buildPiMcpConfig(storedProviders);
  writeJsonIfChanged(path.join(agentDir, 'mcp.json'), mcpConfig);
  const mcpServers = isRecord(mcpConfig.mcpServers) ? mcpConfig.mcpServers : {};

  const extensions = resolvePiExtensionPaths();
  const currentSettings = readJsonObject(path.join(agentDir, 'settings.json'));
  const currentCompaction = isRecord(currentSettings.compaction) ? currentSettings.compaction : {};
  writeJsonIfChanged(path.join(agentDir, 'settings.json'), {
    ...currentSettings,
    defaultProjectTrust: 'always',
    enableInstallTelemetry: false,
    // Pi only checks the threshold after a whole agent run, and one agentic run
    // adds 30-40k tokens of tool output. With the 16k default a 128k model went
    // from "fine" to the hard limit inside a single run, and the summariser no
    // longer fitted either. Compact earlier; a user-set value wins.
    compaction: {
      ...currentCompaction,
      reserveTokens:
        typeof currentCompaction.reserveTokens === 'number'
          ? currentCompaction.reserveTokens
          : PI_COMPACTION_RESERVE_TOKENS,
    },
    extensions,
  });

  const agentCount = syncPiAgents(agentDir);
  return {
    agentDir,
    modelCount: models.length,
    providerCount: Object.keys(piProviders).length,
    mcpCount: Object.keys(mcpServers).length,
    agentCount,
    extensions,
  };
}
