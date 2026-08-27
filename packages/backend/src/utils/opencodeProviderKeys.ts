import { get as pgGet, all as pgAll, run as pgRun } from '../db/pg.js';
import { createHash } from 'crypto';
import { safeDecrypt, safeEncrypt } from './encryption.js';
import { getOpenCodeProviderCatalog, type OpenCodeProviderCatalog } from './opencodeCatalog.js';
import { safeJsonParse } from './json.js';

export interface OpenCodeProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl?: string;
  enabled: boolean;
  /**
   * Models this endpoint serves, owned by the WebUI registry rather than by any
   * harness. Endpoints the shared catalog does not know (self-hosted, or a new
   * aggregator) previously existed for Pi only while OpenCode happened to keep
   * a config file listing them. Empty means "whatever the catalog knows".
   */
  models?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OpenCodeProviderPublic extends Omit<OpenCodeProvider, 'apiKey'> {
  apiKey: string;
  hasKey: boolean;
  envVars: string[];
}

interface UserSettingsRow {
  user_id?: string;
  settings_json: string | null;
}

function normalizeProviderId(id: string): string {
  return id.trim();
}

function normalizeEnvName(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z_][A-Z0-9_]*$/.test(normalized) ? normalized : null;
}

function derivedApiKeyEnv(providerId: string): string {
  const normalized = providerId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${normalized || 'OPENCODE_PROVIDER'}_API_KEY`;
}

export function getOpenCodeCredentialEnvVars(
  providerId: string,
  catalog: OpenCodeProviderCatalog = getOpenCodeProviderCatalog()
): string[] {
  const explicit = catalog[providerId]?.env || [];
  const envVars = new Set<string>();
  for (const item of explicit) {
    const envName = normalizeEnvName(item);
    if (envName) envVars.add(envName);
  }
  if (providerId === 'z-ai' || providerId === 'zai') {
    envVars.add('ZAI_API_KEY');
    envVars.add('ZHIPU_API_KEY');
    envVars.add('Z_AI_API_KEY');
  }
  envVars.add(derivedApiKeyEnv(providerId));
  return [...envVars];
}

function normalizeStoredProvider(raw: unknown): OpenCodeProvider | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const provider = raw as Partial<OpenCodeProvider>;
  if (typeof provider.id !== 'string' || !provider.id.trim()) return null;
  if (typeof provider.name !== 'string' || !provider.name.trim()) return null;

  const now = new Date().toISOString();
  const baseUrl =
    typeof provider.baseUrl === 'string' && provider.baseUrl.trim()
      ? provider.baseUrl.trim()
      : undefined;

  const models = Array.isArray(provider.models)
    ? [
        ...new Set(
          provider.models
            .filter((model): model is string => typeof model === 'string')
            .map((model) => model.trim())
            .filter((model) => model.length > 0)
        ),
      ]
    : undefined;

  return {
    id: normalizeProviderId(provider.id),
    name: provider.name.trim(),
    apiKey: typeof provider.apiKey === 'string' ? provider.apiKey : '',
    baseUrl,
    enabled: provider.enabled !== false,
    ...(models && models.length > 0 ? { models } : {}),
    createdAt:
      typeof provider.createdAt === 'string' && provider.createdAt ? provider.createdAt : now,
    updatedAt:
      typeof provider.updatedAt === 'string' && provider.updatedAt ? provider.updatedAt : now,
  };
}

function parseProviders(settingsJson: string | null | undefined): OpenCodeProvider[] {
  const parsed = safeJsonParse<{ opencodeProviders?: unknown[] }>(settingsJson, {});
  if (!Array.isArray(parsed.opencodeProviders)) return [];
  return parsed.opencodeProviders
    .map(normalizeStoredProvider)
    .filter((provider): provider is OpenCodeProvider => Boolean(provider));
}

export async function readOpenCodeProvidersForUser(userId: string): Promise<OpenCodeProvider[]> {
  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as UserSettingsRow | undefined;
  return parseProviders(row?.settings_json);
}

export async function writeOpenCodeProvidersForUser(
  userId: string,
  providers: OpenCodeProvider[]
): Promise<void> {
  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as UserSettingsRow | undefined;

  const settings = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  settings.opencodeProviders = providers;
  const json = JSON.stringify(settings);

  if (row) {
    await pgRun('UPDATE user_settings SET settings_json = ? WHERE user_id = ?', json, userId);
  } else {
    await pgRun('INSERT INTO user_settings (user_id, settings_json) VALUES (?, ?)', userId, json);
  }
}

async function readAllEnabledOpenCodeProviders(): Promise<OpenCodeProvider[]> {
  const rows = (await pgAll('SELECT user_id, settings_json FROM user_settings')) as unknown as
    | UserSettingsRow[]
    | undefined;
  const providers: OpenCodeProvider[] = [];

  for (const row of rows || []) {
    providers.push(...parseProviders(row.settings_json).filter((provider) => provider.enabled));
  }

  return providers;
}

export function maskOpenCodeProvider(
  provider: OpenCodeProvider,
  catalog: OpenCodeProviderCatalog = getOpenCodeProviderCatalog()
): OpenCodeProviderPublic {
  return {
    ...provider,
    apiKey: provider.apiKey ? '***' : '',
    hasKey: Boolean(provider.apiKey),
    envVars: getOpenCodeCredentialEnvVars(provider.id, catalog),
  };
}

export function encryptOpenCodeProviderKey(apiKey: string | undefined): string {
  return apiKey ? (safeEncrypt(apiKey) ?? '') : '';
}

export async function buildOpenCodeProviderCredentialEnv(
  userId?: string
): Promise<Record<string, string>> {
  const providers = userId
    ? (await readOpenCodeProvidersForUser(userId)).filter((provider) => provider.enabled)
    : await readAllEnabledOpenCodeProviders();
  const catalog = getOpenCodeProviderCatalog();
  const env: Record<string, string> = {};

  for (const provider of providers) {
    if (!provider.apiKey) continue;
    const apiKey = safeDecrypt(provider.apiKey);
    if (!apiKey) continue;
    for (const envVar of getOpenCodeCredentialEnvVars(provider.id, catalog)) {
      env[envVar] = apiKey;
    }
  }

  return env;
}

export async function getOpenCodeProviderCredentialFingerprint(userId?: string): Promise<string> {
  const providers = userId
    ? (await readOpenCodeProvidersForUser(userId)).filter((provider) => provider.enabled)
    : await readAllEnabledOpenCodeProviders();
  const payload = providers
    .map((provider) => ({
      id: provider.id,
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl || '',
      enabled: provider.enabled,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function overlayOpenCodeProviderStatus(
  catalog: OpenCodeProviderCatalog,
  userId: string
): Promise<OpenCodeProviderCatalog> {
  const providers = await readOpenCodeProvidersForUser(userId);
  if (providers.length === 0) return catalog;

  const next: OpenCodeProviderCatalog = {};
  for (const [id, provider] of Object.entries(catalog)) {
    next[id] = { ...provider };
  }

  for (const stored of providers) {
    const existing = next[stored.id];
    const envVars = getOpenCodeCredentialEnvVars(stored.id, catalog);
    next[stored.id] = {
      name: existing?.name || stored.name,
      models: existing?.models || [],
      description: existing?.description || 'Configured OpenCode provider',
      env: existing?.env?.length ? existing.env : envVars,
      api: stored.baseUrl || existing?.api,
      doc: existing?.doc,
      source: existing?.source || 'config',
      configured: stored.enabled,
      hasKey: Boolean(stored.apiKey),
    };
  }

  return next;
}
