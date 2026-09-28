/**
 * Mistral plan usage: our own ledger of `mistral/*` turns in the billing month,
 * measured against a declared budget (Mistral has no quota API for Pro plans).
 */
import assert from 'node:assert/strict';
import { createTestSchema, dropTestSchema, useTestSchema } from '../src/db/testing.js';

useTestSchema();
const { run: pgRun } = await import('../src/db/pg.js');
await createTestSchema();
const { buildMistralLimitResponse, mistralBillingWindow, saveMistralPlanConfig } =
  await import('../src/services/mistralPlanUsage.js');

try {
  // Billing windows: day 1 is the calendar month; a later day rolls back a month.
  assert.deepEqual(mistralBillingWindow(1, new Date('2026-09-27T12:00:00Z')), {
    start: new Date('2026-09-01T00:00:00Z'),
    end: new Date('2026-10-01T00:00:00Z'),
  });
  assert.deepEqual(mistralBillingWindow(28, new Date('2026-03-05T00:00:00Z')), {
    start: new Date('2026-02-28T00:00:00Z'),
    end: new Date('2026-03-28T00:00:00Z'),
  });

  await pgRun(
    `INSERT INTO users (id, email, name, provider, provider_id)
     VALUES ('mistral-user', 'mistral@example.test', 'M', 'local', 'mistral-user')`
  );
  await pgRun(
    `INSERT INTO sessions (id, user_id, name, working_directory, cli_provider, status)
     VALUES ('mistral-session', 'mistral-user', 'm', '/tmp', 'pi', 'stopped')`
  );

  // No Mistral provider and no usage: nothing to show.
  const empty = await buildMistralLimitResponse('mistral-user');
  assert.equal(empty.supported, false);

  const now = new Date();
  const sqlNow = now.toISOString().slice(0, 19).replace('T', ' ');
  for (const [id, model, input, output] of [
    ['m1', 'mistral/devstral-latest', 1_000_000, 500_000],
    ['m2', 'mistral/zai-glm-5-3', 200_000, 100_000],
    ['other', 'z-ai/glm-5.3', 9_000_000, 9_000_000],
  ] as const) {
    await pgRun(
      `INSERT INTO usage_history (turn_id, user_id, session_id, provider, model, input_tokens,
         output_tokens, cache_read_tokens, cache_creation_tokens, total_tokens, cost_usd, created_at)
       VALUES (?, 'mistral-user', 'mistral-session', 'pi', ?, ?, ?, 0, 0, ?, 0, ?)`,
      id,
      model,
      input,
      output,
      input + output,
      sqlNow
    );
  }

  // Usage without a budget: the month so far, no percentage.
  const noBudget = await buildMistralLimitResponse('mistral-user');
  assert.equal(noBudget.supported, true);
  assert.equal(noBudget.data?.sevenDay, null);
  assert.equal(noBudget.data?.planUsage.requests, 2, 'only mistral/* turns count');
  assert.equal(noBudget.data?.planUsage.tokens, 1_800_000);
  // Devstral 2: 1M in × $0.40 + 0.5M out × $2 = $1.40; GLM-5.3: 0.2M × $1.40 + 0.1M × $4.40 = $0.72.
  assert.equal(noBudget.data?.planUsage.spend, 2.12);
  assert.equal(noBudget.error?.code, 'NO_BUDGET');

  // With a budget: a whole-percent month window (Android decodes it as Int).
  await saveMistralPlanConfig('mistral-user', { monthlyBudget: 10, currency: 'EUR', billingDay: 1 });
  const budgeted = await buildMistralLimitResponse('mistral-user');
  assert.equal(budgeted.data?.sevenDay?.utilization, 21);
  assert.ok(Number.isInteger(budgeted.data?.sevenDay?.utilization));
  assert.equal(budgeted.data?.sevenDay?.limit, 10);
  assert.equal(budgeted.data?.sevenDay?.unit, 'eur');
  assert.equal(budgeted.data?.planUsage.allowance, 'api', 'a regular key draws on the API allowance');
  assert.equal(budgeted.error, undefined);

  console.log('mistral plan usage tests passed');
} finally {
  await dropTestSchema();
}
process.exit(0);
