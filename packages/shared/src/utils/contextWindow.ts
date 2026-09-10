import type { UsageSnapshot } from '../types/session.js';

export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** `provider/model` → `model`. Pi and OpenCode ids carry the provider prefix. */
function stripProviderPrefix(model: string): string {
  const slash = model.lastIndexOf('/');
  return slash >= 0 ? model.slice(slash + 1) : model;
}

/**
 * Known context window for a model id, or `null` when the family is unknown.
 *
 * Callers that write the value into a provider config (Pi's `models.json`)
 * must not guess: Pi compacts at `contextWindow - reserveTokens`, so a wrong
 * number either compacts far too early or lets the request overflow. Display
 * code can fall back to {@link DEFAULT_CONTEXT_WINDOW} via
 * {@link resolveContextWindow}.
 */
export function lookupContextWindow(model: string | null | undefined): number | null {
  if (!model) return null;
  const id = stripProviderPrefix(model.trim().toLowerCase());
  if (!id) return null;

  // Anthropic's current Fable, Opus, and Sonnet families use the 1M-token
  // window. Haiku 4.5 remains at 200k.
  if (id === 'fable' || id === 'opus' || id === 'sonnet') return 1_000_000;
  if (/(fable|opus|sonnet)-?(4|5)/.test(id)) return 1_000_000;
  if (id === 'haiku' || /haiku-?4[.-]?5/.test(id)) return 200_000;

  // Codex / GPT windows observed in live session logs; GPT-6 Astra from the
  // launch rate card (1.1M).
  if (id.startsWith('gpt-6')) return 1_100_000;
  if (id.startsWith('gpt-5.6')) return 1_050_000;
  if (id.startsWith('gpt-5.4-mini')) return 128_000;
  if (id.startsWith('gpt-5.4')) return 196_000;
  if (id.startsWith('gpt-5.3-codex')) return 400_000;
  if (id.startsWith('gpt-5.5')) return 256_000;
  if (id.startsWith('gpt-5')) return 256_000;
  if (id.startsWith('gpt-oss')) return 128_000;

  // Zhipu GLM: the 5.x line and 4.6/4.7 ship a 200k window, 4.5 stays at
  // 128k, and the 4.5 vision model at 64k.
  if (/^glm-4\.5v/.test(id)) return 64_000;
  if (/^glm-4\.5/.test(id)) return 128_000;
  if (/^glm-(?:5|4\.[67])/.test(id)) return 200_000;

  // Moonshot Kimi K2 family (also behind the Kimi-for-coding endpoint).
  if (/^(?:kimi-)?k2/.test(id) || id.startsWith('kimi')) return 256_000;
  // DeepSeek V3.x / R1
  if (id.startsWith('deepseek')) return 128_000;
  // Google Gemini 2.5 and later
  if (/^gemini-(?:2\.5|3)/.test(id)) return 1_000_000;
  // MiniMax M2 line
  if (/^minimax-m2/.test(id)) return 200_000;
  // Qwen3 coder models
  if (/^qwen3(?:\.\d+)?-coder/.test(id)) return 256_000;

  return null;
}

export function resolveContextWindow(model: string | null | undefined): number {
  return lookupContextWindow(model) ?? DEFAULT_CONTEXT_WINDOW;
}

export function normalizeUsageSnapshot(
  usage: UsageSnapshot | null | undefined
): UsageSnapshot | undefined {
  if (!usage) return undefined;

  const resolvedWindow = resolveContextWindow(usage.model);
  const contextWindow =
    resolvedWindow !== DEFAULT_CONTEXT_WINDOW && resolvedWindow !== usage.contextWindow
      ? resolvedWindow
      : usage.contextWindow;
  const totalTokens =
    contextWindow > 0 ? Math.min(usage.totalTokens, contextWindow) : usage.totalTokens;
  const rawPercent =
    contextWindow > 0 && totalTokens > 0 ? Math.round((totalTokens * 100.0) / contextWindow) : 0;
  const normalized = {
    ...usage,
    totalTokens,
    contextWindow,
    contextUsedPercent: Math.max(0, Math.min(100, rawPercent)),
    contextUsedPercentRaw: Math.max(0, Math.min(100, rawPercent)),
    contextExceeded: false,
  };

  // Keep caller-provided windows for unknown models, but always preserve the
  // active-context invariant: display values cannot exceed their own window.
  if (resolvedWindow === DEFAULT_CONTEXT_WINDOW || resolvedWindow === usage.contextWindow) {
    return normalized;
  }

  return normalized;
}
