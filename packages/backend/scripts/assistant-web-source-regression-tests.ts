import assert from 'node:assert/strict';
import dns from 'node:dns';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'web-source-fixture-session-secret-000000000';
process.env.JWT_SECRET = 'web-source-fixture-jwt-secret-000000000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, all, closePool } = await import('../src/db/pg.js');
const { publicSourceUrl, isPublicSourceAddress, fetchPublicSource } =
  await import('../src/services/assistant/publicSources.js');
const { importWebSource, configureSourceWatch, sourceWatch, refreshWebSource } =
  await import('../src/services/assistant/webSources.js');
const { BODY_SCHEMAS, createResource, findResource } =
  await import('../src/services/assistant/resources.js');
const { acquireAssistantExecutor } = await import('../src/services/assistant/executor.js');
const { ingestSource } = await import('../src/services/assistant/ingestion.js');
const originalLookup = dns.promises.lookup,
  originalRequest = https.request;
const requests: RequestOptions[] = [];
let encoding = 'identity',
  mimeType = 'text/html';
let address = '8.8.8.8',
  status = 200,
  html =
    '<title>Öffentlicher Beleg</title><nav>NAV OMIT</nav><script>SECRET SCRIPT OMIT</script><article><h1>Dokument</h1><p>Originale Übernahme 10 €.</p></article>',
  hold = false,
  ready: () => void = () => {},
  release: () => void = () => {};
for (const ip of [
  '127.0.0.1',
  '10.1.2.3',
  '172.16.0.1',
  '192.168.1.1',
  '100.64.0.1',
  '169.254.169.254',
  '192.0.2.1',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '::1',
  'fc00::1',
  'fe80::1',
  '::ffff:127.0.0.1',
  '2001:db8::1',
  '2001::1',
  '2002:7f00:1::',
])
  assert.equal(isPublicSourceAddress(ip), false, ip);
for (const ip of ['8.8.8.8', '192.0.78.24', '2606:4700::1111', '2001:4860:4860::8888'])
  assert.equal(isPublicSourceAddress(ip), true, ip);
for (const url of [
  'http://example.invalid',
  'https://localhost',
  'https://127.1',
  'https://0177.0.0.1',
  'https://[::1]',
  'https://user:fixture@example.invalid',
  'https://example.invalid:8443',
])
  assert.throws(() => publicSourceUrl(url));
dns.promises.lookup = (async () => [
  { address, family: 4 },
]) as unknown as typeof dns.promises.lookup;
https.request = ((options: RequestOptions, callback: (reply: IncomingMessage) => void) => {
  requests.push(options);
  assert.equal(
    options.hostname,
    '8.8.8.8',
    'TCP destination must be the validated address, not a second DNS lookup'
  );
  assert.equal(options.servername, 'source.fixture.invalid');
  assert.equal((options.headers as Record<string, string>).Host, 'source.fixture.invalid');
  assert.equal((options.headers as Record<string, string>).Authorization, undefined);
  assert.equal((options.headers as Record<string, string>).Cookie, undefined);
  const request = new EventEmitter() as ClientRequest;
  request.end = (() => {
    process.nextTick(() => {
      const response = new PassThrough() as unknown as IncomingMessage;
      response.statusCode = status;
      response.headers = {
        'content-type': mimeType + '; charset=utf-8',
        'content-encoding': encoding,
      };
      callback(response);
      const raw = Buffer.from(html);
      const bytes =
        encoding === 'gzip'
          ? gzipSync(raw)
          : encoding === 'deflate'
            ? deflateSync(raw)
            : encoding === 'br'
              ? brotliCompressSync(raw)
              : raw;
      release = () => {
        if (!response.destroyed) (response as unknown as PassThrough).end(Buffer.from(bytes));
      };
      if (hold) ready();
      else release();
    });
    return request;
  }) as ClientRequest['end'];
  return request;
}) as unknown as typeof https.request;
try {
  const captured = await fetchPublicSource('https://source.fixture.invalid/article#section');
  assert(captured.text.includes('Originale Übernahme 10 €'));
  assert(!captured.text.includes('OMIT'));
  assert.equal(captured.title, 'Öffentlicher Beleg');
  assert.equal(captured.url, 'https://source.fixture.invalid/article');
  for (const format of ['gzip', 'deflate', 'br']) {
    encoding = format;
    mimeType = 'application/xhtml+xml';
    const decoded = await fetchPublicSource('https://source.fixture.invalid/article');
    assert.equal(decoded.text, captured.text);
    assert.equal(decoded.bytes.toString(), html, 'stored original is the decoded HTTP document');
  }
  const originalHtml = html;
  html = 'x'.repeat(1024 * 1024 + 1);
  encoding = 'gzip';
  await assert.rejects(
    () => fetchPublicSource('https://source.fixture.invalid/article'),
    /überschreitet 1 MB/
  );
  html = originalHtml;
  encoding = 'identity';
  mimeType = 'text/html';
  status = 302;
  await assert.rejects(
    () => fetchPublicSource('https://source.fixture.invalid/article'),
    /leitet weiter/
  );
  status = 200;
  const count = requests.length;
  address = '10.0.0.1';
  await assert.rejects(
    () => fetchPublicSource('https://source.fixture.invalid/article'),
    /nicht öffentliches/
  );
  assert.equal(requests.length, count);
  address = '8.8.8.8';
  console.log(
    'PASS: canonical/private/reserved address guards, DNS pinning with original TLS hostname, credential-free HTTP, no redirects and actual bounded HTML/Unicode extraction'
  );
  if (!(await databaseReachable())) {
    await closePool();
    process.exitCode = 2;
    console.log('NOT RUN: isolated web-source/watch database tests');
  } else
    try {
      await createTestSchema();
      for (const user of ['web-alice', 'web-bob'])
        await run(
          'INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,?,?)',
          user,
          `${user}@fixture.invalid`,
          'test',
          user
        );
      const input = { commandId: randomUUID(), url: 'https://source.fixture.invalid/article' },
        source = await importWebSource('web-alice', input);
      const before = requests.length;
      assert.deepEqual(await importWebSource('web-alice', input), source);
      assert.equal(requests.length, before, 'confirmed import must not refetch');
      const original = await get(
        'SELECT bytes FROM assistant_assets WHERE id=? AND user_id=?',
        source.body.assetId,
        'web-alice'
      );
      assert.equal(Buffer.from(original!.bytes).toString(), html);
      await assert.rejects(() => sourceWatch('web-bob', source.id), /nicht gefunden/);
      const config = {
        commandId: randomUUID(),
        expectedRevision: 1,
        expectedWatchRevision: 0,
        enabled: true,
        intervalMinutes: 60,
      };
      const configured = await configureSourceWatch('web-alice', source.id, config);
      assert.deepEqual(await configureSourceWatch('web-alice', source.id, config), configured);
      await assert.rejects(
        () => configureSourceWatch('web-alice', source.id, { ...config, commandId: randomUUID() }),
        /inzwischen/
      );
      const unchanged = await refreshWebSource('web-alice', source.id, {
        commandId: randomUUID(),
        expectedRevision: 1,
      });
      assert.equal(unchanged.changed, false);
      assert.equal(unchanged.source.revision, 1);
      assert((await sourceWatch('web-alice', source.id)).checkedAt);
      await createResource(
        'web-alice',
        'event-subscription',
        'Beobachtete Änderung',
        BODY_SCHEMAS['event-subscription'].parse({
          sourceId: source.id,
          goal: 'Beleg prüfen',
          enabled: true,
        })
      );
      html = html.replace('10 €', '20 €');
      const refreshId = randomUUID(),
        changed = await refreshWebSource('web-alice', source.id, {
          commandId: refreshId,
          expectedRevision: 1,
        });
      assert.equal(changed.changed, true);
      assert.equal(changed.source.revision, 2);
      assert(changed.source.body.text.includes('20 €'));
      assert.deepEqual(
        await refreshWebSource('web-alice', source.id, {
          commandId: refreshId,
          expectedRevision: 1,
        }),
        changed
      );
      const tasks = await all(
        "SELECT body_json FROM assistant_resources WHERE user_id='web-alice' AND kind='task'"
      );
      assert.equal(tasks.length, 1);
      assert.equal(JSON.parse(tasks[0]!.body_json).status, 'draft');
      assert.equal(JSON.parse(tasks[0]!.body_json).sourceEvent.sourceRevision, 2);
      assert.equal(
        (await all('SELECT id FROM sessions')).length,
        0,
        'source changes must not start a CLI'
      );
      assert(
        Buffer.from(
          (await get('SELECT bytes FROM assistant_assets WHERE id=?', source.body.assetId))!.bytes
        )
          .toString()
          .includes('10 €')
      );
      await acquireAssistantExecutor();
      hold = true;
      html = html.replace('20 €', '30 €');
      const started = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const inFlight = refreshWebSource(
        'web-alice',
        source.id,
        { commandId: randomUUID(), expectedRevision: 2 },
        1
      );
      await started;
      await configureSourceWatch('web-alice', source.id, {
        commandId: randomUUID(),
        expectedRevision: 2,
        expectedWatchRevision: 1,
        enabled: false,
        intervalMinutes: 60,
      });
      release();
      await assert.rejects(() => inFlight, /Beobachtung.*beendet/);
      hold = false;
      assert.equal((await findResource('web-alice', source.id)).revision, 2);
      assert.equal((await sourceWatch('web-alice', source.id)).enabled, false);
      await configureSourceWatch('web-alice', source.id, {
        commandId: randomUUID(),
        expectedRevision: 2,
        expectedWatchRevision: 2,
        enabled: true,
        intervalMinutes: 60,
      });
      const { default: assistantRouter } = await import('../src/routes/assistant.js');
      const { errorHandler } = await import('../src/middleware/errorHandler.js');
      const { config: fixtureConfig } = await import('../src/config.js');
      const app = express();
      app.use(express.json());
      app.use('/api/assistant', assistantRouter);
      app.use(errorHandler);
      const server = await new Promise<import('node:http').Server>((resolve) => {
        const own = app.listen(0, '127.0.0.1', () => resolve(own));
      });
      try {
        const port = (server.address() as import('node:net').AddressInfo).port;
        const token = jwt.sign({ userId: 'web-alice' }, fixtureConfig.jwtSecret, {
          expiresIn: '1m',
        });
        const response = await fetch(
          `http://127.0.0.1:${port}/api/assistant/sources/${source.id}`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: source.title,
              expectedRevision: 2,
              body: { ...changed.source.body, text: 'Eigene Korrektur' },
            }),
          }
        );
        assert.equal(response.status, 200);
        const corrected = await findResource('web-alice', source.id);
        assert.equal(corrected.body.capture, 'public-web');
        assert.equal(corrected.body.text, 'Eigene Korrektur');
        assert.equal(corrected.body.textEdited, true);
        assert.equal(
          (await sourceWatch('web-alice', source.id)).enabled,
          false,
          'manual corrections must atomically pause observation'
        );
        await configureSourceWatch('web-alice', source.id, {
          commandId: randomUUID(),
          expectedRevision: 3,
          expectedWatchRevision: 4,
          enabled: true,
          intervalMinutes: 60,
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      await ingestSource(
        'web-alice',
        {
          buffer: Buffer.from('Eigene ausgewählte Ersatzdatei'),
          originalname: 'replacement.txt',
          mimetype: 'text/plain',
        },
        undefined,
        { id: source.id, expectedRevision: 3 }
      );
      assert.equal((await sourceWatch('web-alice', source.id)).enabled, false);
      console.log(
        'PASS: exact raw HTML originals, durable import/config/refresh receipts, unchanged vs changed revisions, one pinned task draft/no CLI, owner/CAS checks, in-flight stop and file replacement pausing observation'
      );
    } finally {
      await dropTestSchema();
      await closePool();
    }
} finally {
  dns.promises.lookup = originalLookup;
  https.request = originalRequest;
}
