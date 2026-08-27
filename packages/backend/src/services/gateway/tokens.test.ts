/**
 * A gateway token used to inherit the owner's full rights with no way to narrow
 * them, so a monitoring bot that only ever reads had the same power as the user.
 * These lock in the two properties that make read-only meaningful: the scope
 * survives a round trip, and an unrecognised value fails closed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-gw-'));
process.env.WEBUI_DATA_DIR = dataDir;
process.env.SESSION_SECRET ||= 'x'.repeat(32);
process.env.JWT_SECRET ||= 'y'.repeat(32);

const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../../db/testing.js');
useTestSchema();

const { createGatewayToken, listGatewayTokens, resolveGatewayToken, revokeGatewayToken } =
  await import('./tokens.js');
const { all: pgAll, run: pgRun } = await import('../../db/pg.js');

const userId = 'user-under-test';
const reachable = await databaseReachable();
if (reachable) {
  await createTestSchema();
  await pgRun(
    'INSERT INTO users (id, email, name, provider, provider_id) VALUES (?, ?, ?, ?, ?)',
    userId,
    'gw@example.test',
    'GW',
    'local',
    userId
  );
}

const options = reachable ? {} : { skip: 'no Postgres reachable (set PGHOST/PGPASSWORD to run)' };

test.after(async () => {
  if (reachable) await dropTestSchema();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a write token resolves with write scope', options, async () => {
  const { token } = await createGatewayToken(userId, 'supervisor', 'write');
  assert.deepEqual(await resolveGatewayToken(token), { userId, scope: 'write' });
});

test('a read token resolves with read scope', options, async () => {
  const { token } = await createGatewayToken(userId, 'monitor', 'read');
  assert.deepEqual(await resolveGatewayToken(token), { userId, scope: 'read' });
});

test('the default stays write, so existing callers are unaffected', options, async () => {
  const { token } = await createGatewayToken(userId, 'legacy');
  assert.equal((await resolveGatewayToken(token))?.scope, 'write');
});

test('an unrecognised stored scope fails closed to read', options, async () => {
  const { token, row } = await createGatewayToken(userId, 'corrupt', 'write');
  await pgRun('UPDATE gateway_tokens SET scope = ? WHERE id = ?', 'superuser', row.id);
  assert.equal((await resolveGatewayToken(token))?.scope, 'read', 'must not widen rights');
});

test('the scope is visible in the listing', options, async () => {
  const { row } = await createGatewayToken(userId, 'listed', 'read');
  const listed = (await listGatewayTokens(userId)).find((entry) => entry.id === row.id);
  assert.equal(listed?.scope, 'read');
});

test('a revoked token resolves to nothing regardless of scope', options, async () => {
  const { token, row } = await createGatewayToken(userId, 'doomed', 'write');
  await revokeGatewayToken(userId, row.id);
  assert.equal(await resolveGatewayToken(token), null);
});

test('a token secret is never stored verbatim', options, async () => {
  const { token } = await createGatewayToken(userId, 'secret-check', 'read');
  const rows = (await pgAll('SELECT token_hash FROM gateway_tokens')) as Array<{
    token_hash: string;
  }>;
  assert.ok(!rows.some((r) => r.token_hash === token), 'only the hash may be persisted');
});
