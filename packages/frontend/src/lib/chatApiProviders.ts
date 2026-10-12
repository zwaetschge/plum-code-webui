import type { AssistantApiProvider } from '@plum-code-webui/shared';

/** Chat uses personal API connections; CLI harnesses remain in Task and Code. */
export function orderChatApiProviders(providers: AssistantApiProvider[]): AssistantApiProvider[] {
  const priority: Record<string, number> = {
    anthropic: 0,
    mistral: 1,
    deepseek: 2,
    'z-ai': 3,
    zai: 3,
  };
  return providers
    .filter((provider) => provider.models.length > 0)
    .slice()
    .sort((a, b) => (priority[a.id] ?? 4) - (priority[b.id] ?? 4));
}
