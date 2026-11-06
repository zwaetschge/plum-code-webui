/**
 * A provider kept out of Pi must vanish from Pi's model catalog; model chat
 * still reads it from the same registry.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPiAgentSettings,
  buildPiModelCatalog,
  buildPiProviderConfig,
  selectVisiblePiModels,
} from './piConfig.js';
import { isPiModelProvider, type ModelProvider } from './modelProviderKeys.js';

const provider = (id: string, extra: Partial<ModelProvider> = {}): ModelProvider => ({
  id,
  name: id,
  apiKey: 'encrypted',
  baseUrl: `https://${id}.test/v1`,
  enabled: true,
  models: [`${id}-model`],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...extra,
});

test('providers switched off for Pi get neither models nor a models.json entry', () => {
  const { piProviders, models } = buildPiModelCatalog(
    [provider('anthropic', { pi: false }), provider('deepseek')],
    {},
    {},
    () => []
  );
  assert.deepEqual(Object.keys(piProviders), ['deepseek']);
  assert.deepEqual(models, ['deepseek/deepseek-model']);
});

test('only an explicit false keeps a provider from Pi', () => {
  assert.equal(isPiModelProvider(provider('a')), true);
  assert.equal(isPiModelProvider(provider('a', { pi: false })), false);
  assert.equal(isPiModelProvider(provider('a', { enabled: false })), false);
});

test('the picked Pi menu keeps its order and drops models that are gone', () => {
  const available = ['z-ai/glm-5.1', 'deepseek/deepseek-chat', 'mistral/devstral-latest'];
  assert.deepEqual(selectVisiblePiModels(available, []), available);
  assert.deepEqual(
    selectVisiblePiModels(available, ['mistral/devstral-latest', 'gone/model', 'z-ai/glm-5.1']),
    ['mistral/devstral-latest', 'z-ai/glm-5.1']
  );
  // Nothing of the pick left: every model again rather than an empty menu.
  assert.deepEqual(selectVisiblePiModels(available, ['gone/model']), available);
});

test('long-run settings: retries, idle timeout and a reserve that fits small windows', () => {
  const settings = buildPiAgentSettings(
    {},
    {
      strata: {
        models: [
          { id: 'small', contextWindow: 32_768 },
          { id: 'big', contextWindow: 200_000 },
        ],
      },
    },
    ['/ext.ts']
  );
  const compaction = settings.compaction as Record<string, unknown>;
  assert.equal(compaction.reserveTokens, 40_000);
  // 32k window: a quarter, so the threshold stays positive; 200k keeps the global 40k.
  assert.deepEqual(compaction.modelOverrides, { 'strata/small': { reserveTokens: 8_192 } });
  assert.deepEqual(settings.retry, {
    enabled: true,
    maxRetries: 8,
    baseDelayMs: 3_000,
    maxAgentDelayMs: 60_000,
  });
  assert.equal(settings.httpIdleTimeoutMs, 150_000);
  assert.deepEqual(settings.extensions, ['/ext.ts']);
});

test('values already in the settings file win', () => {
  const settings = buildPiAgentSettings(
    {
      httpIdleTimeoutMs: 'disabled',
      retry: { maxRetries: 2 },
      compaction: {
        reserveTokens: 20_000,
        modelOverrides: { 'strata/small': { reserveTokens: 1_000 } },
      },
    },
    { strata: { models: [{ id: 'small', contextWindow: 32_768 }] } },
    []
  );
  const compaction = settings.compaction as Record<string, unknown>;
  assert.equal(compaction.reserveTokens, 20_000);
  assert.deepEqual(compaction.modelOverrides, { 'strata/small': { reserveTokens: 1_000 } });
  assert.equal((settings.retry as Record<string, unknown>).maxRetries, 2);
  assert.equal(settings.httpIdleTimeoutMs, 'disabled');
});

test('a model without a catalog output limit gets a quarter of its window as maxTokens', () => {
  const entry = buildPiProviderConfig(provider('z-ai', { models: ['glm-5.1'] }), {
    'z-ai': { api: 'https://z-ai.test/v1', models: [], modelLimits: {} },
  } as never);
  const model = (entry?.models as Array<Record<string, unknown>>)[0]!;
  // GLM-5.x has a 200k window in the shared table: 50k, capped at 32k.
  assert.equal(model.maxTokens, 32_768);
});
