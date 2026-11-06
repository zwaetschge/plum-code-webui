import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getModelProviderCatalog,
  refreshModelsCache,
  type ModelProviderCatalog,
} from './modelCatalog.js';
import {
  getModelProviderCredentialEnvVars,
  isPiModelProvider,
  readModelProvidersForUser,
  type ModelProvider,
} from './modelProviderKeys.js';
import { lookupContextWindow } from './contextWindow.js';
import { writeFileAtomicSync } from './atomicWrite.js';
import { refreshProviderModelsInBackground } from './providerModelDiscovery.js';

const CLAUDE_AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const PI_ROOT = path.join(os.homedir(), '.pi', 'webui-users');
/** Headroom Pi keeps before auto-compaction (`contextWindow - reserveTokens`). */
export const PI_COMPACTION_RESERVE_TOKENS = 40_000;
/** Upper bound for `maxTokens` written into Pi's models.json. */
export const PI_MAX_TOKENS_CAP = 32_768;
/**
 * Agent-level retries for long runs. Pi's defaults (3 tries, 2 s base) gave up
 * on a provider that was overloaded for half a minute.
 */
export const PI_RETRY_SETTINGS = {
  enabled: true,
  maxRetries: 8,
  baseDelayMs: 3_000,
  maxAgentDelayMs: 60_000,
};
/**
 * A request that sends nothing for this long counts as stalled and is retried.
 * Pi's 5 minute default left runs hanging for exactly 5:00 before a retry that
 * then answered in seconds; local endpoints still get time for a long prefill.
 */
export const PI_HTTP_IDLE_TIMEOUT_MS = 150_000;

/**
 * Compaction reserve for one model: the global 40k, but at most a quarter of
 * its window. On a 32k model the global value put the threshold below zero,
 * so Pi compacted before every request.
 */
export function piCompactionReserveFor(contextWindow: number): number {
  return Math.min(PI_COMPACTION_RESERVE_TOKENS, Math.floor(contextWindow / 4));
}

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
  return /(?:reason|thinking|(^|[-_/])o[134](?:[-_/]|$)|gpt-5|glm-5|kimi|deepseek-r|deepseek-flash|deepseek-v4)/i.test(
    modelId
  );
}

function modelSupportsImages(modelId: string): boolean {
  return /(?:vision|vl|gpt-4o|gpt-5|claude|gemini|glm-4\.5v|deepseek-flash)/i.test(modelId);
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
  provider: ModelProvider,
  catalog: ModelProviderCatalog = getModelProviderCatalog(),
  configuredModelIds: string[] = []
): Record<string, unknown> | null {
  const catalogProvider = catalog[provider.id];
  const baseUrl = provider.baseUrl || catalogProvider?.api;
  // Union, not either/or: a provider listed in one source must not hide every
  // model known only to the other, and a provider missing from the catalog (a
  // self-hosted or newly added endpoint) still gets its registry models.
  // A list the provider reported itself is complete; the catalog would only add
  // retired models back (DeepSeek's deepseek-chat long after its API dropped it).
  const modelIds = [
    ...new Set([
      ...(provider.models ?? []),
      ...configuredModelIds,
      ...(provider.modelsSource === 'live' ? [] : (catalogProvider?.models ?? [])),
    ]),
  ].filter(isPiRunnableModel);
  if (!provider.enabled || !baseUrl || modelIds.length === 0) return null;

  const envVar = getModelProviderCredentialEnvVars(provider.id, catalog)[0];
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
        // front, so keep the request budget modest. Without a catalog limit Pi
        // used 16k, reasoning included, which cut GLM rounds off mid-answer; a
        // quarter of a known window (capped) leaves room for both.
        ...(limit?.output
          ? { maxTokens: Math.min(limit.output, PI_MAX_TOKENS_CAP) }
          : contextWindow
            ? { maxTokens: Math.min(PI_MAX_TOKENS_CAP, Math.floor(contextWindow / 4)) }
            : {}),
      };
    }),
  };
}

/**
 * Providers Pi implements natively. Mistral has no OpenAI-style base URL in the
 * model catalog or on models.dev, so the generic path drops it; Pi's own
 * provider speaks Mistral's chat API and carries the model metadata. Only the
 * key is passed on (MISTRAL_API_KEY via the credential env).
 *
 * Pi's catalog lists every Mistral model, dated snapshots, legacy and audio
 * ones included, so the picker gets the current chat and code models only.
 */
const PI_NATIVE_PROVIDERS: Record<string, { catalogFile: string; api: string; models: string[] }> =
  {
    mistral: {
      catalogFile: 'mistral.json',
      api: 'mistral-conversations',
      models: [
        'mistral-medium-3.5',
        'mistral-large-latest',
        'devstral-latest',
        'devstral-medium-latest',
        'codestral-latest',
        'magistral-medium-latest',
        'mistral-small-latest',
        'zai-glm-5-3',
      ],
    },
  };

/** The curated models of a native provider that Pi's installed catalog knows. */
export function readPiNativeModelIds(providerId: string): string[] {
  const native = PI_NATIVE_PROVIDERS[providerId];
  if (!native) return [];
  const file = firstExisting(
    ['/home/node/.npm-global', '/opt/plum-cli'].map((prefix) =>
      path.join(
        prefix,
        'lib',
        'node_modules',
        '@earendil-works',
        'pi-coding-agent',
        'node_modules',
        '@earendil-works',
        'pi-ai',
        'dist',
        'providers',
        'data',
        native.catalogFile
      )
    )
  );
  if (!file) return [];
  const data = readJsonObject(file);
  const known = isRecord(data[native.api]) ? (data[native.api] as Record<string, unknown>) : {};
  // Pi keys catalog entries as `<type>:<id>` (`chat:zai-glm-5-3`); the bare id
  // only appears inside each entry. Collect both spellings plus the entries'
  // own `id` field, otherwise not a single curated model matches and the
  // native provider list is silently empty.
  const knownIds = new Set<string>();
  for (const [key, value] of Object.entries(known)) {
    knownIds.add(key);
    knownIds.add(key.includes(':') ? key.slice(key.indexOf(':') + 1) : key);
    if (isRecord(value) && typeof value.id === 'string') knownIds.add(value.id);
  }
  return native.models.filter((id) => knownIds.has(id));
}

/**
 * True when a provider should run through Pi's native implementation. A custom
 * base URL usually means a proxy and stays on the generic path — but pointing a
 * native provider at its own official API is not a proxy. With Mistral the
 * generic OpenAI path sends the system prompt as a `developer` role, which
 * api.mistral.ai rejects with 422, so a turn against the real endpoint only
 * ever works through Pi's `mistral-conversations` provider.
 */
function isPiNativeProviderEndpoint(providerId: string, baseUrl?: string): boolean {
  if (!baseUrl) return true;
  if (providerId !== 'mistral') return false;
  const normalized = baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  return /^https?:\/\/api\.mistral\.ai$/i.test(normalized);
}

export function buildPiModelCatalog(
  storedProviders: ModelProvider[],
  catalog: ModelProviderCatalog,
  configuredModels: Record<string, string[]>,
  nativeModelIds: (providerId: string) => string[] = readPiNativeModelIds
): {
  piProviders: Record<string, unknown>;
  models: string[];
} {
  const piProviders: Record<string, unknown> = {};
  const models: string[] = [];

  for (const provider of storedProviders.filter(isPiModelProvider)) {
    // A custom base URL means a proxy or self-hosted endpoint: that stays on
    // the generic path. Otherwise Pi's native provider serves the account.
    if (
      PI_NATIVE_PROVIDERS[provider.id] &&
      isPiNativeProviderEndpoint(provider.id, provider.baseUrl)
    ) {
      const native = nativeModelIds(provider.id);
      if (native.length > 0) {
        models.push(...native.map((modelId) => `${provider.id}/${modelId}`));
        continue;
      }
    }
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
  storedProviders: ModelProvider[];
  piProviders: Record<string, unknown>;
  models: string[];
}> {
  const storedProviders = (await readModelProvidersForUser(userId)).filter(
    (provider) => provider.enabled
  );
  const resolved = buildPiModelCatalog(storedProviders, getModelProviderCatalog(), {});
  return { storedProviders, ...resolved };
}

/**
 * The models the session pickers offer: the user's stored list
 * (`cliProviderModelLists.pi`, chosen in the Pi settings) in its order, so its
 * first entry is the default, limited to models that are still available. No
 * stored list, or nothing of it left, offers every available model.
 */
export function selectVisiblePiModels(available: string[], stored: string[]): string[] {
  const availableIds = new Set(available);
  const visible = [...new Set(stored.map((model) => model.trim()))].filter((model) =>
    availableIds.has(model)
  );
  return visible.length > 0 ? visible : available;
}

export async function getPiModelsForUser(userId: string): Promise<string[]> {
  // Keeps the registry's lists current; the result shows on the next read.
  refreshProviderModelsInBackground(userId);
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

function shouldEnableZaiVision(providers: ModelProvider[]): boolean {
  // OPENCODE_ZAI_VISION_MCP is the pre-2026-10-27 name, still honoured.
  const policy = (process.env.PLUM_ZAI_VISION_MCP || process.env.OPENCODE_ZAI_VISION_MCP || 'auto')
    .trim()
    .toLowerCase();
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

function buildPiMcpConfig(providers: ModelProvider[]): Record<string, unknown> {
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
  // Ultracode for Pi: the `workflow` tool, active for the `ultracode` effort
  // or a prompt that says "ultracode".
  const ultracode = firstExisting([
    path.resolve(process.cwd(), 'scripts', 'pi-ultracode-extension.ts'),
    '/app/scripts/pi-ultracode-extension.ts',
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
  return [mcp, subagent, permission, ultracode, antigravity].filter(
    (value): value is string => !!value
  );
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
/** Pi's auth.json for a WebUI user (Antigravity OAuth lives here after `/login`). */
export function piAuthFile(userId: string): string {
  return path.join(PI_ROOT, safeUserSegment(userId), 'agent', 'auth.json');
}

export function hasPiAntigravityLogin(userId: string): boolean {
  const authFile = piAuthFile(userId);
  try {
    const parsed = JSON.parse(fs.readFileSync(authFile, 'utf8')) as unknown;
    if (!isRecord(parsed)) return false;
    return Object.keys(parsed).some((key) => key.toLowerCase().startsWith('antigravity'));
  } catch {
    return false;
  }
}

/**
 * Pi's agent settings for long, unattended runs. Values the user set in the
 * file win; only missing ones are filled in.
 */
export function buildPiAgentSettings(
  current: Record<string, unknown>,
  piProviders: Record<string, unknown>,
  extensions: string[]
): Record<string, unknown> {
  const compaction = isRecord(current.compaction) ? current.compaction : {};
  const retry = isRecord(current.retry) ? current.retry : {};

  // Small windows get a reserve that fits them; the global one stays for the rest.
  const generatedOverrides: Record<string, { reserveTokens: number }> = {};
  for (const [providerId, entry] of Object.entries(piProviders)) {
    const models = isRecord(entry) && Array.isArray(entry.models) ? entry.models : [];
    for (const model of models) {
      if (!isRecord(model) || typeof model.id !== 'string') continue;
      const window = typeof model.contextWindow === 'number' ? model.contextWindow : 0;
      if (window <= 0 || piCompactionReserveFor(window) >= PI_COMPACTION_RESERVE_TOKENS) continue;
      generatedOverrides[`${providerId}/${model.id}`] = {
        reserveTokens: piCompactionReserveFor(window),
      };
    }
  }
  const userOverrides = isRecord(compaction.modelOverrides) ? compaction.modelOverrides : {};
  const modelOverrides = { ...generatedOverrides, ...userOverrides };

  return {
    ...current,
    defaultProjectTrust: 'always',
    enableInstallTelemetry: false,
    // Pi only checks the threshold after a whole agent run, and one agentic run
    // adds 30-40k tokens of tool output. With the 16k default a 128k model went
    // from "fine" to the hard limit inside a single run, and the summariser no
    // longer fitted either. Compact earlier; a user-set value wins.
    compaction: {
      ...compaction,
      reserveTokens:
        typeof compaction.reserveTokens === 'number'
          ? compaction.reserveTokens
          : PI_COMPACTION_RESERVE_TOKENS,
      ...(Object.keys(modelOverrides).length > 0 ? { modelOverrides } : {}),
    },
    retry: { ...PI_RETRY_SETTINGS, ...retry },
    httpIdleTimeoutMs:
      current.httpIdleTimeoutMs !== undefined ? current.httpIdleTimeoutMs : PI_HTTP_IDLE_TIMEOUT_MS,
    extensions,
  };
}

export async function syncPiConfig(userId: string): Promise<PiConfigSyncResult> {
  const agentDir = path.join(PI_ROOT, safeUserSegment(userId), 'agent');
  fs.mkdirSync(agentDir, { recursive: true });
  // Per-model context windows come from models.dev; make sure the cache exists
  // before the catalog is read. Bounded by a 20 s timeout, silent on failure.
  await refreshModelsCache();

  const { storedProviders, piProviders, models } = await buildPiProvidersForUser(userId);

  writeJsonIfChanged(path.join(agentDir, 'models.json'), { providers: piProviders });

  const mcpConfig = buildPiMcpConfig(storedProviders);
  writeJsonIfChanged(path.join(agentDir, 'mcp.json'), mcpConfig);
  const mcpServers = isRecord(mcpConfig.mcpServers) ? mcpConfig.mcpServers : {};

  const extensions = resolvePiExtensionPaths();
  const currentSettings = readJsonObject(path.join(agentDir, 'settings.json'));
  writeJsonIfChanged(
    path.join(agentDir, 'settings.json'),
    buildPiAgentSettings(currentSettings, piProviders, extensions)
  );

  const agentCount = syncPiAgents(agentDir);
  return {
    agentDir,
    modelCount: models.length,
    // Native providers (Mistral) have models but no models.json entry.
    providerCount: new Set(models.map((model) => model.split('/')[0])).size,
    mcpCount: Object.keys(mcpServers).length,
    agentCount,
    extensions,
  };
}
