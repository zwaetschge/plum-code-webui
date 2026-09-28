import { all as pgAll, get as pgGet, run as pgRun } from '../db/pg.js';
import { estimateModelCost } from '@plum-code-webui/shared';
import { readOpenCodeProvidersForUser } from '../utils/opencodeProviderKeys.js';
import { isProviderAvailable } from './cli-providers.js';
import { safeJsonParse } from '../utils/json.js';

/**
 * Mistral plan usage.
 *
 * A Mistral plan carries two monthly allowances in euros, both reset on the
 * 1st of the calendar month: API/Studio usage (Pro: €25.50) — what a regular
 * API key draws on, which is how Pi and OpenCode reach Mistral — and Vibe Code
 * usage (Pro: €255) for Vibe, or a key created under Code › Vibe CLI. Neither
 * is readable through an API outside Enterprise (the Admin API rejects regular
 * keys; rate-limit headers are per minute). So this is our own ledger of
 * Mistral turns in the month, priced at list rates (€ and $ taken 1:1), against
 * the allowance the user picks. Usage outside Plum (Le Chat, Studio, the Vibe
 * CLI) is not in it.
 */

const MISTRAL_MODEL_PATTERN = 'mistral/%';

export type MistralAllowance = 'api' | 'vibe';
export type MistralCurrency = 'EUR' | 'USD';

export interface MistralPlanConfig {
  /** The month's allowance in `currency`; null = none set. */
  monthlyBudget: number | null;
  currency: MistralCurrency;
  /** Which of the plan's two allowances the configured key draws on. */
  allowance: MistralAllowance;
  /** Day of month the period starts (1–28), UTC. Mistral resets on the 1st. */
  billingDay: number;
}

/** Pro plan allowances as shown in Mistral's console. */
export const MISTRAL_PRO_ALLOWANCES: Record<MistralAllowance, number> = { api: 25.5, vibe: 255 };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeBudget(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function normalizeBillingDay(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return 1;
  return Math.min(28, Math.max(1, Math.round(parsed)));
}

async function readSettings(userId: string): Promise<Record<string, unknown>> {
  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json?: string | null } | undefined;
  return safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
}

function normalizeConfig(input: Record<string, unknown>): MistralPlanConfig {
  return {
    monthlyBudget: normalizeBudget(input.monthlyBudget ?? input.monthlyBudgetUsd),
    currency: input.currency === 'USD' ? 'USD' : 'EUR',
    allowance: input.allowance === 'vibe' ? 'vibe' : 'api',
    billingDay: normalizeBillingDay(input.billingDay),
  };
}

interface PlanBudget {
  monthlyBudget: number | null;
  currency: MistralCurrency;
  billingDay: number;
}

function normalizeBudgetRecord(input: Record<string, unknown>): PlanBudget {
  return {
    monthlyBudget: normalizeBudget(input.monthlyBudget ?? input.monthlyBudgetUsd),
    currency: input.currency === 'USD' ? 'USD' : 'EUR',
    billingDay: normalizeBillingDay(input.billingDay),
  };
}

/**
 * Both allowances of one Mistral plan, read from `usagePlans`.
 *
 * `usagePlans.mistral` is the API/Studio budget; `usagePlans.vibe` is the Vibe
 * Code budget drawn by the Vibe harness. A record saved before the split could
 * declare `allowance: 'vibe'`, and that budget then belongs to the Vibe side.
 * The Vibe budget defaults to the published Pro allowance so a fresh Vibe
 * session shows a percentage without a settings detour; the API side stays
 * explicit because Mistral sells several API tiers.
 */
async function readPlanBudgets(userId: string): Promise<{
  api: PlanBudget;
  vibe: PlanBudget;
  legacyAllowance: MistralAllowance;
}> {
  const plans = asRecord((await readSettings(userId)).usagePlans);
  const legacy = normalizeBudgetRecord(asRecord(plans.mistral));
  const legacyAllowance: MistralAllowance =
    asRecord(plans.mistral).allowance === 'vibe' ? 'vibe' : 'api';
  const vibeRecord = asRecord(plans.vibe);
  const vibe =
    Object.keys(vibeRecord).length > 0
      ? normalizeBudgetRecord(vibeRecord)
      : legacyAllowance === 'vibe'
        ? legacy
        : { ...legacy, monthlyBudget: MISTRAL_PRO_ALLOWANCES.vibe };
  const api = legacyAllowance === 'vibe' ? { ...legacy, monthlyBudget: null } : legacy;
  return { api, vibe, legacyAllowance };
}

async function writePlanBudget(
  userId: string,
  key: 'mistral' | 'vibe',
  budget: PlanBudget & { allowance?: MistralAllowance }
): Promise<void> {
  const settings = await readSettings(userId);
  settings.usagePlans = { ...asRecord(settings.usagePlans), [key]: budget };
  await pgRun(
    `INSERT INTO user_settings (user_id, settings_json)
     VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json`,
    userId,
    JSON.stringify(settings)
  );
}

export async function getMistralPlanConfig(userId: string): Promise<MistralPlanConfig> {
  const { api, legacyAllowance } = await readPlanBudgets(userId);
  return { ...api, allowance: legacyAllowance };
}

/** The Vibe Code allowance plan (€255 on Pro), tracked separately from the API plan. */
export async function getVibePlanConfig(userId: string): Promise<MistralPlanConfig> {
  const { vibe } = await readPlanBudgets(userId);
  return { ...vibe, allowance: 'vibe' };
}

export async function saveMistralPlanConfig(
  userId: string,
  input: Record<string, unknown>
): Promise<MistralPlanConfig> {
  const config = normalizeConfig(input);
  // One editor covers both allowances: choosing the Vibe preset stores the
  // budget on the Vibe side so the API budget survives untouched.
  if (config.allowance === 'vibe') {
    const { monthlyBudget, currency, billingDay } = config;
    await writePlanBudget(userId, 'vibe', { monthlyBudget, currency, billingDay });
    return config;
  }
  const { monthlyBudget, currency, billingDay } = config;
  await writePlanBudget(userId, 'mistral', { monthlyBudget, currency, billingDay, allowance: 'api' });
  return config;
}

export async function saveVibePlanConfig(
  userId: string,
  input: Record<string, unknown>
): Promise<MistralPlanConfig> {
  const budget = normalizeBudgetRecord(input);
  await writePlanBudget(userId, 'vibe', budget);
  return { ...budget, allowance: 'vibe' };
}

/** The billing month containing `now`, starting on `billingDay` (UTC). */
export function mistralBillingWindow(billingDay: number, now = new Date()) {
  let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), billingDay));
  if (start.getTime() > now.getTime()) {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, billingDay));
  }
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, billingDay));
  return { start, end };
}

function toSqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Monthly spend against one of the plan's two allowances.
 *
 * `api` counts the routed `mistral/*` traffic (OpenCode, Pi) that a regular API
 * key pays for; `vibe` counts the turns the Vibe harness booked, which draw on
 * the separate Vibe Code allowance.
 */
export async function buildMistralLimitResponse(
  userId: string,
  allowance: MistralAllowance = 'api'
) {
  const wantsVibe = allowance === 'vibe';
  const [providers, config] = await Promise.all([
    readOpenCodeProvidersForUser(userId),
    wantsVibe ? getVibePlanConfig(userId) : getMistralPlanConfig(userId),
  ]);
  const configured = wantsVibe
    ? await isProviderAvailable('vibe').catch(() => false)
    : providers.some((provider) => provider.id === 'mistral' && provider.enabled && !!provider.apiKey);
  const { start, end } = mistralBillingWindow(config.billingDay);
  // Vibe turns are booked with provider 'vibe' and a bare Mistral model id, so
  // the two allowances are separated by attribution, not by the model prefix.
  const rowsSql = wantsVibe
    ? `SELECT model,
            COALESCE(SUM(input_tokens), 0) as input_tokens,
            COALESCE(SUM(output_tokens), 0) as output_tokens,
            COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
            COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
            COALESCE(SUM(total_tokens), 0) as total_tokens,
            COUNT(*) as requests
       FROM usage_history
      WHERE user_id = ?
        AND lower(COALESCE(provider, '')) = 'vibe'
        AND created_at >= ? AND created_at < ?
      GROUP BY model`
    : `SELECT model,
            COALESCE(SUM(input_tokens), 0) as input_tokens,
            COALESCE(SUM(output_tokens), 0) as output_tokens,
            COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
            COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
            COALESCE(SUM(total_tokens), 0) as total_tokens,
            COUNT(*) as requests
       FROM usage_history
      WHERE user_id = ? AND model LIKE ?
        AND lower(COALESCE(provider, '')) <> 'vibe'
        AND created_at >= ? AND created_at < ?
      GROUP BY model`;
  const rowsParams = wantsVibe
    ? [userId, toSqlTimestamp(start), toSqlTimestamp(end)]
    : [userId, MISTRAL_MODEL_PATTERN, toSqlTimestamp(start), toSqlTimestamp(end)];
  const rows = (await pgAll(rowsSql, ...rowsParams)) as unknown as Array<{
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    total_tokens: number;
    requests: number;
  }>;
  const tokens = rows.reduce((sum, row) => sum + Number(row.total_tokens || 0), 0);
  const requests = rows.reduce((sum, row) => sum + Number(row.requests || 0), 0);
  // Priced from tokens with the current rate card, like the analytics page,
  // so a later price correction reaches this figure too.
  const spendUsd = rows.reduce(
    (sum, row) =>
      sum +
      estimateModelCost(
        row.model,
        {
          inputTokens: Number(row.input_tokens || 0),
          outputTokens: Number(row.output_tokens || 0),
          cacheReadTokens: Number(row.cache_read_tokens || 0),
          cacheCreationTokens: Number(row.cache_creation_tokens || 0),
        },
        null
      ).cost,
    0
  );

  const providerLabel = wantsVibe ? ('vibe' as const) : ('mistral' as const);

  if (!configured && requests === 0) {
    return {
      success: true,
      supported: false,
      provider: providerLabel,
      data: null,
      error: {
        code: 'NOT_CONFIGURED',
        message: wantsVibe
          ? 'Mistral Vibe is not signed in (Settings → Provider → Mistral Vibe).'
          : 'Mistral is not configured (Settings → General → OpenCode → Mistral).',
      },
    };
  }

  const budget = config.monthlyBudget;
  const unit = config.currency === 'EUR' ? 'eur' : 'usd';
  const windowSeconds = Math.round((end.getTime() - start.getTime()) / 1000);
  return {
    success: true,
    supported: true,
    provider: providerLabel,
    data: {
      subscriptionType: config.allowance === 'vibe' ? 'Vibe Code allowance' : 'API/Studio allowance',
      rateLimitTier: budget ? 'Monthly allowance' : 'No allowance set',
      fiveHour: null,
      // The billing month is the only window that matters; it rides in the
      // long slot so every client renders it without special cases.
      sevenDay: budget
        ? {
            // Whole percent: the Android client decodes utilization as Int.
            utilization: Math.min(999, Math.round((spendUsd / budget) * 100)),
            resetsAt: end.toISOString(),
            windowSeconds,
            used: Math.round(spendUsd * 100) / 100,
            limit: budget,
            remaining: Math.max(0, Math.round((budget - spendUsd) * 100) / 100),
            unit,
          }
        : null,
      sevenDaySonnet: null,
      additional: [],
      // Derived from our own ledger, so the provenance is explicit.
      source: 'local-estimate' as const,
      planUsage: {
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        // List prices are in USD; Mistral's allowance is in EUR. Taken 1:1.
        spend: Math.round(spendUsd * 100) / 100,
        tokens,
        requests,
        budget,
        currency: config.currency,
        allowance: config.allowance,
        billingDay: config.billingDay,
      },
    },
    error: budget
      ? undefined
      : {
          code: 'NO_BUDGET',
          message:
            'Mistral publishes no quota API for Pro plans. Set the monthly allowance to see a percentage.',
        },
  };
}
