import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'compaction-fixture-encryption-key-000000';
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { run, get, all } = await import('../src/db/pg.js');
const { safeEncrypt } = await import('../src/utils/encryption.js');
const { writeModelProvidersForUser } = await import('../src/utils/modelProviderKeys.js');
const { createApiChat, startApiTurn, apiChatTurns, stopApiTurn } =
  await import('../src/services/assistant/apiChats.js');
const { createResource, BODY_SCHEMAS } = await import('../src/services/assistant/resources.js');
const { forgetMemory } = await import('../src/services/assistant/memory.js');
const { compactChatHistory } = await import('../src/services/assistant/chatCompaction.js');
const { CHAT_OPTIONS } = await import('../src/services/assistant/chatOptions.js');
const originalFetch = globalThis.fetch;
const user = 'compaction-owner';
const requests: Array<{
  compact: boolean;
  body: Record<string, unknown>;
  excerpts: Array<{ id: string; user: string }>;
}> = [];
let blockCompaction = false;
globalThis.fetch = async (input, init) => {
  assert.equal(
    new URL(String(input)).hostname,
    'compaction.fixture.invalid',
    'no real provider or Claude API'
  );
  const body = JSON.parse(String(init?.body));
  const system = String(body.messages?.[0]?.content ?? '');
  const compact = system.startsWith('Plum transcript compaction.');
  const excerpts = compact ? JSON.parse(body.messages.at(-1).content) : [];
  requests.push({ compact, body, excerpts });
  if (compact && blockCompaction)
    await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
    });
  const content = compact
    ? 'Confirmed source excerpts: ' +
      excerpts.map((e: { user: string }) => e.user.slice(0, 80)).join(' / ')
    : 'Primary result';
  return new Response(
    'data: ' +
      JSON.stringify({
        model: 'fixture',
        choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: compact ? 7 : 11, completion_tokens: compact ? 3 : 5 },
      }) +
      '\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } }
  );
};
async function until(check: () => Promise<boolean> | boolean) {
  const deadline = Date.now() + 10000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Fixture timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function settled(chatId: string, turnId: string) {
  await until(
    async () =>
      !['running', 'queued'].includes(
        (await get('SELECT status FROM assistant_api_turns WHERE id=?', turnId)).status
      )
  );
  return (await apiChatTurns(user, chatId)).turns.find((turn) => turn.id === turnId)!;
}
if (!(await testing.databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await testing.createTestSchema();
try {
  const now = new Date().toISOString();
  await run(
    "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
    user,
    user + '@example.invalid',
    user
  );
  await writeModelProvidersForUser(user, [
    {
      id: 'fixture',
      name: 'Fixture',
      enabled: true,
      apiKey: safeEncrypt('fake-key')!,
      baseUrl: 'https://compaction.fixture.invalid/v1',
      models: ['fixture'],
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const chat = await createApiChat(user, {
    commandId: randomUUID(),
    title: 'Long chat',
    providerId: 'fixture',
    model: 'fixture',
    sourceIds: [],
    chatOptions: { contextTurns: 2 },
  });
  const seed: string[] = [];
  for (let seq = 1; seq <= 3; seq++) {
    const id = randomUUID();
    seed.push(id);
    await run(
      "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,created_at,updated_at,expires_at) VALUES(?,?,?,'fixture',?,?,'completed','fixture','{}',?,?,?)",
      id,
      chat.id,
      seq,
      seq === 1 ? 'EARLY_PRIVATE_GOAL' : 'Goal ' + seq,
      'Answer ' + seq,
      now,
      now,
      now
    );
  }
  const send = async (prompt: string) =>
    settled(
      chat.id,
      (
        await startApiTurn(user, chat.id, {
          commandId: randomUUID(),
          expectedRevision: chat.revision,
          prompt,
        })
      ).id
    );
  const first = await send('Now');
  assert.equal(first.status, 'completed');
  assert.equal(first.compaction?.coveredTurns, 1);
  assert(first.compaction?.summary.includes('EARLY_PRIVATE_GOAL'));
  assert.equal(first.usage?.input, 18, 'summary and primary usage are summed');
  assert.equal(first.usage?.output, 8);
  assert.equal(
    (await all('SELECT id FROM assistant_api_usage WHERE chat_id=?', chat.id)).length,
    2,
    'one row per actual model attempt'
  );
  assert(
    requests
      .filter((r) => !r.compact)
      .some((r) => JSON.stringify(r.body).includes('EARLY_PRIVATE_GOAL')),
    'primary receives the confirmed continuation note'
  );
  const stored = await get(
    'SELECT workbench_json,profile_json FROM assistant_api_turns WHERE id=?',
    first.id
  );
  assert.equal(
    JSON.parse(stored.workbench_json).compaction.summary,
    '',
    'receipt stores a checkpoint reference, not another fact copy'
  );
  assert(!stored.profile_json.includes('EARLY_PRIVATE_GOAL'));
  await assert.rejects(apiChatTurns('another-owner', chat.id), /nicht gefunden/);
  const second = await send('Next');
  assert.equal(second.compaction?.coveredTurns, 2);
  assert.deepEqual(
    requests
      .filter((r) => r.compact)
      .at(-1)!
      .excerpts.map((e) => e.id),
    [seed[1]],
    'rolling compaction processes only the newly omitted source'
  );
  const beforeReuse = requests.length;
  const reused = await compactChatHistory({
    userId: user,
    chatId: chat.id,
    turnId: second.id,
    beforeSeq: 3,
    providerId: 'fixture',
    model: 'fixture',
    signal: new AbortController().signal,
    workbench: { sources: [], toolEvents: [], comparisons: [], documentSourceIds: [] },
    onUpdate: async () => {},
    onUsage: async () => {
      throw new Error('Cache reuse must not bill a new call');
    },
  });
  assert.equal(reused.attempted, false);
  assert.equal(requests.length, beforeReuse);
  assert.equal(reused.usage.input, 0);
  await run('UPDATE assistant_api_turns SET hidden_by=? WHERE id=?', 'branch', seed[0]);
  const branched = await send('Branch context');
  assert(
    !branched.compaction?.summary.includes('EARLY_PRIVATE_GOAL'),
    'a changed visible prefix cannot reuse a stale checkpoint'
  );
  const fact = await createResource(
    user,
    'memory',
    'Forget origin',
    BODY_SCHEMAS.memory.parse({
      text: 'EARLY_PRIVATE_GOAL',
      origins: [{ type: 'api', id: chat.id, turnId: seed[0], quote: 'EARLY_PRIVATE_GOAL' }],
    })
  );
  await forgetMemory(user, fact.id, fact.revision);
  assert.equal(
    Number(
      (await get('SELECT COUNT(*) AS n FROM assistant_api_compactions WHERE user_id=?', user)).n
    ),
    0
  );
  const forgotten = (await apiChatTurns(user, chat.id)).turns.find((t) => t.id === first.id)!;
  assert.equal(forgotten.compaction?.summary, '');
  assert.equal(forgotten.compaction?.status, 'failed');
  await run('UPDATE assistant_api_turns SET hidden_by=NULL WHERE id=?', seed[0]);
  await send('After forgetting');
  assert(
    !requests
      .filter((r) => r.compact)
      .at(-1)!
      .excerpts.some((e) => e.id === seed[0]),
    'forgotten origin stays out even when the original message remains visible'
  );
  const bounded = await createApiChat(user, { commandId: randomUUID(), title: 'Bounded coverage', providerId: 'fixture', model: 'fixture', sourceIds: [], chatOptions: { contextTurns: 1 } });
  for (let seq = 1; seq <= 10; seq++) await run("INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,created_at,updated_at,expires_at) VALUES(?,?,?,'fixture',?,?,'completed','fixture','{}',?,?,?)", randomUUID(), bounded.id, seq, 'U'.repeat(20000), 'A'.repeat(40000), now, now, now);
  const beforeBounded = requests.filter((r) => r.compact).length;
  const boundedTurn = await settled(bounded.id, (await startApiTurn(user, bounded.id, { commandId: randomUUID(), expectedRevision: bounded.revision, prompt: 'Bounded answer' })).id);
  assert.equal(requests.filter((r) => r.compact).length - beforeBounded, 4, 'at most four compaction calls per answer');
  assert.equal(boundedTurn.compaction?.coveredTurns, 8);
  assert.equal(boundedTurn.compaction?.remainingTurns, 2, 'coverage gaps remain explicit');
  assert.equal(boundedTurn.compaction?.truncatedTurnIds.length, 8, 'clipped source excerpts are declared');
  assert.equal(boundedTurn.usage?.input, 39);
  blockCompaction = true;
  const beforeStop = requests.length;
  const stopped = await startApiTurn(user, chat.id, {
    commandId: randomUUID(),
    expectedRevision: chat.revision,
    prompt: 'Stop while compacting',
  });
  await until(() => requests.length > beforeStop);
  await stopApiTurn(user, chat.id, stopped.id);
  await until(
    async () =>
      (await get('SELECT status FROM assistant_api_turns WHERE id=?', stopped.id)).status ===
      'cancelled'
  );
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(
    requests.length,
    beforeStop + 1,
    'stopping compaction cannot launch the primary model afterwards'
  );
  assert.equal(
    (await all('SELECT id FROM assistant_api_usage WHERE id=?', stopped.id)).length,
    0,
    'a primary request that never started is not counted'
  );
  assert.equal(CHAT_OPTIONS.parse({}).autoCompact, true);
  console.log(
    'PASS: source-checked rolling compaction uses selected model, injects actual notes, bills exact attempts, reuses checkpoints without rebilling, invalidates changed branches, purges forgotten facts and stops before a primary request; fixtures only'
  );
} finally {
  globalThis.fetch = originalFetch;
  await testing.dropTestSchema();
}
