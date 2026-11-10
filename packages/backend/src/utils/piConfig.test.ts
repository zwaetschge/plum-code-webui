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
  convertAgentModelForPi,
  describePiModelRoute,
  piCompactionReserveFor,
  resolvePiModel,
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

test('DeepSeek compacts at 256k instead of just below its 1M window', () => {
  const settings = buildPiAgentSettings(
    {
      // An entry from the old 128k window must not keep the threshold near 1M.
      compaction: { modelOverrides: { 'deepseek/deepseek-flash': { reserveTokens: 32_000 } } },
    },
    {
      deepseek: {
        models: [
          { id: 'deepseek-flash', contextWindow: 1_048_576 },
          { id: 'deepseek-v4-pro', contextWindow: 1_048_576 },
        ],
      },
      qwen: { models: [{ id: 'qwen-max', contextWindow: 1_000_000 }] },
    },
    []
  );
  const overrides = (settings.compaction as Record<string, unknown>).modelOverrides as Record<
    string,
    { reserveTokens: number }
  >;
  assert.equal(overrides['deepseek/deepseek-flash']?.reserveTokens, 1_048_576 - 256_000);
  assert.equal(overrides['deepseek/deepseek-v4-pro']?.reserveTokens, 1_048_576 - 256_000);
  // Other large windows keep the global reserve.
  assert.equal(overrides['qwen/qwen-max'], undefined);
  // A window at or below the cap is left alone.
  assert.equal(piCompactionReserveFor(128_000, 'deepseek/deepseek-chat'), 32_000);
});

const PI_MENU = [
  'mistral/mistral-large-latest',
  'mistral/zai-glm-5-3',
  'deepseek/deepseek-flash',
  'deepseek/deepseek-v4-pro',
  'z-ai/glm-5.3',
  'mistral/deepseek-v4-1-flash-1017',
];

test('a Pi model says which API it bills: the vendor directly or a host', () => {
  assert.equal(describePiModelRoute('deepseek/deepseek-flash').route, 'direct');
  assert.equal(describePiModelRoute('mistral/deepseek-v4-1-flash-1017').route, 'hosted');
  assert.match(describePiModelRoute('mistral/deepseek-v4-1-flash-1017').description, /mistral/);
  assert.equal(describePiModelRoute('z-ai/glm-5.3').route, 'direct');
  assert.equal(describePiModelRoute('mistral/zai-glm-5-3').route, 'hosted');
  assert.equal(describePiModelRoute('mistral/mistral-large-latest').route, 'direct');
  assert.equal(describePiModelRoute('strata-local/qwen3.8-flash-next').route, 'direct');
});

test('a full Pi model id is taken as is; a bare name must be unambiguous', () => {
  assert.deepEqual(resolvePiModel('deepseek/deepseek-flash', PI_MENU), {
    id: 'deepseek/deepseek-flash',
  });
  assert.deepEqual(resolvePiModel('mistral/deepseek-v4-1-flash-1017', PI_MENU), {
    id: 'mistral/deepseek-v4-1-flash-1017',
  });
  // One exact match by name.
  assert.deepEqual(resolvePiModel('deepseek-flash', PI_MENU), { id: 'deepseek/deepseek-flash' });
  // "deepseek" fits three models on two APIs: never guess.
  const vague = resolvePiModel('deepseek', PI_MENU);
  assert.ok('error' in vague);
  assert.deepEqual('candidates' in vague ? vague.candidates : [], [
    'deepseek/deepseek-flash',
    'deepseek/deepseek-v4-pro',
    'mistral/deepseek-v4-1-flash-1017',
  ]);
  // Unknown provider/model names the same model elsewhere.
  const gone = resolvePiModel('alibaba-token-plan/deepseek-flash', PI_MENU);
  assert.ok('error' in gone);
  assert.deepEqual('candidates' in gone ? gone.candidates : [], ['deepseek/deepseek-flash']);
});

test('Claude agent model pins become something Pi accepts', () => {
  const agent = (model: string) => `---\nname: x\nmodel: ${model}\ntools: Read\n---\nBody`;
  // inherit / Claude aliases: no model line, so the subagent runs on the session model.
  assert.doesNotMatch(convertAgentModelForPi(agent('inherit'), PI_MENU), /^model:/m);
  assert.doesNotMatch(convertAgentModelForPi(agent('sonnet'), PI_MENU), /^model:/m);
  assert.doesNotMatch(convertAgentModelForPi(agent('claude-opus-5-5'), PI_MENU), /^model:/m);
  // A bare name takes the first matching model of the user's menu (their route).
  assert.match(convertAgentModelForPi(agent('glm-5.3'), PI_MENU), /^model: mistral\/zai-glm-5-3$/m);
  assert.match(
    convertAgentModelForPi(agent('glm-5.3'), ['z-ai/glm-5.3', 'mistral/zai-glm-5-3']),
    /^model: z-ai\/glm-5\.3$/m
  );
  // A full id that exists stays; one that is gone is dropped.
  assert.match(
    convertAgentModelForPi(agent('deepseek/deepseek-flash'), PI_MENU),
    /^model: deepseek\/deepseek-flash$/m
  );
  assert.doesNotMatch(convertAgentModelForPi(agent('gone/model'), PI_MENU), /^model:/m);
  // The rest of the file is untouched.
  assert.match(
    convertAgentModelForPi(agent('inherit'), PI_MENU),
    /name: x[\s\S]*tools: Read[\s\S]*Body/
  );
});
