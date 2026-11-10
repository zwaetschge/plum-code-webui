import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mistralAllowanceWindow,
  parseMistralAllowance,
  parseMistralBilling,
} from './mistralBilling.js';

// Shape of GET /v1/billing/budget for a Pro plan (2026-11-08, values rounded).
const BUDGET = {
  vibe_budget: {
    usage_percentage: 69.93981802333333,
    initial_budget: 255.0,
    currency: 'EUR',
    reset_at: '2026-12-01T00:00:00Z',
    payg_enabled: false,
  },
  api_budget: {
    usage_percentage: 0.0,
    initial_budget: 25.5,
    currency: 'EUR',
    reset_at: '2026-12-01T00:00:00Z',
    payg_enabled: false,
  },
  usage_percentage: 0.0,
  initial_budget: 25.5,
  currency: 'EUR',
  reset_at: '2026-12-01T00:00:00Z',
};

test('both allowances and the plan come from the billing answers', () => {
  const billing = parseMistralBilling(BUDGET, { plan_name: 'INDIVIDUAL' }, 'now');
  assert.deepEqual(billing, {
    planName: 'INDIVIDUAL',
    vibe: {
      usagePercentage: 69.93981802333333,
      initialBudget: 255,
      currency: 'EUR',
      resetAt: '2026-12-01T00:00:00Z',
      paygEnabled: false,
    },
    api: {
      usagePercentage: 0,
      initialBudget: 25.5,
      currency: 'EUR',
      resetAt: '2026-12-01T00:00:00Z',
      paygEnabled: false,
    },
    checkedAt: 'now',
  });
});

test('older answers with only top-level fields still give the API allowance', () => {
  const billing = parseMistralBilling(
    { usage_percentage: 12.5, initial_budget: 25.5, currency: 'eur' },
    null
  );
  assert.equal(billing?.vibe, null);
  assert.deepEqual([billing?.api?.usagePercentage, billing?.api?.currency], [12.5, 'EUR']);
  assert.equal(billing?.planName, null);
});

test('malformed or empty answers read as no billing data', () => {
  assert.equal(parseMistralBilling(null, null), null);
  assert.equal(parseMistralBilling({ detail: 'forbidden' }, null), null);
  assert.equal(parseMistralAllowance({ usage_percentage: 'x', initial_budget: 255 }), null);
  assert.equal(parseMistralAllowance({ usage_percentage: 5, initial_budget: 0 }), null);
});

test('the window shows the console figures in whole percent and euros', () => {
  const vibe = parseMistralBilling(BUDGET, null)!.vibe!;
  assert.deepEqual(mistralAllowanceWindow(vibe, 'fallback', 2592000), {
    utilization: 70,
    resetsAt: '2026-12-01T00:00:00Z',
    windowSeconds: 2592000,
    used: 178.35,
    limit: 255,
    remaining: 76.65,
    unit: 'eur',
  });
  // 99.6 % is not used up yet; past 100 (pay-as-you-go) shows as is.
  const almost = { ...vibe, usagePercentage: 99.6 };
  assert.equal(mistralAllowanceWindow(almost, 'x', 1).utilization, 99);
  const over = { ...vibe, usagePercentage: 112.4, paygEnabled: true, resetAt: null };
  assert.deepEqual(
    [
      mistralAllowanceWindow(over, 'x', 1).utilization,
      mistralAllowanceWindow(over, 'x', 1).remaining,
      mistralAllowanceWindow(over, 'x', 1).resetsAt,
    ],
    [112, 0, 'x']
  );
});
