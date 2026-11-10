import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOGIN_REFUSAL_RETRIES,
  MANUAL_RECONNECT_MAX_DELAY_MS,
  isLoginRefusal,
  manualReconnectDelay,
  needsManualReconnect,
} from '../src/lib/socketReconnect.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// A restart ends the socket from the server side; socket.io does not come back from that.
assert.equal(needsManualReconnect({ active: false, reason: 'io server disconnect' }), true);
// A refused handshake leaves the socket inactive without any disconnect reason.
assert.equal(needsManualReconnect({ active: false }), true);
// A lost connection is retried by socket.io itself.
assert.equal(needsManualReconnect({ active: true, reason: 'transport close' }), false);
assert.equal(needsManualReconnect({ active: true, reason: 'ping timeout' }), false);
// Signing out closes the socket on purpose.
assert.equal(needsManualReconnect({ active: false, reason: 'io client disconnect' }), false);

assert.deepEqual(
  [0, 1, 2, 3, 4, 5, 40].map(manualReconnectDelay),
  [1000, 2000, 4000, 8000, 15000, 15000, 15000]
);
assert.equal(manualReconnectDelay(-3), 1000);
assert.equal(manualReconnectDelay(Number.NaN), 1000);
assert.equal(manualReconnectDelay(1e9), MANUAL_RECONNECT_MAX_DELAY_MS);
assert.ok(LOGIN_REFUSAL_RETRIES > 0);

for (const message of ['Invalid token', 'Authentication required', 'Account unavailable']) {
  assert.equal(isLoginRefusal(message), true, message);
}
// The server's "try again" answer and transport errors are not about the login.
for (const message of ['Service unavailable', 'xhr poll error', 'websocket error', 'timeout']) {
  assert.equal(isLoginRefusal(message), false, message);
}

// The socket service acts on both ways a socket can be given up on.
const service = readFileSync(join(root, 'src/services/socket.ts'), 'utf8');
assert.match(service, /on\('disconnect', \(reason\) => \{[^}]*needsManualReconnect\(/s);
assert.match(service, /on\('connect_error'[\s\S]{0,900}scheduleManualReconnect\(/);
assert.match(service, /on\('connect', \(\) => \{[\s\S]{0,200}clearManualReconnect\(/);
// Opening a chat revives a socket that socket.io has given up on, and only such a one.
assert.match(
  service,
  /if \(this\.socket\) \{\s*if \(!this\.socket\.connected && !this\.socket\.active[\s\S]{0,80}\{\s*this\.socket\.connect\(\);/
);

console.log(
  'PASS: the web socket comes back after a server-side disconnect or a refused handshake'
);
