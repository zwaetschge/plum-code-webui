/**
 * Messages, chats and checkpoints — the tables with the most rows and the most
 * call sites, and therefore the ones a botched port would damage first.
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

async function newSession(name: string) {
  return (await server.request('POST', '/api/sessions', { name, workingDirectory: os.tmpdir() }))
    .body.data;
}

test('a fresh session has no messages but a well-formed envelope', async () => {
  const session = await newSession('empty');
  const messages = await server.request('GET', `/api/sessions/${session.id}/messages`);
  assert.equal(messages.status, 200);
  assert.deepEqual(messages.body.data, []);
  // The client resumes from this snapshot; missing fields break reconnects.
  assert.ok(messages.body.snapshot, 'the resume snapshot must always be present');
  assert.equal(messages.body.snapshot.revision, 0);
});

test('a session starts with one chat and can gain another', async () => {
  const session = await newSession('chats');

  const initial = await server.request('GET', `/api/sessions/${session.id}/chats`);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.data.chats.length, 1);
  assert.equal(initial.body.data.activeChatId, 'main');

  const added = await server.request('POST', `/api/sessions/${session.id}/chats`, {
    title: 'Second',
  });
  assert.equal(added.status, 200);
  assert.ok(added.body.data.chats.length >= 2, 'the new chat must appear in the returned list');
});

test('message search answers on an empty session instead of failing', async () => {
  const session = await newSession('search');
  const found = await server.request('GET', `/api/sessions/${session.id}/messages/search?q=hello`);
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.data, []);
});

test('a checkpoint can be created, listed, renamed and deleted', async () => {
  // Regression: the snapshot query selected tool_calls, tool_results, is_partial,
  // is_interrupted, cost_usd and model — none of which exist on `messages`. Every
  // checkpoint creation failed with a 500.
  const session = await newSession('checkpoints');

  const created = await server.request('POST', '/api/checkpoints', {
    sessionId: session.id,
    name: 'before the risky bit',
    description: 'integration',
  });
  assert.equal(created.status, 200, JSON.stringify(created.body).slice(0, 200));
  const id = created.body.data.id;
  assert.ok(id);

  const listed = await server.request('GET', `/api/checkpoints/sessions/${session.id}`);
  assert.equal(listed.status, 200);
  assert.ok((listed.body.data as Array<{ id: string }>).some((c) => c.id === id));

  const renamed = await server.request('PUT', `/api/checkpoints/${id}`, { name: 'renamed' });
  assert.equal(renamed.status, 200);
  const reread = await server.request('GET', `/api/checkpoints/${id}`);
  assert.equal(reread.body.data.name, 'renamed');

  const removed = await server.request('DELETE', `/api/checkpoints/${id}`);
  assert.ok(removed.status === 200 || removed.status === 204);
  const after = await server.request('GET', `/api/checkpoints/sessions/${session.id}`);
  assert.ok(!(after.body.data as Array<{ id: string }>).some((c) => c.id === id));
});

test('a checkpoint for someone else’s session is not found', async () => {
  const refused = await server.request('POST', '/api/checkpoints', {
    sessionId: 'not-a-session',
    name: 'x',
  });
  assert.equal(refused.status, 404);
});

test('usage limits answer for a configured provider', async () => {
  const limits = await server.request('GET', '/api/usage/limits?provider=codex');
  assert.equal(limits.status, 200);
  assert.equal(limits.body.provider, 'codex');
});
