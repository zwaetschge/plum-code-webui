/**
 * A provider's own model list replaces what the registry had, so retired
 * models leave the pickers and new ones appear (DeepSeek, 2026-11: the API
 * lists deepseek-flash and deepseek-v4-pro only).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { chatModelIds, fetchProviderModelIds } from './providerModelDiscovery.js';
import type { ModelProvider } from './modelProviderKeys.js';
import { buildPiProviderConfig } from './piConfig.js';

const provider = (extra: Partial<ModelProvider> = {}): ModelProvider => ({
  id: 'deepseek',
  name: 'DeepSeek',
  apiKey: 'encrypted',
  baseUrl: 'https://api.deepseek.com',
  enabled: true,
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z',
  ...extra,
});

test('the live list is read from GET /models with a bearer key', async () => {
  const calls: Array<{ url: string; auth?: string }> = [];
  const ids = await fetchProviderModelIds(provider(), 'sk-test', {}, async (url, init) => {
    calls.push({ url, auth: (init?.headers as Record<string, string>).authorization });
    return new Response(
      JSON.stringify({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }),
      { status: 200 }
    );
  });
  assert.deepEqual(ids, ['deepseek-flash', 'deepseek-v4-pro']);
  assert.deepEqual(calls, [{ url: 'https://api.deepseek.com/models', auth: 'Bearer sk-test' }]);
});

test('an endpoint without a model list gives null, not an empty menu', async () => {
  const ids = await fetchProviderModelIds(
    provider(),
    'sk',
    {},
    async () => new Response('', { status: 404 })
  );
  assert.equal(ids, null);
});

test('Anthropic is asked under /v1 with its own headers', async () => {
  let seen = '';
  let headers: Record<string, string> = {};
  await fetchProviderModelIds(
    provider({ id: 'anthropic', baseUrl: 'https://api.anthropic.com' }),
    'sk-ant',
    {},
    async (url, init) => {
      seen = url;
      headers = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
  );
  assert.equal(seen, 'https://api.anthropic.com/v1/models');
  assert.equal(headers['x-api-key'], 'sk-ant');
});

test('embedding, audio and image models stay out of a chat menu', () => {
  assert.deepEqual(
    chatModelIds([
      'glm-5.1',
      'text-embedding-3',
      'whisper-1',
      'cogview-image',
      'bge-m3',
      'glm-5.1',
    ]),
    ['glm-5.1']
  );
});

test('Pi offers only the live list, no retired catalog models', () => {
  const live = buildPiProviderConfig(
    provider({ models: ['deepseek-flash', 'deepseek-v4-pro'], modelsSource: 'live' }),
    {
      deepseek: {
        name: 'DeepSeek',
        api: 'https://api.deepseek.com',
        models: ['deepseek-chat', 'deepseek-reasoner'],
        env: ['DEEPSEEK_API_KEY'],
      },
    } as never
  );
  const ids = (live?.models as Array<{ id: string; contextWindow?: number; input?: string[] }>).map(
    (model) => model.id
  );
  assert.deepEqual(ids, ['deepseek-flash', 'deepseek-v4-pro']);
  const flash = (
    live?.models as Array<{ id: string; contextWindow?: number; input?: string[] }>
  )[0]!;
  assert.equal(flash.contextWindow, 1_000_000);
  assert.deepEqual(flash.input, ['text', 'image']);
});
