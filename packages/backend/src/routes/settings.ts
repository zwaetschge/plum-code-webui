import { get as pgGet, run as pgRun } from '../db/pg.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/auth.js';
import { getAppConfig, setAppConfig } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
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
import { DEFAULT_ANALYTICS_HIDDEN_LIMIT_METRICS } from '@plum-code-webui/shared';
import { parseOracleBrowserSettings } from '../utils/oracleSettings.js';

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
    `INSERT OR IGNORE INTO user_settings (user_id, theme, allowed_tools)
     VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`,
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
            tokenPreview: `${parsed.githubToken.substring(0, 8)}...${parsed.githubToken.slice(-4)}`,
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

  // Get existing settings_json
  const existing = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;

  let settingsObj: Record<string, unknown> = {};
  if (existing?.settings_json) {
    try {
      settingsObj = JSON.parse(existing.settings_json);
    } catch {
      // Invalid JSON, start fresh
    }
  }

  // Encrypt the token before storing
  settingsObj.githubToken = safeEncrypt(token);

  await pgRun(
    'UPDATE user_settings SET settings_json = ? WHERE user_id = ?',
    JSON.stringify(settingsObj),
    userId
  );

  res.json({
    success: true,
    data: {
      hasToken: true,
      tokenPreview: `${token.substring(0, 8)}...${token.slice(-4)}`,
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
    authTokenPreview: config?.authToken
      ? `${config.authToken.substring(0, 8)}...${config.authToken.slice(-4)}`
      : null,
    opusModel: config?.opusModel ?? '',
    sonnetModel: config?.sonnetModel ?? '',
    haikuModel: config?.haikuModel ?? '',
  };
}

// Z.AI runs through the Claude Code transport, but is a separate WebUI
// provider. Its endpoint/token are never injected into Anthropic subscription
// sessions.
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

  const existing = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;
  const settingsObj = safeJsonParse<Record<string, unknown>>(existing?.settings_json, {});
  const existingConfig = await getZaiApiConfigForUser(userId);
  const authToken = parsed.data.authToken || existingConfig?.authToken;
  if (!authToken) {
    throw new AppError('API token is required', 400, 'MISSING_API_TOKEN');
  }

  settingsObj.zaiApi = {
    baseUrl: parsed.data.baseUrl,
    authToken: safeEncrypt(authToken),
    opusModel: compactOptionalString(parsed.data.opusModel),
    sonnetModel: compactOptionalString(parsed.data.sonnetModel),
    haikuModel: compactOptionalString(parsed.data.haikuModel),
    apiTimeoutMs: CLAUDE_API_TIMEOUT_MS,
  };
  delete settingsObj.claudeApi;

  await pgRun(
    'UPDATE user_settings SET settings_json = ? WHERE user_id = ?',
    JSON.stringify(settingsObj),
    userId
  );

  res.json({
    success: true,
    data: {
      configured: true,
      baseUrl: parsed.data.baseUrl,
      hasAuthToken: true,
      authTokenPreview: `${authToken.substring(0, 8)}...${authToken.slice(-4)}`,
      opusModel: compactOptionalString(parsed.data.opusModel) ?? '',
      sonnetModel: compactOptionalString(parsed.data.sonnetModel) ?? '',
      haikuModel: compactOptionalString(parsed.data.haikuModel) ?? '',
    },
  });
});

router.delete('/zai-api', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  const existing = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;

  if (existing?.settings_json) {
    const settingsObj = safeJsonParse<Record<string, unknown>>(existing.settings_json, {});
    delete settingsObj.zaiApi;
    delete settingsObj.claudeApi;
    await pgRun(
      'UPDATE user_settings SET settings_json = ? WHERE user_id = ?',
      JSON.stringify(settingsObj),
      userId
    );
  }

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
