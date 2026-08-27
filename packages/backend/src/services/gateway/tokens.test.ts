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

const { initDatabase, getDatabase } = await import('../../db/index.js');
const { createGatewayToken, listGatewayTokens, resolveGatewayToken, revokeGatewayToken } =
  await import('./tokens.js');

initDatabase();

const userId = 'user-under-test';
getDatabase()
  .prepare('INSERT INTO users (id, email, name, provider, provider_id) VALUES (?, ?, ?, ?, ?)')
  .run(userId, 'gw@example.test', 'GW', 'local', userId);

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('a write token resolves with write scope', () => {
  const { token } = createGatewayToken(userId, 'supervisor', 'write');
  assert.deepEqual(resolveGatewayToken(token), { userId, scope: 'write' });
});

test('a read token resolves with read scope', () => {
  const { token } = createGatewayToken(userId, 'monitor', 'read');
  assert.deepEqual(resolveGatewayToken(token), { userId, scope: 'read' });
});

test('the default stays write, so existing callers are unaffected', () => {
  const { token } = createGatewayToken(userId, 'legacy');
  assert.equal(resolveGatewayToken(token)?.scope, 'write');
});

test('an unrecognised stored scope fails closed to read', () => {
  const { token, row } = createGatewayToken(userId, 'corrupt', 'write');
  getDatabase()
    .prepare('UPDATE gateway_tokens SET scope = ? WHERE id = ?')
    .run('superuser', row.id);
  assert.equal(resolveGatewayToken(token)?.scope, 'read', 'must not widen rights');
});

test('the scope is visible in the listing', () => {
  const { row } = createGatewayToken(userId, 'listed', 'read');
  const listed = listGatewayTokens(userId).find((entry) => entry.id === row.id);
  assert.equal(listed?.scope, 'read');
});

test('a revoked token resolves to nothing regardless of scope', () => {
  const { token, row } = createGatewayToken(userId, 'doomed', 'write');
  revokeGatewayToken(userId, row.id);
  assert.equal(resolveGatewayToken(token), null);
});

test('a token secret is never stored verbatim', () => {
  const { token } = createGatewayToken(userId, 'secret-check', 'read');
  const rows = getDatabase().prepare('SELECT token_hash FROM gateway_tokens').all() as Array<{
    token_hash: string;
  }>;
  assert.ok(!rows.some((r) => r.token_hash === token), 'only the hash may be persisted');
});
