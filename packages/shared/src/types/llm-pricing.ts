export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  source: string;
  label: string;
}

export interface UsageTokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ModelCostEstimate {
  cost: number;
  pricing: ModelPricing | null;
  known: boolean;
}

export const LLM_PRICING_RATE_CARD_VERSION = '2026-09-06-standard-api-equivalent-v11';

export const DEFAULT_MODEL_PRICING: ModelPricing = {
  input: 5,
  output: 30,
  cacheRead: 0.5,
  cacheWrite: 0,
  source: 'OpenAI API pricing, 2026-06-01',
  label: 'GPT-5.5 fallback',
};

function splitProviderPrefix(model: string): { provider: string | null; id: string } {
  const slash = model.indexOf('/');
  if (slash === -1) return { provider: null, id: model };
  const provider = model.slice(0, slash);
  const id = model.slice(slash + 1);
  return { provider, id };
}

function normalizeProviderModelId(provider: string | null, id: string, raw: string): string {
  if (!provider) return id;
  if (
    provider === 'anthropic' ||
    provider === 'openai' ||
    provider === 'mistral' ||
    provider === 'z-ai' ||
    provider === 'zai' ||
    provider === 'zhipuai' ||
    provider === 'deepseek' ||
    provider === 'opencode' ||
    provider === 'opencode-go' ||
    provider === 'kimi' ||
    provider === 'kimi-code' ||
    provider === 'moonshot' ||
    provider === 'alibaba-token-plan'
  ) {
    return id;
  }
  return raw;
}

function price(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  source: string,
  label: string
): ModelPricing {
  return { input, output, cacheRead, cacheWrite, source, label };
}

function resolveOpenCodeZenPricing(id: string): ModelPricing | null {
  const source = 'OpenCode Go/Zen pricing, 2026-07-06';

  if (id === 'big-pickle' || id === 'deepseek-v4-flash-free') {
    return price(0, 0, 0, 0, source, 'OpenCode Zen free model');
  }
  if (id === 'mimo-v2.5-free' || id === 'nemotron-3-ultra-free') {
    return price(0, 0, 0, 0, source, 'OpenCode Zen free model');
  }
  if (id === 'mimo-v2.5-pro') {
    return price(1.74, 3.48, 0.0145, 0, source, 'OpenCode Go MiMo V2.5 Pro');
  }
  if (id === 'mimo-v2.5') {
    return price(0.14, 0.28, 0.0028, 0, source, 'OpenCode Go MiMo V2.5');
  }
  if (id === 'minimax-m3') {
    return price(0.3, 1.2, 0.06, 0, source, 'OpenCode Go MiniMax M3');
  }
  if (id === 'minimax-m2.7' || id === 'minimax-m2.5') {
    return price(0.3, 1.2, 0.06, 0.375, source, 'OpenCode Zen MiniMax');
  }
  if (id === 'kimi-k2.5') {
    return price(0.6, 3, 0.1, 0, source, 'OpenCode Zen Kimi K2.5');
  }
  if (id === 'kimi-k2.6') {
    return price(0.95, 4, 0.16, 0, source, 'OpenCode Zen Kimi K2.6');
  }
  if (id === 'qwen3.7-max') {
    return price(2.5, 7.5, 0.5, 3.125, source, 'OpenCode Zen Qwen3.7 Max');
  }
  if (id === 'qwen3.7-plus') {
    return price(0.4, 1.6, 0.04, 0.5, source, 'OpenCode Zen Qwen3.7 Plus');
  }
  if (id === 'qwen3.6-plus') {
    return price(0.5, 3, 0.05, 0.625, source, 'OpenCode Zen Qwen3.6 Plus');
  }
  if (id === 'qwen3.5-plus') {
    return price(0.2, 1.2, 0.02, 0.25, source, 'OpenCode Zen Qwen3.5 Plus');
  }
  if (id === 'deepseek-v4-flash') {
    return price(0.14, 0.28, 0.03, 0, source, 'OpenCode Zen DeepSeek V4 Flash');
  }
  if (id === 'grok-build-0.1') {
    return price(1, 2, 0.2, 0, source, 'OpenCode Zen Grok Build');
  }
  if (id === 'gemini-3.5-flash') {
    return price(1.5, 9, 0.15, 0, source, 'OpenCode Zen Gemini 3.5 Flash');
  }
  if (id === 'gemini-3.1-pro') {
    return price(2, 12, 0.2, 0, source, 'OpenCode Zen Gemini 3.1 Pro');
  }
  if (id === 'gemini-3-flash') {
    return price(0.5, 3, 0.05, 0, source, 'OpenCode Zen Gemini 3 Flash');
  }
  if (id === 'gpt-5.5-pro') {
    return price(30, 180, 30, 0, source, 'OpenCode Zen GPT-5.5 Pro');
  }
  if (id === 'gpt-5.4-pro') {
    return price(30, 180, 30, 0, source, 'OpenCode Zen GPT-5.4 Pro');
  }
  if (id === 'gpt-5.4-nano') {
    return price(0.2, 1.25, 0.02, 0, source, 'OpenCode Zen GPT-5.4 Nano');
  }
  if (id === 'gpt-5.3-codex-spark') {
    return price(1.75, 14, 0.175, 0, source, 'OpenCode Zen GPT-5.3 Codex Spark');
  }
  if (id === 'gpt-5.2' || id === 'gpt-5.2-codex') {
    return price(1.75, 14, 0.175, 0, source, 'OpenCode Zen GPT-5.2');
  }
  if (id === 'gpt-5.1' || id === 'gpt-5.1-codex' || id === 'gpt-5' || id === 'gpt-5-codex') {
    return price(1.07, 8.5, 0.107, 0, source, 'OpenCode Zen GPT-5.1/5');
  }
  if (id === 'gpt-5.1-codex-max') {
    return price(1.25, 10, 0.125, 0, source, 'OpenCode Zen GPT-5.1 Codex Max');
  }
  if (id === 'gpt-5.1-codex-mini') {
    return price(0.25, 2, 0.025, 0, source, 'OpenCode Zen GPT-5.1 Codex Mini');
  }
  if (id === 'gpt-5-nano') {
    return price(0.05, 0.4, 0.005, 0, source, 'OpenCode Zen GPT-5 Nano');
  }

  return null;
}

export function resolveModelPricing(model?: string | null): ModelPricing | null {
  if (!model) return null;
  const raw = model.trim().toLowerCase();
  if (!raw) return null;
  const { provider, id: providerId } = splitProviderPrefix(raw);

  // These providers expose subscription, local, quota, or provider-specific
  // billing that is not a stable per-token API rate card.
  if (
    provider === 'ollama-cloud' ||
    provider === 'ollama' ||
    provider === 'llama-local' ||
    provider === 'lmstudio'
  ) {
    return null;
  }

  if (provider === 'opencode' || provider === 'opencode-go') {
    const zenPricing = resolveOpenCodeZenPricing(providerId);
    if (zenPricing) return zenPricing;
  }

  const id = normalizeProviderModelId(provider, providerId, raw);

  // OpenAI, USD per 1M tokens. Standard tier, short context (the long-context
  // surcharge above 272k input tokens is not modelled).
  if (id.startsWith('gpt-6-astra') || id === 'gpt-6') {
    return price(10, 50, 1, 12.5, 'OpenAI API pricing, 2026-09-04', 'GPT-6 Astra');
  }
  // 5.6 Sol carries promotional pricing at least through 2026-11-21.
  if (id.startsWith('gpt-5.6-sol') || id === 'gpt-5.6') {
    return price(4, 20, 0.4, 5, 'OpenAI API pricing, 2026-09-04', 'GPT-5.6 Sol');
  }
  if (id.startsWith('gpt-5.6-terra')) {
    return price(2, 12, 0.2, 2.5, 'OpenAI API pricing, 2026-09-04', 'GPT-5.6 Terra');
  }
  if (id.startsWith('gpt-5.6-luna')) {
    return price(0.2, 1.2, 0.02, 0.25, 'OpenAI API pricing, 2026-09-04', 'GPT-5.6 Luna');
  }
  if (id.startsWith('gpt-5.5')) {
    return price(5, 30, 0.5, 0, 'OpenAI API pricing, 2026-06-01', 'GPT-5.5');
  }
  if (id.startsWith('gpt-5.4-mini')) {
    return price(0.75, 4.5, 0.075, 0, 'OpenAI API pricing, 2026-06-01', 'GPT-5.4 mini');
  }
  if (id.startsWith('gpt-5.4-nano')) {
    return price(0.2, 1.25, 0.02, 0, 'OpenAI API pricing, 2026-06-09', 'GPT-5.4 nano');
  }
  if (id.startsWith('gpt-5.4')) {
    return price(2.5, 15, 0.25, 0, 'OpenAI API pricing, 2026-06-01', 'GPT-5.4');
  }
  if (id.startsWith('gpt-5.3-codex') || id.startsWith('gpt-5.2-codex')) {
    return price(1.75, 14, 0.175, 0, 'OpenAI model pricing, 2026-06-01', 'GPT Codex');
  }
  if (id === 'gpt-5.2' || id.startsWith('gpt-5.2-')) {
    return price(1.75, 14, 0.175, 0, 'OpenAI API pricing, 2026-06-09', 'GPT-5.2');
  }
  if (id === 'gpt-5.1' || id.startsWith('gpt-5.1-') || id === 'gpt-5') {
    return price(1.25, 10, 0.125, 0, 'OpenAI API pricing, 2026-06-09', 'GPT-5.1/5 family');
  }
  if (id === 'gpt-5-nano') {
    return price(0.05, 0.4, 0.005, 0, 'OpenAI API pricing, 2026-06-09', 'GPT-5 nano');
  }
  if (id.startsWith('gpt-4o-mini')) {
    return price(0.15, 0.6, 0.075, 0, 'OpenAI model pricing, 2026-06-01', 'GPT-4o mini');
  }
  if (id.startsWith('gpt-4o')) {
    return price(2.5, 10, 1.25, 0, 'OpenAI model pricing, 2026-06-01', 'GPT-4o');
  }

  // Anthropic, USD per 1M tokens. Cache write uses the 5 minute write rate.
  if (/^claude-fable-5(?:\b|-|$)/.test(id) || id === 'fable') {
    return price(10, 50, 1, 12.5, 'Anthropic API pricing, 2026-07-25', 'Claude Fable 5');
  }
  if (/^claude-opus-(?:5|4[.-](5|6|7|8))(?:\b|-|$)/.test(id) || id === 'opus') {
    return price(5, 25, 0.5, 6.25, 'Anthropic API pricing, 2026-07-25', 'Claude Opus 5/4.5+');
  }
  if (/^claude-opus-4(?:$|-202|[.-](?:0|1)(?:\b|-|$))/.test(id)) {
    return price(15, 75, 1.5, 18.75, 'Anthropic API pricing, 2026-06-01', 'Claude Opus 4/4.1');
  }
  if (/^claude-sonnet-5(?:\b|-|$)/.test(id) || id === 'sonnet') {
    return price(
      2,
      10,
      0.2,
      2.5,
      'Anthropic introductory API pricing through 2026-08-31',
      'Claude Sonnet 5'
    );
  }
  if (/^claude-sonnet-4(?:$|[.-])/.test(id)) {
    return price(3, 15, 0.3, 3.75, 'Anthropic API pricing, 2026-06-01', 'Claude Sonnet 4');
  }
  if (/^claude-3[.-]5-sonnet/.test(id)) {
    return price(3, 15, 0.3, 3.75, 'Anthropic API pricing, 2026-06-01', 'Claude Sonnet 3.5');
  }
  if (/^claude-haiku-4[.-]5(?:\b|-|$)/.test(id) || id === 'haiku') {
    return price(1, 5, 0.1, 1.25, 'Anthropic API pricing, 2026-06-01', 'Claude Haiku 4.5');
  }
  if (/^claude-3[.-]5-haiku/.test(id)) {
    return price(0.8, 4, 0.08, 1, 'Anthropic API pricing, 2026-06-01', 'Claude Haiku 3.5');
  }

  // Moonshot/Kimi, USD per 1M tokens. OpenCode Go is subscription-based, but
  // analytics use API-equivalent spend so Go-routed Kimi rows stay priced.
  if (id === 'k3' || id === 'kimi-k3') {
    return price(3, 15, 0.3, 0, 'Kimi K3 API pricing, 2026-07-18', 'Kimi K3');
  }
  if (id === 'kimi-k2.7-code' || id === 'kimi-k2.7-code-highspeed' || id === 'kimi-k2.7') {
    return price(0.95, 4, 0.19, 0, 'Kimi K2.7 Code API pricing, 2026-06-17', 'Kimi K2.7 Code');
  }

  // Alibaba Token Plan is Credits-based and does not publish a separate
  // pay-as-you-go USD rate for Qwen3.8 Max Preview yet. Use the official
  // Qwen3.7 Max list price as a clearly labelled API-equivalent proxy until
  // Alibaba publishes a model-specific rate.
  if (id === 'qwen3.8-max-preview') {
    return price(
      2.5,
      7.5,
      0.5,
      3.125,
      'Alibaba Model Studio Qwen3.7 Max list-price proxy, 2026-07-27',
      'Qwen3.8 Max Preview (Qwen3.7 Max proxy)'
    );
  }

  // Z.AI, USD per 1M tokens.
  if (id === 'glm-5.3-flash') {
    // Standard API-equivalent list rates; the launch promotion is 50% off
    // through 2026-09-09 24:00 UTC+8 (2026-09-09 16:00 UTC).
    return price(
      0.15,
      0.5,
      0.03,
      0,
      'Z.AI list pricing, 2026-09-06; 50% launch discount through 2026-09-09 16:00 UTC excluded',
      'GLM-5.3-Flash'
    );
  }
  if (id === 'glm-5.3') {
    return price(1.4, 4.4, 0.26, 0, 'Z.AI pricing, 2026-09-06', 'GLM-5.3');
  }
  if (raw === 'z-ai/glm-5.2' || raw === 'zai/glm-5.2' || id === 'glm-5.2') {
    return price(1.4, 4.4, 0.26, 0, 'Z.AI pricing, 2026-06-17', 'GLM-5.2');
  }
  if (raw === 'z-ai/glm-5.1' || raw === 'zai/glm-5.1' || id === 'glm-5.1') {
    return price(1.4, 4.4, 0.26, 0, 'Z.AI pricing, 2026-06-01', 'GLM-5.1');
  }
  if (raw === 'z-ai/glm-5' || raw === 'zai/glm-5' || id === 'glm-5') {
    return price(1, 3.2, 0.2, 0, 'Z.AI pricing, 2026-06-01', 'GLM-5');
  }
  if (raw === 'z-ai/glm-4.7' || raw === 'zai/glm-4.7' || id === 'glm-4.7') {
    return price(0.6, 2.2, 0.11, 0, 'Z.AI pricing, 2026-06-01', 'GLM-4.7');
  }
  if (raw === 'z-ai/glm-4.6' || raw === 'zai/glm-4.6' || id === 'glm-4.6') {
    return price(0.6, 2.2, 0.11, 0, 'Z.AI pricing, 2026-06-01', 'GLM-4.6');
  }
  if (raw === 'z-ai/glm-4.5' || raw === 'zai/glm-4.5' || id === 'glm-4.5') {
    return price(0.6, 2.2, 0.11, 0, 'Z.AI pricing, 2026-06-01', 'GLM-4.5');
  }

  // DeepSeek, USD per 1M tokens. deepseek-chat and deepseek-reasoner are
  // compatibility aliases for the V4 Flash non-thinking/thinking modes.
  if (id === 'deepseek-chat' || id === 'deepseek-reasoner' || id === 'deepseek-v4-flash') {
    return price(0.14, 0.28, 0.0028, 0, 'DeepSeek API pricing, 2026-06-09', 'DeepSeek V4 Flash');
  }
  if (id === 'deepseek-v4-pro') {
    return price(0.435, 0.87, 0.003625, 0, 'DeepSeek API pricing, 2026-06-09', 'DeepSeek V4 Pro');
  }

  // Google Gemini API, USD per 1M tokens. Use the standard <=200k prompt tier
  // because usage_history stores aggregate rows, not per-request context length.
  if (id === 'gemini-3.1-pro-preview' || id === 'google/gemini-3.1-pro-preview') {
    return price(2, 12, 0.2, 0, 'Google Gemini API pricing, 2026-06-01', 'Gemini 3.1 Pro Preview');
  }

  // Mistral, USD per 1M tokens. The public table does not expose prompt-cache
  // discounts for these text models, so cached tokens are priced as normal input.
  if (
    id === 'mistral-vibe-cli-latest' ||
    id === 'mistral-medium-3.5' ||
    id === 'mistral-medium-latest'
  ) {
    return price(1.5, 7.5, 1.5, 1.5, 'Mistral API pricing, 2026-06-01', 'Mistral Medium 3.5');
  }
  if (id === 'devstral-small-latest' || id.includes('devstral-small')) {
    return price(0.1, 0.3, 0.1, 0.1, 'Mistral API pricing, 2026-06-01', 'Devstral Small 2');
  }
  if (id === 'devstral-medium-latest' || id.includes('devstral-medium')) {
    return price(0.4, 2, 0.4, 0.4, 'Mistral API pricing, 2026-06-01', 'Devstral 2');
  }
  if (id === 'codestral-latest') {
    return price(0.3, 0.9, 0.3, 0.3, 'Mistral API pricing, 2026-06-01', 'Codestral');
  }
  if (id === 'mistral-small-latest') {
    return price(0.1, 0.3, 0.1, 0.1, 'Mistral API pricing, 2026-06-01', 'Mistral Small 4');
  }
  if (id === 'mistral-large-latest') {
    return price(0.5, 1.5, 0.5, 0.5, 'Mistral API pricing, 2026-06-01', 'Mistral Large 3');
  }

  return null;
}

export function calculateModelCost(tokens: UsageTokenCounts, pricing: ModelPricing): number {
  return (
    (tokens.inputTokens / 1_000_000) * pricing.input +
    (tokens.outputTokens / 1_000_000) * pricing.output +
    (tokens.cacheReadTokens / 1_000_000) * pricing.cacheRead +
    (tokens.cacheCreationTokens / 1_000_000) * pricing.cacheWrite
  );
}

export function estimateModelCost(
  model: string | null | undefined,
  tokens: UsageTokenCounts,
  fallbackPricing: ModelPricing | null = null
): ModelCostEstimate {
  const pricing = resolveModelPricing(model);
  const effectivePricing = pricing ?? fallbackPricing;
  return {
    cost: effectivePricing ? calculateModelCost(tokens, effectivePricing) : 0,
    pricing: effectivePricing,
    known: !!pricing,
  };
}
