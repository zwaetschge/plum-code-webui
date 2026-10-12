import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'office-fixture-session-secret-000000000000';
process.env.JWT_SECRET = 'office-fixture-jwt-secret-0000000000000000';
process.env.ENCRYPTION_KEY = 'office-fixture-encryption-key-00000000000';
process.env.FRONTEND_URL = 'https://plum.fixture.invalid';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, transaction, closePool } = await import('../src/db/pg.js');
const { issueOfficeTicket, redeemOfficeTicket, officeSession, officeCommandId } =
  await import('../src/services/assistant/officeSessions.js');
const { createApiChat, apiChatTurns } = await import('../src/services/assistant/apiChats.js');
const { findResource, createResource, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const { safeEncrypt } = await import('../src/utils/encryption.js');
const { writeOpenCodeProvidersForUser } = await import('../src/utils/opencodeProviderKeys.js');
const { default: officeRoutes } = await import('../src/routes/office.js');
const { default: assistantRoutes } = await import('../src/routes/assistant.js');
const { requireAuth } = await import('../src/middleware/auth.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { officeSurfaceHeaders, OFFICE_PUBLIC_PATHS } =
  await import('../src/middleware/officeSurface.js');
const nativeFetch = globalThis.fetch;
let wait = false;
const calls: Array<Record<string, unknown>> = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === '127.0.0.1') return nativeFetch(input, init);
  assert.equal(url.hostname, 'office.fixture.invalid', 'No external provider requests');
  calls.push(JSON.parse(String(init?.body)));
  if (wait)
    await new Promise<void>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Fixture abort')), {
        once: true,
      });
      if (init?.signal?.aborted) reject(new Error('Fixture abort'));
    });
  return new Response(
    'data: ' +
      JSON.stringify({
        choices: [{ index: 0, delta: { content: 'Überarbeitete Äpfel' }, finish_reason: 'stop' }],
      }) +
      '\n\ndata: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } }
  );
};
const app = express();
app.use(express.json(), helmet(), officeSurfaceHeaders);
app.use('/api/office', officeRoutes);
app.use('/api/assistant', assistantRoutes);
app.get('/ordinary', requireAuth, (_req, res) => res.json({ success: true }));
app.get([...OFFICE_PUBLIC_PATHS, '/office-connect', '/chat'], (_req, res) => res.send('fixture'));
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
async function http(path: string, token?: string, body?: unknown) {
  const response = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function connect(owner: string) {
  const verifier = randomBytes(32).toString('base64url'),
    challenge = createHash('sha256').update(verifier).digest('base64url');
  const issued = await issueOfficeTicket(owner, challenge, process.env.FRONTEND_URL!);
  return { issued, verifier, ...(await redeemOfficeTicket(issued.ticket, verifier)) };
}
async function settled(chatId: string, turnId: string) {
  for (let n = 0; n < 200; n++) {
    const row = (await apiChatTurns('office-alice', chatId)).turns.find(
      (turn) => turn.id === turnId
    );
    if (row && row.status !== 'running') return row;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Fixture response did not settle');
}
if (!(await databaseReachable())) {
  await closePool();
  server.close();
  throw new Error('Own test database unavailable');
}
try {
  await createTestSchema();
  for (const user of ['office-alice', 'office-bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      user,
      `${user}@fixture.invalid`,
      user
    );
  const stamp = new Date().toISOString();
  await writeOpenCodeProvidersForUser('office-alice', [
    {
      id: 'openai',
      name: 'Office fixture',
      enabled: true,
      apiKey: safeEncrypt('office-fixture-key')!,
      baseUrl: 'https://office.fixture.invalid/v1',
      models: ['gpt-5.5'],
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]);
  await createResource(
    'office-alice',
    'memory',
    'Private memory',
    BODY_SCHEMAS.memory.parse({ text: 'MUST NOT ENTER OFFICE PROMPT' })
  );
  await assert.rejects(
    issueOfficeTicket('office-alice', 'x'.repeat(43), 'https://foreign.fixture.invalid'),
    /Installation/
  );
  const jwtToken = jwt.sign({ userId: 'office-alice' }, process.env.JWT_SECRET!);
  assert.equal(
    (
      await http('/api/assistant/office-tickets', undefined, {
        challenge: 'x'.repeat(43),
        origin: process.env.FRONTEND_URL,
      })
    ).status,
    401
  );
  const ordinaryTicket = await http('/api/assistant/office-tickets', jwtToken, {
    challenge: 'x'.repeat(43),
    origin: process.env.FRONTEND_URL,
  });
  assert.equal(ordinaryTicket.status, 200);
  assert(!JSON.stringify(ordinaryTicket.body).includes(jwtToken));
  const first = await connect('office-alice'),
    second = await connect('office-alice'),
    bob = await connect('office-bob');
  await assert.rejects(
    redeemOfficeTicket(first.issued.ticket, first.verifier),
    /bereits|abgelaufen/
  );
  const nonce = randomBytes(32).toString('base64url'),
    challenge = createHash('sha256').update(nonce).digest('base64url');
  const ticket = await issueOfficeTicket('office-alice', challenge, process.env.FRONTEND_URL!);
  await assert.rejects(redeemOfficeTicket(ticket.ticket, 'z'.repeat(43)), /anderen Dialog/);
  const parallel = await Promise.allSettled([
    redeemOfficeTicket(ticket.ticket, nonce),
    redeemOfficeTicket(ticket.ticket, nonce),
  ]);
  assert.equal(parallel.filter((value) => value.status === 'fulfilled').length, 1);
  assert.equal(
    (await http('/ordinary', first.token)).status,
    401,
    'Office capability cannot authenticate normal APIs'
  );
  assert.equal(
    (await http('/api/office/providers', jwtToken)).status,
    401,
    'Normal JWT does not authenticate Office API'
  );
  const catalog = await http('/api/office/providers', first.token);
  assert.equal(catalog.status, 200);
  assert(!JSON.stringify(catalog.body).includes('fixture-key'));
  assert.deepEqual((await http('/api/office/providers', bob.token)).body.data, []);
  for (const path of OFFICE_PUBLIC_PATHS) {
    const response = await nativeFetch(origin + path);
    assert.equal(response.headers.get('x-frame-options'), null);
    assert(
      response.headers.get('content-security-policy')?.includes('https://*.officeapps.live.com')
    );
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
  const main = await nativeFetch(origin + '/chat');
  assert.equal(main.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert(
    (await nativeFetch(origin + '/office-connect')).headers
      .get('content-security-policy')
      ?.includes("frame-ancestors 'none'")
  );
  const createInput = { commandId: randomUUID(), providerId: 'openai', model: 'gpt-5.5' };
  const duplicates = await Promise.all([
    http('/api/office/chats', first.token, createInput),
    http('/api/office/chats', first.token, createInput),
  ]);
  assert(duplicates.every((value) => value.status === 201));
  assert.deepEqual(duplicates[0]!.body, duplicates[1]!.body);
  const chat = duplicates[0]!.body.data;
  assert.equal(chat.body.temporary, true);
  assert.equal(chat.body.profileId, undefined);
  assert.deepEqual(chat.body.sourceIds, []);
  assert.equal(
    (await http('/api/office/chats', first.token, { ...createInput, model: 'other' })).status,
    409
  );
  const separate = (await http('/api/office/chats', second.token, createInput)).body.data;
  assert.notEqual(chat.id, separate.id, 'Command UUID namespace is per Office connection');
  assert.equal((await http('/api/office/chats/' + chat.id, second.token)).status, 404);
  assert.equal((await http('/api/office/chats/' + chat.id, bob.token)).status, 404);
  const normal = await createApiChat('office-alice', {
    ...createInput,
    commandId: randomUUID(),
    title: 'Ordinary',
    sourceIds: [],
  });
  assert.equal(
    (await http('/api/office/chats/' + normal.id, first.token)).status,
    404,
    'Own ordinary chat is still outside capability scope'
  );
  assert.equal(
    (
      await http('/api/office/chats/' + chat.id + '/turns', first.token, {
        commandId: randomUUID(),
        expectedRevision: 1,
        prompt: 'Original',
        imageAssetIds: [randomUUID()],
      })
    ).status,
    400
  );
  assert.equal(
    (
      await http('/api/office/tasks', first.token, {
        commandId: 'invalid',
        original: 'x',
        instruction: 'x',
      })
    ).status,
    400
  );
  const input = { commandId: randomUUID(), expectedRevision: 1, prompt: 'Ausgewählte Äpfel' };
  const turn = (await http('/api/office/chats/' + chat.id + '/turns', first.token, input)).body
    .data;
  assert.equal((await settled(chat.id, turn.id)).response, 'Überarbeitete Äpfel');
  assert.deepEqual(
    (await http('/api/office/chats/' + chat.id + '/turns', first.token, input)).body.data.id,
    turn.id
  );
  assert.equal(calls.length, 1);
  assert(!JSON.stringify(calls).includes('MUST NOT ENTER'));
  const taskInput = {
    commandId: randomUUID(),
    original: 'Unveränderte Word-Stelle ä',
    instruction: 'Kürzen',
  };
  const drafts = await Promise.all([
    http('/api/office/tasks', bob.token, taskInput),
    http('/api/office/tasks', bob.token, taskInput),
  ]);
  assert(drafts.every((value) => value.status === 201));
  assert.deepEqual(drafts[0]!.body, drafts[1]!.body);
  const draft = drafts[0]!.body.data;
  assert.equal(draft.body.status, 'draft');
  assert.equal(
    draft.body.officeOrigin.selectionHash,
    createHash('sha256').update(taskInput.original).digest('hex')
  );
  assert.equal((await findResource('office-bob', draft.id)).body.goal, draft.body.goal);
  await assert.rejects(findResource('office-alice', draft.id));
  assert.equal(
    (await http('/api/office/tasks', bob.token, { ...taskInput, instruction: 'Different' })).status,
    409
  );
  assert.equal(
    Number((await get('SELECT COUNT(*) AS n FROM sessions')).n),
    0,
    'Task draft does not start CLI'
  );
  // Disconnect while turn acceptance waits on the actual DB owner lock.
  wait = true;
  let locked!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
      locked = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const lock = transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', 'office-alice');
    locked();
    await gate;
  });
  await ready;
  const starting = http('/api/office/chats/' + separate.id + '/turns', second.token, {
    ...input,
    commandId: randomUUID(),
  });
  const scoped = await officeSession(second.token);
  for (let n = 0; n < 200 && !scoped.starts.size; n++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(scoped.starts.size, 1);
  const disconnect = http('/api/office/disconnect', second.token, {});
  for (let n = 0; n < 200 && !scoped.closing; n++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert(scoped.closing);
  release();
  await lock;
  assert.equal((await starting).status, 401);
  assert.equal((await disconnect).status, 200);
  const aborted = (await apiChatTurns('office-alice', separate.id)).turns[0]!;
  assert.equal((await settled(separate.id, aborted.id)).status, 'cancelled');
  assert.equal((await http('/api/office/providers', second.token)).status, 401);
  wait = false;
  const capacity = await Promise.all(
    Array.from({ length: 8 }, () =>
      http('/api/office/chats', first.token, { ...createInput, commandId: randomUUID() })
    )
  );
  assert.equal(capacity.filter((value) => value.status === 201).length, 7);
  assert.equal(capacity.filter((value) => value.status === 429).length, 1);
  await run("UPDATE users SET status='suspended' WHERE id=?", 'office-bob');
  assert.equal((await http('/api/office/providers', bob.token)).status, 401);
  const oldNow = Date.now;
  try {
    Date.now = () => oldNow() + 3600001;
    await assert.rejects(officeSession(first.token), /abgelaufen/);
  } finally {
    Date.now = oldNow;
  }
  assert.notEqual(officeCommandId(scoped, randomUUID()), randomUUID());
  console.log(
    'PASS: real Office HTTP + own PostgreSQL schema; one-use PKCE, account/scope/status, concurrent chat/task UUID receipts, temporary/no-memory context, actual mocked SSE and disconnect/acceptance race, native surface CSP; no Word host or provider called'
  );
} finally {
  globalThis.fetch = nativeFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await dropTestSchema();
}
