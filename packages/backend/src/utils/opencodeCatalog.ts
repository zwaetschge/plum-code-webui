import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeFileAtomicSync } from './atomicWrite.js';

export type OpenCodeProviderSource = 'models.dev' | 'cli' | 'config' | 'fallback';

/** Per-model token limits as models.dev publishes them (`limit.context/output`). */
export interface OpenCodeModelLimit {
  context?: number;
  output?: number;
}

export interface OpenCodeProviderInfo {
  name: string;
  models: string[];
  /** Keyed by model id; only present for models the cache carries limits for. */
  modelLimits?: Record<string, OpenCodeModelLimit>;
  description: string;
  env?: string[];
  api?: string;
  doc?: string;
  source: OpenCodeProviderSource;
  configured?: boolean;
  hasKey?: boolean;
}

export type OpenCodeProviderCatalog = Record<string, OpenCodeProviderInfo>;

export const ZAI_CODING_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';

const OPENCODE_PROVIDER_PRIORITY = [
  'opencode',
  'opencode-go',
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'mistral',
  'zai',
  'z-ai',
  'zhipuai',
  'deepseek',
  'xai',
  'x-ai',
  'groq',
  'cohere',
  'togetherai',
  'together',
  'ollama-cloud',
  'ollama',
  'github-copilot',
  'github-models',
  'vercel',
  'amazon-bedrock',
  'azure',
  'moonshotai',
  'kimi-for-coding',
  'cerebras',
  'fireworks-ai',
  'perplexity',
  'deepinfra',
  'huggingface',
  'lmstudio',
  'llama-local',
];

const NAME_OVERRIDES: Record<string, string> = {
  opencode: 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
  zai: 'Z.AI',
  'z-ai': 'Z-AI',
  zhipuai: 'Zhipu AI',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  'x-ai': 'xAI',
  groq: 'Groq',
  cohere: 'Cohere',
  togetherai: 'Together AI',
  together: 'Together AI',
  'ollama-cloud': 'Ollama Cloud',
  ollama: 'Ollama',
  'github-copilot': 'GitHub Copilot',
  'github-models': 'GitHub Models',
  vercel: 'Vercel AI Gateway',
  'amazon-bedrock': 'Amazon Bedrock',
  azure: 'Azure',
  moonshotai: 'Moonshot AI',
  'kimi-for-coding': 'Kimi For Coding',
  cerebras: 'Cerebras',
  'fireworks-ai': 'Fireworks AI',
  perplexity: 'Perplexity',
  deepinfra: 'DeepInfra',
  huggingface: 'Hugging Face',
  lmstudio: 'LM Studio',
};

const FALLBACK_PROVIDERS: Array<{
  id: string;
  name: string;
  env?: string[];
  api?: string;
  doc?: string;
  models: string[];
}> = [
  {
    id: 'opencode',
    name: 'OpenCode Zen',
    env: ['OPENCODE_API_KEY'],
    doc: 'https://opencode.ai/zen',
    models: ['claude-sonnet-4-6', 'gpt-5.2', 'gpt-5-codex', 'kimi-k2.7'],
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    env: ['OPENCODE_API_KEY'],
    models: ['kimi-k2.7', 'kimi-k2.6', 'glm-5.1'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    env: ['OPENAI_API_KEY'],
    api: 'https://api.openai.com/v1',
    models: ['gpt-5.2', 'gpt-5.5', 'gpt-4o', 'gpt-4o-mini'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    env: ['ANTHROPIC_API_KEY'],
    api: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-6', 'claude-opus-4-5', 'claude-haiku-4-5'],
  },
  {
    id: 'z-ai',
    name: 'Z-AI',
    env: ['ZAI_API_KEY'],
    api: ZAI_CODING_BASE_URL,
    models: ['glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.6'],
  },
  {
    id: 'zai',
    name: 'Z.AI',
    env: ['ZAI_API_KEY'],
    api: ZAI_CODING_BASE_URL,
    models: ['glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.6'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    env: ['DEEPSEEK_API_KEY'],
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'google',
    name: 'Google',
    env: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    models: ['gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    env: ['OPENROUTER_API_KEY'],
    api: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5.2', 'z-ai/glm-4.7'],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    env: ['MISTRAL_API_KEY'],
    models: ['mistral-medium-latest', 'mistral-large-latest', 'codestral-latest'],
  },
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    env: ['OLLAMA_API_KEY'],
    api: 'https://ollama.com/v1',
    models: ['glm-5.1', 'qwen3-coder:480b', 'kimi-k2.6'],
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string' && !!item);
  return strings.length > 0 ? strings : undefined;
}

function expandHome(value: string): string {
  return value.replace(/^~/, os.homedir());
}

function augmentedPath(): string {
  const extra = ['/home/node/.npm-global/bin', '/opt/plum-cli/bin', '/usr/local/bin', '/usr/bin'];
  const current = process.env.PATH || '';
  const parts = current.split(':').filter(Boolean);
  for (const item of extra) {
    if (!parts.includes(item)) parts.unshift(item);
  }
  return parts.join(':');
}

export function buildOpenCodeCommandEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: augmentedPath(),
    OPENCODE_CONFIG_DIR:
      process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode'),
    OPENCODE_DATA_DIR:
      process.env.OPENCODE_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'opencode'),
  };
}

export function resolveOpenCodeBinary(command = process.env.CLI_PROVIDER_OPENCODE_COMMAND): string {
  const requested = command || 'opencode';
  const candidates = requested.includes('/')
    ? [expandHome(requested)]
    : [
        `/home/node/.npm-global/bin/${requested}`,
        `/opt/plum-cli/bin/${requested}`,
        `/usr/local/bin/${requested}`,
        `/usr/bin/${requested}`,
      ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  try {
    const found = execFileSync('which', [requested], {
      encoding: 'utf-8',
      env: buildOpenCodeCommandEnv(),
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    return found ? fs.realpathSync(found) : requested;
  } catch {
    return requested;
  }
}

export function getOpenCodeModelsCachePath(): string {
  if (process.env.OPENCODE_MODELS_CACHE_PATH) {
    return expandHome(process.env.OPENCODE_MODELS_CACHE_PATH);
  }
  const cacheHome = process.env.XDG_CACHE_HOME
    ? expandHome(process.env.XDG_CACHE_HOME)
    : path.join(os.homedir(), '.cache');
  return path.join(cacheHome, 'opencode', 'models.json');
}

function humanizeProviderId(id: string): string {
  if (NAME_OVERRIDES[id]) return NAME_OVERRIDES[id]!;
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function providerDescription(info: {
  env?: string[];
  api?: string;
  doc?: string;
  source: OpenCodeProviderSource;
}): string {
  const parts: string[] = [];
  if (info.env?.length) {
    parts.push(`env: ${info.env.join(', ')}`);
  } else if (info.api) {
    parts.push(info.api);
  } else {
    parts.push(info.source === 'cli' ? 'from opencode CLI' : 'OpenCode provider');
  }
  if (info.doc) parts.push(info.doc);
  return parts.join(' - ');
}

function modelIdsFromRaw(models: unknown): string[] {
  const modelRecord = asRecord(models);
  if (!modelRecord) return [];

  const ids = new Set<string>();
  for (const [modelKey, rawModel] of Object.entries(modelRecord)) {
    const model = asRecord(rawModel);
    const rawId = model?.id;
    const modelId = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : modelKey;
    if (modelId.trim()) ids.add(modelId.trim());
  }
  return [...ids];
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function modelLimitsFromRaw(models: unknown): Record<string, OpenCodeModelLimit> | undefined {
  const modelRecord = asRecord(models);
  if (!modelRecord) return undefined;

  const limits: Record<string, OpenCodeModelLimit> = {};
  for (const [modelKey, rawModel] of Object.entries(modelRecord)) {
    const model = asRecord(rawModel);
    const limit = asRecord(model?.limit);
    if (!limit) continue;
    const rawId = model?.id;
    const modelId = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : modelKey.trim();
    const context = positiveInteger(limit.context);
    const output = positiveInteger(limit.output);
    if (!modelId || (!context && !output)) continue;
    limits[modelId] = { ...(context ? { context } : {}), ...(output ? { output } : {}) };
  }
  return Object.keys(limits).length > 0 ? limits : undefined;
}

function mergeProvider(
  catalog: OpenCodeProviderCatalog,
  id: string,
  info: OpenCodeProviderInfo
): void {
  const existing = catalog[id];
  if (!existing) {
    catalog[id] = { ...info, models: [...new Set(info.models)] };
    return;
  }

  const modelLimits =
    existing.modelLimits || info.modelLimits
      ? { ...info.modelLimits, ...existing.modelLimits }
      : undefined;
  catalog[id] = {
    name: existing.name || info.name,
    models: [...new Set([...existing.models, ...info.models])],
    ...(modelLimits ? { modelLimits } : {}),
    description: existing.description || info.description,
    env: existing.env ?? info.env,
    api: existing.api ?? info.api,
    doc: existing.doc ?? info.doc,
    source: existing.source === 'fallback' ? info.source : existing.source,
    configured: existing.configured || info.configured,
    hasKey: existing.hasKey || info.hasKey,
  };
}

export function sortOpenCodeProviderCatalog(
  catalog: OpenCodeProviderCatalog
): OpenCodeProviderCatalog {
  const priority = new Map(OPENCODE_PROVIDER_PRIORITY.map((id, index) => [id, index]));
  const entries = Object.entries(catalog).sort(([idA, a], [idB, b]) => {
    const priorityA = priority.get(idA) ?? Number.MAX_SAFE_INTEGER;
    const priorityB = priority.get(idB) ?? Number.MAX_SAFE_INTEGER;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return Object.fromEntries(entries);
}

export function parseOpenCodeModelsCache(raw: string): OpenCodeProviderCatalog {
  const parsed = JSON.parse(raw) as unknown;
  const root = asRecord(parsed);
  if (!root) return {};

  const catalog: OpenCodeProviderCatalog = {};
  for (const [providerKey, rawProvider] of Object.entries(root)) {
    const provider = asRecord(rawProvider);
    if (!provider) continue;

    const rawId = provider.id;
    const id = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : providerKey;
    const rawName = provider.name;
    const env = asStringArray(provider.env);
    const rawApi = provider.api;
    const rawDoc = provider.doc;
    const api = typeof rawApi === 'string' && rawApi.trim() ? rawApi.trim() : undefined;
    const doc = typeof rawDoc === 'string' && rawDoc.trim() ? rawDoc.trim() : undefined;
    const models = modelIdsFromRaw(provider.models);
    if (!id || models.length === 0) continue;
    const modelLimits = modelLimitsFromRaw(provider.models);

    const name =
      typeof rawName === 'string' && rawName.trim() ? rawName.trim() : humanizeProviderId(id);
    mergeProvider(catalog, id, {
      name,
      models,
      ...(modelLimits ? { modelLimits } : {}),
      description: providerDescription({ env, api, doc, source: 'models.dev' }),
      env,
      api,
      doc,
      source: 'models.dev',
    });
  }

  return sortOpenCodeProviderCatalog(catalog);
}

const MODELS_DEV_URL = 'https://models.dev/api.json';
const MODELS_DEV_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let modelsDevRefresh: Promise<boolean> | null = null;

/**
 * Populate the models.dev cache OpenCode would normally write itself.
 *
 * OpenCode only writes `~/.cache/opencode/models.json` when its own server
 * fetches the catalog; in a Pi-only or fresh container the file never exists,
 * so every provider fell back to the CLI list without per-model limits — and
 * Pi then assumed 128k for models that actually have 1M. Fetch it ourselves,
 * at most once a day, and never block a caller on the network.
 */
export async function refreshOpenCodeModelsCache(
  options: { force?: boolean } = {}
): Promise<boolean> {
  const cachePath = getOpenCodeModelsCachePath();
  if (!options.force) {
    try {
      const age = Date.now() - fs.statSync(cachePath).mtimeMs;
      if (age < MODELS_DEV_CACHE_MAX_AGE_MS) return false;
    } catch {
      // Missing: fetch below.
    }
  }
  if (modelsDevRefresh) return modelsDevRefresh;
  modelsDevRefresh = (async () => {
    try {
      const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text();
      // Validate before touching the cache: a partial body must not replace a
      // good file with an unparsable one.
      const providers = Object.keys(parseOpenCodeModelsCache(raw)).length;
      if (providers === 0) throw new Error('catalog is empty');
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      writeFileAtomicSync(cachePath, raw, { mode: 0o644 });
      resetOpenCodeProviderCatalogCache();
      console.log(`[OPENCODE-CATALOG] models.dev cache refreshed (${providers} providers)`);
      return true;
    } catch (error) {
      console.warn(
        `[OPENCODE-CATALOG] models.dev refresh failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    } finally {
      modelsDevRefresh = null;
    }
  })();
  return modelsDevRefresh;
}

function readOpenCodeModelsCache(): OpenCodeProviderCatalog {
  const cachePath = getOpenCodeModelsCachePath();
  try {
    return parseOpenCodeModelsCache(fs.readFileSync(cachePath, 'utf-8'));
  } catch {
    return {};
  }
}

function readOpenCodeConfigProviders(): OpenCodeProviderCatalog {
  const configDir = process.env.OPENCODE_CONFIG_DIR
    ? expandHome(process.env.OPENCODE_CONFIG_DIR)
    : path.join(os.homedir(), '.config', 'opencode');
  const configPath = path.join(configDir, 'opencode.json');

  try {
    const config = asRecord(JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown);
    const providers = asRecord(config?.provider);
    if (!providers) return {};

    const catalog: OpenCodeProviderCatalog = {};
    for (const [id, rawBlock] of Object.entries(providers)) {
      const block = asRecord(rawBlock);
      if (!block) continue;
      const rawName = block.name;
      const options = asRecord(block.options);
      const rawBaseUrl = options?.baseURL ?? options?.baseUrl;
      const api =
        typeof rawBaseUrl === 'string' && rawBaseUrl.trim() ? rawBaseUrl.trim() : undefined;
      const name =
        typeof rawName === 'string' && rawName.trim() ? rawName.trim() : humanizeProviderId(id);
      mergeProvider(catalog, id, {
        name,
        models: modelIdsFromRaw(block.models),
        description: providerDescription({ api, source: 'config' }),
        api,
        source: 'config',
        configured: true,
      });
    }
    return catalog;
  } catch {
    return {};
  }
}

export function discoverOpenCodeCliModels(): Record<string, string[]> {
  const binary = resolveOpenCodeBinary();
  try {
    const raw = execFileSync(binary, ['models'], {
      encoding: 'utf-8',
      env: buildOpenCodeCommandEnv(),
      timeout: 10_000,
      maxBuffer: 50 * 1024 * 1024,
    }).replace(/\x1B\[[0-9;]*m/g, '');

    const grouped: Record<string, string[]> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      const slash = trimmed.indexOf('/');
      if (slash <= 0 || /\s/.test(trimmed)) continue;
      const providerId = trimmed.slice(0, slash);
      const modelId = trimmed.slice(slash + 1);
      if (!providerId || !modelId) continue;
      grouped[providerId] ??= [];
      grouped[providerId]!.push(modelId);
    }
    return grouped;
  } catch {
    return {};
  }
}

function fallbackProviderCatalog(): OpenCodeProviderCatalog {
  const catalog: OpenCodeProviderCatalog = {};
  for (const provider of FALLBACK_PROVIDERS) {
    mergeProvider(catalog, provider.id, {
      name: provider.name,
      models: provider.models,
      description: providerDescription({
        env: provider.env,
        api: provider.api,
        doc: provider.doc,
        source: 'fallback',
      }),
      env: provider.env,
      api: provider.api,
      doc: provider.doc,
      source: 'fallback',
    });
  }
  return catalog;
}

let catalogCache: { value: OpenCodeProviderCatalog; at: number } | null = null;
const CATALOG_TTL_MS = 120_000;

/** Provider create/update/delete must refresh the catalog immediately. */
export function resetOpenCodeProviderCatalogCache(): void {
  catalogCache = null;
}

export function getOpenCodeProviderCatalog(): OpenCodeProviderCatalog {
  // Memoised: building this shells out to `opencode models` synchronously
  // (10s timeout), and it used to run on every provider/model GET — one open
  // provider picker could stall the whole event loop for seconds.
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.value;
  }
  const catalog: OpenCodeProviderCatalog = {};

  for (const [id, provider] of Object.entries(readOpenCodeModelsCache())) {
    mergeProvider(catalog, id, provider);
  }
  for (const [id, provider] of Object.entries(fallbackProviderCatalog())) {
    mergeProvider(catalog, id, provider);
  }
  for (const [id, provider] of Object.entries(readOpenCodeConfigProviders())) {
    mergeProvider(catalog, id, provider);
  }
  for (const [id, models] of Object.entries(discoverOpenCodeCliModels())) {
    mergeProvider(catalog, id, {
      name: catalog[id]?.name || humanizeProviderId(id),
      models,
      description: providerDescription({ source: 'cli' }),
      source: 'cli',
      configured: true,
    });
  }

  const sorted = sortOpenCodeProviderCatalog(catalog);
  catalogCache = { value: sorted, at: Date.now() };
  return sorted;
}

export function getOpenCodeModelIdsForProviders(providerIds: string[]): string[] {
  const catalog = getOpenCodeProviderCatalog();
  const models: string[] = [];
  for (const providerId of providerIds) {
    const provider = catalog[providerId];
    if (!provider) continue;
    models.push(...provider.models.map((modelId) => `${providerId}/${modelId}`));
  }
  return [...new Set(models)];
}
