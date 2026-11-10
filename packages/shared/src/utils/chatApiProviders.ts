import type { AssistantApiProvider } from '../types/assistant.js';

/** New API chats prefer the configured GLM Flash connection; no API fallback runs. */
export function orderChatApiProviders(providers: AssistantApiProvider[]): AssistantApiProvider[] {
  // A model list chosen in the settings keeps its own order, default first.
  const chosen = providers.find((provider) => provider.default && provider.models.length > 0);
  if (chosen) return [chosen, ...providers.filter((p) => p !== chosen && p.models.length > 0)];
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

/**
 * The chat model menu from the personalisation's `chatModels`
 * (`providerId/model`, default first): providers in order of first use, their
 * models in list order, the default's provider marked. Entries that are no
 * longer available are skipped; when none is left every model is offered.
 */
export function selectChatModels(
  providers: AssistantApiProvider[],
  chosen: readonly string[]
): AssistantApiProvider[] {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const picked = new Map<string, string[]>();
  for (const entry of chosen) {
    const slash = entry.indexOf('/');
    if (slash <= 0) continue;
    const id = entry.slice(0, slash);
    const model = entry.slice(slash + 1);
    if (!byId.get(id)?.models.includes(model)) continue;
    const models = picked.get(id) ?? [];
    if (!models.includes(model)) models.push(model);
    picked.set(id, models);
  }
  if (!picked.size) return providers;
  return [...picked].map(([id, models], index) => ({
    ...byId.get(id)!,
    models,
    ...(index === 0 ? { default: true } : {}),
  }));
}
