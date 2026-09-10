import { maskSecret } from '../utils/maskSecret.js';
import { get as pgGet, run as pgRun } from '../db/pg.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/auth.js';
import { getAppConfig, setAppConfig, insertUsageHistoryTurn } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { requireHookSecret } from '../middleware/hookSecret.js';
import { nanoid } from 'nanoid';

import { safeEncrypt, safeDecrypt } from '../utils/encryption.js';
import { safeJsonParse } from '../utils/json.js';
import type {
  UserSettings,
  Theme,
  UiProvider,
  BackgroundAnimation,
  CLIProvider,
  CodexWebSearchMode,
  CodexServiceTier,
  LocalUsageBudget,
  OracleBrowserSettings,
  AnalyticsSettings,
} from '@plum-code-webui/shared';
import { DEFAULT_ANALYTICS_HIDDEN_LIMIT_METRICS, estimateModelCost } from '@plum-code-webui/shared';
import { parseOracleBrowserSettings } from '../utils/oracleSettings.js';
import { KIMI_CODING_MODELS, hasKimiCodingCredentials } from '../utils/kimiUsage.js';
import {
  ensureOpenCodeTenantDirectories,
  resolveOpenCodeTenantPaths,
} from '../services/opencode/tenantPaths.js';
import { buildOpenCodeProviderCredentialEnv } from '../utils/opencodeProviderKeys.js';
import { mergeUserSettings, removeUserSettings } from '../utils/userSettings.js';
import { syncProviderLinks } from '../utils/providerLinks.js';
import { syncPiConfig } from '../utils/piConfig.js';

const router = Router();

const CLAUDE_API_TIMEOUT_MS = 3_000_000;

export interface ClaudeApiConfig {
  baseUrl: string;
  authToken: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
  apiTimeoutMs: number;
}

export type ZaiApiConfig = ClaudeApiConfig;

export const DEFAULT_ENABLED_CLI_PROVIDERS: CLIProvider[] = [
  'codex',
  'claude',
  'zai',
  'opencode',
  'pi',
  'kimi',
];

export type ClaudeApiEndpointKind = 'anthropic' | 'z-ai' | 'custom';

export function getClaudeApiEndpointKind(config: ClaudeApiConfig | null): ClaudeApiEndpointKind {
  if (!config) return 'anthropic';

  try {
    const hostname = new URL(config.baseUrl).hostname.toLowerCase();
    if (hostname === 'z.ai' || hostname.endsWith('.z.ai')) return 'z-ai';
    if (hostname === 'anthropic.com' || hostname.endsWith('.anthropic.com')) return 'anthropic';
  } catch {
    // The settings schema validates URLs; keep malformed legacy values isolated.
  }

  return 'custom';
}

export function getClaudeApiModelLabels(
  config: ClaudeApiConfig | null
): Partial<Record<'opus' | 'sonnet' | 'haiku', string>> | null {
  if (!config) return null;
  const labels: Partial<Record<'opus' | 'sonnet' | 'haiku', string>> = {};
  if (config.opusModel) labels.opus = config.opusModel;
  if (config.sonnetModel) labels.sonnet = config.sonnetModel;
  if (config.haikuModel) labels.haiku = config.haikuModel;
  return labels;
}

const claudeApiSettingsSchema = z.object({
  baseUrl: z.string().trim().url().max(2048),
  authToken: z.string().trim().min(1).max(4096).optional(),
  opusModel: z.string().trim().max(200).optional(),
  sonnetModel: z.string().trim().max(200).optional(),
  haikuModel: z.string().trim().max(200).optional(),
});

function compactOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function buildClaudeApiEnv(config: ClaudeApiConfig | null): Record<string, string> {
  if (!config) return {};

  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: config.baseUrl,
    ANTHROPIC_AUTH_TOKEN: config.authToken,
    API_TIMEOUT_MS: String(config.apiTimeoutMs),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };

  if (config.opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = config.opusModel;
  if (config.sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = config.sonnetModel;
  if (config.haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = config.haikuModel;

  return env;
}

export const updateSettingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system', 'eink']).optional(),
  // Account-wide alert thresholds. Both clients read these instead of keeping
  // their own local copies, so a change applies everywhere at once.
  usageAlerts: z
    .object({
      enabled: z.boolean().optional(),
      quotaPercent: z.number().int().min(1).max(100).optional(),
      dailyCostUsd: z.number().min(0).max(10000).optional(),
    })
    .partial()
    .optional(),
  // Appearance is device-local by default (a phone in the dark and a desktop in
  // daylight rarely want the same theme). Turning this on makes theme and
  // background follow the account onto every client instead.
  appearanceSync: z.boolean().optional(),
  defaultWorkingDir: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).optional(),
  customSystemPrompt: z.string().nullable().optional(),
  uiProvider: z.enum(['plum', 'claude', 'zai', 'codex', 'opencode', 'pi', 'kimi']).optional(),
  backgroundAnimation: z.enum(['glass', 'aurora', 'ribbons', 'still']).optional(),
  defaultCliProvider: z.enum(['claude', 'zai', 'codex', 'opencode', 'pi', 'kimi']).optional(),
  enabledCliProviders: z
    .array(z.enum(['claude', 'zai', 'codex', 'opencode', 'pi', 'kimi']))
    .min(1)
    .optional(),
  cliProviderModels: z
    .object({
      claude: z.string().optional(),
      zai: z.string().optional(),
      codex: z.string().optional(),
      opencode: z.string().optional(),
      pi: z.string().optional(),
      kimi: z.string().optional(),
    })
    .partial()
    .optional(),
  cliProviderModelLists: z
    .object({
      claude: z.array(z.string()).optional(),
      zai: z.array(z.string()).optional(),
      codex: z.array(z.string()).optional(),
      opencode: z.array(z.string()).optional(),
      pi: z.array(z.string()).optional(),
      kimi: z.array(z.string()).optional(),
    })
    .partial()
    .optional(),
  cliProviderReasoning: z
    .object({
      claude: z.string().optional(),
      zai: z.string().optional(),
      codex: z.string().optional(),
      opencode: z.string().optional(),
      pi: z.string().optional(),
      kimi: z.string().optional(),
    })
    .partial()
    .optional(),
  cliProviderServiceTiers: z
    .object({
      codex: z.enum(['fast']).optional(),
    })
    .partial()
    .optional(),
  codexWebSearch: z.enum(['auto', 'cached', 'live', 'disabled']).optional(),
  localUsageBudgets: z
    .object({
      claude: z
        .object({ dailyUsd: z.number().min(0).optional(), weeklyUsd: z.number().min(0).optional() })
        .partial()
        .optional(),
      zai: z
        .object({ dailyUsd: z.number().min(0).optional(), weeklyUsd: z.number().min(0).optional() })
        .partial()
        .optional(),
      codex: z
        .object({ dailyUsd: z.number().min(0).optional(), weeklyUsd: z.number().min(0).optional() })
        .partial()
        .optional(),
      opencode: z
        .object({ dailyUsd: z.number().min(0).optional(), weeklyUsd: z.number().min(0).optional() })
        .partial()
        .optional(),
      pi: z
        .object({ dailyUsd: z.number().min(0).optional(), weeklyUsd: z.number().min(0).optional() })
        .partial()
        .optional(),
      kimi: z
        .object({ dailyUsd: z.number().min(0).optional(), weeklyUsd: z.number().min(0).optional() })
        .partial()
        .optional(),
    })
    .partial()
    .optional(),
  oracleBrowser: z
    .object({
      mode: z.enum(['profile', 'manual', 'remote']).optional(),
      chatgptUrl: z.string().trim().max(512).nullable().optional(),
      remoteChrome: z.string().trim().max(256).nullable().optional(),
      chromeProfile: z.string().trim().max(120).nullable().optional(),
      chromeCookiePath: z.string().trim().max(512).nullable().optional(),
      manualLoginProfileDir: z.string().trim().max(512).nullable().optional(),
    })
    .partial()
    .optional(),
  analytics: z
    .object({
      hiddenLimitMetrics: z
        .object({
          codex: z.array(z.string().max(160)).optional(),
          kimi: z.array(z.string().max(160)).optional(),
          claude: z.array(z.string().max(160)).optional(),
          zai: z.array(z.string().max(160)).optional(),
        })
        .partial()
        .optional(),
    })
    .partial()
    .optional(),
});

export function stripDeviceAppearanceSettings<
  T extends { theme?: unknown; backgroundAnimation?: unknown },
>(settings: T): Omit<T, 'theme' | 'backgroundAnimation'> {
  const accountSettings = { ...settings };
  delete accountSettings.theme;
  delete accountSettings.backgroundAnimation;
  return accountSettings;
}

/** Alert thresholds always resolve to a complete object so clients can render. */
function parseUsageAlerts(value: unknown): {
  enabled: boolean;
  quotaPercent: number;
  dailyCostUsd: number;
} {
  const raw = (value ?? {}) as Record<string, unknown>;
  const quota = Number(raw.quotaPercent);
  const cost = Number(raw.dailyCostUsd);
  return {
    enabled: raw.enabled !== false,
    quotaPercent: Number.isFinite(quota) && quota > 0 && quota <= 100 ? Math.round(quota) : 80,
    dailyCostUsd: Number.isFinite(cost) && cost >= 0 ? cost : 5,
  };
}

function parseUiProvider(value: unknown): UiProvider {
  return value === 'plum' ||
    value === 'claude' ||
    value === 'zai' ||
    value === 'codex' ||
    value === 'opencode' ||
    value === 'pi' ||
    value === 'kimi'
    ? value
    : 'plum';
}

function parseCliProvider(value: unknown): CLIProvider {
  return value === 'claude' ||
    value === 'zai' ||
    value === 'codex' ||
    value === 'opencode' ||
    value === 'pi' ||
    value === 'kimi'
    ? value
    : 'codex';
}

export function parseEnabledCliProviders(value: unknown): CLIProvider[] {
  if (!Array.isArray(value)) return [...DEFAULT_ENABLED_CLI_PROVIDERS];
  const valid = new Set<CLIProvider>(DEFAULT_ENABLED_CLI_PROVIDERS);
  const providers = value.filter(
    (provider): provider is CLIProvider =>
      typeof provider === 'string' && valid.has(provider as CLIProvider)
  );
  return providers.length > 0 ? [...new Set(providers)] : [...DEFAULT_ENABLED_CLI_PROVIDERS];
}

export async function getEnabledCliProvidersForUser(userId: string): Promise<CLIProvider[]> {
  const settings = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;
  const parsed = safeJsonParse<Record<string, unknown>>(settings?.settings_json, {});
  return parseEnabledCliProviders(parsed.enabledCliProviders);
}

function parseBackgroundAnimation(value: unknown): BackgroundAnimation {
  return value === 'aurora' || value === 'ribbons' || value === 'still' || value === 'glass'
    ? value
    : 'aurora';
}

function parseCodexWebSearch(value: unknown): CodexWebSearchMode {
  return value === 'cached' || value === 'live' || value === 'disabled' || value === 'auto'
    ? value
    : 'auto';
}

function parseCliProviderModels(value: unknown): Partial<Record<CLIProvider, string>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, string>> = {};

  const providers: CLIProvider[] = DEFAULT_ENABLED_CLI_PROVIDERS;
  for (const provider of providers) {
    const model = raw[provider];
    if (typeof model === 'string' && model.trim()) {
      parsed[provider] = model.trim();
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseCliProviderModelLists(
  value: unknown
): Partial<Record<CLIProvider, string[]>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, string[]>> = {};

  const providers: CLIProvider[] = DEFAULT_ENABLED_CLI_PROVIDERS;
  for (const provider of providers) {
    const models = raw[provider];
    if (Array.isArray(models)) {
      const normalized = models
        .map((model) => (typeof model === 'string' ? model.trim() : ''))
        .filter((model) => model.length > 0);
      if (normalized.length > 0) {
        parsed[provider] = normalized;
      }
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

const VALID_REASONING_LEVELS = new Set([
  'fast',
  'off',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'extra_high',
  'xhigh',
  'max',
  'ultra',
]);

function normalizeReasoningLevel(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (!normalized) {
    return undefined;
  }

  return VALID_REASONING_LEVELS.has(normalized) ? normalized : undefined;
}

function parseCliProviderReasoning(
  value: unknown
): Partial<Record<CLIProvider, string>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, string>> = {};

  const providers: CLIProvider[] = DEFAULT_ENABLED_CLI_PROVIDERS;
  for (const provider of providers) {
    const level = normalizeReasoningLevel(raw[provider]);
    if (level) {
      parsed[provider] = level;
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function normalizeCodexServiceTier(_value: unknown): CodexServiceTier | undefined {
  return undefined;
}

function parseCliProviderServiceTiers(
  value: unknown
): Partial<Record<CLIProvider, CodexServiceTier>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, CodexServiceTier>> = {};
  const codexTier = normalizeCodexServiceTier(raw.codex);
  if (codexTier) {
    parsed.codex = codexTier;
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function normalizeBudgetNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.round(value * 100) / 100;
}

function parseLocalUsageBudgets(
  value: unknown
): Partial<Record<CLIProvider, LocalUsageBudget>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<CLIProvider, LocalUsageBudget>> = {};
  const providers: CLIProvider[] = DEFAULT_ENABLED_CLI_PROVIDERS;

  for (const provider of providers) {
    const entry = raw[provider];
    if (!entry || typeof entry !== 'object') continue;
    const budget = entry as Record<string, unknown>;
    const dailyUsd = normalizeBudgetNumber(budget.dailyUsd);
    const weeklyUsd = normalizeBudgetNumber(budget.weeklyUsd);
    if (dailyUsd || weeklyUsd) {
      parsed[provider] = { ...(dailyUsd ? { dailyUsd } : {}), ...(weeklyUsd ? { weeklyUsd } : {}) };
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function normalizeOracleBrowserSettings(value: unknown): OracleBrowserSettings | undefined {
  return parseOracleBrowserSettings(value);
}

export function parseAnalyticsSettings(value: unknown): AnalyticsSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { hiddenLimitMetrics: DEFAULT_ANALYTICS_HIDDEN_LIMIT_METRICS };
  }
  const parsed = value as { hiddenLimitMetrics?: unknown };
  if (
    !parsed.hiddenLimitMetrics ||
    typeof parsed.hiddenLimitMetrics !== 'object' ||
    Array.isArray(parsed.hiddenLimitMetrics)
  ) {
    return { hiddenLimitMetrics: {} };
  }
  const hiddenLimitMetrics: NonNullable<AnalyticsSettings['hiddenLimitMetrics']> = {};
  for (const provider of ['codex', 'kimi', 'claude', 'zai'] as const) {
    const metrics = (parsed.hiddenLimitMetrics as Record<string, unknown>)[provider];
    if (!Array.isArray(metrics)) continue;
    hiddenLimitMetrics[provider] = [
      ...new Set(
        metrics.filter(
          (metric): metric is string =>
            typeof metric === 'string' && metric.length > 0 && metric.length <= 160
        )
      ),
    ];
  }
  return { hiddenLimitMetrics };
}

// Get user settings
router.get('/', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  let settings = (await pgGet(
    `SELECT user_id as userId, theme, default_working_dir as defaultWorkingDir,
              allowed_tools as allowedTools, custom_system_prompt as customSystemPrompt,
              settings_json as settingsJson
       FROM user_settings WHERE user_id = ?`,
    userId
  )) as unknown as
    | {
        userId: string;
        theme: Theme;
        defaultWorkingDir: string | null;
        allowedTools: string;
        customSystemPrompt: string | null;
        settingsJson?: string | null;
      }
    | undefined;

  if (!settings) {
    // Create default settings
    await pgRun(
      `INSERT INTO user_settings (user_id, theme, allowed_tools)
       VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`,
      userId
    );

    settings = {
      userId,
      theme: 'dark',
      defaultWorkingDir: null,
      allowedTools: '["Bash","Read","Write","Edit","Glob","Grep"]',
      customSystemPrompt: null,
      settingsJson: null,
    };
  }

  const settingsJson = safeJsonParse<Record<string, unknown>>(settings.settingsJson, {});
  const uiProvider = parseUiProvider(settingsJson.uiProvider);
  const backgroundAnimation = parseBackgroundAnimation(settingsJson.backgroundAnimation);
  const defaultCliProvider = parseCliProvider(settingsJson.defaultCliProvider);
  const enabledCliProviders = parseEnabledCliProviders(settingsJson.enabledCliProviders);
  const cliProviderModels = parseCliProviderModels(settingsJson.cliProviderModels);
  const cliProviderModelLists = parseCliProviderModelLists(settingsJson.cliProviderModelLists);
  const cliProviderReasoning = parseCliProviderReasoning(settingsJson.cliProviderReasoning);
  const cliProviderServiceTiers = parseCliProviderServiceTiers(
    settingsJson.cliProviderServiceTiers
  );
  const codexWebSearch = parseCodexWebSearch(settingsJson.codexWebSearch);
  const localUsageBudgets = parseLocalUsageBudgets(settingsJson.localUsageBudgets);
  const oracleBrowser = normalizeOracleBrowserSettings(settingsJson.oracleBrowser);
  const analytics = parseAnalyticsSettings(settingsJson.analytics);

  const userSettings: UserSettings = {
    userId: settings.userId,
    theme: settings.theme,
    defaultWorkingDir: settings.defaultWorkingDir,
    allowedTools: JSON.parse(settings.allowedTools || '[]'),
    customSystemPrompt: settings.customSystemPrompt,
    uiProvider,
    backgroundAnimation,
    defaultCliProvider,
    enabledCliProviders,
    cliProviderModels,
    cliProviderModelLists,
    cliProviderReasoning,
    cliProviderServiceTiers,
    codexWebSearch,
    localUsageBudgets,
    oracleBrowser,
    analytics,
    appearanceSync: settingsJson.appearanceSync === true,
    usageAlerts: parseUsageAlerts(settingsJson.usageAlerts),
  };

  res.json({ success: true, data: userSettings });
});

// Update user settings
/**
 * Settings rows are created lazily. GET has always done it, PUT never did — so a
 * user who saved settings before ever loading them hit an UPDATE that matched no
 * row, and the re-read afterwards had nothing to return. That surfaced as a 500
 * on the very first save of a fresh account.
 */
async function ensureSettingsRow(userId: string): Promise<void> {
  await pgRun(
    `INSERT INTO user_settings (user_id, theme, allowed_tools)
     VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')
     ON CONFLICT (user_id) DO NOTHING`,
    userId
  );
}

router.put('/', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSettingsSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  await ensureSettingsRow(userId);
  const {
    defaultWorkingDir,
    allowedTools,
    customSystemPrompt,
    uiProvider,
    defaultCliProvider,
    enabledCliProviders,
    cliProviderModels,
    cliProviderModelLists,
    cliProviderReasoning,
    cliProviderServiceTiers,
    codexWebSearch,
    localUsageBudgets,
    oracleBrowser,
    analytics,
    usageAlerts,
    appearanceSync,
  } = stripDeviceAppearanceSettings(parsed.data);

  const updates: string[] = [];
  const values: unknown[] = [];

  // Appearance only becomes account state once the user asked for it. Resolve
  // against the stored flag so a plain theme change on a sync-enabled account
  // still propagates without having to resend the flag.
  const storedSettingsJson = safeJsonParse<Record<string, unknown>>(
    (
      (await pgGet(
        'SELECT settings_json FROM user_settings WHERE user_id = ?',
        userId
      )) as unknown as { settings_json: string | null } | undefined
    )?.settings_json,
    {}
  );
  const syncAppearance = appearanceSync ?? storedSettingsJson.appearanceSync === true;
  if (syncAppearance && parsed.data.theme !== undefined) {
    updates.push('theme = ?');
    values.push(parsed.data.theme);
  }

  if (defaultWorkingDir !== undefined) {
    updates.push('default_working_dir = ?');
    values.push(defaultWorkingDir);
  }
  if (allowedTools !== undefined) {
    updates.push('allowed_tools = ?');
    values.push(JSON.stringify(allowedTools));
  }
  if (customSystemPrompt !== undefined) {
    updates.push('custom_system_prompt = ?');
    values.push(customSystemPrompt);
  }
  if (
    uiProvider !== undefined ||
    defaultCliProvider !== undefined ||
    enabledCliProviders !== undefined ||
    cliProviderModels !== undefined ||
    cliProviderModelLists !== undefined ||
    cliProviderReasoning !== undefined ||
    cliProviderServiceTiers !== undefined ||
    codexWebSearch !== undefined ||
    localUsageBudgets !== undefined ||
    oracleBrowser !== undefined ||
    analytics !== undefined ||
    usageAlerts !== undefined ||
    appearanceSync !== undefined ||
    (syncAppearance && parsed.data.backgroundAnimation !== undefined)
  ) {
    const existing = (await pgGet(
      'SELECT settings_json FROM user_settings WHERE user_id = ?',
      userId
    )) as unknown as { settings_json: string | null } | undefined;

    const settingsJson = safeJsonParse<Record<string, unknown>>(existing?.settings_json, {});
    if (appearanceSync !== undefined) {
      settingsJson.appearanceSync = appearanceSync;
    }
    if (syncAppearance && parsed.data.backgroundAnimation !== undefined) {
      settingsJson.backgroundAnimation = parsed.data.backgroundAnimation;
    }
    if (uiProvider !== undefined) {
      settingsJson.uiProvider = uiProvider;
    }
    if (defaultCliProvider !== undefined) {
      settingsJson.defaultCliProvider = defaultCliProvider;
    }
    if (enabledCliProviders !== undefined) {
      const normalizedEnabledProviders = parseEnabledCliProviders(enabledCliProviders);
      settingsJson.enabledCliProviders = normalizedEnabledProviders;
      if (!normalizedEnabledProviders.includes(settingsJson.defaultCliProvider as CLIProvider)) {
        settingsJson.defaultCliProvider = normalizedEnabledProviders[0];
      }
    }
    if (cliProviderModels !== undefined) {
      const normalized = parseCliProviderModels(cliProviderModels) || {};
      if (Object.keys(normalized).length > 0) {
        settingsJson.cliProviderModels = normalized;
      } else {
        delete settingsJson.cliProviderModels;
      }
    }
    if (cliProviderModelLists !== undefined) {
      const normalized = parseCliProviderModelLists(cliProviderModelLists) || {};
      if (Object.keys(normalized).length > 0) {
        settingsJson.cliProviderModelLists = normalized;
      } else {
        delete settingsJson.cliProviderModelLists;
      }
    }
    if (cliProviderReasoning !== undefined) {
      const normalized = parseCliProviderReasoning(cliProviderReasoning) || {};
      if (Object.keys(normalized).length > 0) {
        settingsJson.cliProviderReasoning = normalized;
      } else {
        delete settingsJson.cliProviderReasoning;
      }
    }
    if (cliProviderServiceTiers !== undefined) {
      const normalized = parseCliProviderServiceTiers(cliProviderServiceTiers) || {};
      if (Object.keys(normalized).length > 0) {
        settingsJson.cliProviderServiceTiers = normalized;
      } else {
        delete settingsJson.cliProviderServiceTiers;
      }
    }
    if (codexWebSearch !== undefined) {
      settingsJson.codexWebSearch = parseCodexWebSearch(codexWebSearch);
    }
    if (localUsageBudgets !== undefined) {
      const normalized = parseLocalUsageBudgets(localUsageBudgets) || {};
      if (Object.keys(normalized).length > 0) {
        settingsJson.localUsageBudgets = normalized;
      } else {
        delete settingsJson.localUsageBudgets;
      }
    }
    if (oracleBrowser !== undefined) {
      const normalized = normalizeOracleBrowserSettings(oracleBrowser);
      if (normalized && Object.keys(normalized).length > 0) {
        settingsJson.oracleBrowser = normalized;
      } else {
        delete settingsJson.oracleBrowser;
      }
    }
    if (analytics !== undefined) {
      settingsJson.analytics = parseAnalyticsSettings(analytics);
    }
    if (usageAlerts !== undefined) {
      // Merge rather than replace: the clients send only the field they changed.
      const existingAlerts = (settingsJson.usageAlerts as Record<string, unknown>) || {};
      settingsJson.usageAlerts = { ...existingAlerts, ...usageAlerts };
    }
    updates.push('settings_json = ?');
    values.push(JSON.stringify(settingsJson));
  }

  if (updates.length > 0) {
    values.push(userId);
    await pgRun(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`, ...values);
  }

  // Fetch updated settings
  const settings = (await pgGet(
    `SELECT user_id as userId, theme, default_working_dir as defaultWorkingDir,
              allowed_tools as allowedTools, custom_system_prompt as customSystemPrompt,
              settings_json as settingsJson
       FROM user_settings WHERE user_id = ?`,
    userId
  )) as unknown as {
    userId: string;
    theme: Theme;
    defaultWorkingDir: string | null;
    allowedTools: string;
    customSystemPrompt: string | null;
    settingsJson?: string | null;
  };

  const updatedJson = safeJsonParse<Record<string, unknown>>(settings.settingsJson, {});
  const updatedUiProvider = parseUiProvider(updatedJson.uiProvider);
  const updatedBackgroundAnimation = parseBackgroundAnimation(updatedJson.backgroundAnimation);
  const updatedDefaultCliProvider = parseCliProvider(updatedJson.defaultCliProvider);
  const updatedEnabledCliProviders = parseEnabledCliProviders(updatedJson.enabledCliProviders);
  const updatedCliProviderModels = parseCliProviderModels(updatedJson.cliProviderModels);
  const updatedCliProviderModelLists = parseCliProviderModelLists(
    updatedJson.cliProviderModelLists
  );
  const updatedCliProviderReasoning = parseCliProviderReasoning(updatedJson.cliProviderReasoning);
  const updatedCliProviderServiceTiers = parseCliProviderServiceTiers(
    updatedJson.cliProviderServiceTiers
  );
  const updatedCodexWebSearch = parseCodexWebSearch(updatedJson.codexWebSearch);
  const updatedLocalUsageBudgets = parseLocalUsageBudgets(updatedJson.localUsageBudgets);
  const updatedOracleBrowser = normalizeOracleBrowserSettings(updatedJson.oracleBrowser);
  const updatedAnalytics = parseAnalyticsSettings(updatedJson.analytics);

  const userSettings: UserSettings = {
    userId: settings.userId,
    theme: settings.theme,
    defaultWorkingDir: settings.defaultWorkingDir,
    allowedTools: JSON.parse(settings.allowedTools || '[]'),
    customSystemPrompt: settings.customSystemPrompt,
    uiProvider: updatedUiProvider,
    backgroundAnimation: updatedBackgroundAnimation,
    defaultCliProvider: updatedDefaultCliProvider,
    enabledCliProviders: updatedEnabledCliProviders,
    cliProviderModels: updatedCliProviderModels,
    cliProviderModelLists: updatedCliProviderModelLists,
    cliProviderReasoning: updatedCliProviderReasoning,
    cliProviderServiceTiers: updatedCliProviderServiceTiers,
    codexWebSearch: updatedCodexWebSearch,
    localUsageBudgets: updatedLocalUsageBudgets,
    oracleBrowser: updatedOracleBrowser,
    analytics: updatedAnalytics,
    appearanceSync: updatedJson.appearanceSync === true,
    usageAlerts: parseUsageAlerts(updatedJson.usageAlerts),
  };

  res.json({ success: true, data: userSettings });
});

// Update API key
router.put('/api-key', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { apiKey } = req.body;

  if (!apiKey) {
    throw new AppError('API key is required', 400, 'MISSING_API_KEY');
  }

  // Encrypt the API key before storing

  await pgRun(
    'UPDATE users SET api_key_encrypted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    safeEncrypt(apiKey),
    userId
  );

  res.json({ success: true });
});

// Delete API key
router.delete('/api-key', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  await pgRun(
    'UPDATE users SET api_key_encrypted = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    userId
  );

  res.json({ success: true });
});

// Get GitHub token status (not the actual token)
router.get('/github-token', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  const settings = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    try {
      const parsed = JSON.parse(settings.settings_json);
      if (parsed.githubToken) {
        res.json({
          success: true,
          data: {
            hasToken: true,
            tokenPreview: maskSecret(parsed.githubToken),
          },
        });
        return;
      }
    } catch {
      // Invalid JSON, continue
    }
  }

  res.json({ success: true, data: { hasToken: false, tokenPreview: null } });
});

// Set GitHub token
router.put('/github-token', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { token } = req.body;

  if (!token || typeof token !== 'string') {
    throw new AppError('Token is required', 400, 'MISSING_TOKEN');
  }

  // Validate token format (GitHub PAT starts with ghp_, github_pat_, or is a classic token)
  if (!token.startsWith('ghp_') && !token.startsWith('github_pat_') && token.length < 20) {
    throw new AppError('Invalid GitHub token format', 400, 'INVALID_TOKEN');
  }

  // Merge inside Postgres. Read-modify-write in JS loses whichever concurrent
  // settings update commits first — two browser tabs, or a settings save racing
  // a provider-key write, silently dropped one side's field.
  await mergeUserSettings(userId, { githubToken: safeEncrypt(token) });

  res.json({
    success: true,
    data: {
      hasToken: true,
      tokenPreview: maskSecret(token),
    },
  });
});

// Delete GitHub token
router.delete('/github-token', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  // Get existing settings_json
  const existing = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;

  if (existing?.settings_json) {
    try {
      const settingsObj = JSON.parse(existing.settings_json);
      delete settingsObj.githubToken;

      await pgRun(
        'UPDATE user_settings SET settings_json = ? WHERE user_id = ?',
        JSON.stringify(settingsObj),
        userId
      );
    } catch {
      // Invalid JSON, just continue
    }
  }

  res.json({ success: true });
});

// Get GitHub token for internal use (returns full decrypted token)
export async function getGitHubTokenForUser(userId: string): Promise<string | null> {
  const settings = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;

  if (settings?.settings_json) {
    const parsed = safeJsonParse<Record<string, unknown>>(settings.settings_json, {});
    const encryptedToken = parsed.githubToken;
    if (typeof encryptedToken === 'string') {
      return safeDecrypt(encryptedToken);
    }
  }

  return null;
}

function serializeZaiApiStatus(config: ZaiApiConfig | null) {
  return {
    configured: !!config,
    baseUrl: config?.baseUrl ?? '',
    hasAuthToken: !!config?.authToken,
    authTokenPreview: maskSecret(config?.authToken),
    opusModel: config?.opusModel ?? '',
    sonnetModel: config?.sonnetModel ?? '',
    haikuModel: config?.haikuModel ?? '',
  };
}

/**
 * User-defined subagent upstreams for the model router.
 *
 * Z.AI was the first of these and is built in; this list is the general case:
 * any Anthropic-compatible endpoint, matched per request by model pattern. An
 * agent whose frontmatter names one of the listed models runs on that upstream
 * while the session's main agent stays on the Claude subscription.
 *
 * Stored in user_settings.settings_json like zaiApi, tokens encrypted the same
 * way, and the token never travels back to a client — updates without a token
 * keep the stored one, matched by entry id.
 */
export interface SubagentUpstream {
  id: string;
  label: string;
  baseUrl: string;
  authToken: string;
  /** Exact model ids, or prefixes ending in `*` (e.g. `kimi-*`). */
  models: string[];
}

const subagentUpstreamSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  label: z.string().trim().min(1).max(40),
  baseUrl: z.string().trim().url().max(300),
  authToken: z.string().trim().min(1).max(500).optional(),
  models: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
});

const subagentUpstreamsSchema = z.array(subagentUpstreamSchema).max(10);

export async function getSubagentUpstreamsForUser(userId: string): Promise<SubagentUpstream[]> {
  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;
  const settings = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const raw = settings.subagentUpstreams;
  if (!Array.isArray(raw)) return [];

  const upstreams: SubagentUpstream[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    const authToken = safeDecrypt(typeof entry.authToken === 'string' ? entry.authToken : null);
    if (!authToken || typeof entry.baseUrl !== 'string' || !Array.isArray(entry.models)) continue;
    upstreams.push({
      id: String(entry.id ?? ''),
      label: String(entry.label ?? ''),
      baseUrl: entry.baseUrl,
      authToken,
      models: (entry.models as unknown[]).map(String).filter(Boolean),
    });
  }
  return upstreams;
}

function serializeSubagentUpstream(entry: SubagentUpstream) {
  return {
    id: entry.id,
    label: entry.label,
    baseUrl: entry.baseUrl,
    hasAuthToken: true,
    authTokenPreview: maskSecret(entry.authToken),
    models: entry.models,
  };
}

// Z.AI runs through the Claude Code transport, but is a separate WebUI
// provider. Its endpoint/token are never injected into Anthropic subscription
// sessions.
router.get('/subagent-upstreams', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const upstreams = await getSubagentUpstreamsForUser(userId);
  res.json({ success: true, data: upstreams.map(serializeSubagentUpstream) });
});

router.put('/subagent-upstreams', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = subagentUpstreamsSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid subagent upstream configuration', 400, 'VALIDATION_ERROR');
  }

  const existing = await getSubagentUpstreamsForUser(userId);
  const existingById = new Map(existing.map((entry) => [entry.id, entry]));

  const stored = parsed.data.map((entry) => {
    // A client never holds the token after saving, so an update without one
    // means "keep what is stored" — same contract as the Z.AI settings.
    const token = entry.authToken || (entry.id ? existingById.get(entry.id)?.authToken : undefined);
    if (!token) {
      throw new AppError(
        `Upstream "${entry.label}" is missing an API token`,
        400,
        'MISSING_API_TOKEN'
      );
    }
    return {
      id: entry.id || nanoid(),
      label: entry.label,
      baseUrl: entry.baseUrl.replace(/\/$/, ''),
      authToken: safeEncrypt(token),
      models: [...new Set(entry.models.map((model) => model.trim()).filter(Boolean))],
    };
  });

  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;
  const settings = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  settings.subagentUpstreams = stored;
  await ensureSettingsRow(userId);
  await pgRun(
    'UPDATE user_settings SET settings_json = ? WHERE user_id = ?',
    JSON.stringify(settings),
    userId
  );

  res.json({
    success: true,
    data: (await getSubagentUpstreamsForUser(userId)).map(serializeSubagentUpstream),
  });
});

/**
 * The model groups the agent editors offer. One place, so the WebUI select and
 * anything else rendering a picker cannot drift from what the router actually
 * routes: the built-in Z.AI group appears only when Z.AI is configured, and
 * each custom upstream contributes its exact (non-wildcard) model ids.
 */
router.get('/subagent-models', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const groups: Array<{ group: string; models: string[] }> = [];

  const zaiConfig = await getZaiApiConfigForUser(userId);
  if (zaiConfig) {
    // The same GLM ids the Z.AI harness actually runs: the user's configured
    // opus/sonnet/haiku mappings. Only unmapped setups get a generic fallback.
    const mapped = getClaudeApiModelLabels(zaiConfig);
    const models = [
      ...new Set(
        (['opus', 'sonnet', 'haiku'] as const)
          .map((alias) => mapped?.[alias])
          .filter((model): model is string => Boolean(model))
      ),
    ];
    groups.push({
      group: 'Z.AI (GLM subscription)',
      models: models.length > 0 ? models : ['glm-5.3', 'glm-5.1', 'glm-4.7'],
    });
  }
  // The shared Kimi Code login doubles as an Anthropic-compatible upstream
  // (api.kimi.com/coding), so an existing `kimi login` is all it takes.
  if (await hasKimiCodingCredentials()) {
    groups.push({ group: 'Kimi (Coding subscription)', models: [...KIMI_CODING_MODELS] });
  }
  for (const upstream of await getSubagentUpstreamsForUser(userId)) {
    const models = upstream.models.filter((model) => !model.endsWith('*'));
    if (models.length) groups.push({ group: upstream.label, models });
  }

  res.json({ success: true, data: groups });
});

/**
 * CLI subagents: which provider CLIs the `subagents` MCP bridge may spawn as
 * one-shot workers from inside any harness. This is the second half of the
 * subagent layer — the model router above swaps the API endpoint under a
 * Claude-transport agent, while these entries let ANY harness (Claude Code,
 * Codex, OpenCode, Pi) delegate a task to a whole other CLI: Codex can spawn
 * `opencode run -m z-ai/glm-5.3`, Claude can spawn `codex exec`, and so on.
 *
 * The spawned CLIs use their own shared logins under ~/.codex, ~/.claude,
 * ~/.opencode. The one exception is `zai`: it runs the *Claude* CLI against
 * the user's Z.AI endpoint — the same second Claude transport a Z.AI session
 * uses — so its endpoint and token are injected as env below.
 */
export type CliSubagentProvider = 'codex' | 'claude' | 'opencode' | 'pi' | 'zai';

const CLI_SUBAGENT_PROVIDERS = new Set<CliSubagentProvider>([
  'codex',
  'claude',
  'opencode',
  'pi',
  'zai',
]);

export interface CliSubagentEntry {
  id: string;
  label: string;
  provider: CliSubagentProvider;
  /**
   * Optional model override. OpenCode expects `provider/model` ids; `zai`
   * takes a bare GLM id and falls back to the configured opus/sonnet mapping.
   */
  model: string;
  enabled: boolean;
}

const DEFAULT_CLI_SUBAGENTS: CliSubagentEntry[] = [
  { id: 'codex', label: 'Codex', provider: 'codex', model: '', enabled: true },
  { id: 'claude', label: 'Claude', provider: 'claude', model: '', enabled: true },
  { id: 'opencode', label: 'OpenCode', provider: 'opencode', model: '', enabled: true },
  { id: 'pi', label: 'Pi', provider: 'pi', model: '', enabled: true },
  // Dropped again by the internal route when the user has no Z.AI endpoint,
  // so an unconfigured account never gets a GLM-labelled Anthropic worker.
  { id: 'zai', label: 'Z.AI', provider: 'zai', model: '', enabled: true },
];

const cliSubagentSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  label: z.string().trim().min(1).max(40),
  provider: z.enum(['codex', 'claude', 'opencode', 'pi', 'zai']),
  model: z.string().trim().max(120).optional().default(''),
  enabled: z.boolean().optional().default(true),
});

const cliSubagentsSchema = z.array(cliSubagentSchema).max(20);

export async function getCliSubagentsForUser(userId: string): Promise<CliSubagentEntry[]> {
  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;
  const settings = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const raw = settings.cliSubagents;
  // Unset means "never configured" and gets working defaults; an empty array
  // is an explicit "no CLI subagents".
  if (!Array.isArray(raw)) return DEFAULT_CLI_SUBAGENTS;

  const entries: CliSubagentEntry[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    if (typeof entry.provider !== 'string') continue;
    if (!CLI_SUBAGENT_PROVIDERS.has(entry.provider as CliSubagentProvider)) continue;
    const provider = entry.provider as CliSubagentProvider;
    entries.push({
      id: String(entry.id ?? ''),
      label: String(entry.label ?? provider),
      provider,
      model: typeof entry.model === 'string' ? entry.model : '',
      enabled: entry.enabled !== false,
    });
  }
  return entries;
}

router.get('/cli-subagents', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  res.json({ success: true, data: await getCliSubagentsForUser(userId) });
});

router.put('/cli-subagents', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = cliSubagentsSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid CLI subagent configuration', 400, 'VALIDATION_ERROR');
  }

  const stored: CliSubagentEntry[] = parsed.data.map((entry) => ({
    id: entry.id || nanoid(),
    label: entry.label,
    provider: entry.provider,
    model: entry.model,
    enabled: entry.enabled,
  }));

  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;
  const settings = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  settings.cliSubagents = stored;
  await ensureSettingsRow(userId);
  await pgRun(
    'UPDATE user_settings SET settings_json = ? WHERE user_id = ?',
    JSON.stringify(settings),
    userId
  );

  res.json({ success: true, data: stored });
});

async function resolveInternalSessionUser(req: Parameters<typeof requireHookSecret>[0]) {
  const sessionId = req.header('x-webui-session-id') || '';
  if (!sessionId) return null;
  const row = (await pgGet('SELECT user_id FROM sessions WHERE id = ?', sessionId)) as unknown as
    | { user_id: string }
    | undefined;
  return row?.user_id ? { sessionId, userId: row.user_id } : null;
}

// The subagents MCP bridge (a child of a spawned CLI) fetches the calling
// user's entries with the hook secret; the session id supplies attribution.
router.get('/internal/cli-subagents', requireHookSecret, async (req, res) => {
  const resolved = await resolveInternalSessionUser(req);
  if (!resolved) {
    res.status(403).json({
      success: false,
      error: { code: 'INVALID_SESSION', message: 'Unknown WebUI session identity' },
    });
    return;
  }
  let entries = (await getCliSubagentsForUser(resolved.userId)).filter((e) => e.enabled);

  // OpenCode auth is per WebUI user: providers like z-ai only exist through
  // the generated tenant opencode.json, and API keys are injected as env —
  // the same provisioning `opencode serve` and the provider test use. Without
  // it a spawned `opencode run` has no logins and no z-ai models at all.
  // This stays inside the container; the bridge holds the hook secret.
  const env: Record<string, Record<string, string>> = {};
  if (entries.some((entry) => entry.provider === 'opencode' || entry.provider === 'pi')) {
    try {
      const tenant = resolveOpenCodeTenantPaths(resolved.userId);
      ensureOpenCodeTenantDirectories(tenant);
      await syncProviderLinks({
        quiet: true,
        userId: resolved.userId,
        opencodeConfigPath: `${tenant.configDir}/opencode.json`,
        opencodeAgentsDir: `${tenant.configDir}/agents`,
      });
      const credentialEnv = await buildOpenCodeProviderCredentialEnv(resolved.userId);
      env.opencode = {
        ...(credentialEnv as Record<string, string>),
        OPENCODE_CONFIG_DIR: tenant.configDir,
        OPENCODE_DATA_DIR: tenant.dataDir,
      };
    } catch (error) {
      // A failed opencode provisioning must not take codex/claude down with it.
      console.warn('[cli-subagents] opencode tenant provisioning failed:', String(error));
    }
  }
  // Z.AI runs the Claude CLI against the user's Z.AI endpoint instead of the
  // Anthropic subscription — the same transport a `zai` WebUI session uses, so
  // GLM subagents keep the Claude harness (skills, agents, MCP, tool loop)
  // rather than being handed to OpenCode. Without a configured endpoint the
  // entry is dropped: a `zai` worker that silently fell back to Anthropic would
  // bill the wrong subscription under a GLM label.
  if (entries.some((entry) => entry.provider === 'zai')) {
    const zaiConfig = await getZaiApiConfigForUser(resolved.userId);
    if (zaiConfig) {
      env.zai = buildClaudeApiEnv(zaiConfig);
    } else {
      entries = entries.filter((entry) => entry.provider !== 'zai');
    }
  }

  if (entries.some((entry) => entry.provider === 'pi')) {
    try {
      // Same provisioning a Pi session gets: per-user agent dir with providers
      // (models.json), MCP config and extensions. PI_CODING_AGENT_DIR is how
      // the pi CLI finds it; without it a spawned `pi -p` has no logins.
      const piSync = await syncPiConfig(resolved.userId);
      env.pi = {
        ...((await buildOpenCodeProviderCredentialEnv(resolved.userId)) as Record<string, string>),
        PI_CODING_AGENT_DIR: piSync.agentDir,
        PI_TELEMETRY: '0',
        PI_SKIP_VERSION_CHECK: '1',
      };
    } catch (error) {
      console.warn('[cli-subagents] pi provisioning failed:', String(error));
    }
  }

  res.json({ success: true, data: { entries, env } });
});

const cliSubagentUsageSchema = z.object({
  provider: z.enum(['codex', 'claude', 'opencode', 'pi', 'zai']),
  model: z.string().trim().min(1).max(120),
  // Identifies the subagent run, not the request. `insertUsageHistoryTurn`
  // deduplicates on `(session_id, provider, turn_id)`, so the sender has to
  // repeat the same value if it retries — a fresh id per attempt would book the
  // same tokens twice. Optional so an older MCP script keeps working.
  runId: z.string().trim().min(1).max(120).optional(),
  inputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  cacheReadTokens: z.number().int().min(0).default(0),
  cacheCreationTokens: z.number().int().min(0).default(0),
});

// One usage row per completed CLI-subagent run, attributed to the calling
// session's owner. The spawned CLI is not a WebUI session, so this is the only
// place its tokens can enter the analytics.
router.post('/internal/cli-subagents/usage', requireHookSecret, async (req, res) => {
  const resolved = await resolveInternalSessionUser(req);
  if (!resolved) {
    res.status(403).json({
      success: false,
      error: { code: 'INVALID_SESSION', message: 'Unknown WebUI session identity' },
    });
    return;
  }
  const parsed = cliSubagentUsageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
    });
    return;
  }
  const usage = parsed.data;
  const totalTokens =
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  if (totalTokens > 0) {
    await insertUsageHistoryTurn({
      userId: resolved.userId,
      sessionId: resolved.sessionId,
      provider: usage.provider,
      // A random id per request defeats the ON CONFLICT clause that makes this
      // insert exactly-once: every retry would look like a new turn and charge
      // the tokens again. Fall back to one only when the caller sent no run id.
      turnId: usage.runId ? `cli-subagent-${usage.runId}` : `cli-subagent-${nanoid()}`,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      totalTokens,
      costUsd: estimateModelCost(usage.model, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
      }).cost,
      model: usage.model,
    });
  }
  res.json({ success: true });
});

router.get('/zai-api', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  res.json({ success: true, data: serializeZaiApiStatus(await getZaiApiConfigForUser(userId)) });
});

router.put('/zai-api', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = claudeApiSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid Z.AI configuration', 400, 'VALIDATION_ERROR');
  }

  const existingConfig = await getZaiApiConfigForUser(userId);
  const authToken = parsed.data.authToken || existingConfig?.authToken;
  if (!authToken) {
    throw new AppError('API token is required', 400, 'MISSING_API_TOKEN');
  }

  await mergeUserSettings(userId, {
    zaiApi: {
      baseUrl: parsed.data.baseUrl,
      authToken: safeEncrypt(authToken),
      opusModel: compactOptionalString(parsed.data.opusModel),
      sonnetModel: compactOptionalString(parsed.data.sonnetModel),
      haikuModel: compactOptionalString(parsed.data.haikuModel),
      apiTimeoutMs: CLAUDE_API_TIMEOUT_MS,
    },
  });
  // The pre-rename key. Dropped separately so the merge above stays a pure
  // addition and cannot resurrect it.
  await removeUserSettings(userId, ['claudeApi']);

  res.json({
    success: true,
    data: {
      configured: true,
      baseUrl: parsed.data.baseUrl,
      hasAuthToken: true,
      authTokenPreview: maskSecret(authToken),
      opusModel: compactOptionalString(parsed.data.opusModel) ?? '',
      sonnetModel: compactOptionalString(parsed.data.sonnetModel) ?? '',
      haikuModel: compactOptionalString(parsed.data.haikuModel) ?? '',
    },
  });
});

router.delete('/zai-api', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  await removeUserSettings(userId, ['zaiApi', 'claudeApi']);

  res.json({ success: true });
});

export async function getZaiApiConfigForUser(userId: string): Promise<ZaiApiConfig | null> {
  const settings = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;
  const parsed = safeJsonParse<Record<string, unknown>>(settings?.settings_json, {});
  const stored =
    parsed.zaiApi && typeof parsed.zaiApi === 'object'
      ? parsed.zaiApi
      : parsed.claudeApi && typeof parsed.claudeApi === 'object'
        ? parsed.claudeApi
        : null;
  if (!stored) return null;

  const raw = stored as Record<string, unknown>;
  const baseUrl = compactOptionalString(raw.baseUrl);
  const authToken = typeof raw.authToken === 'string' ? safeDecrypt(raw.authToken) : null;
  if (!baseUrl || !authToken) return null;

  return {
    baseUrl,
    authToken,
    opusModel: compactOptionalString(raw.opusModel),
    sonnetModel: compactOptionalString(raw.sonnetModel),
    haikuModel: compactOptionalString(raw.haikuModel),
    apiTimeoutMs:
      typeof raw.apiTimeoutMs === 'number' && Number.isFinite(raw.apiTimeoutMs)
        ? raw.apiTimeoutMs
        : CLAUDE_API_TIMEOUT_MS,
  };
}

// ComfyUI / LoRA Tester integration URLs (admin-wide, stored in app_config)
const integrationsSchema = z.object({
  comfyuiUrl: z.string().trim().url().or(z.literal('')).nullable().optional(),
  loraTesterUrl: z.string().trim().url().or(z.literal('')).nullable().optional(),
});

router.get('/integrations', requireAuth, (_req, res) => {
  res.json({
    success: true,
    data: {
      comfyuiUrl: getAppConfig('comfyui_url') ?? '',
      loraTesterUrl: getAppConfig('lora_tester_url') ?? '',
    },
  });
});

router.put('/integrations', requireAuth, requireAdmin, (req, res) => {
  const parsed = integrationsSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { comfyuiUrl, loraTesterUrl } = parsed.data;

  if (comfyuiUrl !== undefined) {
    setAppConfig('comfyui_url', (comfyuiUrl ?? '').trim());
  }
  if (loraTesterUrl !== undefined) {
    setAppConfig('lora_tester_url', (loraTesterUrl ?? '').trim());
  }

  res.json({
    success: true,
    data: {
      comfyuiUrl: getAppConfig('comfyui_url') ?? '',
      loraTesterUrl: getAppConfig('lora_tester_url') ?? '',
    },
  });
});

export default router;
