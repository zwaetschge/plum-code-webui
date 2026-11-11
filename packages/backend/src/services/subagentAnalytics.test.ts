import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createTestSchema, dropTestSchema, useTestSchema } from '../db/testing.js';

useTestSchema();

const { run: pgRun } = await import('../db/pg.js');
const { bookSubagentUsage, insertUsageHistoryTurn, insertUsageSubagentTurns } =
  await import('../db/index.js');
const { summariseSubagentUsage } = await import('./subagentAnalytics.js');

const tokens = (input: number, output: number, cacheRead: number) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheCreationTokens: 0,
  totalTokens: input + output + cacheRead,
});

before(async () => {
  await createTestSchema();
  for (const user of ['user-1', 'user-2']) {
    await pgRun(
      `INSERT INTO users (id, email, name, provider, provider_id) VALUES (?, ?, 'U', 'local', ?)`,
      user,
      `${user}@example.test`,
      user
    );
  }
  await pgRun(
    `INSERT INTO sessions (id, user_id, name, working_directory, cli_provider)
     VALUES ('s1', 'user-1', 'S1', '/tmp/a', 'claude'), ('s2', 'user-1', 'S2', '/tmp/b', 'claude'),
            ('other', 'user-2', 'O', '/tmp/c', 'claude')`
  );
  const turn = (
    sessionId: string,
    turnId: string,
    provider: string,
    model: string,
    t: ReturnType<typeof tokens>,
    createdAt: string,
    userId = 'user-1'
  ) =>
    insertUsageHistoryTurn({
      userId,
      sessionId,
      provider,
      turnId,
      ...t,
      costUsd: t.totalTokens / 1e6,
      model,
      createdAt,
    });

  // Codex books its threads inside the turn's row; the split only says whose they were.
  await turn(
    's2',
    'codex-turn',
    'codex',
    'gpt-6.1-sol',
    tokens(20, 20, 960),
    '2026-11-10T08:00:00Z'
  );
  // The session's own turns.
  await turn(
    's1',
    'q1',
    'claude',
    'claude-fable-5-2',
    tokens(10, 500, 99_490),
    '2026-11-10T09:00:00Z'
  );
  // Agents of two sessions; the same type and model belong together.
  const agent = (
    sessionId: string,
    agentId: string,
    agentType: string,
    model: string,
    t: ReturnType<typeof tokens>,
    spentAt: string
  ) => ({
    userId: 'user-1',
    sessionId,
    provider: 'claude' as const,
    turnId: 'q1',
    agentId,
    parentAgentId: null,
    agentType,
    model,
    ...t,
    costUsd: t.totalTokens / 1e6,
    spentAt,
  });
  await bookSubagentUsage([
    agent(
      's1',
      'a1',
      'general-purpose',
      'claude-sonnet-5-5',
      tokens(5, 100, 9_895),
      '2026-11-10T09:10:00Z'
    ),
    agent(
      's2',
      'a2',
      'general-purpose',
      'claude-sonnet-5-5',
      tokens(5, 100, 19_895),
      '2026-11-10T10:10:00Z'
    ),
    agent('s1', 'a3', 'fork', 'claude-fable-5-2', tokens(2, 50, 49_948), '2026-11-10T09:20:00Z'),
    // Before the period asked for below.
    agent(
      's1',
      'old',
      'general-purpose',
      'claude-sonnet-5-5',
      tokens(1, 1, 999_998),
      '2026-10-01T00:00:00Z'
    ),
  ]);
  // Two Codex threads: their "types" are names, one per run.
  await insertUsageSubagentTurns(
    ['Hypatia', 'Nash'].map((name, index) => ({
      userId: 'user-1',
      sessionId: 's2',
      provider: 'codex' as const,
      turnId: 'codex-turn',
      agentId: `thread-${index}`,
      parentAgentId: null,
      agentType: name,
      model: 'gpt-6.1-sol',
      ...tokens(10, 10, 480),
      costUsd: 0.0005,
    }))
  );
  await pgRun(
    `UPDATE usage_subagent_turns SET created_at = '2026-11-10 08:00:00' WHERE provider = 'codex'`
  );
  // A Pi worker of the bridge, and two calls of a routed agent.
  await turn(
    's1',
    'cli-subagent-x-1',
    'pi',
    'deepseek/deepseek-flash',
    tokens(100, 20, 4_880),
    '2026-11-10T11:00:00Z'
  );
  await turn('s1', 'subagent-r1', 'zai', 'glm-5.3', tokens(300, 10, 690), '2026-11-10T11:30:00Z');
  await turn('s1', 'subagent-r2', 'zai', 'glm-5.3', tokens(300, 10, 690), '2026-11-10T11:31:00Z');
  // Somebody else's.
  await turn(
    'other',
    'cli-subagent-y-1',
    'pi',
    'deepseek/deepseek-flash',
    tokens(1, 1, 999_998),
    '2026-11-10T11:00:00Z',
    'user-2'
  );
});

after(async () => {
  await dropTestSchema();
});

test('agents, bridge workers and routed calls of a period, with their share', async () => {
  const summary = await summariseSubagentUsage('user-1', {
    from: '2026-11-10 00:00:00',
    to: '2026-11-11 00:00:00',
  });
  assert.deepEqual(
    summary.groups.map((group) => [
      group.kind,
      group.provider,
      group.agentType,
      group.model,
      group.runs,
      group.sessions,
      group.totalTokens,
    ]),
    [
      ['agent', 'claude', 'fork', 'claude-fable-5-2', 1, 1, 50_000],
      ['agent', 'claude', 'general-purpose', 'claude-sonnet-5-5', 2, 2, 30_000],
      ['worker', 'pi', '', 'deepseek/deepseek-flash', 1, 1, 5_000],
      ['routed', 'zai', '', 'glm-5.3', 2, 1, 2_000],
      ['agent', 'codex', '', 'gpt-6.1-sol', 2, 1, 1_000],
    ]
  );
  // 88 000 of the 188 000 tokens booked that day: the Claude turn itself is the rest.
  assert.deepEqual(summary.totals, {
    totalTokens: 88_000,
    costUsd: 0.088,
    runs: 8,
    windowTotalTokens: 188_000,
    sharePercent: 46.8,
  });
  assert.equal(summary.groups[0]?.lastUsedAt, '2026-11-10 09:20:00');
});

test('an open period takes everything, and nobody sees another account', async () => {
  const everything = await summariseSubagentUsage('user-1');
  assert.equal(
    everything.groups.find((group) => group.agentType === 'general-purpose')?.runs,
    3,
    'the agent from October counts'
  );
  const other = await summariseSubagentUsage('user-2');
  assert.deepEqual(
    other.groups.map((group) => [group.kind, group.totalTokens]),
    [['worker', 1_000_000]]
  );
  assert.equal(other.totals.sharePercent, 100);
});
