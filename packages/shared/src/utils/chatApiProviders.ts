import type { AssistantApiProvider } from '../types/assistant.js';

/** New API chats prefer the configured GLM Flash connection; no API fallback runs. */
export function orderChatApiProviders(providers: AssistantApiProvider[]): AssistantApiProvider[] {
  const priority: Record<string, number> = {
    'z-ai': 0,
    zai: 0,
    mistral: 1,
    deepseek: 2,
    anthropic: 4,
  };
  const preferred = (model: string) => model.toLowerCase().split('/').at(-1) === 'glm-5.3-flash';
  return providers
    .filter((provider) => provider.models.length > 0)
    .map((provider) => ({
      ...provider,
      models: [...provider.models].sort((a, b) => Number(preferred(b)) - Number(preferred(a))),
    }))
    .sort(
      (a, b) =>
        Number(preferred(b.models[0]!)) - Number(preferred(a.models[0]!)) ||
        (priority[a.id] ?? 3) - (priority[b.id] ?? 3)
    );
}
