import { createHash } from 'node:crypto';

/**
 * Mistral's own figures for a plan's monthly allowances, read like Vibe 3 does
 * (mistral-vibe `vibe/app_server/_billing.py`): `GET /v1/billing/budget` with
 * the account's API key reports how much of the Vibe Code allowance and of the
 * API/Studio allowance is used, `GET /v1/billing/subscription` names the plan.
 * These are the numbers the Mistral console shows; the local ledger and the
 * 402 probe (mistralBudgetProbe.ts) only stand in when this read fails.
 * `/budget` needs the `see_org_inference_usage` permission: a 403 reads as
 * "no billing data", not as an error.
 */

export interface MistralAllowanceBudget {
  /** Percent of the allowance used, unrounded (may pass 100 with pay-as-you-go). */
  usagePercentage: number;
  /** The allowance in `currency`, e.g. 255 EUR for Vibe on Pro. */
  initialBudget: number;
  currency: string;
  resetAt: string | null;
  paygEnabled: boolean | null;
}

export interface MistralBilling {
  planName: string | null;
  vibe: MistralAllowanceBudget | null;
  api: MistralAllowanceBudget | null;
  checkedAt: string;
}

const DEFAULT_BASE_URL = 'https://api.mistral.ai/v1';
const TIMEOUT_MS = 10_000;
/** Fresh for two minutes; the console itself updates with some delay. */
const TTL_MS = 2 * 60_000;
/** A failed read keeps the last good figures this long. */
const STALE_MAX_MS = 6 * 60 * 60_000;

const cache = new Map<string, { at: number; value: MistralBilling }>();
const requests = new Map<string, Promise<MistralBilling | null>>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One allowance of a `/billing/budget` answer; null when absent or malformed. */
export function parseMistralAllowance(value: unknown): MistralAllowanceBudget | null {
  const record = asRecord(value);
  if (!record) return null;
  const usagePercentage = finiteNumber(record.usage_percentage);
  const initialBudget = finiteNumber(record.initial_budget);
  if (usagePercentage === null || initialBudget === null || initialBudget <= 0) return null;
  return {
    usagePercentage: Math.max(0, usagePercentage),
    initialBudget,
    currency: typeof record.currency === 'string' ? record.currency.toUpperCase() : 'EUR',
    resetAt: typeof record.reset_at === 'string' ? record.reset_at : null,
    paygEnabled: typeof record.payg_enabled === 'boolean' ? record.payg_enabled : null,
  };
}

/** Both answers combined; the budget's top-level fields mirror the API allowance. */
export function parseMistralBilling(
  budgetBody: unknown,
  subscriptionBody: unknown,
  checkedAt = new Date().toISOString()
): MistralBilling | null {
  const budget = asRecord(budgetBody);
  if (!budget) return null;
  const vibe = parseMistralAllowance(budget.vibe_budget);
  const api = parseMistralAllowance(budget.api_budget) ?? parseMistralAllowance(budget);
  if (!vibe && !api) return null;
  const subscription = asRecord(subscriptionBody);
  return {
    planName: typeof subscription?.plan_name === 'string' ? subscription.plan_name : null,
    vibe,
    api,
    checkedAt,
  };
}

async function getJson(url: string, apiKey: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function read(apiKey: string, baseUrl: string): Promise<MistralBilling | null> {
  const base = baseUrl.replace(/\/+$/, '');
  const [budget, subscription] = await Promise.allSettled([
    getJson(`${base}/billing/budget`, apiKey),
    getJson(`${base}/billing/subscription`, apiKey),
  ]);
  if (budget.status !== 'fulfilled') return null;
  return parseMistralBilling(
    budget.value,
    subscription.status === 'fulfilled' ? subscription.value : null
  );
}

/**
 * Mistral's billing figures for a key, cached two minutes and single-flight;
 * a failed read falls back to the last good figures (up to six hours old).
 */
export async function readMistralBilling(
  apiKey: string,
  baseUrl: string = DEFAULT_BASE_URL
): Promise<MistralBilling | null> {
  // Ledger tests run beside a real Vibe login; they switch the network read off.
  if (process.env.PLUM_MISTRAL_BILLING === 'off') return null;
  const key = createHash('sha256').update(`${baseUrl}\0${apiKey}`).digest('hex');
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const running = requests.get(key);
  if (running) return running;
  const task = read(apiKey, baseUrl)
    .catch(() => null)
    .then((value) => {
      if (value) {
        cache.set(key, { at: Date.now(), value });
        return value;
      }
      return cached && Date.now() - cached.at < STALE_MAX_MS ? cached.value : null;
    })
    .finally(() => requests.delete(key));
  requests.set(key, task);
  return task;
}

/**
 * The limit window of an allowance as the clients render it: whole percent
 * (Android decodes an Int; below 100 never rounds up to 100), the amount used
 * and left in the allowance's currency.
 */
export function mistralAllowanceWindow(
  allowance: MistralAllowanceBudget,
  fallbackResetAt: string,
  windowSeconds: number
) {
  const percent = allowance.usagePercentage;
  const used = Math.round(((allowance.initialBudget * percent) / 100) * 100) / 100;
  return {
    utilization: percent < 100 ? Math.min(99, Math.round(percent)) : Math.round(percent),
    resetsAt: allowance.resetAt ?? fallbackResetAt,
    windowSeconds,
    used,
    limit: allowance.initialBudget,
    remaining: Math.max(0, Math.round((allowance.initialBudget - used) * 100) / 100),
    unit: allowance.currency.toLowerCase(),
  };
}
