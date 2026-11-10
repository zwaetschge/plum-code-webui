import { safeDecrypt } from './encryption.js';
import { providerBaseUrlProblem } from './providerUrlGuard.js';
import { getRunnerAccessDecision } from './runnerAccess.js';
import { getModelProviderCatalog, type ModelProviderCatalog } from './modelCatalog.js';
import {
  readModelProvidersForUser,
  writeModelProvidersForUser,
  type ModelProvider,
} from './modelProviderKeys.js';

/**
 * Model lists straight from each provider's own `GET /models`.
 *
 * The registry used to know models only from what was typed or merged in once
 * and from a built-in catalog, so retired models stayed in every picker
 * (DeepSeek still offered `deepseek-chat` long after the API stopped listing
 * it) and new ones never appeared. A provider that answers is now the source
 * of truth: its list replaces the stored one and Pi stops mixing in catalog
 * entries for it (`modelsSource: 'live'`).
 */

/** Providers whose menu Plum curates itself (Pi's native Mistral catalog). */
const CURATED_PROVIDERS = new Set(['mistral']);
/** Above this the list is a marketplace (OpenRouter), not a menu; keep it manual. */
const MAX_LIVE_MODELS = 60;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
// Embedding families without "embed" in the name (bge-m3, e5, gte) included.
const NON_CHAT_MODEL =
  /(?:embed|moderation|ocr|whisper|transcri|tts|audio|rerank|dall-e|sora|(?:^|[-_/])(?:image|video)(?:[-_.:/]|$)|(?:^|[-_/])(?:bge|e5|gte)(?:[-_.]|$))/i;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Chat-capable ids from a provider's list, without duplicates. */
export function chatModelIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id && !NON_CHAT_MODEL.test(id)))];
}

function modelsUrl(provider: ModelProvider, catalog: ModelProviderCatalog): string | null {
  const base = (provider.baseUrl || catalog[provider.id]?.api || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  // Anthropic's catalog entry is the bare host; its list lives under /v1.
  if (provider.id === 'anthropic' && !/\/v1$/.test(base)) return `${base}/v1/models`;
  return `${base}/models`;
}

/** The provider's current model ids, or null when it cannot be asked. */
export async function fetchProviderModelIds(
  provider: ModelProvider,
  apiKey: string,
  catalog: ModelProviderCatalog = getModelProviderCatalog(),
  fetchImpl: FetchLike = fetch
): Promise<string[] | null> {
  const url = modelsUrl(provider, catalog);
  if (!url) return null;
  const headers: Record<string, string> =
    provider.id === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { authorization: `Bearer ${apiKey}` };
  try {
    const response = await fetchImpl(url, {
      headers,
      // The key goes to the host that was configured, not to wherever it points.
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: unknown; models?: unknown };
    const entries = Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.models)
        ? body.models
        : null;
    if (!entries) return null;
    const ids = entries
      .map((entry) =>
        entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
          ? (entry as { id: string }).id
          : typeof entry === 'string'
            ? entry
            : ''
      )
      .filter(Boolean);
    return chatModelIds(ids);
  } catch {
    return null;
  }
}

export interface ProviderModelRefresh {
  id: string;
  status: 'updated' | 'unchanged' | 'skipped' | 'failed';
  models?: string[];
  added?: string[];
  removed?: string[];
}

/**
 * Asks every enabled provider (or only `only`) for its models and stores the
 * answers. Unreachable providers, curated ones and marketplaces keep their list.
 */
export async function refreshProviderModels(
  userId: string,
  options: { only?: string; fetchImpl?: FetchLike } = {}
): Promise<ProviderModelRefresh[]> {
  lastRefreshAt.set(userId, Date.now());
  const catalog = getModelProviderCatalog();
  const providers = await readModelProvidersForUser(userId);
  const results: ProviderModelRefresh[] = [];
  const updates = new Map<string, string[]>();

  const allowPrivateNetwork = (await getRunnerAccessDecision(userId)).allowed;

  for (const provider of providers) {
    if (options.only && provider.id !== options.only) continue;
    if (!provider.enabled || !provider.apiKey || CURATED_PROVIDERS.has(provider.id)) {
      results.push({ id: provider.id, status: 'skipped' });
      continue;
    }
    if (provider.baseUrl && providerBaseUrlProblem(provider.baseUrl, { allowPrivateNetwork })) {
      results.push({ id: provider.id, status: 'failed' });
      continue;
    }
    const apiKey = safeDecrypt(provider.apiKey);
    if (!apiKey) {
      results.push({ id: provider.id, status: 'skipped' });
      continue;
    }
    const ids = await fetchProviderModelIds(provider, apiKey, catalog, options.fetchImpl);
    if (!ids || ids.length === 0) {
      results.push({ id: provider.id, status: 'failed' });
      continue;
    }
    if (ids.length > MAX_LIVE_MODELS) {
      results.push({ id: provider.id, status: 'skipped', models: ids });
      continue;
    }
    const before = provider.models ?? [];
    const added = ids.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !ids.includes(id));
    const changed = added.length > 0 || removed.length > 0 || provider.modelsSource !== 'live';
    if (changed) updates.set(provider.id, ids);
    results.push({
      id: provider.id,
      status: changed ? 'updated' : 'unchanged',
      models: ids,
      added,
      removed,
    });
  }

  if (updates.size > 0) {
    // Re-read: a key or toggle saved while the lists were fetched must survive.
    const fresh = await readModelProvidersForUser(userId);
    const checkedAt = new Date().toISOString();
    for (const provider of fresh) {
      const ids = updates.get(provider.id);
      if (!ids) continue;
      provider.models = ids;
      provider.modelsSource = 'live';
      provider.modelsCheckedAt = checkedAt;
    }
    await writeModelProvidersForUser(userId, fresh);
  }
  return results;
}

const lastRefreshAt = new Map<string, number>();
const inflight = new Set<string>();

/** At most every six hours per user, never blocking the caller. */
export function refreshProviderModelsInBackground(userId: string): void {
  if (inflight.has(userId)) return;
  if (Date.now() - (lastRefreshAt.get(userId) ?? 0) < REFRESH_INTERVAL_MS) return;
  inflight.add(userId);
  void refreshProviderModels(userId)
    .then((results) => {
      for (const result of results.filter((entry) => entry.status === 'updated')) {
        console.log(
          `[MODEL-PROVIDERS] ${result.id}: ${result.models?.length ?? 0} live models` +
            (result.added?.length ? `, new ${result.added.join(', ')}` : '') +
            (result.removed?.length ? `, gone ${result.removed.join(', ')}` : '')
        );
      }
    })
    .catch((error) => console.warn('[MODEL-PROVIDERS] Live model refresh failed:', error))
    .finally(() => inflight.delete(userId));
}
