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

const { insertUsageHistoryTurn, reconcileStaleRunningSessions } =
  await import('../src/db/index.js');
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

  // Exercise the real HTTP route against Postgres: repeated timezone bind
  // parameters in SELECT/GROUP BY are different expressions to its planner.
  const { default: express } = await import('express');
  const { default: jwt } = await import('jsonwebtoken');
  const { config } = await import('../src/config.js');
  const { default: analyticsRouter } = await import('../src/routes/analytics.js');
  await pgRun("UPDATE usage_history SET created_at = '2026-07-31 23:45:00'");
  await pgRun(`INSERT INTO session_events (id, user_id, session_id, event_type, context_used_percent, created_at)
    VALUES ('snapshot-1', 'user-1', 'pi-session', 'context_snapshot', 42, '2026-07-31 23:45:00'),
           ('compact-1', 'user-1', 'pi-session', 'compact', 0, '2026-07-31 23:45:00')`);
  const app = express();
  app.use('/api/analytics', analyticsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const headers = { Authorization: `Bearer ${jwt.sign({ userId: 'user-1' }, config.jwtSecret)}` };
  try {
    for (const tz of [0, 330, -300]) {
      for (const query of [
        'period=all',
        'period=24h&granularity=hour',
        'period=24h&granularity=day',
        'period=30d',
      ]) {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/api/analytics/timeline?${query}&tz=${tz}`,
          { headers }
        );
        const body = (await response.json()) as {
          data: Array<{
            date: string;
            total_tokens: number;
            requests: number;
            context_snapshots: number;
            compact_events: number;
            max_context_used_percent: number;
            providers: Record<string, { tokens: number }>;
            models: Record<string, unknown>;
          }>;
        };
        assert.equal(response.status, 200, `timeline ${query}, tz=${tz}: ${JSON.stringify(body)}`);
        if (query === 'period=all') {
          assert.equal(body.data.length, 1);
          const bucket = body.data[0];
          assert.equal(bucket.date, tz === 330 ? '2026-08' : '2026-07');
          assert.equal(bucket.total_tokens, 195);
          assert.equal(bucket.requests, 2);
          assert.equal(bucket.context_snapshots, 1);
          assert.equal(bucket.compact_events, 1);
          assert.equal(bucket.max_context_used_percent, 42);
          assert.equal(bucket.providers.Pi.tokens, 175);
          assert.equal(bucket.providers.OpenCode.tokens, 20);
          assert.equal(Object.keys(bucket.models).length, 2);
        }
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }

  console.log('runtime analytics regression tests passed');
} finally {
  await dropTestSchema();
}
