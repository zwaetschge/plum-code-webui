import type { CLIProvider, CodexServiceTier } from './session.js';

export type Theme = 'dark' | 'light' | 'system' | 'eink';
export type UiProvider = 'plum' | 'claude' | 'zai' | 'codex' | 'opencode' | 'pi' | 'kimi' | 'vibe';
export type BackgroundAnimation = 'glass' | 'aurora' | 'ribbons' | 'still';
export type CodexWebSearchMode = 'auto' | 'cached' | 'live' | 'disabled';
export type OracleBrowserMode = 'profile' | 'manual' | 'remote';

export interface LocalUsageBudget {
  dailyUsd?: number;
  weeklyUsd?: number;
}

export type AnalyticsLimitProvider = 'codex' | 'kimi' | 'claude' | 'zai';

export const DEFAULT_ANALYTICS_HIDDEN_LIMIT_METRICS: Partial<
  Record<AnalyticsLimitProvider, string[]>
> = {
  codex: ['additional_gpt_5_3_codex_spark'],
  kimi: ['additional_parallel_sessions'],
  zai: ['additional_web_search'],
};

export interface AnalyticsSettings {
  hiddenLimitMetrics?: Partial<Record<AnalyticsLimitProvider, string[]>>;
}

export interface OracleBrowserSettings {
  mode?: OracleBrowserMode;
  chatgptUrl?: string;
  remoteChrome?: string;
  chromeProfile?: string;
  chromeCookiePath?: string;
  manualLoginProfileDir?: string;
}

export interface UserSettings {
  userId: string;
  theme: Theme;
  defaultWorkingDir: string | null;
  allowedTools: string[];
  customSystemPrompt: string | null;
  uiProvider?: UiProvider;
  backgroundAnimation?: BackgroundAnimation;
  defaultCliProvider?: CLIProvider;
  enabledCliProviders?: CLIProvider[];
  cliProviderModels?: Partial<Record<CLIProvider, string>>;
  cliProviderModelLists?: Partial<Record<CLIProvider, string[]>>;
  cliProviderReasoning?: Partial<Record<CLIProvider, string>>;
  cliProviderServiceTiers?: Partial<Record<CLIProvider, CodexServiceTier>>;
  codexWebSearch?: CodexWebSearchMode;
  localUsageBudgets?: Partial<Record<CLIProvider, LocalUsageBudget>>;
  oracleBrowser?: OracleBrowserSettings;
  analytics?: AnalyticsSettings;
  /** When true, theme and background follow the account onto every client. */
  appearanceSync?: boolean;
  usageAlerts?: UsageAlertSettings;
}

/** Account-wide spend/quota alarm thresholds, shared by WebUI and app. */
export interface UsageAlertSettings {
  enabled?: boolean;
  quotaPercent?: number;
  dailyCostUsd?: number;
}

export interface UpdateSettingsInput {
  appearanceSync?: boolean;
  usageAlerts?: UsageAlertSettings;
  theme?: Theme;
  defaultWorkingDir?: string | null;
  allowedTools?: string[];
  customSystemPrompt?: string | null;
  uiProvider?: UiProvider;
  backgroundAnimation?: BackgroundAnimation;
  defaultCliProvider?: CLIProvider;
  enabledCliProviders?: CLIProvider[];
  cliProviderModels?: Partial<Record<CLIProvider, string>>;
  cliProviderModelLists?: Partial<Record<CLIProvider, string[]>>;
  cliProviderReasoning?: Partial<Record<CLIProvider, string>>;
  cliProviderServiceTiers?: Partial<Record<CLIProvider, CodexServiceTier>>;
  codexWebSearch?: CodexWebSearchMode;
  localUsageBudgets?: Partial<Record<CLIProvider, LocalUsageBudget>>;
  oracleBrowser?: OracleBrowserSettings;
  analytics?: AnalyticsSettings;
}

export interface ClaudeSettings {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}
