import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import jwt from 'jsonwebtoken';
import { io as createClient, type Socket } from 'socket.io-client';

type SendAck =
  | { clientMessageId: string; chatId?: string | null; status: 'accepted'; acceptedAt: string }
  | {
      clientMessageId: string;
      chatId?: string | null;
      status: 'rejected';
      error: string;
      retryable: boolean;
    };

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-ws-send-ack-'));
const jwtSecret = 'websocket-send-ack-test-jwt-secret-000000000';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'websocket-send-ack-session-secret-0000000000';
process.env.JWT_SECRET = jwtSecret;
process.env.ENCRYPTION_KEY = 'websocket-send-ack-encryption-key-000000000';
process.env.WEBUI_DATA_DIR = temporaryDirectory;
process.env.WEBUI_SUPPRESS_BOOTSTRAP_CREDENTIAL_LOG = '1';
process.env.WEBUI_EXTERNAL_SKILL_SYNC = 'false';

const { useTestSchema, createTestSchema, dropTestSchema } = await import(
  '../src/db/testing.js'
);
useTestSchema();
const { getProcessManager, setupWebSocket } = await import('../src/websocket/index.js');
const { all: pgAll, get: pgGet, run: pgRun } = await import('../src/db/pg.js');

await createTestSchema();
await pgRun(
  `INSERT INTO users (id, email, name, provider, provider_id, role, status)
     VALUES ('send-user', 'send@example.test', 'Send Test', 'basic', 'send-user', 'admin', 'active')`
);
await pgRun(
  `INSERT INTO users (id, email, name, provider, provider_id, role, status)
     VALUES ('other-user', 'other@example.test', 'Other', 'basic', 'other-user', 'user', 'active')`
);
await pgRun(
  `INSERT INTO sessions (id, user_id, name, working_directory, status)
     VALUES ('other-session', 'other-user', 'Other session', '/tmp', 'stopped')`
);
await pgRun(
  `INSERT INTO sessions (id, user_id, name, working_directory, status)
     VALUES ('send-session', 'send-user', 'Send session', '/tmp', 'stopped')`
);
await pgRun(
  `INSERT INTO messages (id, session_id, role, content)
     VALUES ('presence-marker', 'send-session', 'assistant', 'read me')`
);

const httpServer = createServer();
const ioServer = setupWebSocket(httpServer);
await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
const address = httpServer.address();
assert(address && typeof address !== 'string');
const url = `http://127.0.0.1:${address.port}`;

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = createClient(url, {
      auth: { token: jwt.sign({ userId: 'send-user' }, jwtSecret, { expiresIn: '5m' }) },
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    client.once('connect', () => resolve(client));
    client.once('connect_error', reject);
  });
}

function emitSend(
  client: Socket,
  message: string,
  clientMessageId: string,
  activeFollowupMode: 'queue' | 'steer' = 'queue'
): Promise<SendAck> {
  return new Promise((resolve, reject) => {
    client.timeout(2_000).emit(
      'session:send',
      {
        sessionId: 'send-session',
        message,
        activeFollowupMode,
        clientMessageId,
      },
      (error: Error | null, acknowledgement?: SendAck) => {
        if (error) reject(error);
        else if (!acknowledgement) reject(new Error('missing send acknowledgement'));
        else resolve(acknowledgement);
      }
    );
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for WebSocket send');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const calls: Array<{ message: string; activeFollowupMode?: 'queue' | 'steer' }> = [];
let releaseFirst: (() => void) | undefined;
const firstGate = new Promise<void>((resolve) => {
  releaseFirst = resolve;
});
let flakyAttempts = 0;
const processManager = getProcessManager() as unknown as {
  sendMessage: (
    sessionId: string,
    userId: string,
    message: string,
    images: unknown,
    options: { activeFollowupMode?: 'queue' | 'steer' }
  ) => Promise<{ chatId: string | null; disposition: 'dispatched'; highWatermark: number }>;
};
processManager.sendMessage = async (_sessionId, _userId, message, _images, options) => {
  calls.push({ message, activeFollowupMode: options.activeFollowupMode });
  if (message === 'first') await firstGate;
  if (message === 'flaky' && flakyAttempts++ === 0) throw new Error('temporary provider failure');
  return { chatId: null, disposition: 'dispatched', highWatermark: 0 };
};

const client = await connect();

// Concurrent events for one session remain FIFO, and a duplicate waits on the
// original receipt instead of entering the provider queue a second time.
const first = emitSend(client, 'first', 'message-first', 'queue');
await waitUntil(() => calls.length === 1);
const duplicateFirst = emitSend(client, 'first', 'message-first', 'queue');
const second = emitSend(client, 'second', 'message-second', 'steer');
await new Promise((resolve) => setTimeout(resolve, 50));
assert.deepEqual(calls, [{ message: 'first', activeFollowupMode: 'queue' }]);
releaseFirst?.();
const [firstAck, duplicateAck, secondAck] = await Promise.all([first, duplicateFirst, second]);
assert.equal(firstAck.status, 'accepted');
assert.equal(duplicateAck.status, 'accepted');
assert.equal(secondAck.status, 'accepted');
assert.deepEqual(calls, [
  { message: 'first', activeFollowupMode: 'queue' },
  { message: 'second', activeFollowupMode: 'steer' },
]);

// Accepted receipts survive a socket reconnect, which makes retry-after-timeout safe.
client.close();
const reconnected = await connect();
const reconnectAck = await emitSend(reconnected, 'first', 'message-first', 'queue');
assert.equal(reconnectAck.status, 'accepted');
assert.equal(calls.filter((call) => call.message === 'first').length, 1);

// Rejected work is not cached: retrying the same ID can be accepted later.
const rejected = await emitSend(reconnected, 'flaky', 'message-flaky');
assert.equal(rejected.status, 'rejected');
if (rejected.status === 'rejected') {
  assert.equal(rejected.retryable, true);
  assert.match(rejected.error, /temporary provider failure/);
}
const retried = await emitSend(reconnected, 'flaky', 'message-flaky');
assert.equal(retried.status, 'accepted');
assert.equal(calls.filter((call) => call.message === 'flaky').length, 2);

// Presence is owner-only and validates its identity fields/read hint. Durable
// read writes remain REST-authoritative, avoiding one write per heartbeat.
const forbiddenPresence = new Promise<{ sessionId: string; error: string }>((resolve) => {
  reconnected.once('session:error', resolve);
});
reconnected.emit('session:presence', {
  sessionId: 'other-session',
  deviceId: 'phone-1',
  state: 'active',
});
assert.match((await forbiddenPresence).error, /Forbidden/);

const presence = new Promise<{
  sessionId: string;
  total: number;
  viewers: Array<{ deviceId: string; label?: string }>;
}>((resolve) => reconnected.once('session:presence', resolve));
reconnected.emit('session:presence', {
  sessionId: 'send-session',
  deviceId: 'phone-1',
  label: ' Vale phone ',
  state: 'active',
  lastReadMessageId: 'presence-marker',
});
const presenceSnapshot = await presence;
assert.equal(presenceSnapshot.sessionId, 'send-session');
assert.equal(presenceSnapshot.total, 1);
assert.equal(presenceSnapshot.viewers[0]?.deviceId, 'phone-1');
assert.equal(presenceSnapshot.viewers[0]?.label, 'Vale phone');
assert.equal(
  await pgGet(`SELECT 1 FROM session_reads
        WHERE user_id = 'send-user' AND session_id = 'send-session'`),
  undefined
);

// A known reconnect gap must require REST and must not expose a cursor the
// client could persist before applying that snapshot.
await pgRun(`UPDATE sessions SET event_sequence = 10 WHERE id = 'send-session'`);
const resync = new Promise<{
  needsFullResync?: boolean;
  highWatermark?: number;
}>((resolve) => reconnected.once('session:reconnected', resolve));
reconnected.emit('session:reconnect', { sessionId: 'send-session', lastSequence: 1 });
const resyncPayload = await resync;
assert.equal(resyncPayload.needsFullResync, true);
assert.equal(resyncPayload.highWatermark, undefined);

// Sequenced live state is emitted before its cursor; blocking permissions are
// buffered under an explicit replay type just like questions.
const managerSource = fs.readFileSync(
  path.resolve('src/services/claude/ClaudeProcessManager.ts'),
  'utf8'
);
const websocketSource = fs.readFileSync(path.resolve('src/websocket/index.ts'), 'utf8');
assert.match(
  websocketSource,
  /bufferedMessages: needsFullResync \? \[\] : bufferedMessages[^]*?needsFullResync \? \{\} : \{ highWatermark:/,
  'known replay gaps must expose neither truncated items nor an unapplied high watermark'
);
const sequencedHelper = managerSource.match(
  /private (?:async )?emitBufferedEvent<[\s\S]*?\n {2}private compactActivityText/
)?.[0];
assert.ok(sequencedHelper, 'sequenced buffered-event helper should remain present');
assert.ok(
  sequencedHelper.indexOf('emitLive(') < sequencedHelper.indexOf("emit('session:cursor'"),
  'the live event must be emitted before its cursor'
);
assert.match(
  managerSource,
  /emitBufferedEvent\([\s\S]{0,120}'permission_request'/,
  'blocking permission requests should be replay-buffered'
);
assert.match(
  managerSource,
  /const targetChatId = await resolveSessionSendChatId[^]*?recordedChatId = targetChatId/,
  'user rows should stay pinned to one resolved chat'
);
assert.match(
  managerSource,
  /const chatId = proc\?\.currentChatId \?\? \(await getSessionSyncState/,
  'provider output should use the pinned turn chat instead of a later active-chat switch'
);
assert.match(
  fs.readFileSync(path.resolve('../shared/src/types/websocket.ts'), 'utf8'),
  /\| 'permission_request'/,
  'the shared buffered message union should describe permission replay'
);

reconnected.close();
await new Promise<void>((resolve) => ioServer.close(() => resolve()));
await new Promise<void>((resolve) => httpServer.close(() => resolve()));
fs.rmSync(temporaryDirectory, { recursive: true, force: true });

await dropTestSchema();

console.log('websocket send acknowledgement regression tests passed');
