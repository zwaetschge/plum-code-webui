/**
 * One model id, two harnesses.
 *
 * `z-ai/glm-5.1` is reachable through both Pi and OpenCode, so usage keyed by
 * model alone silently merges two providers into one row and the analytics page
 * attributes a Pi turn's tokens to OpenCode. These pin the split: the ledger
 * keeps the provider, the turn is written once, and the timeline series for the
 * two harnesses cannot collide.
 *
 * The one-time attribution migration that used to be tested here is gone with
 * the SQLite schema — its result is part of the Postgres baseline, and a
 * migration that can never run again is not behaviour worth asserting.
 */

import assert from 'node:assert/strict';

import {
  getProviderLabelForUsage,
  getUsageModelKey,
} from '../../shared/src/types/cli-providers.js';
import { createTestSchema, dropTestSchema, useTestSchema } from '../src/db/testing.js';

useTestSchema();

const { insertUsageHistoryTurn, reconcileStaleRunningSessions } = await import(
  '../src/db/index.js'
);
const { all: pgAll, run: pgRun } = await import('../src/db/pg.js');

await createTestSchema();

try {
  await pgRun(
    `INSERT INTO users (id, email, name, provider, provider_id)
     VALUES ('user-1', 'runtime@example.test', 'R', 'local', 'user-1')`
  );
  for (const [id, provider, status] of [
    ['pi-session', 'pi', 'running'],
    ['opencode-session', 'opencode', 'running'],
    ['stopped-session', 'codex', 'stopped'],
  ]) {
    await pgRun(
      `INSERT INTO sessions (id, user_id, name, working_directory, cli_provider, status)
       VALUES (?, 'user-1', ?, '/tmp', ?, ?)`,
      id,
      id,
      provider,
      status
    );
  }

  const turn = {
    userId: 'user-1',
    sessionId: 'pi-session',
    provider: 'pi' as const,
    turnId: 'message-1',
    inputTokens: 100,
    outputTokens: 25,
    cacheReadTokens: 50,
    cacheCreationTokens: 0,
    totalTokens: 175,
    costUsd: 0.001,
    model: 'z-ai/glm-5.1',
    createdAt: '2026-07-26T21:46:47.000Z',
  };

  assert.equal(await insertUsageHistoryTurn(turn), true);
  assert.equal(
    await insertUsageHistoryTurn(turn),
    false,
    'the same completed turn must be idempotent'
  );

  const [written] = (await pgAll(
    `SELECT created_at as "createdAt", COUNT(*) OVER () AS "rows"
       FROM usage_history
      WHERE session_id = 'pi-session' AND provider = 'pi' AND turn_id = 'message-1'`
  )) as Array<{ createdAt: string; rows: number }>;
  assert.equal(
    written?.createdAt,
    '2026-07-26 21:46:47',
    'usage should be attributed to user turn submission time rather than completion time'
  );
  assert.equal(Number(written?.rows), 1);

  await insertUsageHistoryTurn({
    ...turn,
    sessionId: 'opencode-session',
    provider: 'opencode',
    turnId: 'message-2',
    totalTokens: 20,
  });

  const providerGroups = (await pgAll(
    `SELECT provider, model, SUM(total_tokens) as tokens
       FROM usage_history
      WHERE model = 'z-ai/glm-5.1'
      GROUP BY provider, model
      ORDER BY provider`
  )) as Array<{ provider: string; model: string; tokens: number }>;
  assert.equal(
    providerGroups.length,
    2,
    'one shared model id must remain split by runtime provider'
  );

  assert.equal(getProviderLabelForUsage('pi', 'z-ai/glm-5.1'), 'Pi');
  assert.equal(getProviderLabelForUsage('opencode', 'z-ai/glm-5.1'), 'OpenCode');
  assert.notEqual(
    getUsageModelKey('pi', 'z-ai/glm-5.1'),
    getUsageModelKey('opencode', 'z-ai/glm-5.1'),
    'timeline model series must not collide across harnesses'
  );

  // The in-memory process registry is empty after a restart, so a persisted
  // `running` row describes a process the old backend owned.
  assert.equal(await reconcileStaleRunningSessions(), 2);
  assert.deepEqual(await pgAll('SELECT id, status FROM sessions ORDER BY id'), [
    { id: 'opencode-session', status: 'stopped' },
    { id: 'pi-session', status: 'stopped' },
    { id: 'stopped-session', status: 'stopped' },
  ]);
  assert.equal(
    await reconcileStaleRunningSessions(),
    0,
    'startup reconciliation should be repeatable'
  );

  console.log('runtime analytics regression tests passed');
} finally {
  await dropTestSchema();
}
