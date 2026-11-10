import { get as pgGet, run as pgRun } from '../db/pg.js';
import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { CLI_PROVIDERS, type CLIProvider } from '../services/cli-providers.js';
import {
  getModelProviderCredentialEnvVars,
  readModelProvidersForUser,
} from '../utils/modelProviderKeys.js';
import { getModelProviderCatalog } from '../utils/modelCatalog.js';
import {
  fetchCodexUsage,
  getCodexAuth,
  isCodexUsageAuthError,
  mapCodexUsage,
  refreshCodexToken,
} from '../utils/codexUsage.js';
import { safeDecrypt } from '../utils/encryption.js';
import { safeJsonParse } from '../utils/json.js';
import { requestClaudeOAuthTokenRefresh } from '../utils/claudeOauth.js';
import { getZaiApiConfigForUser } from './settings.js';
import {
  buildMistralLimitResponse,
  getMistralPlanConfig,
  getVibePlanConfig,
  saveMistralPlanConfig,
  saveVibePlanConfig,
} from '../services/mistralPlanUsage.js';
import {
  normalizeUsageLimitHistoryRange,
  queryUsageLimitHistory,
  recordUsageLimitSnapshots,
  type TrackedUsageLimitProvider,
} from '../services/usage-limit-history.js';

const router = Router();
const claudeCredentialsRoot = CLI_PROVIDERS.claude.credentialsPath;
const credentialsPath = path.join(
  claudeCredentialsRoot.replace('~', os.homedir()),
  '.credentials.json'
);
interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    refreshTokenExpiresAt?: number;
    scopes: string[];
    subscriptionType: string;
    rateLimitTier: string;
  };
}

interface UsageLimitResponse {
  five_hour: {
    utilization: number;
    resets_at: string | null;
  } | null;
  seven_day: {
    utilization: number;
    resets_at: string | null;
  } | null;
  seven_day_opus: {
    utilization: number;
    resets_at: string | null;
  } | null;
  seven_day_oauth_apps?: unknown;
  iguana_necktie?: unknown;
}

interface LocalUsageBudget {
  dailyUsd?: number;
  weeklyUsd?: number;
}

type UsageProviderId = CLIProvider | 'z-ai';

interface NormalizedUsageWindow {
  utilization: number;
  resetsAt: string | null;
  windowSeconds?: number | null;
  used?: number | null;
  limit?: number | null;
  remaining?: number | null;
  unit?: 'tokens' | 'requests' | 'usd' | string;
}

interface UsageLimitPayload {
  subscriptionType?: string;
  rateLimitTier?: string;
  fiveHour: NormalizedUsageWindow | null;
  sevenDay: NormalizedUsageWindow | null;
  sevenDaySonnet: NormalizedUsageWindow | null;
  additional?: Array<{ name: string } & NormalizedUsageWindow>;
  localBudget?: {
    dailyUsd: number | null;
    weeklyUsd: number | null;
    dailySpendUsd: number;
    weeklySpendUsd: number;
    dailyTokens: number;
    weeklyTokens: number;
    dailyRequests: number;
    weeklyRequests: number;
  };
  accountUsage?: {
    periodDays: number;
    totalTokens: number;
    totalRequests: number;
    startsAt: string | null;
    endsAt: string | null;
    timezone: 'Asia/Shanghai';
    models: Array<{ model: string; tokens: number }>;
  };
  source?: 'upstream' | 'local-budget' | 'local-estimate';
}

interface UsageLimitResult {
  success: boolean;
  supported: boolean;
  provider: UsageProviderId;
  data: UsageLimitPayload | null;
  error?: { code: string; message: string };
}

const TRACKED_USAGE_LIMIT_PROVIDERS: TrackedUsageLimitProvider[] = ['codex', 'claude', 'zai'];

function persistUsageLimitResult(userId: string, result: UsageLimitResult): UsageLimitResult {
  if (!result.success || !result.supported || !result.data) return result;
  const provider = result.provider === 'z-ai' ? 'zai' : result.provider;
  if (!TRACKED_USAGE_LIMIT_PROVIDERS.includes(provider as TrackedUsageLimitProvider)) {
    return result;
  }

  try {
    recordUsageLimitSnapshots(userId, provider as TrackedUsageLimitProvider, result.data);
  } catch (error) {
    // Quota history must never break the live provider-limit cards.
    console.error(`[USAGE LIMITS] Failed to persist ${provider} snapshot:`, error);
  }
  return result;
}

interface ZaiApiEnvelope {
  success?: boolean;
  code?: number | string;
  msg?: string;
  message?: string;
  data?: unknown;
}

interface ZaiSubscriptionItem {
  productName?: string;
  status?: string;
  inCurrentPeriod?: boolean;
  nextRenewTime?: string;
}

interface ZaiQuotaLimit {
  type?: string;
  unit?: number;
  number?: number;
  usage?: number;
  limit?: number;
  currentValue?: number;
  remaining?: number;
  percentage?: number;
  nextResetTime?: number | string;
  usageDetails?: Array<{ modelCode?: string; usage?: number }>;
}

interface ZaiQuotaPayload {
  limits?: ZaiQuotaLimit[];
}

interface ZaiModelUsageSummary {
  modelName?: string;
  totalTokens?: number;
}

interface ZaiModelUsagePayload {
  x_time?: string[];
  totalUsage?: {
    totalModelCallCount?: number;
    totalTokensUsage?: number;
    modelSummaryList?: ZaiModelUsageSummary[];
  };
  modelSummaryList?: ZaiModelUsageSummary[];
}

function unavailableUsageData(
  subscriptionType: string,
  rateLimitTier: string,
  source: UsageLimitPayload['source'] = 'upstream'
): UsageLimitPayload {
  return {
    subscriptionType,
    rateLimitTier,
    fiveHour: null,
    sevenDay: null,
    sevenDaySonnet: null,
    additional: [],
    source,
  };
}

// Get Claude credentials from ~/.claude/.credentials.json
async function getClaudeCredentials(): Promise<ClaudeCredentials | null> {
  try {
    const content = await fs.readFile(credentialsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function normalizeBudgetValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function getEnvBudget(provider: CLIProvider, window: 'daily' | 'weekly'): number | undefined {
  const specific =
    process.env[`LOCAL_USAGE_BUDGET_${provider.toUpperCase()}_${window.toUpperCase()}_USD`];
  const shared = process.env[`LOCAL_USAGE_BUDGET_${window.toUpperCase()}_USD`];
  const raw = specific || shared;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function getLocalUsageBudget(
  userId: string,
  provider: CLIProvider
): Promise<LocalUsageBudget> {
  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json?: string | null } | undefined;

  const settings = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const budgets =
    settings.localUsageBudgets && typeof settings.localUsageBudgets === 'object'
      ? (settings.localUsageBudgets as Record<string, unknown>)
      : {};
  const providerBudget =
    budgets[provider] && typeof budgets[provider] === 'object'
      ? (budgets[provider] as Record<string, unknown>)
      : {};

  return {
    dailyUsd: normalizeBudgetValue(providerBudget.dailyUsd) ?? getEnvBudget(provider, 'daily'),
    weeklyUsd: normalizeBudgetValue(providerBudget.weeklyUsd) ?? getEnvBudget(provider, 'weekly'),
  };
}

// ── Alibaba Token Plan ──────────────────────────────────────────────────────
// Alibaba's Token Plan is a prepaid token allotment. Model Studio does not
// expose the remaining balance through the inference API key (the token-plan
// host only answers the inference router; quota lives behind Alibaba Cloud
// OpenAPI AccessKey signing). So the plan size and period are configured here
// and consumption is derived from usage_history, which already records every
// alibaba-token-plan turn routed through Pi.

const ALIBABA_TOKEN_PLAN_MODEL_PREFIX = 'alibaba-token-plan/';

export interface TokenPlanConfig {
  totalTokens: number;
  periodStart: string;
  periodDays: number;
}

function normalizePositiveInt(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function normalizeDateOnly(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  return Number.isFinite(Date.parse(`${trimmed}T00:00:00Z`)) ? trimmed : undefined;
}

async function getTokenPlanConfig(userId: string, planId: string): Promise<TokenPlanConfig | null> {
  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json?: string | null } | undefined;
  const settings = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const plans = asRecord(settings.tokenPlans) || {};
  const plan = asRecord(plans[planId]) || {};

  const totalTokens =
    normalizePositiveInt(plan.totalTokens) ??
    normalizePositiveInt(process.env.ALIBABA_TOKEN_PLAN_TOTAL_TOKENS);
  const periodStart =
    normalizeDateOnly(plan.periodStart) ??
    normalizeDateOnly(process.env.ALIBABA_TOKEN_PLAN_PERIOD_START);
  if (!totalTokens || !periodStart) return null;

  const periodDays =
    normalizePositiveInt(plan.periodDays) ??
    normalizePositiveInt(process.env.ALIBABA_TOKEN_PLAN_PERIOD_DAYS) ??
    30;
  return { totalTokens, periodStart, periodDays };
}

/**
 * Roll `periodStart` forward by whole periods until it covers `now`, so a
 * monthly plan keeps reporting against the current cycle without reconfiguring.
 */
function resolveTokenPlanWindow(config: TokenPlanConfig, now: Date) {
  const periodMs = config.periodDays * 24 * 60 * 60 * 1000;
  const firstStart = Date.parse(`${config.periodStart}T00:00:00Z`);
  const elapsed = now.getTime() - firstStart;
  const cycles = elapsed > 0 ? Math.floor(elapsed / periodMs) : 0;
  const start = new Date(firstStart + cycles * periodMs);
  const end = new Date(start.getTime() + periodMs);
  return { start, end, cycles };
}

async function readTokenPlanConsumption(userId: string, startIso: string): Promise<number> {
  const row = (await pgGet(
    `SELECT COALESCE(SUM(total_tokens), 0) as tokens
         FROM usage_history
        WHERE user_id = ?
          AND model LIKE ?
          AND created_at >= ?`,
    userId,
    `${ALIBABA_TOKEN_PLAN_MODEL_PREFIX}%`,
    startIso
  )) as unknown as { tokens: number };
  return row?.tokens ?? 0;
}

async function buildAlibabaLimitResponse(userId: string) {
  const config = await getTokenPlanConfig(userId, 'alibaba-token-plan');
  if (!config) {
    return {
      success: true,
      supported: false,
      provider: 'alibaba' as const,
      data: null,
      error: {
        code: 'TOKEN_PLAN_NOT_CONFIGURED',
        message:
          'Alibaba Token Plan size and period are not configured. Set them via PUT /api/usage/token-plan or ALIBABA_TOKEN_PLAN_TOTAL_TOKENS + ALIBABA_TOKEN_PLAN_PERIOD_START.',
      },
    };
  }

  const now = new Date();
  const { start, end } = resolveTokenPlanWindow(config, now);
  const startSql = start.toISOString().slice(0, 19).replace('T', ' ');
  const used = await readTokenPlanConsumption(userId, startSql);
  const utilization = config.totalTokens > 0 ? (used / config.totalTokens) * 100 : 0;
  const windowSeconds = config.periodDays * 24 * 60 * 60;

  return {
    success: true,
    supported: true,
    provider: 'alibaba' as const,
    data: {
      subscriptionType: 'alibaba-token-plan',
      rateLimitTier: 'token-plan',
      // The plan period is the only window Alibaba enforces; expose it as the
      // long window so the existing limits card renders it unchanged.
      fiveHour: null,
      sevenDay: {
        utilization: Math.min(Math.round(utilization * 10) / 10, 100),
        resetsAt: end.toISOString(),
        windowSeconds,
      },
      sevenDaySonnet: null,
      additional: [],
      // Locally derived, so make the provenance explicit rather than letting it
      // look like an upstream reading.
      source: 'local-usage-history',
      tokenPlan: {
        totalTokens: config.totalTokens,
        usedTokens: used,
        remainingTokens: Math.max(config.totalTokens - used, 0),
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        periodDays: config.periodDays,
      },
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '***') return null;
  return trimmed.replace(/^Bearer\s+/i, '').trim() || null;
}

function configuredEnvKey(envNames: string[]): string | null {
  for (const name of envNames) {
    const value = normalizeApiKey(process.env[name]);
    if (value) return value;
  }
  return null;
}

async function readStoredProviderKey(
  userId: string,
  providerIds: string[]
): Promise<string | null> {
  const providers = (await readModelProvidersForUser(userId)).filter(
    (provider) => provider.enabled && providerIds.includes(provider.id)
  );

  for (const provider of providers) {
    const key = normalizeApiKey(safeDecrypt(provider.apiKey));
    if (key) return key;
  }
  return null;
}

export async function getZaiApiKey(userId: string): Promise<string | null> {
  return (
    configuredEnvKey(['ZAI_API_KEY', 'GLM_API_KEY', 'ZHIPU_API_KEY', 'Z_AI_API_KEY']) ||
    (await readStoredProviderKey(userId, ['z-ai', 'zai']))
  );
}

async function hasConfiguredModelProvider(providerIds: string[], userId: string): Promise<boolean> {
  const stored = (await readModelProvidersForUser(userId)).some(
    (provider) =>
      provider.enabled &&
      providerIds.includes(provider.id) &&
      (Boolean(provider.apiKey) || Boolean(provider.baseUrl))
  );
  if (stored) return true;

  const catalog = getModelProviderCatalog();
  return providerIds.some((providerId) =>
    Boolean(configuredEnvKey(getModelProviderCredentialEnvVars(providerId, catalog)))
  );
}

function providerSqlPredicate(provider: CLIProvider): string {
  switch (provider) {
    case 'codex':
      return "(lower(provider) = 'codex' OR (lower(provider) IN ('', 'unknown') AND (lower(model) LIKE 'gpt-%' OR lower(model) LIKE '%codex%')))";
    case 'claude':
      return "(lower(provider) = 'claude' OR (lower(provider) IN ('', 'unknown') AND (lower(model) LIKE 'claude%' OR lower(model) IN ('opus', 'sonnet', 'haiku'))))";
    case 'zai':
      return "lower(provider) IN ('zai', 'z-ai')";
    case 'pi':
      return "lower(provider) = 'pi'";
    case 'vibe':
      return "lower(provider) = 'vibe'";
    default: {
      // The predicate is interpolated straight into SQL, so a provider this
      // switch does not know about used to become the literal `undefined` in a
      // WHERE clause. `never` makes adding a seventh CLIProvider a compile
      // error; the throw is what happens if the value arrives from outside the
      // type system anyway.
      const unreachable: never = provider;
      throw new Error(`No usage predicate for provider ${String(unreachable)}`);
    }
  }
}

function nextLocalReset(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function toSqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function getLocalWeekWindow(now = new Date()): { startsAt: Date; resetsAt: Date } {
  const local = new Date(now);
  const daysSinceMonday = (local.getDay() + 6) % 7;
  const startsAt = new Date(local);
  startsAt.setDate(local.getDate() - daysSinceMonday);
  startsAt.setHours(0, 0, 0, 0);

  const resetsAt = new Date(startsAt);
  resetsAt.setDate(startsAt.getDate() + 7);
  return { startsAt, resetsAt };
}

function pct(spend: number, budget?: number): number {
  if (!budget || budget <= 0) return 0;
  return Math.min(999, Math.round((spend / budget) * 100));
}

function clampUtilization(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(999, Math.round(value)));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function epochMillisToIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const millis = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
      const date = new Date(millis);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  return null;
}

function parseDateLikeToIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function zaiWindowSeconds(limit: ZaiQuotaLimit): number | null {
  if (limit.unit === 3 && limit.number === 5) return 5 * 60 * 60;
  if (limit.unit === 6 && limit.number === 7) return 7 * 24 * 60 * 60;
  if (limit.unit === 5 && limit.number === 1) return 30 * 24 * 60 * 60;
  return null;
}

function mapZaiWindow(limit?: ZaiQuotaLimit, unit = 'tokens'): NormalizedUsageWindow | null {
  if (!limit) return null;
  const used = finiteNumber(limit.currentValue);
  const total = finiteNumber(limit.usage) ?? finiteNumber(limit.limit);
  const remaining =
    finiteNumber(limit.remaining) ??
    (used !== null && total !== null ? Math.max(0, total - used) : null);
  const utilization =
    finiteNumber(limit.percentage) ??
    (used !== null && total && total > 0 ? Math.round((used / total) * 100) : 0);

  return {
    utilization: clampUtilization(utilization),
    resetsAt: epochMillisToIso(limit.nextResetTime),
    windowSeconds: zaiWindowSeconds(limit),
    used,
    limit: total,
    remaining,
    unit,
  };
}

function selectZaiTokenLimit(
  limits: ZaiQuotaLimit[],
  unit: number,
  number: number,
  fallbackIndex: number
): ZaiQuotaLimit | undefined {
  const tokenLimits = limits.filter((limit) => limit.type === 'TOKENS_LIMIT');
  return (
    tokenLimits.find((limit) => limit.unit === unit && limit.number === number) ||
    tokenLimits[fallbackIndex]
  );
}

export function mapZaiUsage(
  quota: ZaiQuotaPayload | null,
  subscription: ZaiSubscriptionItem[] | null
): UsageLimitPayload | null {
  const limits = quota?.limits || [];
  if (!Array.isArray(limits) || limits.length === 0) return null;

  const activePlan =
    subscription?.find((item) => item.inCurrentPeriod || item.status === 'VALID') ||
    subscription?.[0];
  const fiveHour = selectZaiTokenLimit(limits, 3, 5, 0);
  const weekly = selectZaiTokenLimit(limits, 6, 7, 1);
  const searchLimit = limits.find((limit) => limit.type === 'TIME_LIMIT');
  const searchReset =
    epochMillisToIso(searchLimit?.nextResetTime) || parseDateLikeToIso(activePlan?.nextRenewTime);

  return {
    subscriptionType: activePlan?.productName || 'GLM Coding Plan',
    rateLimitTier: activePlan?.productName || 'Z.ai',
    fiveHour: mapZaiWindow(fiveHour, 'tokens'),
    sevenDay: mapZaiWindow(weekly, 'tokens'),
    sevenDaySonnet: null,
    additional: searchLimit
      ? [
          {
            name: 'Web search',
            ...mapZaiWindow(
              { ...searchLimit, nextResetTime: searchReset || searchLimit.nextResetTime },
              'requests'
            )!,
          },
        ]
      : [],
    source: 'upstream',
  };
}

function zaiStatusFromCode(code: unknown): number | null {
  if (typeof code === 'number' && Number.isFinite(code)) return code;
  if (typeof code === 'string' && code.trim()) {
    const parsed = Number(code);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isAuthStatus(status: number | null | undefined): boolean {
  return status === 401 || status === 403;
}

function zaiEnvelopeMessage(body: unknown, fallback: string): string {
  const parsed = asRecord(body);
  const message = parsed?.msg || parsed?.message;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}

function unwrapZaiEnvelope<T>(body: unknown): T {
  const parsed = asRecord(body);
  if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'data')) {
    return parsed.data as T;
  }
  return body as T;
}

export async function fetchZaiJson<T>(apiKey: string, pathname: string): Promise<T> {
  const baseUrl = (process.env.ZAI_USAGE_BASE_URL || 'https://api.z.ai').replace(/\/+$/, '');
  const authHeaders = [...new Set([apiKey, `Bearer ${apiKey}`])];
  let authError: (Error & { status?: number }) | null = null;

  for (const authorization of authHeaders) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en-US,en',
        'Content-Type': 'application/json',
        Authorization: authorization,
        'User-Agent': 'plum-code-webui/1.0',
      },
    });
    const rawBody = await response.text();

    if (isAuthStatus(response.status)) {
      authError = new Error(`Z.ai credentials rejected: HTTP ${response.status}`) as Error & {
        status?: number;
      };
      authError.status = response.status;
      continue;
    }

    if (!response.ok) {
      const err = new Error(`Z.ai usage error: HTTP ${response.status}`) as Error & {
        status?: number;
      };
      err.status = response.status;
      throw err;
    }

    let body: unknown;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      const err = new Error('Z.ai usage response was not JSON') as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    const envelope = asRecord(body) as ZaiApiEnvelope | null;
    const status = zaiStatusFromCode(envelope?.code);
    if (isAuthStatus(status)) {
      authError = new Error(zaiEnvelopeMessage(body, 'Z.ai credentials rejected')) as Error & {
        status?: number;
      };
      authError.status = status ?? undefined;
      continue;
    }

    if (envelope?.success === false) {
      const err = new Error(
        zaiEnvelopeMessage(body, 'Z.ai usage response reported failure')
      ) as Error & {
        status?: number;
      };
      err.status = status ?? undefined;
      throw err;
    }

    return unwrapZaiEnvelope<T>(body);
  }

  throw authError ?? new Error('Z.ai authentication failed');
}

function formatZaiDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function zaiModelUsagePath(days: number): string {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 0, 0, 0, 0);
  const params = new URLSearchParams({
    startTime: formatZaiDateTime(start),
    endTime: formatZaiDateTime(end),
  });
  return `/api/monitor/usage/model-usage?${params.toString()}`;
}

export function mapZaiAccountUsage(
  usage: ZaiModelUsagePayload | null,
  periodDays: number
): NonNullable<UsageLimitPayload['accountUsage']> | undefined {
  const totalTokens = finiteNumber(usage?.totalUsage?.totalTokensUsage);
  const totalRequests = finiteNumber(usage?.totalUsage?.totalModelCallCount);
  if (totalTokens === null || totalRequests === null) return undefined;

  const dates = Array.isArray(usage?.x_time) ? usage.x_time : [];
  const summaries = usage?.totalUsage?.modelSummaryList || usage?.modelSummaryList || [];
  return {
    periodDays,
    totalTokens,
    totalRequests,
    startsAt: dates[0] || null,
    endsAt: dates.at(-1) || null,
    timezone: 'Asia/Shanghai',
    models: summaries
      .map((item) => ({
        model: typeof item.modelName === 'string' ? item.modelName : '',
        tokens: finiteNumber(item.totalTokens) ?? 0,
      }))
      .filter((item) => item.model && item.tokens > 0),
  };
}

// Each Z.ai read costs three upstream calls and clients poll every minute, so
// successful reads are shared for a short while and concurrent reads coalesce,
// like the Claude and Codex branches.
const zaiUsageCache = new Map<string, { expiresAt: number; value: UsageLimitResult }>();
const zaiUsageRequests = new Map<string, Promise<UsageLimitResult>>();
const ZAI_USAGE_CACHE_TTL_MS = 45_000;

async function fetchZaiUsageLimits(
  userId: string,
  apiKeyOverride?: string,
  providerId: 'zai' | 'z-ai' = 'z-ai'
): Promise<UsageLimitResult> {
  const apiKey = normalizeApiKey(apiKeyOverride) || (await getZaiApiKey(userId));
  if (!apiKey) return fetchZaiUsageLimitsUncached(userId, apiKey, providerId);
  const cacheKey = `${providerId}:${crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 24)}`;
  const cached = zaiUsageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = zaiUsageRequests.get(cacheKey);
  if (pending) return pending;
  const request = fetchZaiUsageLimitsUncached(userId, apiKey, providerId)
    .then((value) => {
      if (value.supported) {
        zaiUsageCache.set(cacheKey, { expiresAt: Date.now() + ZAI_USAGE_CACHE_TTL_MS, value });
      }
      return value;
    })
    .finally(() => zaiUsageRequests.delete(cacheKey));
  zaiUsageRequests.set(cacheKey, request);
  return request;
}

async function fetchZaiUsageLimitsUncached(
  userId: string,
  apiKey: string | null | undefined,
  providerId: 'zai' | 'z-ai'
): Promise<UsageLimitResult> {
  if (!apiKey) {
    const configured = await hasConfiguredModelProvider(['z-ai', 'zai'], userId);
    return {
      success: configured,
      supported: configured,
      provider: providerId,
      data: configured ? unavailableUsageData('Z.ai Coding Plan', 'No API key') : null,
      error: { code: 'NO_CREDENTIALS', message: 'Z.ai API key not found' },
    };
  }

  try {
    const accountUsageDays = 30;
    const [quota, subscription, modelUsage] = await Promise.all([
      fetchZaiJson<ZaiQuotaPayload>(apiKey, '/api/monitor/usage/quota/limit'),
      fetchZaiJson<ZaiSubscriptionItem[]>(apiKey, '/api/biz/subscription/list').catch(() => null),
      fetchZaiJson<ZaiModelUsagePayload>(apiKey, zaiModelUsagePath(accountUsageDays - 1)).catch(
        () => null
      ),
    ]);
    const mapped = mapZaiUsage(quota, subscription);
    if (mapped) mapped.accountUsage = mapZaiAccountUsage(modelUsage, accountUsageDays);
    return {
      success: Boolean(mapped),
      supported: Boolean(mapped),
      provider: providerId,
      data: mapped,
      error: mapped
        ? undefined
        : { code: 'UNSUPPORTED_RESPONSE', message: 'Z.ai usage response did not include limits' },
    };
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status === 401 || status === 403) {
      return {
        success: true,
        supported: true,
        provider: providerId,
        data: unavailableUsageData('Z.ai Coding Plan', 'Credentials need refresh'),
        error: { code: 'NO_CREDENTIALS', message: 'Z.ai API key is missing or expired' },
      };
    }
    console.error('Z.ai usage fetch error:', err);
    return {
      success: false,
      supported: false,
      provider: providerId,
      data: null,
      error: { code: 'ZAI_USAGE_ERROR', message: 'Failed to fetch Z.ai usage limits' },
    };
  }
}

/**
 * Spend against a self-declared budget, for providers that have no account API
 * to ask.
 *
 * This is the only usage signal available for the execution harnesses, and the
 * only one left for an account provider whose credentials have gone stale. It
 * is an estimate derived from our own priced `usage_history`, never an upstream
 * quota, which is why the payload is marked as such.
 */
async function fetchLocalBudgetUsage(userId: string, provider: CLIProvider) {
  const budget = await getLocalUsageBudget(userId, provider);
  if (!budget.dailyUsd && !budget.weeklyUsd) {
    return null;
  }
  const predicate = providerSqlPredicate(provider);
  const localWeek = getLocalWeekWindow();
  const daily = (await pgGet(
    `SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(total_tokens), 0) as tokens, COUNT(*) as requests
       FROM usage_history
       WHERE user_id = ? AND created_at >= ? AND ${predicate}`,
    userId,
    // Bound as a parameter rather than in SQL: this used to read
    // `datetime('now', '-1 day')`, which is SQLite and would have thrown on
    // the first call had there ever been one.
    toSqlTimestamp(new Date(Date.now() - 24 * 60 * 60 * 1000))
  )) as unknown as { cost: number; tokens: number; requests: number };
  const weekly = (await pgGet(
    `SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(total_tokens), 0) as tokens, COUNT(*) as requests
       FROM usage_history
       WHERE user_id = ? AND created_at >= ? AND created_at < ? AND ${predicate}`,
    userId,
    toSqlTimestamp(localWeek.startsAt),
    toSqlTimestamp(localWeek.resetsAt)
  )) as unknown as {
    cost: number;
    tokens: number;
    requests: number;
  };

  return {
    subscriptionType: 'local-budget',
    rateLimitTier: 'local-budget',
    fiveHour: budget.dailyUsd
      ? { utilization: pct(daily.cost, budget.dailyUsd), resetsAt: nextLocalReset(1) }
      : null,
    sevenDay: budget.weeklyUsd
      ? {
          utilization: pct(weekly.cost, budget.weeklyUsd),
          resetsAt: localWeek.resetsAt.toISOString(),
        }
      : null,
    sevenDaySonnet: null,
    localBudget: {
      dailyUsd: budget.dailyUsd ?? null,
      weeklyUsd: budget.weeklyUsd ?? null,
      dailySpendUsd: daily.cost,
      weeklySpendUsd: weekly.cost,
      dailyTokens: daily.tokens,
      weeklyTokens: weekly.tokens,
      dailyRequests: daily.requests,
      weeklyRequests: weekly.requests,
    },
    source: 'local-budget' as const,
  };
}

/**
 * The `/limits` envelope around a local budget, or null when the user has not
 * declared one. `z-ai` is a request-level alias; the spend behind it is booked
 * under the CLI provider it belongs to.
 *
 * Deliberately not run through `persistUsageLimitResult`: the snapshot table
 * records what the upstream account reported, and an estimate derived from our
 * own priced history is not that.
 */
/**
 * What `/limits` answers when the account cannot be reached. A declared budget
 * beats an empty card, so it wins over the bare error when one exists.
 */
async function noCredentialsOrLocalBudget(
  userId: string,
  provider: UsageProviderId,
  message: string
): Promise<UsageLimitResult> {
  return (
    (await localBudgetLimitResult(userId, provider)) ?? {
      success: false,
      supported: false,
      provider,
      data: null,
      error: { code: 'NO_CREDENTIALS', message },
    }
  );
}

async function localBudgetLimitResult(
  userId: string,
  provider: UsageProviderId
): Promise<UsageLimitResult | null> {
  const cliProvider: CLIProvider = provider === 'z-ai' ? 'zai' : provider;
  const data = await fetchLocalBudgetUsage(userId, cliProvider);
  return data ? { success: true, supported: true, provider, data } : null;
}

// Refresh Claude OAuth token
async function refreshClaudeToken(refreshToken: string): Promise<ClaudeCredentials | null> {
  try {
    const tokens = await requestClaudeOAuthTokenRefresh(refreshToken);
    const existing = await getClaudeCredentials();
    const now = Date.now();
    const updated: ClaudeCredentials = {
      claudeAiOauth: {
        ...existing?.claudeAiOauth,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || refreshToken,
        expiresAt: now + tokens.expiresIn * 1000,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresIn
          ? now + tokens.refreshTokenExpiresIn * 1000
          : existing?.claudeAiOauth?.refreshTokenExpiresAt,
        scopes: existing?.claudeAiOauth?.scopes || [],
        subscriptionType: existing?.claudeAiOauth?.subscriptionType || 'unknown',
        rateLimitTier: existing?.claudeAiOauth?.rateLimitTier || 'unknown',
      },
    };

    await fs.writeFile(credentialsPath, JSON.stringify(updated, null, 2));
    console.log('Claude token refreshed successfully');
    return updated;
  } catch (err) {
    console.error('Token refresh error:', err);
    return null;
  }
}

type FetchUsageResult = {
  ok: boolean;
  status: number;
  data?: UsageLimitResponse;
  error?: string;
};

// The Codex branch has had a TTL cache and a single-flight map since it was
// written; the Claude branch went straight out to api.anthropic.com on every
// request. Two browser tabs plus the widget poll meant three concurrent
// upstream calls for one number that only changes every few minutes.
const claudeUsageCache = new Map<string, { expiresAt: number; value: FetchUsageResult }>();
const claudeUsageRequests = new Map<string, Promise<FetchUsageResult>>();
const CLAUDE_USAGE_CACHE_TTL_MS = 120_000;
/**
 * api.anthropic.com/api/oauth/usage answers 429 in bursts (Retry-After: 0) when
 * the same OAuth token is polled by several clients. A failed read used to drop
 * Claude from the watch, widget and limit cards until the next success, so the
 * last good reading (up to 6 h old) stands in, and after a 429 nobody asks
 * upstream again for a few minutes, which only prolonged the limit.
 */
const CLAUDE_USAGE_STALE_MAX_MS = 6 * 60 * 60_000;
const CLAUDE_USAGE_BACKOFF_MS = 3 * 60_000;
let claudeUsageLastGood: { at: number; value: FetchUsageResult } | null = null;
let claudeUsageBackoffUntil = 0;

/** The last good reading for transient failures (429, 5xx, network), else the failure. */
function claudeUsageFallback(failure: FetchUsageResult): FetchUsageResult {
  const transient = failure.status === 429 || failure.status >= 500;
  if (failure.status === 429) claudeUsageBackoffUntil = Date.now() + CLAUDE_USAGE_BACKOFF_MS;
  if (
    transient &&
    claudeUsageLastGood &&
    Date.now() - claudeUsageLastGood.at < CLAUDE_USAGE_STALE_MAX_MS
  )
    return claudeUsageLastGood.value;
  return failure;
}

function claudeUsageCacheKey(accessToken: string): string {
  return crypto.createHash('sha256').update(accessToken).digest('hex').slice(0, 24);
}

// Helper to fetch usage with a given access token
async function fetchUsage(accessToken: string): Promise<FetchUsageResult> {
  const cacheKey = claudeUsageCacheKey(accessToken);
  const cached = claudeUsageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const inFlight = claudeUsageRequests.get(cacheKey);
  if (inFlight) return inFlight;
  if (Date.now() < claudeUsageBackoffUntil && claudeUsageLastGood) return claudeUsageLastGood.value;

  const request = (async (): Promise<FetchUsageResult> => {
    // Without a deadline a hung upstream connection holds the Express handler
    // open indefinitely, and every retry stacks another one behind it.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    timeout.unref();

    try {
      const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'plum-code-webui/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return claudeUsageFallback({ ok: false, status: response.status, error: errorText });
      }

      const data = (await response.json()) as UsageLimitResponse;
      const value: FetchUsageResult = { ok: true, status: 200, data };
      // Only successful reads are cached. A 401 has to reach the caller so the
      // token refresh path still runs on the very next request.
      claudeUsageCache.set(cacheKey, { expiresAt: Date.now() + CLAUDE_USAGE_CACHE_TTL_MS, value });
      claudeUsageLastGood = { at: Date.now(), value };
      claudeUsageBackoffUntil = 0;
      return value;
    } catch (err) {
      console.error('Fetch usage error:', err);
      return claudeUsageFallback({ ok: false, status: 500, error: String(err) });
    } finally {
      clearTimeout(timeout);
    }
  })();

  claudeUsageRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    claudeUsageRequests.delete(cacheKey);
  }
}

router.get('/limit-history', requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const requestedProviders = String(req.query.providers || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is TrackedUsageLimitProvider =>
        TRACKED_USAGE_LIMIT_PROVIDERS.includes(value as TrackedUsageLimitProvider)
      );
    const providers =
      requestedProviders.length > 0
        ? [...new Set(requestedProviders)]
        : TRACKED_USAGE_LIMIT_PROVIDERS;
    const range = normalizeUsageLimitHistoryRange(req.query.range);

    return res.json({
      success: true,
      data: await queryUsageLimitHistory(userId, providers, range),
    });
  } catch (error) {
    console.error('[USAGE LIMITS] Failed to read quota history:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'LIMIT_HISTORY_ERROR', message: 'Failed to read provider limit history' },
    });
  }
});

// Read/write the declared Mistral monthly budget and billing day.
router.get('/plan/mistral', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  return res.json({ success: true, data: await getMistralPlanConfig(userId) });
});

router.put('/plan/mistral', requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const body = asRecord(req.body) || {};
    return res.json({
      success: true,
      data: await saveMistralPlanConfig(userId, body),
    });
  } catch (error) {
    console.error('[USAGE LIMITS] Failed to save Mistral plan:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'MISTRAL_PLAN_SAVE_FAILED', message: 'Failed to save Mistral plan' },
    });
  }
});

// The Vibe Code allowance of the same plan, tracked on its own so an API key
// and a Vibe sign-in do not share one budget.
router.get('/plan/vibe', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  return res.json({ success: true, data: await getVibePlanConfig(userId) });
});

router.put('/plan/vibe', requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const body = asRecord(req.body) || {};
    return res.json({ success: true, data: await saveVibePlanConfig(userId, body) });
  } catch (error) {
    console.error('[USAGE LIMITS] Failed to save Vibe plan:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'VIBE_PLAN_SAVE_FAILED', message: 'Failed to save Vibe plan' },
    });
  }
});

// Read/write the locally configured prepaid token plan (Alibaba Token Plan).
router.get('/token-plan', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  return res.json({
    success: true,
    data: await getTokenPlanConfig(userId, 'alibaba-token-plan'),
  });
});

router.put('/token-plan', requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const body = asRecord(req.body) || {};
    const totalTokens = normalizePositiveInt(body.totalTokens);
    const periodStart = normalizeDateOnly(body.periodStart);
    const periodDays = normalizePositiveInt(body.periodDays) ?? 30;

    if (!totalTokens || !periodStart) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN_PLAN',
          message: 'totalTokens (> 0) and periodStart (YYYY-MM-DD) are required.',
        },
      });
    }
    const row = (await pgGet(
      'SELECT settings_json FROM user_settings WHERE user_id = ?',
      userId
    )) as unknown as { settings_json?: string | null } | undefined;
    const settings = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
    const plans = asRecord(settings.tokenPlans) || {};
    settings.tokenPlans = {
      ...plans,
      'alibaba-token-plan': { totalTokens, periodStart, periodDays },
    };

    await pgRun(
      `INSERT INTO user_settings (user_id, settings_json)
       VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json`,
      userId,
      JSON.stringify(settings)
    );

    return res.json({ success: true, data: { totalTokens, periodStart, periodDays } });
  } catch (error) {
    console.error('[USAGE LIMITS] Failed to save token plan:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'TOKEN_PLAN_SAVE_FAILED', message: 'Failed to save token plan' },
    });
  }
});

// Fetch usage limits for the selected provider.
router.get('/limits', requireAuth, rateLimiters.usageLimits, async (req, res) => {
  try {
    const providerParam = String(req.query.provider || 'codex').toLowerCase();
    const harnessProviders: UsageProviderId[] = ['pi'];
    if (harnessProviders.includes(providerParam as UsageProviderId)) {
      // A harness has no account to query, but the user may have declared a
      // spend budget in settings — that is the only usage signal there is here.
      const local = await localBudgetLimitResult(
        (req as AuthenticatedRequest).userId,
        providerParam as UsageProviderId
      );
      if (local) return res.json(local);
      return res.json({
        success: true,
        supported: false,
        provider: providerParam,
        data: null,
        error: {
          code: 'HARNESS_HAS_NO_ACCOUNT_LIMITS',
          message:
            'Pi is an execution harness. Account limits are available for Codex, Claude, and Z.AI.',
        },
      });
    }

    if (providerParam === 'alibaba' || providerParam === 'alibaba-token-plan') {
      return res.json(await buildAlibabaLimitResponse((req as AuthenticatedRequest).userId));
    }

    if (providerParam === 'mistral') {
      return res.json(await buildMistralLimitResponse((req as AuthenticatedRequest).userId));
    }

    if (providerParam === 'vibe') {
      // Vibe is a Mistral harness, but its turns draw on the plan's separate
      // Vibe Code allowance, so it gets its own monthly ledger view.
      return res.json(
        await buildMistralLimitResponse((req as AuthenticatedRequest).userId, 'vibe')
      );
    }

    const accountProviders: UsageProviderId[] = ['claude', 'zai', 'codex', 'z-ai'];
    if (!accountProviders.includes(providerParam as UsageProviderId)) {
      return res.status(400).json({
        success: false,
        supported: false,
        provider: providerParam,
        data: null,
        error: {
          code: 'UNKNOWN_LIMIT_PROVIDER',
          message:
            'Account limits are available for Codex, Claude, Z.AI, Mistral, and the Alibaba Token Plan.',
        },
      });
    }
    const provider = providerParam as UsageProviderId;
    const userId = (req as AuthenticatedRequest).userId;

    if (provider === 'zai') {
      const zaiApi = await getZaiApiConfigForUser(userId);
      const result = await fetchZaiUsageLimits(userId, zaiApi?.authToken, 'zai');
      return res.json(persistUsageLimitResult(userId, result));
    }

    if (provider === 'z-ai') {
      const result = await fetchZaiUsageLimits(userId);
      return res.json(persistUsageLimitResult(userId, result));
    }

    if (provider === 'codex') {
      const codexAuth = await getCodexAuth();
      if (!codexAuth?.tokens?.access_token) {
        return res.json(
          await noCredentialsOrLocalBudget(userId, 'codex', 'Codex credentials not found')
        );
      }

      const buildCodexResponse = (mapped: ReturnType<typeof mapCodexUsage>) => ({
        success: true,
        supported: true,
        provider: 'codex' as const,
        data: {
          // Mirror Claude's shape so the existing frontend usage card renders without
          // changes: subscriptionType / rateLimitTier are surfaced for the badge,
          // fiveHour / sevenDay are the two primary windows.
          subscriptionType: mapped.plan ?? 'codex',
          rateLimitTier: mapped.plan ?? 'codex',
          fiveHour: mapped.fiveHour,
          sevenDay: mapped.sevenDay,
          // Codex doesn't have a Sonnet-equivalent third window; keep the field
          // null for shape compatibility.
          sevenDaySonnet: null,
          // Extra per-model / per-feature limits (e.g. code-review). Frontend can
          // optionally render these as additional bars beside the main two.
          additional: mapped.additional,
        },
      });

      // Without a paid ChatGPT plan Codex reports a "free" plan with an empty
      // monthly window: no subscription, so every limit display hides it (watch,
      // widget, session bar) until a plan returns.
      const codexResult = (usage: Parameters<typeof mapCodexUsage>[0]) => {
        const mapped = mapCodexUsage(usage);
        if (mapped.plan === 'free')
          return { success: true, supported: false, provider: 'codex' as const, data: null };
        return persistUsageLimitResult(userId, buildCodexResponse(mapped));
      };

      try {
        const usage = await fetchCodexUsage(codexAuth);
        if (!usage) {
          return res.json({ success: true, supported: false, provider: 'codex', data: null });
        }
        return res.json(codexResult(usage));
      } catch (err) {
        const errorText = String(err);
        const isAuthError = isCodexUsageAuthError(err);
        if (isAuthError) {
          const refreshed = await refreshCodexToken(codexAuth);
          if (refreshed?.tokens?.access_token) {
            try {
              const usage = await fetchCodexUsage(refreshed);
              return res.json(codexResult(usage));
            } catch (retryErr) {
              console.error('Codex usage retry error:', retryErr);
            }
          }
          return res.json(
            await noCredentialsOrLocalBudget(
              userId,
              'codex',
              'Codex credentials not found or expired'
            )
          );
        }

        console.error('Codex usage fetch error:', err);
        return res.status(502).json({
          success: false,
          error: {
            code: 'CODEX_USAGE_ERROR',
            message: `Failed to fetch Codex usage: ${errorText}`,
          },
        });
      }
    }

    let credentials = await getClaudeCredentials();

    if (!credentials?.claudeAiOauth?.accessToken) {
      return res.json(
        await noCredentialsOrLocalBudget(userId, 'claude', 'Claude credentials not found')
      );
    }

    let { accessToken, subscriptionType, rateLimitTier } = credentials.claudeAiOauth;
    const { refreshToken } = credentials.claudeAiOauth;

    // Try to fetch usage
    let result = await fetchUsage(accessToken);

    // If 401, try to refresh token and retry
    if (!result.ok && result.status === 401 && refreshToken) {
      console.log('Token expired, attempting refresh...');
      const refreshed = await refreshClaudeToken(refreshToken);

      if (refreshed?.claudeAiOauth?.accessToken) {
        credentials = refreshed;
        accessToken = refreshed.claudeAiOauth.accessToken;
        subscriptionType = refreshed.claudeAiOauth.subscriptionType;
        rateLimitTier = refreshed.claudeAiOauth.rateLimitTier;
        result = await fetchUsage(accessToken);
      }
    }

    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        return res.json(
          await noCredentialsOrLocalBudget(
            userId,
            'claude',
            'Claude credentials not found or expired'
          )
        );
      }
      console.error('Claude API error:', result.status, result.error);
      return res.status(result.status).json({
        success: false,
        error: { code: 'API_ERROR', message: `Claude API error: ${result.status}` },
      });
    }

    const usageData = result.data!;

    // Transform to frontend-friendly format
    const response: UsageLimitResult = {
      success: true,
      supported: true,
      provider: 'claude',
      data: {
        subscriptionType,
        rateLimitTier,
        fiveHour: usageData.five_hour
          ? {
              utilization: usageData.five_hour.utilization,
              resetsAt: usageData.five_hour.resets_at,
            }
          : null,
        sevenDay: usageData.seven_day
          ? {
              utilization: usageData.seven_day.utilization,
              resetsAt: usageData.seven_day.resets_at,
            }
          : null,
        sevenDaySonnet: usageData.seven_day_opus
          ? {
              utilization: usageData.seven_day_opus.utilization,
              resetsAt: usageData.seven_day_opus.resets_at,
            }
          : null,
      },
    };
    res.json(persistUsageLimitResult(userId, response));
  } catch (err) {
    console.error('Failed to fetch usage limits:', err);
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch usage limits' },
    });
  }
});

export default router;
