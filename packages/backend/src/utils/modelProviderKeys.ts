import { get as pgGet, run as pgRun } from '../db/pg.js';
import { createHash } from 'crypto';
import { safeDecrypt, safeEncrypt } from './encryption.js';
import { getModelProviderCatalog, type ModelProviderCatalog } from './modelCatalog.js';
import { safeJsonParse } from './json.js';

export interface ModelProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl?: string;
  enabled: boolean;
  /**
   * Models this endpoint serves, owned by the WebUI registry rather than by any
   * harness. Endpoints the shared catalog does not know (self-hosted, or a new
   * aggregator) are listed here. Empty means "whatever the catalog knows".
   */
  models?: string[];
  /**
   * `live`: `models` is the provider's own `GET /models` answer
   * (utils/providerModelDiscovery.ts) and the only list Pi and chat offer.
   * Absent: typed or merged in, completed from the catalog.
   */
  modelsSource?: 'live';
  /** When the live list was last fetched. */
  modelsCheckedAt?: string;
  /**
   * False keeps this provider out of Pi: no models.json entry and no key in
   * Pi's environment. Model chat still uses it. Absent means Pi may use it.
   */
  pi?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelProviderPublic extends Omit<ModelProvider, 'apiKey'> {
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
  return `${normalized || 'MODEL_PROVIDER'}_API_KEY`;
}

export function getModelProviderCredentialEnvVars(
  providerId: string,
  catalog: ModelProviderCatalog = getModelProviderCatalog()
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

function normalizeStoredProvider(raw: unknown): ModelProvider | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const provider = raw as Partial<ModelProvider>;
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
    ...(models && models.length > 0 && provider.modelsSource === 'live'
      ? { modelsSource: 'live' as const }
      : {}),
    ...(typeof provider.modelsCheckedAt === 'string'
      ? { modelsCheckedAt: provider.modelsCheckedAt }
      : {}),
    ...(provider.pi === false ? { pi: false } : {}),
    createdAt:
      typeof provider.createdAt === 'string' && provider.createdAt ? provider.createdAt : now,
    updatedAt:
      typeof provider.updatedAt === 'string' && provider.updatedAt ? provider.updatedAt : now,
  };
}

function parseProviders(settingsJson: string | null | undefined): ModelProvider[] {
  const parsed = safeJsonParse<{ modelProviders?: unknown[]; opencodeProviders?: unknown[] }>(
    settingsJson,
    {}
  );
  // `opencodeProviders` is the pre-2026-10-27 key. The startup migration renames
  // it, but a row written by an older client before that must still resolve.
  const stored = Array.isArray(parsed.modelProviders)
    ? parsed.modelProviders
    : Array.isArray(parsed.opencodeProviders)
      ? parsed.opencodeProviders
      : [];
  return stored
    .map(normalizeStoredProvider)
    .filter((provider): provider is ModelProvider => Boolean(provider));
}

export async function readModelProvidersForUser(userId: string): Promise<ModelProvider[]> {
  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as UserSettingsRow | undefined;
  return parseProviders(row?.settings_json);
}

export async function writeModelProvidersForUser(
  userId: string,
  providers: ModelProvider[]
): Promise<void> {
  // Merge inside Postgres rather than read-modify-write in JS. The old version
  // parsed the whole settings blob, replaced one key and wrote it all back, so
  // a concurrent save of any other setting — two browser tabs, or a provider
  // key write racing the GitHub token — silently discarded whichever side
  // committed first. The legacy key is dropped in the same statement so a
  // stale copy can never shadow the registry again.
  await pgRun(
    `INSERT INTO user_settings (user_id, settings_json)
          VALUES (?, ?)
     ON CONFLICT (user_id) DO UPDATE
            SET settings_json = (
                  (COALESCE(NULLIF(user_settings.settings_json, '')::jsonb, '{}'::jsonb)
                    - 'opencodeProviders')
                  || EXCLUDED.settings_json::jsonb
                )::text`,
    userId,
    JSON.stringify({ modelProviders: providers })
  );
}

/**
 * Provider keys are per user, so there is no sensible answer without one.
 *
 * This used to merge every user's enabled providers together, which meant a
 * spawn that reached here with no user id handed one account's API keys to
 * whoever's session happened to trigger it. Returning nothing is the only safe
 * reading of "I do not know whose credentials these should be" — the CLI then
 * reports a missing key instead of quietly billing someone else.
 */
function warnMissingUser(caller: string): ModelProvider[] {
  console.warn(
    `[model-provider-keys] ${caller} called without a user id — no provider credentials will be supplied.`
  );
  return [];
}

export function maskModelProvider(
  provider: ModelProvider,
  catalog: ModelProviderCatalog = getModelProviderCatalog()
): ModelProviderPublic {
  return {
    ...provider,
    apiKey: provider.apiKey ? '***' : '',
    hasKey: Boolean(provider.apiKey),
    envVars: getModelProviderCredentialEnvVars(provider.id, catalog),
  };
}

export function encryptModelProviderKey(apiKey: string | undefined): string {
  return apiKey ? (safeEncrypt(apiKey) ?? '') : '';
}

/** Whether Pi may see this provider (models and key). */
export function isPiModelProvider(provider: ModelProvider): boolean {
  return provider.enabled && provider.pi !== false;
}

/**
 * Provider keys as environment variables for a spawned harness. `pi` drops the
 * providers the user kept out of Pi, so their keys never reach its process.
 */
export async function buildModelProviderCredentialEnv(
  userId?: string,
  options: { pi?: boolean } = {}
): Promise<Record<string, string>> {
  const providers = userId
    ? (await readModelProvidersForUser(userId)).filter((provider) =>
        options.pi ? isPiModelProvider(provider) : provider.enabled
      )
    : warnMissingUser('buildModelProviderCredentialEnv');
  const catalog = getModelProviderCatalog();
  const env: Record<string, string> = {};

  for (const provider of providers) {
    if (!provider.apiKey) continue;
    const apiKey = safeDecrypt(provider.apiKey);
    if (!apiKey) continue;
    for (const envVar of getModelProviderCredentialEnvVars(provider.id, catalog)) {
      env[envVar] = apiKey;
    }
  }

  return env;
}

export async function getModelProviderCredentialFingerprint(userId?: string): Promise<string> {
  const providers = userId
    ? (await readModelProvidersForUser(userId)).filter((provider) => provider.enabled)
    : warnMissingUser('getModelProviderCredentialFingerprint');
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

export async function overlayModelProviderStatus(
  catalog: ModelProviderCatalog,
  userId: string
): Promise<ModelProviderCatalog> {
  const providers = await readModelProvidersForUser(userId);
  if (providers.length === 0) return catalog;

  const next: ModelProviderCatalog = {};
  for (const [id, provider] of Object.entries(catalog)) {
    next[id] = { ...provider };
  }

  for (const stored of providers) {
    const existing = next[stored.id];
    const envVars = getModelProviderCredentialEnvVars(stored.id, catalog);
    next[stored.id] = {
      name: existing?.name || stored.name,
      models: existing?.models || [],
      description: existing?.description || 'Configured model provider',
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
