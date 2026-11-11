import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { createTestSchema, dropTestSchema, useTestSchema } from '../../db/testing.js';

useTestSchema();

const { all: pgAll, run: pgRun } = await import('../../db/pg.js');
const { bookClaudeSubagentUsage, countsForProvider, reconcileClaudeSubagentUsage } =
  await import('./claudeSubagentBooking.js');

const home = mkdtempSync(path.join(os.tmpdir(), 'claude-home-'));
const CLAUDE_SESSION = '37ef1a0d-c461-41db-85d6-48f41f9e2c8a';
const CHAT_SESSION = '51e43494-9ffb-4f2b-ac01-2c9d6cbe0deb';

const call = (id: string, model: string, usage: number[], timestamp: string) =>
  JSON.stringify({
    type: 'assistant',
    timestamp,
    message: {
      id,
      model,
      usage: {
        input_tokens: usage[0],
        output_tokens: usage[1],
        cache_read_input_tokens: usage[2],
        cache_creation_input_tokens: usage[3],
      },
    },
  });

function agentFile(claudeSessionId: string, agentId: string): string {
  const directory = path.join(home, 'projects', '-tmp-project', claudeSessionId, 'subagents');
  mkdirSync(directory, { recursive: true });
  return path.join(directory, `agent-${agentId}.jsonl`);
}

const ledger = () =>
  pgAll(
    `SELECT turn_id AS "turnId", model, total_tokens::int AS total, created_at AS "createdAt"
       FROM usage_history WHERE session_id = 'plum-1' ORDER BY turn_id`
  ) as Promise<Array<{ turnId: string; model: string; total: number; createdAt: string }>>;

before(async () => {
  await createTestSchema();
  await pgRun(
    `INSERT INTO users (id, email, name, provider, provider_id)
     VALUES ('user-1', 'agents@example.test', 'A', 'local', 'user-1')`
  );
  await pgRun(
    `INSERT INTO sessions (id, user_id, name, working_directory, cli_provider, claude_session_id)
     VALUES ('plum-1', 'user-1', 'S', '/tmp/project', 'claude', ?)`,
    CLAUDE_SESSION
  );
  await pgRun(
    `INSERT INTO session_chats (id, session_id, title, provider_session_id)
     VALUES ('chat-2', 'plum-1', 'Second', ?)`,
    CHAT_SESSION
  );
});

after(async () => {
  await dropTestSchema();
  rmSync(home, { recursive: true, force: true });
});

const booking = (bookingId: string) => ({
  sessionId: 'plum-1',
  userId: 'user-1',
  provider: 'claude' as const,
  claudeSessionId: CLAUDE_SESSION,
  workingDirectory: '/tmp/project',
  bookingId,
  configHome: home,
});

test('an agent is booked once, and again only for what it spent since', async () => {
  writeFileSync(
    agentFile(CLAUDE_SESSION, 'a1'),
    call('msg_1', 'claude-sonnet-5-5', [2, 100, 1000, 50], '2026-11-10T08:43:00.000Z') + '\n'
  );
  writeFileSync(
    agentFile(CLAUDE_SESSION, 'a1').replace('.jsonl', '.meta.json'),
    JSON.stringify({ agentType: 'general-purpose', description: 'Translate' })
  );
  // On a routed model: the router has written this usage already.
  writeFileSync(
    agentFile(CLAUDE_SESSION, 'glm'),
    call('msg_g', 'glm-5.3', [500, 10, 0, 0], '2026-11-10T08:43:10.000Z') + '\n'
  );

  assert.equal(await bookClaudeSubagentUsage(booking('turn-1')), 1);
  // The same turn booked again (a shutdown flush, a retry): nothing new.
  assert.equal(await bookClaudeSubagentUsage(booking('turn-1')), 0);
  assert.equal(await bookClaudeSubagentUsage(booking('turn-2')), 0);

  // The agent works on after its turn was booked.
  appendFileSync(
    agentFile(CLAUDE_SESSION, 'a1'),
    call('msg_2', 'claude-sonnet-5-5', [1, 20, 1100, 0], '2026-11-10T08:50:00.000Z') + '\n'
  );
  // Two bookings racing for the same gap must not both write it.
  const written = await Promise.all([
    bookClaudeSubagentUsage(booking('turn-3')),
    bookClaudeSubagentUsage(booking('turn-3b')),
  ]);
  assert.deepEqual(written, [1, 0]);

  const rows = await ledger();
  assert.deepEqual(
    rows.map((row) => [row.turnId, row.model, row.total]),
    [
      ['agent:a1:turn-1', 'claude-sonnet-5-5', 1152],
      ['agent:a1:turn-3', 'claude-sonnet-5-5', 1121],
    ]
  );
  const split = (await pgAll(
    `SELECT agent_id AS "agentId", agent_type AS "agentType", SUM(total_tokens)::int AS total,
            SUM(cost_usd) > 0 AS priced
       FROM usage_subagent_turns WHERE session_id = 'plum-1' GROUP BY 1, 2`
  )) as Array<Record<string, unknown>>;
  assert.deepEqual(split, [
    { agentId: 'a1', agentType: 'general-purpose', total: 2273, priced: true },
  ]);
});

test('a session on one endpoint for everything counts every model', () => {
  assert.equal(countsForProvider('claude')('glm-5.3'), false);
  assert.equal(countsForProvider('claude')('claude-fable-5-2'), true);
  assert.equal(countsForProvider('zai')('glm-5.3'), true);
});

test('usage found after the fact lands on the day it was spent', async () => {
  // An agent of the session's second chat, never booked while it ran.
  writeFileSync(
    agentFile(CHAT_SESSION, 'f9'),
    call('msg_f', 'claude-fable-5-2', [2, 300, 780000, 9000], '2026-11-03T01:22:13.458Z') + '\n'
  );
  // Its transcript last changed ten days ago. The pass at boot reads only what
  // changed in the last days; the one-off pass over everything finds it.
  const tenDaysAgo = (Date.now() - 10 * 86_400_000) / 1000;
  utimesSync(agentFile(CHAT_SESSION, 'f9'), tenDaysAgo, tenDaysAgo);
  assert.deepEqual(await reconcileClaudeSubagentUsage({ configHome: home }), {
    sessions: 0,
    rows: 0,
  });
  const first = await reconcileClaudeSubagentUsage({ configHome: home, days: 30 });
  assert.deepEqual(first, { sessions: 1, rows: 1 });
  // Nothing is left for a second pass.
  assert.deepEqual(await reconcileClaudeSubagentUsage({ configHome: home, days: 30 }), {
    sessions: 0,
    rows: 0,
  });

  const found = (await ledger()).find((row) => row.turnId.startsWith('agent:f9:reconcile:'));
  assert.equal(found?.total, 789302);
  assert.equal(found?.createdAt, '2026-11-03 01:22:13');
});

test('transcripts of an id the session has left behind are found by their project', async () => {
  // A session starts a new Claude Code session now and then; Plum keeps the
  // current id only. This one is from before, in the same project directory.
  const FORMER = '7c4b5b49-0000-4000-8000-000000000001';
  writeFileSync(
    agentFile(FORMER, 'old1'),
    call('msg_o', 'claude-opus-5-5', [3, 400, 90000, 2000], '2026-10-12T16:50:00.000Z') + '\n'
  );
  const pass = () => reconcileClaudeSubagentUsage({ configHome: home, days: 400 });

  // The session booked nothing around that time: it may not be its transcript.
  assert.deepEqual(await pass(), { sessions: 0, rows: 0 });

  // With a turn of its own on that day it is.
  await pgRun(
    `INSERT INTO usage_history (user_id, session_id, provider, turn_id, total_tokens, created_at)
     VALUES ('user-1', 'plum-1', 'claude', 'turn-then', 1000, '2026-10-12 17:05:00')`
  );
  assert.deepEqual(await pass(), { sessions: 1, rows: 1 });
  const found = (await ledger()).find((row) => row.turnId.startsWith('agent:old1:'));
  assert.equal(found?.total, 92403);
  assert.equal(found?.createdAt, '2026-10-12 16:50:00');

  // Two sessions in one directory: nobody can say whose transcript it is.
  const OTHER = '7c4b5b49-0000-4000-8000-000000000002';
  writeFileSync(
    agentFile(OTHER, 'old2'),
    call('msg_p', 'claude-opus-5-5', [1, 10, 500, 0], '2026-10-12 16:55:00.000Z') + '\n'
  );
  await pgRun(
    `INSERT INTO sessions (id, user_id, name, working_directory, cli_provider)
     VALUES ('plum-2', 'user-1', 'Other', '/tmp/project', 'codex')`
  );
  assert.deepEqual(await pass(), { sessions: 0, rows: 0 });
});
