/**
 * What a connected client sees when the server is restarted.
 *
 * After a restart Plum resumes the runs it cut off. The open chat only shows
 * that if its socket comes back, and a socket.io client does not come back
 * from a socket the server ended with a DISCONNECT packet — it waits for the
 * page to call connect(). The real shutdown path is exercised here: a child
 * process, SIGTERM, and a client that must be left in a state it retries from.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { io as connect } from 'socket.io-client';

import { startTestServer } from './harness.js';

const until = async (condition: () => boolean, ms: number) => {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  return condition();
};

test('a restart leaves connected clients retrying on their own', async () => {
  const server = await startTestServer();
  const client = connect(server.url, {
    auth: { token: server.token },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 100,
    reconnectionDelayMax: 300,
  });
  const reasons: string[] = [];
  const refusals: string[] = [];
  let connects = 0;
  client.on('connect', () => connects++);
  client.on('disconnect', (reason) => reasons.push(reason));
  client.on('connect_error', (error) => {
    // Only an answer from the server's handshake carries a message of its own.
    if (!client.active) refusals.push(error.message);
  });
  let stopped = false;
  try {
    assert.ok(await until(() => connects === 1, 10_000), `socket connects\n${server.logs()}`);

    const stopStarted = Date.now();
    await server.stop();
    stopped = true;
    const stopMs = Date.now() - stopStarted;

    assert.ok(await until(() => reasons.length >= 1, 3000), 'the client notices the shutdown');
    assert.notEqual(reasons[0], 'io server disconnect');
    assert.equal(client.active, true, 'the client keeps retrying without help from the page');
    assert.deepEqual(refusals, [], 'no retry was answered with a refusal by the stopping server');
    // A drain that waits for its own sockets runs into the forced exit instead.
    assert.doesNotMatch(server.logs(), /Grace period elapsed/);
    assert.ok(stopMs < 5000, `shutdown took ${stopMs} ms`);
  } finally {
    client.close();
    if (!stopped) await server.stop();
  }
});
