import { createHash } from 'crypto';

/**
 * Whether a Mistral key's monthly allowance is used up, asked of Mistral itself.
 *
 * Pro plans expose no quota API, but the completions endpoint checks the
 * allowance before it validates the request body: an exhausted key gets
 * `402 billing_vibe_budget_exhausted` even for an empty message list, while a
 * key with budget left gets a validation error. An empty message list is never
 * generated or billed, so the probe is free. It answers "used up or not", not
 * how much is left; the amount stays our own estimate.
 */

export type MistralBudgetState = 'exhausted' | 'available' | 'unauthorized' | 'unknown';

export interface MistralBudgetProbe {
  state: MistralBudgetState;
  /** Mistral's error `type`, e.g. `billing_vibe_budget_exhausted`. */
  errorType: string | null;
  checkedAt: string;
}

const DEFAULT_BASE_URL = 'https://api.mistral.ai/v1';
// A model id that must exist: an unknown model is rejected before the budget
// check (400 invalid_model) and would otherwise read as "budget left".
const PROBE_MODEL = 'mistral-small-latest';
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_TTL_MS = 2 * 60_000;
const UNKNOWN_TTL_MS = 30_000;

const probeCache = new Map<string, { expiresAt: number; value: MistralBudgetProbe }>();
const probeRequests = new Map<string, Promise<MistralBudgetProbe>>();

function cacheKey(apiKey: string, baseUrl: string): string {
  return createHash('sha256').update(`${baseUrl}\0${apiKey}`).digest('hex');
}

function errorTypeOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const type = (body as { type?: unknown }).type;
  return typeof type === 'string' ? type : null;
}

export function classifyMistralBudgetResponse(
  status: number,
  body: unknown
): Omit<MistralBudgetProbe, 'checkedAt'> {
  const errorType = errorTypeOf(body);
  if (status === 402) return { state: 'exhausted', errorType };
  if (status === 401 || status === 403) return { state: 'unauthorized', errorType };
  if (errorType === 'invalid_model') return { state: 'unknown', errorType };
  // Past the budget check: the empty message list fails validation.
  if (status === 400 || status === 422 || (status >= 200 && status < 300)) {
    return { state: 'available', errorType };
  }
  return { state: 'unknown', errorType };
}

async function runProbe(apiKey: string, baseUrl: string): Promise<MistralBudgetProbe> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model: PROBE_MODEL, messages: [], max_tokens: 1 }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    return { ...classifyMistralBudgetResponse(response.status, body), checkedAt };
  } catch {
    return { state: 'unknown', errorType: null, checkedAt };
  }
}

export async function probeMistralBudget(
  apiKey: string,
  baseUrl: string = DEFAULT_BASE_URL
): Promise<MistralBudgetProbe> {
  const key = cacheKey(apiKey, baseUrl);
  const cached = probeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = probeRequests.get(key);
  if (pending) return pending;
  const request = runProbe(apiKey, baseUrl)
    .then((value) => {
      const ttl = value.state === 'unknown' ? UNKNOWN_TTL_MS : PROBE_TTL_MS;
      probeCache.set(key, { expiresAt: Date.now() + ttl, value });
      return value;
    })
    .finally(() => probeRequests.delete(key));
  probeRequests.set(key, request);
  return request;
}

/** A Vibe or Mistral turn just failed on the budget: the next read asks again. */
export function invalidateMistralBudgetProbes(): void {
  probeCache.clear();
}
