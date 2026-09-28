import type { CLIProvider as CLIProviderType } from '@plum-code-webui/shared';
export type { CLIProvider } from '@plum-code-webui/shared';
type CLIProvider = CLIProviderType;

export type UiProvider = 'plum' | 'claude' | 'zai' | 'codex' | 'opencode' | 'pi' | 'kimi' | 'vibe';
export const ACCOUNT_USAGE_LIMIT_PROVIDERS = [
  'codex',
  'claude',
  'zai',
  'kimi',
  'alibaba',
  'mistral',
  // Vibe is the second allowance of the same Mistral plan, tracked on its own
  // so harness turns and routed API traffic never share one budget.
  'vibe',
] as const;
export type AccountUsageLimitProvider = (typeof ACCOUNT_USAGE_LIMIT_PROVIDERS)[number];
export type UsageLimitProvider = AccountUsageLimitProvider | 'z-ai' | 'opencode-go';

export const DEFAULT_UI_PROVIDER: UiProvider = 'plum';
export const UI_PROVIDER_STORAGE_KEY = 'ui-provider';

export const UI_PROVIDER_META: Record<
  UiProvider,
  {
    id: UiProvider;
    label: string;
    productName: string;
    tagline: string;
    loginCta: string;
    description: string;
  }
> = {
  plum: {
    id: 'plum',
    label: 'Plum',
    productName: 'Plum Code',
    tagline: 'WebUI',
    loginCta: 'Continue to Plum',
    description: 'A Plum-branded dashboard for multi-provider CLI sessions.',
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    productName: 'Claude Code',
    tagline: 'WebUI',
    loginCta: 'Continue with Claude',
    description: 'Built for Anthropic Claude Code CLI workflows.',
  },
  zai: {
    id: 'zai',
    label: 'Z.AI',
    productName: 'Z.AI Code',
    tagline: 'GLM Coding Plan',
    loginCta: 'Continue with Z.AI',
    description: 'Claude Code transport backed by the Z.AI GLM Coding Plan.',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    productName: 'Codex',
    tagline: 'WebUI',
    loginCta: 'Continue with Codex',
    description: 'OpenAI Codex CLI with fast, focused coding sessions.',
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    productName: 'OpenCode',
    tagline: 'Multi-Provider',
    loginCta: 'Continue with OpenCode',
    description: 'OpenCode CLI with 75+ LLM providers. Default: GLM 5.1.',
  },
  pi: {
    id: 'pi',
    label: 'Pi',
    productName: 'Pi',
    tagline: 'Agent Harness',
    loginCta: 'Continue with Pi',
    description: 'Pi agent harness using the same provider connections as OpenCode.',
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi',
    productName: 'Kimi Code',
    tagline: 'Coding Plan',
    loginCta: 'Continue with Kimi',
    description: 'Kimi Code CLI with native persistent ACP chat sessions.',
  },
  vibe: {
    id: 'vibe',
    label: 'Mistral Vibe',
    productName: 'Mistral Vibe',
    tagline: 'Vibe Code Plan',
    loginCta: 'Continue with Vibe',
    description:
      'Mistral Vibe CLI with native persistent ACP chat sessions. Its turns draw on the separate Vibe-Code-Kontingent (Vibe Code allowance) of the Mistral plan.',
  },
};

export const CLI_PROVIDER_LABEL: Record<CLIProvider, string> = {
  claude: 'Claude Code',
  zai: 'Z.AI Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  pi: 'Pi',
  kimi: 'Kimi Code',
  vibe: 'Mistral Vibe',
};

export const CLI_PROVIDER_ICON: Record<CLIProvider, string> = {
  claude: 'C',
  zai: 'Z',
  codex: 'O',
  opencode: '⚡',
  pi: 'π',
  kimi: '🌙',
  vibe: '🧡',
};

export const CLI_PROVIDER_DEFAULT_MODEL: Record<CLIProvider, string> = {
  claude: 'sonnet',
  zai: 'opus',
  codex: 'gpt-5.5',
  opencode: 'z-ai/glm-5.1',
  pi: 'z-ai/glm-5.1',
  kimi: 'kimi-code/kimi-for-coding',
  // `mistral-medium-3.5` is the alias of mistral-vibe-cli-latest, the model the
  // plan's Vibe Code allowance pays for.
  vibe: 'mistral-medium-3.5',
};

export const UI_PROVIDER_THEME_COLOR: Record<UiProvider, string> = {
  plum: '#020403',
  claude: '#141413',
  zai: '#0f766e',
  codex: '#000000',
  opencode: '#160d2b',
  pi: '#0e1716',
  kimi: '#2582ed',
  vibe: '#ff7000',
};

export const USAGE_PROVIDER_LABEL: Record<UsageLimitProvider, string> = {
  claude: CLI_PROVIDER_LABEL.claude,
  zai: CLI_PROVIDER_LABEL.zai,
  codex: CLI_PROVIDER_LABEL.codex,
  kimi: CLI_PROVIDER_LABEL.kimi,
  alibaba: 'Alibaba Token Plan',
  mistral: 'Mistral',
  vibe: CLI_PROVIDER_LABEL.vibe,
  'z-ai': 'Z.ai Coding Plan',
  'opencode-go': 'OpenCode Go',
};

export const USAGE_PROVIDER_SHORT_LABEL: Record<UsageLimitProvider, string> = {
  claude: 'Claude',
  zai: 'Z.AI',
  codex: 'Codex',
  kimi: 'Kimi',
  alibaba: 'Token Plan',
  mistral: 'Mistral',
  vibe: 'Vibe',
  'z-ai': 'Z.ai',
  'opencode-go': 'OpenCode Go',
};

export const CLI_PROVIDER_LIMIT_LABELS: Record<
  AccountUsageLimitProvider,
  {
    session: { title: string; subtitle?: string };
    weeklyAll?: { title: string; subtitle?: string };
    weeklySonnet?: { title: string; subtitle?: string };
  }
> = {
  claude: {
    session: { title: 'Session' },
    weeklyAll: { title: 'Weekly', subtitle: 'All' },
    weeklySonnet: { title: 'Weekly', subtitle: 'Sonnet' },
  },
  zai: {
    session: { title: '5h', subtitle: 'Tokens' },
    weeklyAll: { title: 'Weekly', subtitle: 'Tokens' },
  },
  codex: {
    // Codex limits come from /backend-api/codex/usage:
    // windows are assigned from limit_window_seconds rather than position,
    // because some plans expose a weekly-only primary_window.
    // Codex has no per-model split (no Sonnet equivalent) — the sevenDaySonnet
    // field is intentionally null and the third bar is hidden.
    session: { title: '5h', subtitle: 'Session' },
    weeklyAll: { title: 'Weekly', subtitle: 'Total' },
  },
  kimi: {
    session: { title: '5h', subtitle: 'Coding Plan' },
    weeklyAll: { title: 'Weekly', subtitle: 'Coding Plan' },
  },
  alibaba: {
    // A prepaid token allotment has no short rolling window — only the plan
    // period, which is reported through the weekly slot.
    session: { title: 'Plan', subtitle: 'Tokens' },
    weeklyAll: { title: 'Plan period', subtitle: 'Tokens' },
  },
  mistral: {
    // Mistral exposes no quota API for Pro plans; the month is measured
    // against a budget the user declares (see /api/usage/plan/mistral).
    session: { title: 'Today' },
    weeklyAll: { title: 'Month', subtitle: 'Budget' },
  },
  vibe: {
    // Same missing quota API, but the Vibe harness spends the plan's separate
    // Vibe Code allowance, declared through /api/usage/plan/vibe.
    session: { title: 'Today' },
    weeklyAll: { title: 'Month', subtitle: 'Vibe Code' },
  },
};

const CLI_TO_UI: Record<CLIProvider, UiProvider> = {
  claude: 'claude',
  zai: 'zai',
  codex: 'codex',
  opencode: 'opencode',
  pi: 'pi',
  kimi: 'kimi',
  vibe: 'vibe',
};

const UI_TO_CLI: Record<UiProvider, CLIProvider> = {
  plum: 'codex',
  claude: 'claude',
  zai: 'zai',
  codex: 'codex',
  opencode: 'opencode',
  pi: 'pi',
  kimi: 'kimi',
  vibe: 'vibe',
};

export function normalizeUiProvider(value?: string | null): UiProvider {
  const key = (value || '').toLowerCase();
  if (key === 'plum') return 'plum';
  if (key === 'codex') return 'codex';
  if (key === 'zai' || key === 'z-ai') return 'zai';
  if (key === 'opencode') return 'opencode';
  if (key === 'pi') return 'pi';
  if (key === 'kimi') return 'kimi';
  if (key === 'vibe') return 'vibe';
  return 'plum';
}

export function toUiProvider(cliProvider?: CLIProvider | null): UiProvider {
  if (!cliProvider) return DEFAULT_UI_PROVIDER;
  return CLI_TO_UI[cliProvider] || DEFAULT_UI_PROVIDER;
}

export function toCliProvider(uiProvider?: UiProvider | null): CLIProvider {
  if (!uiProvider) return UI_TO_CLI[DEFAULT_UI_PROVIDER];
  return UI_TO_CLI[uiProvider] || UI_TO_CLI[DEFAULT_UI_PROVIDER];
}

export function getUsageLimitProviderForModel(
  cliProvider: CLIProvider,
  model?: string | null
): AccountUsageLimitProvider | null {
  const value = (model || '').trim().toLowerCase();
  if (cliProvider === 'kimi') return 'kimi';
  // Vibe turns carry a bare `mistral-*` model id, so attribution must come from
  // the harness: they spend the plan's Vibe allowance, not the API allowance.
  if (cliProvider === 'vibe') return 'vibe';
  if (cliProvider !== 'opencode' && cliProvider !== 'pi') {
    return cliProvider;
  }
  // The Alibaba Token Plan is a prepaid allotment shared by every model routed
  // through it, so the plan — not the model — is the limit that matters.
  if (value.startsWith('alibaba-token-plan/')) {
    return 'alibaba';
  }
  if (value.startsWith('mistral/')) {
    return 'mistral';
  }
  if (value.startsWith('z-ai/') || value.startsWith('zai/') || value.startsWith('glm-')) {
    return 'zai';
  }
  return null;
}

export function getStoredUiProvider(): UiProvider {
  if (typeof window === 'undefined') {
    return DEFAULT_UI_PROVIDER;
  }
  return DEFAULT_UI_PROVIDER;
}

export function setStoredUiProvider(provider: UiProvider): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (provider === DEFAULT_UI_PROVIDER) {
    window.localStorage.setItem(UI_PROVIDER_STORAGE_KEY, provider);
  } else {
    window.localStorage.removeItem(UI_PROVIDER_STORAGE_KEY);
  }
}

export function applyProviderClass(_provider: UiProvider): void {
  if (typeof document === 'undefined') {
    return;
  }
  const visualProvider = DEFAULT_UI_PROVIDER;
  const root = document.documentElement;
  root.classList.remove(
    'provider-plum',
    'provider-claude',
    'provider-zai',
    'provider-codex',
    'provider-opencode',
    'provider-pi',
    'provider-kimi',
    'provider-vibe'
  );
  root.classList.add(`provider-${visualProvider}`);
  root.setAttribute('data-provider', visualProvider);
}
