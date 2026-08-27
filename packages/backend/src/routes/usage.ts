import { get as pgGet, run as pgRun } from '../db/pg.js';
import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { CLI_PROVIDERS, type CLIProvider } from '../services/cli-providers.js';
import {
  getOpenCodeCredentialEnvVars,
  readOpenCodeProvidersForUser,
} from '../utils/opencodeProviderKeys.js';
import { getOpenCodeProviderCatalog } from '../utils/opencodeCatalog.js';
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
import { fetchKimiUsage } from '../utils/kimiUsage.js';
import { getZaiApiConfigForUser } from './settings.js';
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

type UsageProviderId = CLIProvider | 'z-ai' | 'opencode-go';

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

const TRACKED_USAGE_LIMIT_PROVIDERS: TrackedUsageLimitProvider[] = [
  'codex',
  'claude',
  'zai',
  'kimi',
];

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

interface OpenCodeConfigProvider {
  env?: unknown;
  options?: unknown;
}

interface OpenCodeGoCredentials {
  authCookie: string;
  workspaceId: string;
}

interface OpenCodeGoQuotaWindow {
  status: 'ok' | 'error' | 'unknown';
  usagePercent: number;
  resetsInSeconds: number;
}

interface OpenCodeGoQuotaSnapshot {
  rolling: OpenCodeGoQuotaWindow;
  weekly: OpenCodeGoQuotaWindow;
  monthly: OpenCodeGoQuotaWindow;
  source: 'api' | 'scraping';
}

interface UsageSpendWindow {
  cost: number;
  tokens: number;
  requests: number;
  oldest: string | null;
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
// alibaba-token-plan turn routed through OpenCode or Pi.

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

function expandHome(value: string): string {
  return value.replace(/^~/, os.homedir());
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

async function readOpenCodeConfig(): Promise<Record<string, OpenCodeConfigProvider>> {
  const explicitPath =
    process.env.OPENCODE_CONFIG_PATH || process.env.CLI_PROVIDER_OPENCODE_CONFIG_PATH;
  const configPath = explicitPath
    ? expandHome(explicitPath)
    : path.join(
        expandHome(process.env.OPENCODE_CONFIG_DIR || '~/.config/opencode'),
        'opencode.json'
      );

  try {
    const parsed = JSON.parse(await fs.readFile(configPath, 'utf-8')) as unknown;
    const providerBlock = asRecord(asRecord(parsed)?.provider);
    if (!providerBlock) return {};

    const providers: Record<string, OpenCodeConfigProvider> = {};
    for (const [id, value] of Object.entries(providerBlock)) {
      const provider = asRecord(value);
      if (!provider) continue;
      providers[id] = {
        env: provider.env,
        options: provider.options,
      };
    }
    return providers;
  } catch {
    return {};
  }
}

function readApiKeyFromOpenCodeProviderConfig(
  config: Record<string, OpenCodeConfigProvider>,
  providerIds: string[]
): string | null {
  for (const providerId of providerIds) {
    const provider = config[providerId];
    const env = Array.isArray(provider?.env)
      ? provider.env.filter((item): item is string => typeof item === 'string')
      : [];
    const envKey = configuredEnvKey(env);
    if (envKey) return envKey;

    const options = asRecord(provider?.options);
    const apiKey = normalizeApiKey(options?.apiKey);
    if (apiKey) return apiKey;
  }
  return null;
}

async function readOpenCodeStoredProviderKey(
  userId: string,
  providerIds: string[]
): Promise<string | null> {
  const providers = (await readOpenCodeProvidersForUser(userId)).filter(
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
    (await readOpenCodeStoredProviderKey(userId, ['z-ai', 'zai'])) ||
    readApiKeyFromOpenCodeProviderConfig(await readOpenCodeConfig(), ['z-ai', 'zai'])
  );
}

async function hasConfiguredOpenCodeProvider(
  providerIds: string[],
  userId: string
): Promise<boolean> {
  const catalog = getOpenCodeProviderCatalog();
  const equivalentIds = new Set(providerIds);
  if (providerIds.includes('opencode-go')) {
    // The OpenCode Go provider uses the same OPENCODE_API_KEY env slot as the
    // main OpenCode provider in current OpenCode catalogs.
    equivalentIds.add('opencode');
  }

  const stored = (await readOpenCodeProvidersForUser(userId)).some(
    (provider) =>
      provider.enabled &&
      equivalentIds.has(provider.id) &&
      (Boolean(provider.apiKey) || Boolean(provider.baseUrl))
  );
  if (stored) return true;

  const config = await readOpenCodeConfig();
  for (const providerId of equivalentIds) {
    if (config[providerId]) return true;
    if (configuredEnvKey(getOpenCodeCredentialEnvVars(providerId, catalog))) return true;
  }

  return false;
}

function providerSqlPredicate(provider: CLIProvider): string {
  switch (provider) {
    case 'codex':
      return "(lower(provider) = 'codex' OR (lower(provider) IN ('', 'unknown') AND (lower(model) LIKE 'gpt-%' OR lower(model) LIKE '%codex%')))";
    case 'claude':
      return "(lower(provider) = 'claude' OR (lower(provider) IN ('', 'unknown') AND (lower(model) LIKE 'claude%' OR lower(model) IN ('opus', 'sonnet', 'haiku'))))";
    case 'zai':
      return "lower(provider) IN ('zai', 'z-ai')";
    case 'opencode':
      return "(lower(provider) = 'opencode' OR (lower(provider) IN ('', 'unknown') AND (strpos(model, '/') > 0 OR lower(model) LIKE '%opencode%')))";
    case 'pi':
      return "lower(provider) = 'pi'";
    case 'kimi':
      return "lower(provider) = 'kimi'";
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

async function fetchZaiUsageLimits(
  userId: string,
  apiKeyOverride?: string,
  providerId: 'zai' | 'z-ai' = 'z-ai'
): Promise<UsageLimitResult> {
  const apiKey = normalizeApiKey(apiKeyOverride) || (await getZaiApiKey(userId));
  if (!apiKey) {
    const configured = await hasConfiguredOpenCodeProvider(['z-ai', 'zai'], userId);
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

function normalizeOpenCodeGoCookie(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('auth=') ? trimmed : `auth=${trimmed}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function getOpenCodeGoConfigFilePaths(): string[] {
  const explicit = normalizeApiKey(process.env.OPENCODE_GO_CONFIG_PATH);
  const home = os.homedir();
  const configDirs = uniqueStrings(
    [
      process.env.OPENCODE_CONFIG_DIR,
      process.env.CLI_PROVIDER_OPENCODE_CONFIG_PATH,
      path.join(home, '.opencode', 'config'),
      path.join(home, '.config', 'opencode'),
      path.join(home, '.local', 'share', 'opencode'),
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(expandHome)
  );

  return uniqueStrings([
    ...(explicit ? [expandHome(explicit)] : []),
    ...configDirs.map((dir) => path.join(dir, 'opencode-quota', 'opencode-go.json')),
  ]);
}

function openCodeGoCredentialsFromRecord(record: Record<string, unknown> | null) {
  const authCookie = normalizeApiKey(record?.authCookie);
  const workspaceId = normalizeApiKey(record?.workspaceId);
  return authCookie && workspaceId ? { authCookie, workspaceId } : null;
}

async function readOpenCodeGoCredentialsFile(): Promise<OpenCodeGoCredentials | null> {
  for (const configPath of getOpenCodeGoConfigFilePaths()) {
    try {
      const parsed = JSON.parse(await fs.readFile(configPath, 'utf-8')) as unknown;
      const credentials = openCodeGoCredentialsFromRecord(asRecord(parsed));
      if (credentials) return credentials;
    } catch {
      // Missing or invalid optional quota config; try the next candidate.
    }
  }
  return null;
}

async function getOpenCodeGoCredentials(userId: string): Promise<OpenCodeGoCredentials | null> {
  const settingsRow = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json?: string | null } | undefined;
  const settings = safeJsonParse<Record<string, unknown>>(settingsRow?.settings_json, {});
  const quotaSettings = asRecord(settings.opencodeGoQuota);

  const envCredentials = openCodeGoCredentialsFromRecord({
    authCookie: process.env.OPENCODE_GO_AUTH_COOKIE || process.env.OPENCODE_AUTH_COOKIE,
    workspaceId: process.env.OPENCODE_GO_WORKSPACE_ID || process.env.OPENCODE_WORKSPACE_ID,
  });
  if (envCredentials) return envCredentials;

  const settingsCredentials = openCodeGoCredentialsFromRecord(quotaSettings);
  if (settingsCredentials) return settingsCredentials;

  return readOpenCodeGoCredentialsFile();
}

function addSecondsToNow(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function mapOpenCodeGoWindow(window: OpenCodeGoQuotaWindow): NormalizedUsageWindow {
  return {
    utilization: clampUtilization(window.usagePercent),
    resetsAt: addSecondsToNow(window.resetsInSeconds),
    windowSeconds: window.resetsInSeconds > 0 ? window.resetsInSeconds : null,
    used: window.usagePercent,
    limit: 100,
    remaining: Math.max(0, 100 - clampUtilization(window.usagePercent)),
    unit: 'percent',
  };
}

function mapOpenCodeGoWindowOrNull(window: OpenCodeGoQuotaWindow): NormalizedUsageWindow | null {
  return window.status === 'unknown' ? null : mapOpenCodeGoWindow(window);
}

function parseHumanDurationSeconds(value: string): number | null {
  const normalized = value.toLowerCase().trim().replace(/\s+/g, ' ');
  if (['reset-now', 'reset now', 'now', 'resets now'].includes(normalized)) return 0;

  let seconds = 0;
  let matched = false;
  const units: Array<[RegExp, number]> = [
    [/(\d+(?:\.\d+)?)\s*days?/, 24 * 60 * 60],
    [/(\d+(?:\.\d+)?)\s*hours?/, 60 * 60],
    [/(\d+(?:\.\d+)?)\s*minutes?/, 60],
    [/(\d+(?:\.\d+)?)\s*seconds?/, 1],
  ];

  for (const [pattern, multiplier] of units) {
    const match = normalized.match(pattern);
    if (!match) continue;
    matched = true;
    seconds += Number(match[1]) * multiplier;
  }

  return matched && Number.isFinite(seconds) ? seconds : null;
}

function stripSolidComments(value: string): string {
  return value
    .replace(/<!--\$-->/g, '')
    .replace(/<!--\/-->/g, '')
    .trim();
}

function parseOpenCodeGoDataSlotHtml(
  html: string
): Partial<Record<'rolling' | 'weekly' | 'monthly', OpenCodeGoQuotaWindow>> {
  const windows: Partial<Record<'rolling' | 'weekly' | 'monthly', OpenCodeGoQuotaWindow>> = {};
  const items = html.split(/data-slot="usage-item"/);

  for (let i = 1; i < items.length; i++) {
    const content = items[i] || '';
    const labelMatch = content.match(/data-slot="usage-label">([^<]+)</);
    const usageMatch = content.match(/data-slot="usage-value">[^0-9]*(\d+(?:\.\d+)?)/);
    const resetMatch = content.match(/data-slot="(reset-time|reset-now)">([\s\S]*?)<\/span>/);
    if (!labelMatch?.[1] || !usageMatch?.[1] || !resetMatch?.[1] || resetMatch[2] === undefined) {
      continue;
    }

    const label = labelMatch[1].trim().toLowerCase();
    const usagePercent = Number(usageMatch[1]);
    const resetText = stripSolidComments(resetMatch[2])
      .replace(/Resets?\s*in\s*/i, '')
      .trim();
    const resetsInSeconds =
      resetMatch[1] === 'reset-now' ? 0 : parseHumanDurationSeconds(resetText);

    if (!Number.isFinite(usagePercent) || resetsInSeconds === null) continue;

    const key = label.includes('rolling')
      ? 'rolling'
      : label.includes('weekly')
        ? 'weekly'
        : label.includes('monthly')
          ? 'monthly'
          : null;
    if (!key) continue;

    windows[key] = {
      status: 'ok',
      usagePercent,
      resetsInSeconds,
    };
  }

  return windows;
}

export function parseOpenCodeGoQuotaHtml(html: string): OpenCodeGoQuotaSnapshot | null {
  const extractWindow = (name: string): OpenCodeGoQuotaWindow => {
    const numberPattern = String.raw`(-?\d+(?:\.\d+)?)`;
    const patterns = [
      new RegExp(
        String.raw`${name}:\$R\[\d+\]=\{[^}]*usagePercent:${numberPattern}[^}]*resetInSec:${numberPattern}[^}]*\}`
      ),
      new RegExp(
        String.raw`${name}:\$R\[\d+\]=\{[^}]*resetInSec:${numberPattern}[^}]*usagePercent:${numberPattern}[^}]*\}`
      ),
      new RegExp(
        String.raw`${name}=\{[^}]*usagePercent:${numberPattern}[^}]*resetInSec:${numberPattern}[^}]*\}`
      ),
      new RegExp(
        String.raw`${name}=\{[^}]*resetInSec:${numberPattern}[^}]*usagePercent:${numberPattern}[^}]*\}`
      ),
    ];

    for (let index = 0; index < patterns.length; index++) {
      const pattern = patterns[index]!;
      const match = pattern.exec(html);
      if (!match) continue;
      const pctFirst = index % 2 === 0;
      const usagePercent = Number(match[pctFirst ? 1 : 2]);
      const resetsInSeconds = Number(match[pctFirst ? 2 : 1]);
      const statusMatch = match[0].match(/status:"([^"]+)"/);
      const statusValue = statusMatch?.[1];
      const status = statusValue === 'ok' || statusValue === 'error' ? statusValue : 'ok';
      return {
        status,
        resetsInSeconds,
        usagePercent,
      };
    }

    return { status: 'unknown', resetsInSeconds: 0, usagePercent: 0 };
  };

  const snapshot: OpenCodeGoQuotaSnapshot = {
    rolling: extractWindow('rollingUsage'),
    weekly: extractWindow('weeklyUsage'),
    monthly: extractWindow('monthlyUsage'),
    source: 'scraping',
  };

  if (snapshot.rolling.status !== 'unknown') return snapshot;
  if (snapshot.weekly.status !== 'unknown') return snapshot;
  if (snapshot.monthly.status !== 'unknown') return snapshot;

  const dataSlot = parseOpenCodeGoDataSlotHtml(html);
  if (dataSlot.rolling || dataSlot.weekly || dataSlot.monthly) {
    return {
      rolling: dataSlot.rolling ?? snapshot.rolling,
      weekly: dataSlot.weekly ?? snapshot.weekly,
      monthly: dataSlot.monthly ?? snapshot.monthly,
      source: 'scraping',
    };
  }

  return null;
}

function mapOpenCodeGoLiveUsage(snapshot: OpenCodeGoQuotaSnapshot): UsageLimitPayload {
  const monthly = mapOpenCodeGoWindowOrNull(snapshot.monthly);
  return {
    subscriptionType: 'OpenCode Go',
    rateLimitTier: 'Go subscription',
    fiveHour: mapOpenCodeGoWindowOrNull(snapshot.rolling),
    sevenDay: mapOpenCodeGoWindowOrNull(snapshot.weekly),
    sevenDaySonnet: null,
    additional: monthly ? [{ name: 'Monthly', ...monthly }] : [],
    source: 'upstream',
  };
}

async function fetchOpenCodeGoLiveQuota(
  credentials: OpenCodeGoCredentials
): Promise<UsageLimitPayload> {
  const url = `https://opencode.ai/workspace/${encodeURIComponent(credentials.workspaceId)}/go`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Cookie: normalizeOpenCodeGoCookie(credentials.authCookie),
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `https://opencode.ai/workspace/${encodeURIComponent(credentials.workspaceId)}`,
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    const err = new Error(`OpenCode Go dashboard error: HTTP ${response.status}`) as Error & {
      status?: number;
    };
    err.status = response.status;
    throw err;
  }

  const snapshot = parseOpenCodeGoQuotaHtml(await response.text());
  if (!snapshot) {
    throw new Error('OpenCode Go dashboard response did not include quota windows');
  }

  return mapOpenCodeGoLiveUsage(snapshot);
}

function addMsToSqlTimestamp(sqlTimestamp: string | null, ms: number): string | null {
  if (!sqlTimestamp) return null;
  const iso = sqlTimestamp.includes('T') ? sqlTimestamp : `${sqlTimestamp.replace(' ', 'T')}Z`;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed + ms).toISOString();
}

async function rollingWindowSpend(
  userId: string,
  predicate: string,
  windowMs: number
): Promise<UsageSpendWindow> {
  const startsAt = new Date(Date.now() - windowMs);
  return (await pgGet(
    `SELECT COALESCE(SUM(cost_usd), 0) as cost,
              COALESCE(SUM(total_tokens), 0) as tokens,
              COUNT(*) as requests,
              MIN(created_at) as oldest
       FROM usage_history
       WHERE user_id = ? AND created_at >= ? AND ${predicate}`,
    userId,
    toSqlTimestamp(startsAt)
  )) as unknown as UsageSpendWindow;
}

export function hasOpenCodeGoLocalUsage(windows: Array<{ requests: number }>): boolean {
  return windows.some((window) => Number.isFinite(window.requests) && window.requests > 0);
}

function planWindow(
  spend: UsageSpendWindow,
  budgetUsd: number,
  windowMs: number
): NormalizedUsageWindow {
  return {
    utilization: pct(spend.cost, budgetUsd),
    resetsAt: addMsToSqlTimestamp(spend.oldest, windowMs),
    windowSeconds: Math.round(windowMs / 1000),
    used: spend.cost,
    limit: budgetUsd,
    remaining: Math.max(0, budgetUsd - spend.cost),
    unit: 'usd',
  };
}

function envUsd(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function fetchOpenCodeGoUsage(userId: string): Promise<UsageLimitResult> {
  const credentials = await getOpenCodeGoCredentials(userId);
  let liveQuotaError: { code: string; message: string } | undefined;
  if (credentials) {
    try {
      return {
        success: true,
        supported: true,
        provider: 'opencode-go',
        data: await fetchOpenCodeGoLiveQuota(credentials),
      };
    } catch (err) {
      console.error('OpenCode Go live quota fetch error:', err);
      liveQuotaError = {
        code: 'OPENCODE_GO_LIVE_QUOTA_ERROR',
        message: 'OpenCode Go live quota unavailable; showing local WebUI estimate',
      };
    }
  }

  const predicate = "(lower(model) LIKE 'opencode-go/%')";
  const fiveHourMs = 5 * 60 * 60 * 1000;
  const weeklyMs = 7 * 24 * 60 * 60 * 1000;
  const monthlyMs = 30 * 24 * 60 * 60 * 1000;
  const fiveHour = await rollingWindowSpend(userId, predicate, fiveHourMs);
  const weekly = await rollingWindowSpend(userId, predicate, weeklyMs);
  const monthly = await rollingWindowSpend(userId, predicate, monthlyMs);
  const configured = await hasConfiguredOpenCodeProvider(['opencode-go'], userId);

  if (!hasOpenCodeGoLocalUsage([fiveHour, weekly, monthly])) {
    if (credentials) {
      return {
        success: true,
        supported: true,
        provider: 'opencode-go',
        data: unavailableUsageData('OpenCode Go', 'Dashboard unavailable'),
        error: liveQuotaError,
      };
    }

    if (configured) {
      return {
        success: true,
        supported: true,
        provider: 'opencode-go',
        data: unavailableUsageData('OpenCode Go', 'Quota setup required'),
        error: {
          code: 'NO_LIVE_QUOTA_CREDENTIALS',
          message:
            'OpenCode Go live quota needs workspace ID and auth cookie; no local opencode-go usage history exists yet',
        },
      };
    }

    return {
      success: true,
      supported: false,
      provider: 'opencode-go',
      data: null,
      error: {
        code: 'NOT_CONFIGURED',
        message: 'OpenCode Go provider is not configured',
      },
    };
  }

  const fiveHourBudget = envUsd('OPENCODE_GO_5H_BUDGET_USD', 12);
  const weeklyBudget = envUsd('OPENCODE_GO_WEEKLY_BUDGET_USD', 30);
  const monthlyBudget = envUsd('OPENCODE_GO_MONTHLY_BUDGET_USD', 60);

  return {
    success: true,
    supported: true,
    provider: 'opencode-go',
    data: {
      subscriptionType: 'OpenCode Go',
      rateLimitTier: credentials ? 'Dashboard unavailable' : 'Go subscription',
      fiveHour: planWindow(fiveHour, fiveHourBudget, fiveHourMs),
      sevenDay: planWindow(weekly, weeklyBudget, weeklyMs),
      sevenDaySonnet: null,
      additional: [
        {
          name: 'Monthly',
          ...planWindow(monthly, monthlyBudget, monthlyMs),
        },
      ],
      source: 'local-estimate',
    },
    error: liveQuotaError,
  };
}

export async function fetchLocalBudgetUsage(userId: string, provider: CLIProvider) {
  const budget = await getLocalUsageBudget(userId, provider);
  if (!budget.dailyUsd && !budget.weeklyUsd) {
    return null;
  }
  const predicate = providerSqlPredicate(provider);
  const localWeek = getLocalWeekWindow();
  const daily = (await pgGet(
    `SELECT COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(total_tokens), 0) as tokens, COUNT(*) as requests
       FROM usage_history
       WHERE user_id = ? AND created_at >= datetime('now', '-1 day') AND ${predicate}`,
    userId
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
  };
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

// Helper to fetch usage with a given access token
async function fetchUsage(
  accessToken: string
): Promise<{ ok: boolean; status: number; data?: UsageLimitResponse; error?: string }> {
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
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, status: response.status, error: errorText };
    }

    const data = (await response.json()) as UsageLimitResponse;
    return { ok: true, status: 200, data };
  } catch (err) {
    console.error('Fetch usage error:', err);
    return { ok: false, status: 500, error: String(err) };
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
router.get('/limits', requireAuth, async (req, res) => {
  try {
    const providerParam = String(req.query.provider || 'codex').toLowerCase();
    const harnessProviders: UsageProviderId[] = ['opencode', 'pi', 'opencode-go'];
    if (harnessProviders.includes(providerParam as UsageProviderId)) {
      return res.json({
        success: true,
        supported: false,
        provider: providerParam,
        data: null,
        error: {
          code: 'HARNESS_HAS_NO_ACCOUNT_LIMITS',
          message:
            'OpenCode and Pi are execution harnesses. Account limits are available for Codex, Claude, and Z.AI.',
        },
      });
    }

    if (providerParam === 'alibaba' || providerParam === 'alibaba-token-plan') {
      return res.json(await buildAlibabaLimitResponse((req as AuthenticatedRequest).userId));
    }

    const accountProviders: UsageProviderId[] = ['claude', 'zai', 'codex', 'kimi', 'z-ai'];
    if (!accountProviders.includes(providerParam as UsageProviderId)) {
      return res.status(400).json({
        success: false,
        supported: false,
        provider: providerParam,
        data: null,
        error: {
          code: 'UNKNOWN_LIMIT_PROVIDER',
          message:
            'Account limits are available for Codex, Claude, Kimi, Z.AI, and the Alibaba Token Plan.',
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
        return res.json({
          success: false,
          supported: false,
          provider: 'codex',
          data: null,
          error: { code: 'NO_CREDENTIALS', message: 'Codex credentials not found' },
        });
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

      try {
        const usage = await fetchCodexUsage(codexAuth);
        if (!usage) {
          return res.json({ success: true, supported: false, provider: 'codex', data: null });
        }
        return res.json(persistUsageLimitResult(userId, buildCodexResponse(mapCodexUsage(usage))));
      } catch (err) {
        const errorText = String(err);
        const isAuthError = isCodexUsageAuthError(err);
        if (isAuthError) {
          const refreshed = await refreshCodexToken(codexAuth);
          if (refreshed?.tokens?.access_token) {
            try {
              const usage = await fetchCodexUsage(refreshed);
              return res.json(
                persistUsageLimitResult(userId, buildCodexResponse(mapCodexUsage(usage)))
              );
            } catch (retryErr) {
              console.error('Codex usage retry error:', retryErr);
            }
          }
          return res.json({
            success: false,
            supported: false,
            provider: 'codex',
            data: null,
            error: { code: 'NO_CREDENTIALS', message: 'Codex credentials not found or expired' },
          });
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

    if (provider === 'kimi') {
      const result = await fetchKimiUsage();
      if (!result.ok) {
        return res.status(result.status >= 500 ? 502 : 200).json({
          success: false,
          supported: false,
          provider: 'kimi',
          data: null,
          error: { code: result.code, message: result.message },
        });
      }
      return res.json(
        persistUsageLimitResult(userId, {
          success: true,
          supported: true,
          provider: 'kimi',
          data: result.data,
        })
      );
    }

    let credentials = await getClaudeCredentials();

    if (!credentials?.claudeAiOauth?.accessToken) {
      return res.json({
        success: false,
        supported: false,
        provider: 'claude',
        data: null,
        error: { code: 'NO_CREDENTIALS', message: 'Claude credentials not found' },
      });
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
        return res.json({
          success: false,
          supported: false,
          provider: 'claude',
          data: null,
          error: { code: 'NO_CREDENTIALS', message: 'Claude credentials not found or expired' },
        });
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
