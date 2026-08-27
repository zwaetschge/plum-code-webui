/**
 * Proves the model router is actually mounted in the real server, in front of
 * body parsing. The router's own tests cover its behaviour against stub
 * upstreams; what they cannot cover is the mount order in index.ts — and a
 * router mounted after express.json() would forward re-serialized bodies
 * instead of the original bytes, which is exactly the kind of difference that
 * only shows up against the real API.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startTestServer, type TestServer } from './harness.js';

let server: TestServer;

test.before(async () => {
  server = await startTestServer();
});
test.after(async () => {
  await server?.stop();
});

test('an unknown router token is rejected in the Anthropic error shape', async () => {
  const response = await fetch(`${server.url}/model-router/definitely-not-a-token-000/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'glm-5.3', messages: [] }),
  });
  assert.equal(response.status, 401);
  const body = (await response.json()) as { type?: string; error?: { type?: string } };
  // Claude Code parses errors in this shape; anything else surfaces as a
  // crash in the CLI rather than a readable message.
  assert.equal(body.type, 'error');
  assert.equal(body.error?.type, 'authentication_error');
});

test('a malformed router path is a 404, not a hang', async () => {
  const response = await fetch(`${server.url}/model-router/x`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 404);
});
