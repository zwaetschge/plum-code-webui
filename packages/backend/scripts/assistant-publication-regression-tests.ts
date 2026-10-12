import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import express from 'express';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'publication-fixture-jwt-000000000000000';
process.env.ENCRYPTION_KEY = 'publication-fixture-key-0000000000000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const { createResource, reviseResource, archiveResource, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const { createPublication, revokePublication, listPublications } =
  await import('../src/services/assistant/publications.js');
const { assistantExportSnapshot } = await import('../src/services/assistant/accountExport.js');
const { default: assistantRouter } = await import('../src/routes/assistant.js');
const { default: publicationRouter } = await import('../src/routes/publications.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const app = express();
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        frameSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);
app.use(express.json());
app.use('/api/assistant', assistantRouter);
app.use('/published', publicationRouter);
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', r));
const address = server.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
process.env.FRONTEND_URL = origin;
if (!(await databaseReachable())) {
  server.close();
  await closePool();
  throw new Error('Own test database unavailable');
}
let serving = false;
try {
  await createTestSchema();
  for (const id of ['release-alice', 'release-bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      id,
      `${id}@fixture.invalid`,
      id
    );
  const asset = randomUUID(),
    bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64'
    );
  await run(
    'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?)',
    asset,
    'release-alice',
    'original.png',
    'image/png',
    createHash('sha256').update(bytes).digest('hex'),
    bytes,
    new Date().toISOString()
  );
  const content = `<h2>Gespeicherte App</h2><img id="original" alt="Privates Original ausdrücklich veröffentlicht" src="/assistant-images/${asset}"><button id="count">Weiter</button><output id="value">0</output><p id="scope"></p><script>let n=0;count.onclick=()=>value.textContent=String(++n);scope.textContent=typeof window.Plum;try{parent.document.body.dataset.escaped='yes';scope.textContent+=' escaped'}catch(e){scope.textContent+=' opaque'};fetch('https://publication-external.fixture.invalid/blocked').catch(()=>{});</script>`;
  const artifact = await createResource(
    'release-alice',
    'artifact',
    'Öffentlicher Zähler',
    BODY_SCHEMAS.artifact.parse({ type: 'app', format: 'html', content })
  );
  const input = {
    commandId: randomUUID(),
    resourceId: artifact.id,
    revision: 1,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    acknowledgePublic: true as const,
  };
  process.env.PLUM_PUBLICATIONS_ENABLED = 'false';
  await assert.rejects(createPublication('release-alice', input), /nicht aktiviert/);
  assert.equal((await fetch(origin + '/published/anything')).status, 503);
  process.env.PLUM_PUBLICATIONS_ENABLED = 'true';
  const [a, b] = await Promise.all([
    createPublication('release-alice', input),
    createPublication('release-alice', input),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(a.path, b.path);
  assert(a.path);
  assert.equal(a.url, origin + a.path);
  process.env.FRONTEND_URL = 'https://plum.zwaetschge-webui.ch';
  assert.equal(
    (await listPublications('release-alice')).items[0].url,
    'https://plum.zwaetschge-webui.ch' + a.path
  );
  process.env.FRONTEND_URL = origin;
  assert.equal((await get('SELECT count(*)::int AS n FROM assistant_publications')).n, 1);
  await assert.rejects(
    createPublication('release-alice', { ...input, revision: 2 }),
    /anderen Inhalt/
  );
  await assert.rejects(
    createPublication('release-bob', { ...input, commandId: randomUUID() }),
    /nicht gefunden/
  );
  assert.deepEqual((await listPublications('release-bob')).items, []);
  await assert.rejects(revokePublication('release-bob', a.id), /nicht gefunden/);
  const before = await fetch(origin + a.path + '/content');
  assert.equal(before.status, 200);
  const html = await before.text();
  assert(html.includes(`data:image/png;base64,${bytes.toString('base64')}`));
  assert(!html.includes('/assistant-images/'));
  assert(!html.includes('proposeTask:'));
  assert(before.headers.get('content-security-policy')?.includes('sandbox allow-scripts'));
  assert.equal(before.headers.get('cache-control'), 'no-store');
  assert.equal(before.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(before.headers.get('x-robots-tag'), 'noindex, nofollow');
  const row = await get(
    'SELECT token_encrypted,token_hash,content_sha256 FROM assistant_publications WHERE id=?',
    a.id
  );
  assert(!row.token_encrypted.includes(a.path.split('/').pop()!));
  assert.equal(row.content_sha256, createHash('sha256').update(html).digest('hex'));
  await reviseResource('release-alice', artifact.id, 1, 'Neue Fassung', {
    ...artifact.body,
    content: 'Changed private version',
  });
  assert.equal(await (await fetch(origin + a.path + '/content')).text(), html);
  const exported = await assistantExportSnapshot('release-alice');
  assert.equal(exported.publications.length, 1);
  assert(!JSON.stringify(exported).includes(row.token_encrypted));
  assert(!JSON.stringify(exported).includes(a.path.split('/').pop()!));
  assert.deepEqual((await assistantExportSnapshot('release-bob')).publications, []);
  await run("UPDATE users SET status='suspended' WHERE id='release-alice'");
  assert.equal((await fetch(origin + a.path)).status, 404);
  await run("UPDATE users SET status='active' WHERE id='release-alice'");
  await revokePublication('release-alice', a.id);
  await revokePublication('release-alice', a.id);
  assert.equal((await fetch(origin + a.path)).status, 404);
  assert.equal((await fetch(origin + a.path + '/content')).status, 404);
  const expired = await createPublication('release-alice', { ...input, commandId: randomUUID() });
  await run(
    'UPDATE assistant_publications SET expires_at=? WHERE id=?',
    new Date(0).toISOString(),
    expired.id
  );
  assert.equal((await fetch(origin + expired.path)).status, 404);
  const archive = await createPublication('release-alice', { ...input, commandId: randomUUID() });
  await archiveResource('release-alice', artifact.id, 2);
  assert.equal((await fetch(origin + archive.path)).status, 404);
  const token = jwt.sign({ userId: 'release-alice' }, process.env.JWT_SECRET!);
  assert.equal(
    (
      await fetch(origin + '/api/assistant/publications', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, commandId: randomUUID(), acknowledgePublic: false }),
      })
    ).status,
    400
  );
  const browserArtifact = await createResource(
    'release-alice',
    'artifact',
    'Öffentlicher Zähler',
    BODY_SCHEMAS.artifact.parse({ type: 'app', format: 'html', content })
  );
  const record = process.env.PLUM_PUBLICATION_FIXTURE_RECORD;
  console.log(
    'PASS: explicit gated public immutable HTML/image snapshot, concurrent/lost-ack receipt and encrypted token, foreign/owner controls, actual anonymous HTTP/CSP/headers, old source revision retained, safe export, suspend/archive/revoke/expiry and strict public acknowledgement'
  );
  if (record) {
    serving = true;
    writeFileSync(record, JSON.stringify({ origin, token, artifact: browserArtifact }), {
      mode: 0o600,
    });
    let clean = false;
    const stop = async () => {
      if (clean) return;
      clean = true;
      server.close();
      await dropTestSchema();
      await closePool();
      process.exit(0);
    };
    process.once('SIGTERM', () => void stop());
    process.once('SIGINT', () => void stop());
  }
} finally {
  if (!serving) {
    server.close();
    await dropTestSchema();
    await closePool();
  }
}
