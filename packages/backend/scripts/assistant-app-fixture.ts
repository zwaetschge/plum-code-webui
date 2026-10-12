// Standalone, short-lived test HTTP server. Never starts the product or providers.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'node:crypto';
import { content } from '../../frontend/scripts/fixtures/assistant-app-content.js';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'frame-fixture-session-secret-000000000000';
process.env.JWT_SECRET = 'frame-fixture-jwt-secret-0000000000000000';
process.env.ENCRYPTION_KEY = 'frame-fixture-encryption-key-00000000000';
const { useTestSchema, createTestSchema, dropTestSchema } = await import('../src/db/testing.js');
useTestSchema();
const { run } = await import('../src/db/pg.js');
const { BODY_SCHEMAS, createResource, reviseResource, archiveResource } =
  await import('../src/services/assistant/resources.js');
const { createAppFrame, consumeAppFrame, APP_FRAME_CSP } =
  await import('../src/services/assistant/frames.js');
const { default: assistantRouter } = await import('../src/routes/assistant.js');
const { createAppTask } = await import('../src/services/assistant/appTasks.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const record = process.env.PLUM_APP_FIXTURE_RECORD;
assert(record, 'PLUM_APP_FIXTURE_RECORD is required');
let clean = false;
await createTestSchema();
try {
  for (const id of ['app-alice', 'app-bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES (?,?,'test',?)",
      id,
      `${id}@example.invalid`,
      id
    );
  const artifact = await createResource(
    'app-alice',
    'artifact',
    'Zähler',
    BODY_SCHEMAS.artifact.parse({ type: 'app', format: 'html', content })
  );
  await reviseResource('app-alice', artifact.id, 1, artifact.title, artifact.body);
  const args = { artifactId: artifact.id, revision: 1, channel: 'test:frame', stateEnabled: true };
  await assert.rejects(() => createAppFrame('app-bob', args), /nicht gefunden/);
  await assert.rejects(
    () => createAppFrame('app-alice', { ...args, content: 'edited' }),
    /zuerst.*speichern/
  );
  await assert.rejects(
    () => createAppFrame('app-alice', { ...args, channel: '</script>' }),
    /Ungültige/
  );
  const issued = await createAppFrame('app-alice', args),
    html = await consumeAppFrame(issued.path.split('/').pop()!);
  assert(html.includes('window.Plum=Object.freeze'));
  assert(APP_FRAME_CSP.includes('sandbox allow-scripts'));
  await assert.rejects(() => consumeAppFrame(issued.path.split('/').pop()!), /abgelaufen/);
  const token = randomUUID();
  await run(
    'INSERT INTO assistant_shares(id,user_id,resource_id,revision,token_hash,expires_at,created_at) VALUES (?,?,?,1,?,?,?)',
    randomUUID(),
    'app-alice',
    artifact.id,
    createHash('sha256').update(token).digest('hex'),
    new Date(Date.now() + 60000).toISOString(),
    new Date().toISOString()
  );
  await assert.rejects(
    () => createAppFrame('app-bob', { shareToken: token, channel: 'share', stateEnabled: true }),
    /schreibgeschützt/
  );
  const shared = await createAppFrame('app-bob', {
    shareToken: token,
    channel: 'share',
    stateEnabled: false,
  });
  assert(
    !(await consumeAppFrame(shared.path.split('/').pop()!)).includes('window.Plum=Object.freeze')
  );
  const revoked = await createAppFrame('app-bob', {
    shareToken: token,
    channel: 'share',
    stateEnabled: false,
  });
  await run(
    'UPDATE assistant_shares SET revoked=1 WHERE token_hash=?',
    createHash('sha256').update(token).digest('hex')
  );
  await assert.rejects(() => consumeAppFrame(revoked.path.split('/').pop()!), /nicht verfügbar/);
  const retired = await createResource(
    'app-alice',
    'artifact',
    'Archivierte App',
    BODY_SCHEMAS.artifact.parse({ type: 'app', format: 'html', content })
  );
  const archived = await createAppFrame('app-alice', { ...args, artifactId: retired.id });
  await archiveResource('app-alice', retired.id, 1);
  await assert.rejects(() => consumeAppFrame(archived.path.split('/').pop()!), /nicht verfügbar/);
  const suspended = await createAppFrame('app-alice', args);
  await run("UPDATE users SET status='suspended' WHERE id='app-alice'");
  await assert.rejects(() => consumeAppFrame(suspended.path.split('/').pop()!), /nicht verfügbar/);
  await run("UPDATE users SET status='active' WHERE id='app-alice'");
  const taskInput = {
    commandId: randomUUID(),
    revision: 1,
    title: 'Geprüfter App-Auftrag',
    goal: 'Vom Supervisor geprüftes Ziel.',
  };
  const taskRace = await Promise.all([
    createAppTask('app-alice', artifact.id, taskInput),
    createAppTask('app-alice', artifact.id, taskInput),
  ]);
  assert.deepEqual(taskRace[0], taskRace[1]);
  assert.equal(taskRace[0].body.status, 'draft');
  assert.equal(taskRace[0].body.appOrigin.revision, 1);
  await assert.rejects(
    createAppTask('app-bob', artifact.id, { ...taskInput, commandId: randomUUID() }),
    /gefunden/
  );
  await assert.rejects(
    createAppTask('app-alice', artifact.id, { ...taskInput, goal: 'Geändert' }),
    /anderen Inhalt/
  );
  await assert.rejects(
    createAppTask('app-alice', artifact.id, {
      ...taskInput,
      commandId: randomUUID(),
      revision: 99,
    }),
    /gefunden/
  );
  const actionFrame = await createAppFrame('app-alice', {
      ...args,
      stateEnabled: false,
      actionsEnabled: true,
    }),
    actionHtml = await consumeAppFrame(actionFrame.path.split('/').pop()!);
  assert(actionHtml.includes("proposeTask:proposal=>request('propose-task',proposal)"));
  assert(!actionHtml.includes("loadState:()=>request('load')"));
  await assert.rejects(
    createAppFrame('app-bob', {
      shareToken: token,
      channel: 'share',
      stateEnabled: false,
      actionsEnabled: true,
    }),
    /nicht verfügbar|schreibgeschützt/
  );
  const app = express();
  app.use(express.json());
  app.use('/api/assistant', assistantRouter);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port;
    writeFileSync(
      record,
      JSON.stringify({
        origin: `http://127.0.0.1:${port}`,
        artifact: artifact.id,
        token: jwt.sign({ userId: 'app-alice' }, process.env.JWT_SECRET!, { expiresIn: '10m' }),
      }),
      { mode: 0o600 }
    );
    console.log(
      'READY: isolated app fixture; ownership, one-use, saved-revision, read-only and suspension checks passed'
    );
  });
  const shutdown = async () => {
    if (clean) return;
    clean = true;
    server.close();
    await dropTestSchema();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
} catch (error) {
  await dropTestSchema();
  throw error;
}
