/**
 * The remaining data paths that write to their own tables: notes, categories,
 * settings, gateway tokens and analytics. One server for all of them, because
 * booting costs seconds and they do not interfere.
 *
 * Written to survive the Postgres port unchanged — they assert what a caller
 * observes, never how a row is stored.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { startTestServer, type TestServer } from './harness.js';

let server: TestServer;

test.before(
  async () => {
    server = await startTestServer();
  },
  { timeout: 120_000 }
);

test.after(async () => {
  await server?.stop();
});

test('a note survives a round trip and shows up in the session listing', async () => {
  const session = (
    await server.request('POST', '/api/sessions', { name: 'notes', workingDirectory: os.tmpdir() })
  ).body.data;

  const created = await server.request('POST', '/api/notes', {
    sessionId: session.id,
    content: 'remember this',
  });
  assert.equal(created.status, 200, JSON.stringify(created.body).slice(0, 200));

  const listed = await server.request('GET', `/api/notes?sessionId=${session.id}`);
  assert.equal(listed.status, 200);
  const contents = (listed.body.data as Array<{ content: string }>).map((n) => n.content);
  assert.ok(contents.includes('remember this'));
});

test('a category can be created, listed and removed', async () => {
  const created = await server.request('POST', '/api/categories', { name: 'Integration' });
  assert.ok(created.status === 200 || created.status === 201, `status ${created.status}`);
  const id = created.body.data.id;

  const listed = await server.request('GET', '/api/categories');
  assert.ok((listed.body.data as Array<{ id: string }>).some((c) => c.id === id));

  const removed = await server.request('DELETE', `/api/categories/${id}`);
  assert.ok(removed.status === 200 || removed.status === 204);

  const after = await server.request('GET', '/api/categories');
  assert.ok(!(after.body.data as Array<{ id: string }>).some((c) => c.id === id));
});

test('settings persist across requests', async () => {
  const saved = await server.request('PUT', '/api/settings', { theme: 'dark' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body).slice(0, 200));

  const reread = await server.request('GET', '/api/settings');
  assert.equal(reread.status, 200);
  assert.equal(String(reread.body.data.theme).toLowerCase(), 'dark');
});

test('a gateway token cannot mint another gateway token', async () => {
  // Documented rule: minting credentials stays with a real session, so a
  // supervisor that gets hold of one token cannot widen its own foothold.
  // The harness authenticates with a gateway token, which makes this the
  // natural place to pin it.
  const refused = await server.request('POST', '/api/gateway/tokens', { name: 'nope' });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.code, 'GATEWAY_FORBIDDEN');
});

test('settings survive a save before they were ever read', async () => {
  // Regression: the row is created lazily by GET, and PUT only ran an UPDATE, so
  // the first save of a fresh account matched no row and returned 500.
  const saved = await server.request('PUT', '/api/settings', { theme: 'light' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body).slice(0, 200));
});

test('analytics answers on an empty database instead of failing', async () => {
  // A fresh install has no usage rows; the summary still has to render.
  const summary = await server.request('GET', '/api/analytics/summary');
  assert.equal(summary.status, 200, JSON.stringify(summary.body).slice(0, 200));
});

test('readiness reports the database as healthy', async () => {
  const ready = await server.request('GET', '/health/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.checks.database.ok, true, ready.body.checks.database.detail);
});
