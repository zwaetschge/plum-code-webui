import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'personal-workspace-fixture-jwt-0000000000';
process.env.ENCRYPTION_KEY = 'personal-workspace-fixture-key-0000000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const { createPersonalWorkspace } = await import('../src/services/assistant/personalWorkspaces.js');
const { createResource, findResource, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const { bindProfile, buildAssistantContext } = await import('../src/services/assistant/context.js');
const { createApiChat, startApiTurn, apiChatTurns } =
  await import('../src/services/assistant/apiChats.js');
const { writeModelProvidersForUser } = await import('../src/utils/modelProviderKeys.js');
const { safeEncrypt } = await import('../src/utils/encryption.js');
const { default: router } = await import('../src/routes/assistant.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const app = express();
app.use(express.json());
app.use('/api/assistant', router);
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', r));
const address = server.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const realFetch = globalThis.fetch;
let captured = '';
globalThis.fetch = async (url, init) => {
  const target = new URL(String(url));
  if (target.origin === origin) return realFetch(url, init);
  assert.equal(target.hostname, 'personal-docs.fixture.invalid');
  captured = String(init?.body);
  return new Response(
    'data: {"choices":[{"delta":{"content":"Belegübersicht"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } }
  );
};
if (!(await databaseReachable())) {
  server.close();
  await closePool();
  throw new Error('Own test database unavailable');
}
try {
  await createTestSchema();
  for (const id of ['personal-alice', 'personal-bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      id,
      `${id}@fixture.invalid`,
      id
    );
  const packet = { commandId: randomUUID(), preset: 'health' as const, title: 'Meine Befunde' };
  const [a, b] = await Promise.all([
    createPersonalWorkspace('personal-alice', packet),
    createPersonalWorkspace('personal-alice', packet),
  ]);
  assert.equal(a.project.id, b.project.id);
  assert.equal(a.profile.id, b.profile.id);
  assert.equal(a.profile.body.memory, 'off');
  assert.equal(a.profile.body.projectId, a.project.id);
  assert.equal(
    (await get("SELECT count(*)::int AS n FROM assistant_resources WHERE user_id='personal-alice'"))
      .n,
    2
  );
  await assert.rejects(
    () => createPersonalWorkspace('personal-alice', { ...packet, preset: 'finance' }),
    /anderen Inhalt/
  );
  await assert.rejects(() => findResource('personal-bob', a.profile.id), /nicht gefunden/);
  const finance = await createPersonalWorkspace('personal-alice', {
    ...packet,
    commandId: randomUUID(),
    preset: 'finance',
    title: 'Steuerunterlagen',
  });
  const health = await createResource(
    'personal-alice',
    'source',
    'Befund 01.10.2026',
    BODY_SCHEMAS.source.parse({
      projectId: a.project.id,
      text: 'HEALTH_ONLY 01.10.2026, 4.2 mmol/L',
    })
  );
  await createResource(
    'personal-alice',
    'source',
    'Ausgabe',
    BODY_SCHEMAS.source.parse({ projectId: finance.project.id, text: 'FINANCE_ONLY 9 CHF' })
  );
  await createResource(
    'personal-alice',
    'memory',
    'Persönlich',
    BODY_SCHEMAS.memory.parse({ text: 'PERSONAL_MEMORY_SECRET' })
  );
  await createResource(
    'personal-alice',
    'memory',
    'Projekt',
    BODY_SCHEMAS.memory.parse({
      text: 'HEALTH_MEMORY_SECRET',
      scope: 'project',
      projectId: a.project.id,
    })
  );
  await createResource(
    'personal-bob',
    'source',
    'Fremd',
    BODY_SCHEMAS.source.parse({ text: 'BOB_ONLY' })
  );
  await run(
    "INSERT INTO sessions(id,user_id,name,working_directory,cli_provider,surface) VALUES('personal-session','personal-alice','Fixture','/tmp/fixture','codex','chat')"
  );
  await bindProfile('personal-alice', 'personal-session', a.profile.id);
  const context = await buildAssistantContext('personal-session', 'personal-alice');
  assert(context?.includes('HEALTH_ONLY'));
  for (const marker of [
    'FINANCE_ONLY',
    'PERSONAL_MEMORY_SECRET',
    'HEALTH_MEMORY_SECRET',
    'BOB_ONLY',
  ])
    assert(!context?.includes(marker), marker);
  assert(context?.includes('reference ranges'));
  assert(!context?.includes('Trader'));
  const stamp = new Date().toISOString();
  await writeModelProvidersForUser('personal-alice', [
    {
      id: 'openai',
      name: 'Own fixture',
      enabled: true,
      apiKey: safeEncrypt('fixture-only-key')!,
      baseUrl: 'https://personal-docs.fixture.invalid/v1',
      models: ['gpt-5.5'],
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]);
  const chat = await createApiChat('personal-alice', {
    commandId: randomUUID(),
    title: 'Befundfrage',
    providerId: 'openai',
    model: 'gpt-5.5',
    profileId: a.profile.id,
    sourceIds: [],
  });
  const turn = await startApiTurn('personal-alice', chat.id, {
    commandId: randomUUID(),
    expectedRevision: chat.revision,
    prompt: 'Welche Fragen sind offen?',
    imageAssetIds: [],
  });
  let done = false;
  for (let n = 0; n < 200; n++) {
    const rows = await apiChatTurns('personal-alice', chat.id);
    const result = rows.turns.find((r) => r.id === turn.id);
    if (result?.status === 'completed') {
      done = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  assert(done, 'actual stored API turn must complete');
  assert(captured.includes('HEALTH_ONLY'));
  for (const marker of [
    'FINANCE_ONLY',
    'PERSONAL_MEMORY_SECRET',
    'HEALTH_MEMORY_SECRET',
    'BOB_ONLY',
  ])
    assert(!captured.includes(marker), marker);
  const original = await findResource('personal-alice', health.id);
  assert.equal(original.body.text, 'HEALTH_ONLY 01.10.2026, 4.2 mmol/L');
  const headers = {
    authorization: `Bearer ${jwt.sign({ userId: 'personal-alice' }, process.env.JWT_SECRET!)}`,
    'content-type': 'application/json',
  };
  assert.equal(
    (
      await fetch(`${origin}/api/assistant/personal-workspaces`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...packet, preset: 'bank-account', commandId: randomUUID() }),
      })
    ).status,
    400
  );
  const result = await fetch(`${origin}/api/assistant/personal-workspaces`, {
    method: 'POST',
    headers,
    body: JSON.stringify(packet),
  });
  assert.equal(result.status, 200);
  assert.equal(((await result.json()) as any).data.project.id, a.project.id);
  console.log(
    'PASS: own atomic personal document project/profile creation and concurrent/lost-ack UUID, strict HTTP input, unchanged source text/units, actual CLI and API turn scoped project sources with memory off and foreign/private markers excluded; no live account or model call'
  );
} finally {
  globalThis.fetch = realFetch;
  server.close();
  await dropTestSchema();
  await closePool();
}
