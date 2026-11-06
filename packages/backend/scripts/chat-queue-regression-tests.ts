import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'chat-queue-fixture-encryption-key-0000000';
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { run, get } = await import('../src/db/pg.js');
const { safeEncrypt } = await import('../src/utils/encryption.js');
const { writeModelProvidersForUser } = await import('../src/utils/modelProviderKeys.js');
const { createApiChat, startApiTurn, stopApiTurn, apiChatTurns } =
  await import('../src/services/assistant/apiChats.js');
const { apiTurnHash, pumpApiChatQueue } = await import('../src/services/assistant/apiChatQueue.js');
const { createResource, BODY_SCHEMAS } = await import('../src/services/assistant/resources.js');
const { uploadApiImage } = await import('../src/services/assistant/apiFiles.js');
const originalFetch = globalThis.fetch;
const user = 'queue-fixture';
const calls: Record<string, unknown>[] = [];
const releases: Array<() => void> = [];
globalThis.fetch = async (url, init) => {
  assert.equal(
    new URL(String(url)).hostname,
    'queue.fixture.invalid',
    'no paid or external provider'
  );
  const body = JSON.parse(String(init?.body));
  calls.push(body);
  await new Promise<void>((resolve, reject) => {
    releases.push(resolve);
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  return new Response(
    'data: ' +
      JSON.stringify({
        model: 'fixture',
        choices: [
          { index: 0, delta: { content: 'Antwort ' + calls.length }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }) +
      '\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } }
  );
};
async function until(check: () => Promise<boolean> | boolean) {
  const deadline = Date.now() + 10000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Fixture timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
if (!(await testing.databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await testing.createTestSchema();
try {
  await run(
    "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
    user,
    user + '@example.invalid',
    user
  );
  const now = new Date().toISOString();
  await writeModelProvidersForUser(user, [
    {
      id: 'fixture',
      name: 'Fixture',
      enabled: true,
      apiKey: safeEncrypt('fake-key')!,
      baseUrl: 'https://queue.fixture.invalid/v1',
      models: ['fixture'],
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const chat = await createApiChat(user, {
    commandId: randomUUID(),
    title: 'FIFO',
    providerId: 'fixture',
    model: 'fixture',
    sourceIds: [],
  });
  const first = await startApiTurn(user, chat.id, {
    commandId: randomUUID(),
    expectedRevision: chat.revision,
    prompt: 'Erstens',
  });
  await until(() => calls.length === 1);
  const image = await uploadApiImage(user, chat.id, {
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    ),
    originalname: 'fixture.png',
  });
  const source = await createResource(
    user,
    'source',
    'Fixturequelle',
    BODY_SCHEMAS.source.parse({ text: 'QUEUED SOURCE EVIDENCE' })
  );
  const secondInput = {
    commandId: randomUUID(),
    expectedRevision: chat.revision,
    prompt: 'Zweitens',
    reasoningEffort: 'high' as const,
    imageAssetIds: [image.id],
    documentSourceIds: [source.id],
  };
  const second = await startApiTurn(user, chat.id, secondInput);
  const third = await startApiTurn(user, chat.id, {
    commandId: randomUUID(),
    expectedRevision: chat.revision,
    prompt: 'Drittens',
  });
  assert.equal(second.status, 'queued');
  assert.equal(third.status, 'queued');
  assert.deepEqual([first.seq, second.seq, third.seq], [1, 2, 3]);
  assert.equal(
    calls.length,
    1,
    'queued messages never call a model before the active turn finishes'
  );
  assert.equal((await startApiTurn(user, chat.id, secondInput)).id, second.id);
  assert.equal(
    (await apiChatTurns(user, chat.id)).turns.length,
    3,
    'duplicate HTTP delivery stays one queue entry'
  );
  await assert.rejects(
    startApiTurn(user, chat.id, { ...secondInput, prompt: 'Anders' }),
    /anderem Inhalt/
  );
  releases[0]!();
  await until(() => calls.length === 2);
  assert.equal(calls[1]!.reasoning_effort, 'high');
  assert(JSON.stringify(calls[1]!.messages).includes('data:image/png;base64,'));
  assert(JSON.stringify(calls[1]!.messages).includes('QUEUED SOURCE EVIDENCE'));
  assert(
    JSON.stringify(calls[1]!.messages).includes('Antwort 1'),
    'follow-up sees the completed prior answer'
  );
  assert.equal(
    (await apiChatTurns(user, chat.id)).turns.find((t) => t.id === third.id)!.status,
    'queued'
  );
  await stopApiTurn(user, chat.id, third.id);
  releases[1]!();
  await until(
    async () =>
      (await get('SELECT status FROM assistant_api_turns WHERE id=?', second.id)).status ===
      'completed'
  );
  assert.equal(calls.length, 2, 'cancelled queued message never executes');
  const resumeId = randomUUID();
  const resumeInput = {
    commandId: resumeId,
    expectedRevision: chat.revision,
    prompt: 'Nach Neustart',
  };
  await run(
    "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,status,model,profile_json,created_at,updated_at,expires_at) VALUES(?,?,4,?,?,'preparing','fixture',?,?,?,'2000-01-01T00:00:00Z')",
    resumeId,
    chat.id,
    apiTurnHash(chat.id, resumeInput),
    resumeInput.prompt,
    JSON.stringify({ queueInput: resumeInput, queueLease: 'old-process' }),
    now,
    now
  );
  await Promise.all([pumpApiChatQueue(user, chat.id), pumpApiChatQueue(user, chat.id)]);
  await until(() => calls.length === 3);
  await pumpApiChatQueue(user, chat.id);
  assert.equal(calls.length, 3, 'parallel workers claim a recovered entry exactly once');
  releases[2]!();
  await until(
    async () =>
      (await get('SELECT status FROM assistant_api_turns WHERE id=?', resumeId)).status ===
      'completed'
  );
  console.log(
    'PASS: durable FIFO, stable seq/ID, command idempotency, reasoning/images/sources, completed prior context, queued cancellation and stale-lease recovery across competing workers; fake model only'
  );
} finally {
  globalThis.fetch = originalFetch;
  for (const release of releases) release();
  await testing.dropTestSchema();
}
