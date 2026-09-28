import {
  ACCOUNT_USAGE_LIMIT_PROVIDERS,
  CLI_PROVIDER_LABEL,
  CLI_PROVIDER_LIMIT_LABELS,
  type AccountUsageLimitProvider,
  type UiProvider,
} from '@/lib/providers';
import type { LimitWindowData } from './analyticsModel';

export interface UsageLimitData {
  subscriptionType?: string;
  rateLimitTier?: string;
  fiveHour: LimitWindowData | null;
  sevenDay: LimitWindowData | null;
  sevenDaySonnet: LimitWindowData | null;
  additional?: Array<{ name: string } & LimitWindowData>;
  source?: 'upstream' | 'local-budget' | 'local-estimate';
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
  /** Mistral: our own ledger for the month (no upstream quota API). */
  planUsage?: {
    periodStart: string;
    periodEnd: string;
    /** In `currency`, list prices taken 1:1. */
    spend: number;
    tokens: number;
    requests: number;
    budget: number | null;
    currency: 'EUR' | 'USD';
    /** Which of the plan's allowances the key draws on. */
    allowance: 'api' | 'vibe';
    billingDay: number;
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
}

export interface UsageLimitsResponse {
  success: boolean;
  supported: boolean;
  provider: AccountUsageLimitProvider;
  data: UsageLimitData | null;
  error?: { code: string; message: string };
}

export type UsageLimitTracker = AccountUsageLimitProvider;

export interface ProviderLimitEntry {
  tracker: UsageLimitTracker;
  provider: AccountUsageLimitProvider;
  data: UsageLimitData;
  error?: { code: string; message: string };
}

/** Every provider with a limits card, upstream quota or local estimate. */
export const USAGE_PROVIDERS: UsageLimitTracker[] = [...ACCOUNT_USAGE_LIMIT_PROVIDERS];

// The quota-history overlay plots persisted upstream snapshots. The Alibaba
// Token Plan and both Mistral allowances have no upstream quota API — their
// numbers are derived from our own usage_history on request — so they have no
// history.
export const HISTORY_PROVIDERS: UsageLimitTracker[] = USAGE_PROVIDERS.filter(
  (provider) => provider !== 'alibaba' && provider !== 'mistral' && provider !== 'vibe'
);

export const USAGE_PROVIDER_COLORS: Record<AccountUsageLimitProvider, string> = {
  claude: '#f97316',
  zai: '#14b8a6',
  codex: '#22c55e',
  kimi: '#2582ed',
  alibaba: '#f59e0b',
  mistral: '#fa520f',
  vibe: '#ff7000',
};

export const USAGE_PROVIDER_LIMIT_COLORS: Record<AccountUsageLimitProvider, readonly string[]> = {
  codex: ['#22c55e', '#86efac', '#15803d', '#4ade80'],
  kimi: ['#2582ed', '#7db5ff', '#1d4ed8', '#60a5fa'],
  claude: ['#f97316', '#fdba74', '#c2410c', '#fb923c'],
  zai: ['#14b8a6', '#5eead4', '#0f766e', '#2dd4bf'],
  alibaba: ['#f59e0b', '#fcd34d', '#b45309', '#fbbf24'],
  mistral: ['#fa520f', '#fdba74', '#c2410c', '#fb923c'],
  vibe: ['#ff7000', '#ffa94d', '#c2410c', '#fb923c'],
};

export const USAGE_PROVIDER_LABELS: Record<AccountUsageLimitProvider, string> = {
  codex: CLI_PROVIDER_LABEL.codex,
  kimi: CLI_PROVIDER_LABEL.kimi,
  claude: CLI_PROVIDER_LABEL.claude,
  zai: CLI_PROVIDER_LABEL.zai,
  alibaba: 'Alibaba Token Plan',
  mistral: 'Mistral',
  vibe: CLI_PROVIDER_LABEL.vibe,
};

export const USAGE_TRACKER_LABELS: Record<UsageLimitTracker, string> = {
  codex: 'Codex',
  kimi: 'Kimi',
  claude: 'Claude',
  zai: 'Z.AI',
  alibaba: 'Token Plan',
  mistral: 'Mistral',
  vibe: 'Vibe',
};

/** The analytics provider label each quota belongs to (for the provider filter). */
export const USAGE_TRACKER_ANALYTICS_LABEL: Record<UsageLimitTracker, string> = {
  codex: 'Codex',
  kimi: 'Kimi',
  claude: 'Claude',
  zai: 'Z.AI',
  alibaba: 'Other',
  mistral: 'Other',
  // Vibe harness turns are booked with provider 'vibe', which the shared
  // analytics mapping already resolves to the Vibe family.
  vibe: 'Vibe',
};

export const USAGE_PROVIDER_LOGO: Record<AccountUsageLimitProvider, UiProvider> = {
  claude: 'claude',
  zai: 'zai',
  codex: 'codex',
  kimi: 'kimi',
  // No dedicated brand mark yet; the neutral Plum badge keeps the row readable.
  alibaba: 'plum',
  mistral: 'plum',
  vibe: 'vibe',
};

export const USAGE_LIMIT_LABELS: Record<
  AccountUsageLimitProvider,
  {
    session: { title: string; subtitle?: string };
    weeklyAll?: { title: string; subtitle?: string };
    weeklySonnet?: { title: string; subtitle?: string };
  }
> = {
  ...CLI_PROVIDER_LIMIT_LABELS,
};

const USAGE_TRACKERS_STORAGE_KEY = 'plum:analytics:usage-limit-trackers:v5';
const V4_USAGE_TRACKERS_STORAGE_KEY = 'plum:analytics:usage-limit-trackers:v4';
const V3_USAGE_TRACKERS_STORAGE_KEY = 'plum:analytics:usage-limit-trackers:v3';
const LEGACY_USAGE_TRACKERS_STORAGE_KEY = 'plum:analytics:usage-limit-trackers:v2';
/** Providers that joined after a stored choice was made start out visible once. */
const ADDED_SINCE_V4: UsageLimitTracker[] = ['vibe'];
const ADDED_SINCE_V3: UsageLimitTracker[] = ['alibaba', 'mistral', 'vibe'];

function migrateStoredTrackers(stored: unknown, added: UsageLimitTracker[]): UsageLimitTracker[] {
  const choices = Array.isArray(stored) ? stored : [];
  return USAGE_PROVIDERS.filter(
    (provider) => added.includes(provider) || choices.includes(provider)
  );
}

export function loadUsageLimitTrackers(): UsageLimitTracker[] {
  if (typeof window === 'undefined') return [...USAGE_PROVIDERS];
  try {
    const current = JSON.parse(window.localStorage.getItem(USAGE_TRACKERS_STORAGE_KEY) || 'null');
    if (Array.isArray(current)) {
      return USAGE_PROVIDERS.filter((provider) => current.includes(provider));
    }
    const v4 = JSON.parse(window.localStorage.getItem(V4_USAGE_TRACKERS_STORAGE_KEY) || 'null');
    if (Array.isArray(v4)) {
      const migrated = migrateStoredTrackers(v4, ADDED_SINCE_V4);
      window.localStorage.setItem(USAGE_TRACKERS_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const v3 = JSON.parse(window.localStorage.getItem(V3_USAGE_TRACKERS_STORAGE_KEY) || 'null');
    if (Array.isArray(v3)) {
      const migrated = migrateStoredTrackers(v3, ADDED_SINCE_V3);
      window.localStorage.setItem(USAGE_TRACKERS_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const legacy = JSON.parse(
      window.localStorage.getItem(LEGACY_USAGE_TRACKERS_STORAGE_KEY) || 'null'
    );
    if (!Array.isArray(legacy)) return [...USAGE_PROVIDERS];
    // Kimi was added after the v2 preference was stored on existing devices, and
    // so were the plan-budget trackers. Preserve their choices for older
    // providers while making every newer one visible once by default.
    const migrated = migrateStoredTrackers(legacy, ['kimi', ...ADDED_SINCE_V3]);
    window.localStorage.setItem(USAGE_TRACKERS_STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [...USAGE_PROVIDERS];
  }
}

export function saveUsageLimitTrackers(trackers: UsageLimitTracker[]): void {
  window.localStorage.setItem(USAGE_TRACKERS_STORAGE_KEY, JSON.stringify(trackers));
}

export interface LimitWindowView extends LimitWindowData {
  key: string;
  title: string;
  subtitle?: string;
}

/** Every quota window a provider reports, labelled, in display order. */
export function limitWindows(
  provider: AccountUsageLimitProvider,
  data: UsageLimitData
): LimitWindowView[] {
  const labels = USAGE_LIMIT_LABELS[provider];
  const windows: LimitWindowView[] = [];
  if (data.fiveHour) windows.push({ key: 'five_hour', ...labels.session, ...data.fiveHour });
  if (data.sevenDay && labels.weeklyAll) {
    windows.push({ key: 'seven_day', ...labels.weeklyAll, ...data.sevenDay });
  }
  if (data.sevenDaySonnet && labels.weeklySonnet) {
    windows.push({ key: 'seven_day_sonnet', ...labels.weeklySonnet, ...data.sevenDaySonnet });
  }
  for (const limit of data.additional ?? []) {
    windows.push({ key: limit.name, title: limit.name.replace(/_/g, ' '), ...limit });
  }
  return windows;
}
