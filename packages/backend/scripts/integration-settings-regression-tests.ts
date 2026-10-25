import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-fixture-jwt-secret-000000000000';
process.env.ENCRYPTION_KEY = 'integration-fixture-encryption-key-0000000';
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { run, get } = await import('../src/db/pg.js');
const { default: settingsRouter } = await import('../src/routes/settings.js');
const { default: comfyRouter } = await import('../src/routes/comfyui.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
if (!(await testing.databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await testing.createTestSchema();
const app = express();
app.use(express.json());
app.use('/api/settings', settingsRouter);
app.use('/api/comfyui', comfyRouter);
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No HTTP fixture port');
const origin = `http://127.0.0.1:${address.port}`;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const requestUrl = new URL(String(input));
  if (requestUrl.hostname === 'fixture.invalid') {
    assert.equal(requestUrl.pathname, '/native/system_stats');
    return Response.json({ system: { comfyui_version: 'fixture' }, devices: [] });
  }
  assert.equal(requestUrl.origin, origin, 'test may only contact its local HTTP fixture');
  return nativeFetch(input, init);
};
const headers = (user: string) => ({
  Authorization: 'Bearer ' + jwt.sign({ userId: user }, process.env.JWT_SECRET!),
  'Content-Type': 'application/json',
});
try {
  for (const [id, role] of [
    ['integration-admin', 'admin'],
    ['integration-user', 'user'],
  ])
    await run(
      "INSERT INTO users(id,email,provider,provider_id,role) VALUES(?,?,'test',?,?)",
      id,
      id + '@example.invalid',
      id,
      role
    );
  const web = '/api/settings/integrations';
  assert.equal((await fetch(origin + web)).status, 401);
  let response = await fetch(origin + web, { headers: headers('integration-admin') });
  assert.deepEqual(
    (await response.json()).data,
    { comfyuiUrl: '', loraTesterUrl: '' },
    'awaited strings, not serialized Promise objects'
  );
  response = await fetch(origin + web, {
    method: 'PUT',
    headers: headers('integration-user'),
    body: JSON.stringify({ comfyuiUrl: 'https://fixture.invalid' }),
  });
  assert.equal(response.status, 403);
  response = await fetch(origin + web, {
    method: 'PUT',
    headers: headers('integration-admin'),
    body: JSON.stringify({
      comfyuiUrl: ' https://fixture.invalid/comfy ',
      loraTesterUrl: 'https://fixture.invalid/lora',
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    comfyuiUrl: 'https://fixture.invalid/comfy',
    loraTesterUrl: 'https://fixture.invalid/lora',
  });
  assert.equal(
    (await get("SELECT value FROM app_config WHERE key='comfyui_url'")).value,
    'https://fixture.invalid/comfy',
    'writes complete before response'
  );
  response = await fetch(origin + '/api/comfyui/settings', {
    headers: headers('integration-admin'),
  });
  assert.equal(
    (await response.json()).data.url,
    'https://fixture.invalid/comfy',
    'Android endpoint sees Web save immediately'
  );
  response = await fetch(origin + '/api/comfyui/settings', {
    method: 'PUT',
    headers: headers('integration-admin'),
    body: JSON.stringify({ url: 'https://fixture.invalid/native' }),
  });
  assert.equal(response.status, 200);
  response = await fetch(origin + web, { headers: headers('integration-admin') });
  assert.equal(
    (await response.json()).data.comfyuiUrl,
    'https://fixture.invalid/native',
    'Web endpoint sees Android save'
  );
  response = await fetch(origin + web, {
    method: 'PUT',
    headers: headers('integration-admin'),
    body: JSON.stringify({ comfyuiUrl: null }),
  });
  assert.deepEqual(
    (await response.json()).data,
    { comfyuiUrl: '', loraTesterUrl: 'https://fixture.invalid/lora' },
    'clear only submitted setting'
  );
  response = await fetch(origin + web, {
    method: 'PUT',
    headers: headers('integration-admin'),
    body: JSON.stringify({ comfyuiUrl: {} }),
  });
  assert.equal(response.status, 400);
  response = await fetch(origin + web, { headers: headers('integration-admin') });
  const final = (await response.json()).data;
  assert.equal(typeof final.comfyuiUrl, 'string');
  assert.equal(typeof final.loraTesterUrl, 'string');
  console.log(
    'PASS: integration settings return strings, await saves, preserve other values, reject invalid input; Web/Android round trip; isolated PostgreSQL+HTTP only, no ComfyUI/model called'
  );
} finally {
  globalThis.fetch = nativeFetch;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  await testing.dropTestSchema();
}
