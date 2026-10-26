import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'apk-fixture-jwt-secret-000000000000';
process.env.ENCRYPTION_KEY = 'apk-fixture-encryption-key-0000000';
const data = await mkdtemp(path.join(tmpdir(), 'plum-apk-gateway-'));
process.env.WEBUI_DATA_DIR = data;
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { run } = await import('../src/db/pg.js');
const { default: router } = await import('../src/routes/app.js');
const { mobileGatewayAuth } = await import('../src/middleware/mobileGateway.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
await testing.createTestSchema();
const bytes = Buffer.from('fixture-apk-exact-bytes');
await mkdir(path.join(data, 'android'));
await writeFile(path.join(data, 'android', 'claude-webui.apk'), bytes);
await writeFile(
  path.join(data, 'android', 'version.json'),
  JSON.stringify({ version: '1.9.6', versionCode: 58 })
);
const app = express();
app.use(
  '/mobile',
  (req, _res, next) => {
    req.headers['x-plum-mobile-gateway'] = '1';
    next();
  },
  mobileGatewayAuth,
  (req, res, next) => {
    if (!req.path.startsWith('/api/app/')) return res.status(404).end();
    next();
  }
);
app.use(['/mobile/api/app', '/api/app'], router);
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
try {
  await run(
    "INSERT INTO users(id,email,provider,provider_id,role) VALUES('apk-owner','apk@example.invalid','test','apk-owner','admin')"
  );
  const headers = {
    Authorization: 'Bearer ' + jwt.sign({ userId: 'apk-owner' }, process.env.JWT_SECRET!),
  };
  assert.equal((await fetch(origin + '/mobile/api/app/version')).status, 401);
  const response = await fetch(origin + '/mobile/api/app/version', { headers });
  assert.equal(response.status, 200);
  const { data: release } = await response.json();
  const link = new URL(release.downloadUrl);
  assert.equal(link.pathname, '/mobile/api/app/download');
  const download = await fetch(link);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.equal((await fetch(origin + '/mobile/api/app/download')).status, 403);
  link.searchParams.set('vc', '59');
  assert.equal((await fetch(link)).status, 403);
  const exp = Date.now() - 1000;
  const sig = createHmac('sha256', process.env.JWT_SECRET!).update(`apk.58.${exp}`).digest('hex');
  assert.equal(
    (await fetch(`${origin}/mobile/api/app/download?vc=58&exp=${exp}&sig=${sig}`)).status,
    403
  );
  assert.equal((await fetch(origin + '/mobile/api/app/version/', { method: 'POST' })).status, 401);
  const web = await fetch(origin + '/api/app/version', { headers });
  assert.equal(new URL((await web.json()).data.downloadUrl).pathname, '/api/app/download');
  console.log(
    'PASS actual mobile gateway/version/download: exact APK without session header, prefix, expired/tampered/unsigned rejection, authenticated metadata and unchanged web path'
  );
} finally {
  server.close();
  await once(server, 'close');
  await testing.dropTestSchema();
  await rm(data, { recursive: true, force: true });
}
