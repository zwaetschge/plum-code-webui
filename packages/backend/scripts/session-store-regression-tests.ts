/**
 * The express-session store, which every request touches.
 *
 * A store that loses a session logs everyone out; one that keeps an expired or
 * unreadable row hands a stale identity to the next request with the same id.
 * These pin the three cases that decide which of those happens: expired rows
 * are pruned as a side effect of writing, unreadable rows fail closed and are
 * removed, and destroy actually destroys.
 */

import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'session-store-test-session-secret-00000000000000';
process.env.JWT_SECRET = 'session-store-test-jwt-secret-000000000000000000';

const { useTestSchema, createTestSchema, dropTestSchema } = await import('../src/db/testing.js');
useTestSchema();

const { SqliteSessionStore } = await import('../src/services/SqliteSessionStore.js');
const { get: pgGet, run: pgRun } = await import('../src/db/pg.js');

await createTestSchema();

const store = new SqliteSessionStore();
const expires = new Date(Date.now() + 60_000);
const sessionData = {
  cookie: {
    originalMaxAge: 60_000,
    expires,
    httpOnly: true,
    path: '/',
  },
  passport: { user: 'user-1' },
};

function setSession(sid: string, data = sessionData): Promise<void> {
  return new Promise((resolve, reject) => {
    store.set(sid, data as never, (error) => (error ? reject(error) : resolve()));
  });
}

function getSession(sid: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    store.get(sid, (error, data) => (error ? reject(error) : resolve(data)));
  });
}

function destroySession(sid: string): Promise<void> {
  return new Promise((resolve, reject) => {
    store.destroy(sid, (error) => (error ? reject(error) : resolve()));
  });
}

const rowExists = async (sid: string) =>
  (await pgGet('SELECT 1 FROM http_sessions WHERE sid = ?', sid)) !== undefined;

try {
  const insert = (sid: string, data: string, expiresAt: number) =>
    pgRun(
      'INSERT INTO http_sessions (sid, data, expires_at) VALUES (?, ?, ?)',
      sid,
      data,
      expiresAt
    );

  await insert('expired-before-prune', '{}', Date.now() - 1);
  await setSession('active');
  assert.equal(
    await rowExists('expired-before-prune'),
    false,
    'writes should opportunistically prune expired sessions'
  );

  const restored = (await getSession('active')) as typeof sessionData;
  assert.equal(restored.passport.user, 'user-1');
  assert.equal(new Date(restored.cookie.expires).getTime(), expires.getTime());

  await insert('corrupt', '{not-json', Date.now() + 60_000);
  assert.equal(await getSession('corrupt'), null, 'corrupt sessions must fail closed');
  assert.equal(await rowExists('corrupt'), false, 'and must not be left behind');

  await insert('expired', '{}', Date.now() - 1);
  assert.equal(await getSession('expired'), null);

  await destroySession('active');
  assert.equal(await getSession('active'), null);

  console.log('session store regression tests passed');
} finally {
  await dropTestSchema();
}
