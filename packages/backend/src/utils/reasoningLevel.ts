import { CLAUDE_CODE_EFFORT_OPTIONS, type CLIProvider } from '@plum-code-webui/shared';

const REASONING_LEVELS_BY_PROVIDER: Record<CLIProvider, Set<string>> = {
  claude: new Set(CLAUDE_CODE_EFFORT_OPTIONS.map(({ value }) => value)),
  zai: new Set(CLAUDE_CODE_EFFORT_OPTIONS.map(({ value }) => value)),
  codex: new Set([
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'extra_high',
    'max',
    'ultra',
  ]),
  opencode: new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'extra_high', 'max']),
  pi: new Set([
    'off',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'extra_high',
    'max',
    'ultracode',
  ]),
  kimi: new Set(['minimal', 'low', 'medium', 'high']),
  // Vibe's ultracode runs workflows at `high` thinking (scripts/mcp-servers/vibe-ultracode.mjs).
  vibe: new Set(['off', 'low', 'medium', 'high', 'max', 'ultracode']),
};

export function normalizeReasoningLevel(provider: CLIProvider, value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) {
    return null;
  }
  return REASONING_LEVELS_BY_PROVIDER[provider].has(normalized) ? normalized : null;
}
