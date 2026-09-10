/**
 * `LLM_PRICING_RATE_CARD_VERSION` was read by nothing for as long as it existed,
 * while two documents promised that changing it repriced stored rows. It now
 * drives a migration id; this checks the arithmetic that migration performs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('./testing.js');
useTestSchema();

const { transaction: pgTransaction, run: pgRun, get: pgGet } = await import('./pg.js');
const { repriceUsageHistory } = await import('./reprice.js');
const { resolveModelPricing } = await import('@plum-code-webui/shared');

const reachable = await databaseReachable();
if (reachable) await createTestSchema();
test.after(async () => {
  if (reachable) await dropTestSchema();
});

const options = reachable ? {} : { skip: 'no Postgres reachable (set PGHOST/PGPASSWORD to run)' };

test(
  'a known model is repriced from its tokens, an unknown one is left alone',
  options,
  async () => {
    await pgRun(
      `INSERT INTO users (id, email, name, provider, provider_id) VALUES ('u1', 'r@example.test', 'R', 'local', 'u1')`
    );
    await pgRun(
      `INSERT INTO sessions (id, user_id, name, working_directory) VALUES ('s1', 'u1', 'S', '/tmp')`
    );

    const insert = (turn: string, model: string, cost: number) =>
      pgRun(
        `INSERT INTO usage_history
         (user_id, session_id, provider, turn_id, input_tokens, output_tokens,
          cache_read_tokens, cache_creation_tokens, total_tokens, cost_usd, model)
       VALUES ('u1', 's1', 'codex', ?, 1000000, 1000000, 0, 0, 2000000, ?, ?)`,
        turn,
        cost,
        model
      );

    // A model the card knows, stored at a deliberately wrong price…
    await insert('t1', 'gpt-5.5', 999);
    // …and one it does not, which must keep whatever it was written with.
    await insert('t2', 'some-model-that-was-never-priced', 42);

    await insert('glm-full', 'glm-5.3', 0);
    await insert('glm-flash', 'glm-5.3-flash', 0);

    await pgTransaction((tx) => repriceUsageHistory(tx));

    const pricing = resolveModelPricing('gpt-5.5');
    assert.ok(pricing, 'gpt-5.5 must be in the rate card for this test to mean anything');
    const expected = pricing.input + pricing.output; // one million tokens each way

    const known = (await pgGet(`SELECT cost_usd FROM usage_history WHERE turn_id = 't1'`)) as {
      cost_usd: number;
    };
    assert.ok(
      Math.abs(known.cost_usd - expected) < 1e-6,
      `expected ${expected}, got ${known.cost_usd}`
    );

    const unknown = (await pgGet(`SELECT cost_usd FROM usage_history WHERE turn_id = 't2'`)) as {
      cost_usd: number;
    };
    assert.equal(unknown.cost_usd, 42);
    for (const [turn, expectedCost] of [
      ['glm-full', 5.8],
      ['glm-flash', 0.65],
    ] as const) {
      const row = await pgGet('SELECT cost_usd FROM usage_history WHERE turn_id = ?', turn);
      assert.ok(Math.abs(row.cost_usd - expectedCost) < 1e-8);
    }
  }
);
