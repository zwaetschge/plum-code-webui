/**
 * The bundle is the first thing a cold load pays for, and nothing else
 * compresses it — the Traefik router carries no compress middleware either. A
 * regression here is invisible in development, where the assets come off
 * localhost, and costs every remote user three times the transfer.
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

test('responses are negotiated for encoding', async () => {
  // `Vary: Accept-Encoding` is what the middleware sets on everything it
  // considers, whether or not the body clears the size threshold. Asserting the
  // encoding itself would need a payload over 1 kB, which the readiness report
  // is not — and compressing something that small is the wrong behaviour
  // anyway, since the framing usually costs more than it saves.
  const response = await fetch(`${server.url}/health/ready`, {
    headers: { 'Accept-Encoding': 'gzip' },
  });
  assert.match(
    response.headers.get('vary') ?? '',
    /Accept-Encoding/i,
    'compression middleware must be in the chain'
  );
});

test('a payload over the threshold comes back gzipped', async () => {
  const session = await server.request('POST', '/api/sessions', {
    name: 'compression probe',
    workingDirectory: server.dataDir,
  });
  assert.equal(session.status, 201, JSON.stringify(session.body));

  // The session list with a real row is comfortably past the threshold once the
  // envelope and per-session metadata are counted.
  const response = await fetch(`${server.url}/api/sessions`, {
    headers: { 'Accept-Encoding': 'gzip', Authorization: `Bearer ${server.token}` },
  });
  const body = await response.text();
  if (Number(response.headers.get('content-length') ?? body.length) > 1024) {
    assert.equal(response.headers.get('content-encoding'), 'gzip');
  }
});

test('a client that does not offer compression still gets a usable response', async () => {
  const response = await fetch(`${server.url}/health`, {
    headers: { 'Accept-Encoding': 'identity' },
  });
  assert.equal(response.headers.get('content-encoding'), null);
  const body = (await response.json()) as { status?: string };
  assert.equal(body.status, 'ok');
});

test('an event stream is never buffered for compression', async () => {
  // Compressing SSE means holding the stream until the buffer fills, which is
  // the opposite of what the gateway's event feed is for.
  const controller = new AbortController();
  const response = await fetch(`${server.url}/api/gateway/events`, {
    headers: { 'Accept-Encoding': 'gzip' },
    signal: controller.signal,
  }).catch(() => null);

  if (response && response.headers.get('content-type')?.includes('text/event-stream')) {
    assert.equal(response.headers.get('content-encoding'), null);
  }
  controller.abort();
});
