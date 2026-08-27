#!/usr/bin/env node
/**
 * Checks that a Postgres copy matches the SQLite database it came from.
 *
 * An import that reports "Done." has proved nothing. This one came close to
 * shipping with 21 tables silently emptied: `TRUNCATE ... CASCADE` was running
 * per table inside the copy loop, so `sessions` wiped `messages` and every
 * other child *after* they had been filled. The row counts caught it; nothing
 * else would have, because the script's own output looked correct.
 *
 * Three things are checked, in the order they can go wrong:
 *
 *   counts    every table has the same number of rows on both sides
 *   ordering  the `seq` column reproduces SQLite's rowid order exactly, which
 *             is what decides "the later message" when two share a timestamp
 *   search    the generated tsvector is populated, so the FTS5 replacement
 *             actually indexes something
 *
 * Usage:
 *   PGSCHEMA=<schema> node scripts/verify-postgres-migration.mjs --source <backup.db>
 */

import Database from '../packages/backend/node_modules/better-sqlite3/lib/index.js';
import pg from '../packages/backend/node_modules/pg/lib/index.js';

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
};

const SOURCE = value('source');
if (!SOURCE) {
  console.error('--source <sqlite file> is required (use a backup, never the live database)');
  process.exit(1);
}

/** Tables whose queries order by what used to be rowid. */
const ORDERED = ['messages', 'message_media', 'session_chats', 'session_events'];

const sqlite = new Database(SOURCE, { readonly: true, fileMustExist: true });
const client = new pg.Client({
  host: process.env.PGHOST || 'plum-postgres',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'plumcode',
  user: process.env.PGUSER || 'plumcode',
  password: process.env.PGPASSWORD || '',
});
await client.connect();
if (process.env.PGSCHEMA) {
  await client.query(`SET search_path TO "${process.env.PGSCHEMA}"`);
}

let failures = 0;
const fail = (message) => {
  console.error(`  FAIL ${message}`);
  failures++;
};

const tables = sqlite
  .prepare(
    `SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'messages_fts%'
      ORDER BY name`
  )
  .all()
  .map((row) => row.name);

let rows = 0;
for (const table of tables) {
  const expected = sqlite.prepare(`SELECT COUNT(*) c FROM "${table}"`).get().c;
  const actual = Number((await client.query(`SELECT COUNT(*) c FROM "${table}"`)).rows[0].c);
  rows += expected;
  if (expected !== actual) fail(`${table}: sqlite has ${expected}, postgres has ${actual}`);
}
console.log(`counts:   ${tables.length} tables, ${rows} rows`);

for (const table of ORDERED) {
  if (!tables.includes(table)) continue;
  const expected = sqlite.prepare(`SELECT id FROM "${table}" ORDER BY rowid`).all().map((r) => r.id);
  const actual = (await client.query(`SELECT id FROM "${table}" ORDER BY seq`)).rows.map((r) => r.id);
  const index = expected.findIndex((id, i) => id !== actual[i]);
  if (expected.length !== actual.length || index >= 0) {
    fail(`${table}: seq order diverges from rowid order at position ${index}`);
  }
}
console.log(`ordering: ${ORDERED.length} tables reproduce rowid order`);

const indexed = Number(
  (await client.query(`SELECT COUNT(*) c FROM messages WHERE search_vector IS NOT NULL`)).rows[0].c
);
const messages = Number((await client.query('SELECT COUNT(*) c FROM messages')).rows[0].c);
if (indexed !== messages) fail(`search: ${messages - indexed} messages have no search vector`);
console.log(`search:   ${indexed} messages indexed`);

await client.end();
sqlite.close();

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
