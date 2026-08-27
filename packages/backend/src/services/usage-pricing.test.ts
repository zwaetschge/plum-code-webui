/**
 * Pricing and provider grouping feed the analytics page and every cost figure in
 * the app. Both are pure, both are easy to break silently — a wrong divisor or a
 * missing provider case shows up as plausible-looking numbers, not as an error.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateModelCost,
  estimateModelCost,
  resolveModelPricing,
} from '@plum-code-webui/shared';
import { getProviderLabelForUsage, getUsageModelKey } from '@plum-code-webui/shared';

/** ModelPricing also carries provenance fields the rate maths never reads. */
function rate(input: number, output = 0, cacheRead = 0, cacheWrite = 0) {
  return { input, output, cacheRead, cacheWrite, source: 'test', label: 'test' };
}

const NO_TOKENS = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

test('cost is per million tokens, summed over all four buckets', () => {
  const pricing = rate(10, 20, 1, 2);
  const cost = calculateModelCost(
    {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    },
    pricing
  );
  assert.equal(cost, 33);
});

test('zero tokens cost nothing', () => {
  assert.equal(calculateModelCost(NO_TOKENS, rate(5, 5, 5, 5)), 0);
});

test('partial millions scale linearly', () => {
  const cost = calculateModelCost({ ...NO_TOKENS, inputTokens: 250_000 }, rate(8));
  assert.equal(cost, 2);
});

test('an unknown model resolves to no pricing rather than a guess', () => {
  // Unpriced must stay unpriced: inventing a rate would corrupt spend totals.
  assert.equal(resolveModelPricing('definitely-not-a-real-model-xyz'), null);
  assert.equal(resolveModelPricing(''), null);
  assert.equal(resolveModelPricing(null), null);
});

test('estimateModelCost flags an unpriced model instead of inventing a rate', () => {
  const unknown = estimateModelCost('definitely-not-a-real-model-xyz', {
    ...NO_TOKENS,
    inputTokens: 1_000_000,
  });
  // Cost is 0, not null — so callers must read `known` to tell "free" apart
  // from "we have no rate card for this". Locking that in: a caller that only
  // sums `cost` silently under-reports spend for every unknown model.
  assert.equal(unknown.known, false);
  assert.equal(unknown.cost, 0);
  assert.equal(unknown.pricing, null);

  const fallback = estimateModelCost(
    'definitely-not-a-real-model-xyz',
    { ...NO_TOKENS, inputTokens: 1_000_000 },
    rate(3)
  );
  assert.equal(fallback.cost, 3, 'an explicit fallback rate should be used');
  assert.equal(fallback.known, false, 'a fallback is still not a known price');
});

test('provider grouping keeps each harness separate', () => {
  assert.equal(getProviderLabelForUsage('codex', 'gpt-5.5'), 'Codex');
  assert.equal(getProviderLabelForUsage('claude', 'sonnet'), 'Claude');
  assert.equal(getProviderLabelForUsage('opencode', 'z-ai/glm-5.1'), 'OpenCode');
  // Pi runs on OpenCode's connections but must not be merged into it.
  assert.equal(getProviderLabelForUsage('pi', 'z-ai/glm-5.1'), 'Pi');
  assert.equal(getProviderLabelForUsage('kimi', 'kimi-k2'), 'Kimi');
});

test('provider grouping is case and whitespace tolerant', () => {
  assert.equal(getProviderLabelForUsage('  Codex  ', 'gpt-5.5'), 'Codex');
  assert.equal(getProviderLabelForUsage('Z-AI', 'glm'), 'Z.AI');
});

test('two harnesses sharing one model id get different timeline keys', () => {
  const pi = getUsageModelKey('pi', 'z-ai/glm-5.1');
  const opencode = getUsageModelKey('opencode', 'z-ai/glm-5.1');
  assert.notEqual(pi, opencode, 'series would collapse into one line otherwise');
});
