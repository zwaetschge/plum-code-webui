import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  createAgentTranscriptReader,
  findClaudeSubagentDir,
  readClaudeSubagentUsage,
  tokensBeyond,
  totalTokens,
} from './claudeSubagentUsage.js';

const call = (
  id: string,
  model: string,
  usage: [number, number, number, number],
  timestamp = '2026-11-10T08:40:00.000Z'
) =>
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

test('a model call counts once, however many records repeat it', () => {
  const reader = createAgentTranscriptReader();
  // One call written once per content block: the first record still shows the
  // output as it stood when the stream began.
  reader.line(call('msg_1', 'claude-sonnet-5-5', [2, 3, 1000, 50]));
  reader.line(call('msg_1', 'claude-sonnet-5-5', [2, 570, 1000, 50], '2026-11-10T08:41:00.000Z'));
  reader.line(call('msg_2', 'claude-sonnet-5-5', [4, 30, 1050, 0], '2026-11-10T08:42:00.000Z'));
  // What a transcript mostly consists of, and what must not count.
  reader.line(
    JSON.stringify({ type: 'user', message: { content: 'the word "usage" in a prompt' } })
  );
  reader.line(call('msg_3', '<synthetic>', [0, 0, 0, 0]));
  reader.line('{"type":"assistant","message":{"id":"msg_4","usage":{"input_tokens":9'); // cut off

  const result = reader.result();
  assert.deepEqual(
    [...result.byModel],
    [
      [
        'claude-sonnet-5-5',
        { inputTokens: 6, outputTokens: 600, cacheReadTokens: 2050, cacheCreationTokens: 50 },
      ],
    ]
  );
  assert.equal(result.calls, 2);
  assert.equal(result.lastCallAt, '2026-11-10T08:42:00.000Z');
});

test('only what is not booked yet is left to book', () => {
  const current = {
    inputTokens: 10,
    outputTokens: 600,
    cacheReadTokens: 2050,
    cacheCreationTokens: 50,
  };
  const booked = {
    inputTokens: 6,
    outputTokens: 600,
    cacheReadTokens: 1000,
    cacheCreationTokens: 80,
  };
  const left = tokensBeyond(current, booked);
  assert.deepEqual(left, {
    inputTokens: 4,
    outputTokens: 0,
    cacheReadTokens: 1050,
    cacheCreationTokens: 0, // a counter that shrank is never booked back
  });
  assert.equal(totalTokens(left), 1054);
});

test('the agents of a session are found and added up from disk', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'claude-home-'));
  try {
    const sessionId = '37ef1a0d-c461-41db-85d6-48f41f9e2c8a';
    // Stored under the directory the CLI saw, not the one the session records.
    const directory = path.join(home, 'projects', '-mnt-cache-project', sessionId, 'subagents');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, 'agent-a1.jsonl'),
      [
        call('msg_1', 'claude-sonnet-5-5', [2, 100, 1000, 50]),
        call('msg_2', 'claude-sonnet-5-5', [2, 20, 1050, 0], '2026-11-10T08:44:45.000Z'),
      ].join('\n') + '\n'
    );
    writeFileSync(
      path.join(directory, 'agent-a1.meta.json'),
      JSON.stringify({ agentType: 'general-purpose', description: 'Translate locale chunk 06' })
    );
    // An agent on a model that the router books by itself.
    writeFileSync(
      path.join(directory, 'agent-b2.jsonl'),
      call('msg_9', 'glm-5.3', [500, 10, 0, 0]) + '\n'
    );
    writeFileSync(path.join(directory, 'notes.txt'), 'not a transcript');

    assert.equal(await findClaudeSubagentDir(home, sessionId, '/mnt/user/project'), directory);
    assert.equal(await findClaudeSubagentDir(home, '../../etc', null), null);
    assert.equal(await findClaudeSubagentDir(home, 'no-such-session', null), null);

    const all = await readClaudeSubagentUsage(home, sessionId);
    assert.deepEqual(all.map((agent) => agent.agentId).sort(), ['a1', 'b2']);

    const claudeOnly = await readClaudeSubagentUsage(home, sessionId, {
      countsModel: (model) => model.startsWith('claude-'),
    });
    assert.deepEqual(claudeOnly, [
      {
        agentId: 'a1',
        agentType: 'general-purpose',
        description: 'Translate locale chunk 06',
        model: 'claude-sonnet-5-5',
        usage: {
          inputTokens: 4,
          outputTokens: 120,
          cacheReadTokens: 2050,
          cacheCreationTokens: 50,
        },
        calls: 2,
        lastCallAt: '2026-11-10T08:44:45.000Z',
      },
    ]);

    // The agent goes on working: the file is read again and the total grows.
    appendFileSync(
      path.join(directory, 'agent-a1.jsonl'),
      call('msg_3', 'claude-sonnet-5-5', [1, 5, 1100, 0], '2026-11-10T08:50:00.000Z') + '\n'
    );
    const later = await readClaudeSubagentUsage(home, sessionId, {
      countsModel: (model) => model.startsWith('claude-'),
    });
    assert.equal(later[0]?.usage.cacheReadTokens, 3150);
    assert.equal(later[0]?.calls, 3);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
