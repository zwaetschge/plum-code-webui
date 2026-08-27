/**
 * The session lifecycle over HTTP, against a real server and a real database.
 *
 * This is the coverage that did not exist: 49 regression suites and none of them
 * created a session through the route and checked what came back. Every
 * assertion here is about behaviour a reader of the API depends on — an id that
 * survives a round trip, a filter that actually filters, a delete that deletes —
 * so they hold whether the rows live in SQLite or Postgres.
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

async function createSession(name: string) {
  const created = await server.request('POST', '/api/sessions', {
    name,
    workingDirectory: os.tmpdir(),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 300));
  return created.body.data;
}

test('a created session comes back with what was sent', async () => {
  const session = await createSession('round trip');
  assert.ok(session.id, 'the id is what every later call keys on');
  assert.equal(session.name, 'round trip');
  assert.equal(session.workingDirectory, os.tmpdir());
});

test('a created session is readable individually and in the list', async () => {
  const session = await createSession('listed');

  const single = await server.request('GET', `/api/sessions/${session.id}`);
  assert.equal(single.status, 200);
  assert.equal(single.body.data.id, session.id);

  const list = await server.request('GET', '/api/sessions');
  assert.equal(list.status, 200);
  const ids = (list.body.data as Array<{ id: string }>).map((s) => s.id);
  assert.ok(ids.includes(session.id), 'a session that is not in the list is invisible in the UI');
});

test('renaming persists rather than only echoing back', async () => {
  const session = await createSession('before');
  const updated = await server.request('PUT', `/api/sessions/${session.id}`, { name: 'after' });
  assert.equal(updated.status, 200);

  // Re-read instead of trusting the response: an update that returns the new
  // value without writing it would pass a weaker check.
  const reread = await server.request('GET', `/api/sessions/${session.id}`);
  assert.equal(reread.body.data.name, 'after');
});

test('starring persists', async () => {
  const session = await createSession('star me');
  const starred = await server.request('PATCH', `/api/sessions/${session.id}/star`);
  assert.equal(starred.status, 200);

  const reread = await server.request('GET', `/api/sessions/${session.id}`);
  assert.equal(Boolean(reread.body.data.starred), true);
});

test('a deleted session is gone, not hidden', async () => {
  const session = await createSession('temporary');
  const removed = await server.request('DELETE', `/api/sessions/${session.id}`);
  assert.ok(removed.status === 200 || removed.status === 204, `status ${removed.status}`);

  const reread = await server.request('GET', `/api/sessions/${session.id}`);
  assert.equal(reread.status, 404);

  const list = await server.request('GET', '/api/sessions');
  const ids = (list.body.data as Array<{ id: string }>).map((s) => s.id);
  assert.ok(!ids.includes(session.id));
});

test('an unknown session is a 404, not an empty success', async () => {
  const missing = await server.request('GET', '/api/sessions/does-not-exist');
  assert.equal(missing.status, 404);
});

test('a working directory outside the allowlist is refused', async () => {
  // The path guard is the workspace boundary; a route that skipped it would let
  // a session point at /etc.
  const rejected = await server.request('POST', '/api/sessions', {
    name: 'escape',
    workingDirectory: '/etc',
  });
  assert.ok(rejected.status >= 400, `expected a refusal, got ${rejected.status}`);
});

test('every session route needs credentials', async () => {
  for (const [method, route] of [
    ['GET', '/api/sessions'],
    ['POST', '/api/sessions'],
    ['GET', '/api/sessions/whatever'],
    ['DELETE', '/api/sessions/whatever'],
  ] as const) {
    const anon = await server.anonymous(method, route, {});
    assert.equal(anon.status, 401, `${method} ${route} was not guarded`);
  }
});
