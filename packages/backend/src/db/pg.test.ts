/**
 * Runs against the real Postgres when one is reachable, and skips otherwise so
 * the suite still passes on a machine without it. The placeholder conversion is
 * pure and always runs — it rewrites every ported query, so a bug there would be
 * silent and everywhere.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET ||= 'x'.repeat(32);
process.env.JWT_SECRET ||= 'y'.repeat(32);

const { convertPlaceholders, get, all, run, transaction, closePool, getPool } =
  await import('./pg.js');

test('placeholders become positional in order', () => {
  assert.equal(
    convertPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?'),
    'SELECT * FROM t WHERE a = $1 AND b = $2'
  );
});

test('a question mark inside a string literal is left alone', () => {
  // Otherwise `WHERE note = '?'` would turn into a parameter that has no value.
  assert.equal(
    convertPlaceholders("SELECT * FROM t WHERE note = '?' AND id = ?"),
    "SELECT * FROM t WHERE note = '?' AND id = $1"
  );
});

test('an escaped quote does not end the literal early', () => {
  assert.equal(
    convertPlaceholders("SELECT * FROM t WHERE s = 'it''s ? here' AND id = ?"),
    "SELECT * FROM t WHERE s = 'it''s ? here' AND id = $1"
  );
});

test('quoted identifiers are left alone', () => {
  assert.equal(
    convertPlaceholders('SELECT "a?b" FROM t WHERE id = ?'),
    'SELECT "a?b" FROM t WHERE id = $1'
  );
});

test('a statement without placeholders is unchanged', () => {
  assert.equal(convertPlaceholders('SELECT 1'), 'SELECT 1');
});

async function postgresReachable(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

const live = await postgresReachable();

test(
  'round-trips through the real database',
  { skip: !live && 'no Postgres reachable' },
  async () => {
    await run('CREATE TABLE IF NOT EXISTS pg_helper_test (id TEXT PRIMARY KEY, n BIGINT)');
    await run('TRUNCATE pg_helper_test');

    await run('INSERT INTO pg_helper_test (id, n) VALUES (?, ?)', 'a', 1);
    await run('INSERT INTO pg_helper_test (id, n) VALUES (?, ?)', 'b', 2);

    const one = (await get('SELECT id FROM pg_helper_test WHERE id = ?', 'a')) as
      | { id: string }
      | undefined;
    assert.equal(one?.id, 'a');

    const rows = (await all('SELECT id FROM pg_helper_test ORDER BY id')) as { id: string }[];
    assert.deepEqual(
      rows.map((r) => r.id),
      ['a', 'b']
    );

    const missing = await get('SELECT id FROM pg_helper_test WHERE id = ?', 'nope');
    assert.equal(missing, undefined, 'a miss must be undefined, like better-sqlite3 .get()');

    const deleted = await run('DELETE FROM pg_helper_test WHERE id = ?', 'a');
    assert.equal(deleted.changes, 1, 'callers read `changes` to tell a no-op apart from a write');
  }
);

test(
  'a failed transaction leaves nothing behind',
  { skip: !live && 'no Postgres reachable' },
  async () => {
    await run('CREATE TABLE IF NOT EXISTS pg_tx_test (id TEXT PRIMARY KEY)');
    await run('TRUNCATE pg_tx_test');

    await assert.rejects(
      await transaction(async (tx) => {
        await tx.run('INSERT INTO pg_tx_test (id) VALUES (?)', 'x');
        throw new Error('boom');
      })
    );

    const rows = await all('SELECT id FROM pg_tx_test');
    assert.equal(rows.length, 0, 'the insert must have rolled back');
  }
);

test(
  'a committed transaction keeps its writes',
  { skip: !live && 'no Postgres reachable' },
  async () => {
    await run('TRUNCATE pg_tx_test');
    await transaction(async (tx) => {
      await tx.run('INSERT INTO pg_tx_test (id) VALUES (?)', 'y');
      const seen = (await tx.get('SELECT id FROM pg_tx_test WHERE id = ?', 'y')) as
        | { id: string }
        | undefined;
      assert.equal(seen?.id, 'y', 'reads inside the transaction see its own writes');
    });
    assert.equal((await all('SELECT id FROM pg_tx_test')).length, 1);
  }
);

test.after(async () => {
  if (live) {
    await run('DROP TABLE IF EXISTS pg_helper_test').catch(() => {});
    await run('DROP TABLE IF EXISTS pg_tx_test').catch(() => {});
  }
  await closePool();
});
