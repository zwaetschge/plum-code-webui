import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import jwt from 'jsonwebtoken';
import { io as createClient, type Socket } from 'socket.io-client';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-ws-auth-'));
const jwtSecret = 'websocket-auth-test-jwt-secret-000000000000000';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'websocket-auth-test-session-secret-0000000000000';
process.env.JWT_SECRET = jwtSecret;
process.env.ENCRYPTION_KEY = 'websocket-auth-test-encryption-key-00000000000';
process.env.WEBUI_DATA_DIR = temporaryDirectory;
process.env.WEBUI_SUPPRESS_BOOTSTRAP_CREDENTIAL_LOG = '1';

const { useTestSchema, createTestSchema, dropTestSchema } = await import('../src/db/testing.js');
useTestSchema();
const { run: pgRun } = await import('../src/db/pg.js');
await createTestSchema();
const { disconnectUserSockets, setupWebSocket } = await import('../src/websocket/index.js');
const { revokeUserHttpSessions } = await import('../src/services/SqliteSessionStore.js');

for (const [id, email, name, status] of [
  ['user-a', 'a@example.test', 'A', 'active'],
  ['user-b', 'b@example.test', 'B', 'active'],
  ['user-suspended', 's@example.test', 'S', 'suspended'],
]) {
  await pgRun(
    `INSERT INTO users (id, email, name, provider, provider_id, role, status)
     VALUES (?, ?, ?, 'basic', ?, 'user', ?)`,
    id,
    email,
    name,
    id,
    status
  );
}
await pgRun(
  `INSERT INTO sessions (id, user_id, name, working_directory, status)
   VALUES ('session-a', 'user-a', 'A session', '/tmp', 'stopped')`
);

const httpServer = createServer();
const ioServer = setupWebSocket(httpServer);
await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
const address = httpServer.address();
assert(address && typeof address !== 'string');
const url = `http://127.0.0.1:${address.port}`;

function tokenFor(userId: string): string {
  return jwt.sign({ userId }, jwtSecret, { expiresIn: '5m' });
}

function connect(userId: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = createClient(url, {
      auth: { token: tokenFor(userId) },
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    client.once('connect', () => resolve(client));
    client.once('connect_error', reject);
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for WebSocket state');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const owner = await connect('user-a');
const stranger = await connect('user-b');

const forbidden = new Promise<{ sessionId: string; error: string }>((resolve) => {
  stranger.once('session:error', resolve);
});
stranger.emit('session:subscribe', 'session-a');
assert.match((await forbidden).error, /Forbidden/);

owner.emit('session:subscribe', 'session-a');
await waitUntil(() => (ioServer.sockets.adapter.rooms.get('session:session-a')?.size ?? 0) === 1);

const runnerDenied = new Promise<{ sessionId: string; error: string }>((resolve) => {
  owner.once('session:error', resolve);
});
owner.emit('session:set-mode', { sessionId: 'session-a', mode: 'manual' });
assert.match((await runnerDenied).error, /admin-only/);

const suspendedError = await new Promise<Error>((resolve) => {
  const suspended = createClient(url, {
    auth: { token: tokenFor('user-suspended') },
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  });
  suspended.once('connect_error', (error) => {
    suspended.close();
    resolve(error);
  });
});
assert.match(suspendedError.message, /Account unavailable/);

await pgRun(
  'INSERT INTO http_sessions (sid, data, expires_at) VALUES (?, ?, ?)',
  'passport-user-a',
  JSON.stringify({ cookie: {}, passport: { user: 'user-a' } }),
  Date.now() + 60_000
);
assert.equal(await revokeUserHttpSessions('user-a'), 1);

const disconnected = new Promise<void>((resolve) => owner.once('disconnect', () => resolve()));
await pgRun("UPDATE users SET status = 'suspended' WHERE id = 'user-a'");
assert.equal(await disconnectUserSockets('user-a'), 1);
await disconnected;

stranger.close();
await new Promise<void>((resolve) => ioServer.close(() => resolve()));
await new Promise<void>((resolve) => httpServer.close(() => resolve()));
fs.rmSync(temporaryDirectory, { recursive: true, force: true });
await dropTestSchema();

console.log('websocket authorization regression tests passed');
