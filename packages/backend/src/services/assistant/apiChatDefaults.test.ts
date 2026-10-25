import assert from 'node:assert/strict';
import test from 'node:test';
import { orderChatApiProviders, type AssistantApiProvider } from '@plum-code-webui/shared';

const provider = (id: string, models: string[]): AssistantApiProvider => ({
  id,
  name: id,
  models,
  protocol: id === 'anthropic' ? 'anthropic' : 'openai',
});
test('new API chats choose configured GLM 5.3 Flash before Claude without mutating the catalog', () => {
  const catalog = [
    provider('anthropic', ['claude-sonnet-5-5']),
    provider('mistral', ['mistral-large-latest']),
    provider('z-ai', ['glm-5.3', 'glm-5.3-flash']),
  ];
  const original = structuredClone(catalog);
  const ordered = orderChatApiProviders(catalog);
  assert.equal(ordered[0]?.id, 'z-ai');
  assert.equal(ordered[0]?.models[0], 'glm-5.3-flash');
  assert.deepEqual(catalog, original);
  assert.deepEqual(ordered.find((p) => p.id === 'anthropic')?.models, ['claude-sonnet-5-5']);
});
test('uses only models actually configured and supports qualified GLM identifiers', () => {
  assert.equal(
    orderChatApiProviders([
      provider('empty', []),
      provider('mistral', ['mistral-small']),
      provider('anthropic', ['claude']),
    ])[0]?.id,
    'mistral'
  );
  assert.equal(
    orderChatApiProviders([
      provider('anthropic', ['claude']),
      provider('router', ['other', 'z-ai/glm-5.3-flash']),
    ])[0]?.models[0],
    'z-ai/glm-5.3-flash'
  );
  assert.deepEqual(orderChatApiProviders([]), []);
});
