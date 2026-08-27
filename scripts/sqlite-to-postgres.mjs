#!/usr/bin/env node
/**
 * Translates the SQLite schema to Postgres and copies the data across.
 *
 * Reads from a *backup copy*, never the live database — a second connection to
 * the running file is what truncated it on 2026-08-26. Point `--source` at the
 * newest file in `data/backups/`.
 *
 * Deliberate choices, because they decide how much application code has to
 * change:
 *
 * - **Booleans stay INTEGER.** SQLite has no boolean; the code writes 0 and 1
 *   and compares with `= 1`. Converting to Postgres BOOLEAN would mean touching
 *   every one of those comparisons for no functional gain.
 * - **Timestamps stay TEXT.** The schema stores `DATETIME DEFAULT
 *   CURRENT_TIMESTAMP`, which SQLite writes as `YYYY-MM-DD HH:MM:SS` strings,
 *   and 161 places in the code compare, slice and sort those strings. Moving to
 *   TIMESTAMPTZ is the right destination, but as a separate step — doing it here
 *   would mix a storage migration with a semantic one.
 * - **FTS5 is not translated.** `messages_fts` is a virtual table with no
 *   Postgres equivalent; it becomes a `tsvector` column plus a GIN index, which
 *   the search code has to be rewritten for anyway. Skipped here, tracked
 *   separately.
 *
 * Usage:
 *   node scripts/sqlite-to-postgres.mjs --source <backup.db> [--schema-only] [--dry-run]
 */

import Database from '../packages/backend/node_modules/better-sqlite3/lib/index.js';
import pg from '../packages/backend/node_modules/pg/lib/index.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const SOURCE = value('source', '');
const DRY_RUN = flag('dry-run');
const SCHEMA_ONLY = flag('schema-only');

if (!SOURCE) {
  console.error('--source <sqlite file> is required (use a backup, never the live database)');
  process.exit(1);
}

/** Virtual tables and their shadow storage; rebuilt natively on the other side. */
const isFts = (name) => name.startsWith('messages_fts');

/**
 * SQLite is loosely typed and accepts almost any type name. Postgres is not, so
 * every declared type has to land on something concrete.
 */
function translateType(declared) {
  const type = (declared || '').toUpperCase();
  if (!type) return 'TEXT';
  if (type.includes('INT')) return 'BIGINT';
  if (type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT')) return 'TEXT';
  if (type.includes('BLOB')) return 'BYTEA';
  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) {
    return 'DOUBLE PRECISION';
  }
  if (type.includes('NUMERIC') || type.includes('DECIMAL')) return 'NUMERIC';
  // DATETIME/DATE land here: kept as TEXT on purpose, see the header.
  return 'TEXT';
}

function translateDefault(raw, pgType) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (/^CURRENT_TIMESTAMP$/i.test(text)) {
    // SQLite's CURRENT_TIMESTAMP is 'YYYY-MM-DD HH:MM:SS' in UTC; Postgres's
    // is a timestamp value. Match the string form the code already parses.
    return "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";
  }
  if (/^\(/.test(text)) return null; // expression defaults: rare, handled by hand
  if (pgType === 'BIGINT' && /^-?\d+$/.test(text)) return text;
  return text;
}

function buildCreateTable(db, table) {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all();

  // A single INTEGER PRIMARY KEY in SQLite is the rowid alias and is usually
  // auto-assigned; Postgres needs that spelled out.
  const intPrimaryKeys = columns.filter((c) => c.pk === 1 && /INT/i.test(c.type || ''));
  const singleIntPk = intPrimaryKeys.length === 1 && columns.filter((c) => c.pk > 0).length === 1;

  const lines = columns.map((column) => {
    const type = translateType(column.type);
    const isSerial = singleIntPk && column.pk === 1;
    const parts = [`"${column.name}"`, isSerial ? 'BIGSERIAL' : type];
    if (column.notnull) parts.push('NOT NULL');
    const fallback = translateDefault(column.dflt_value, type);
    if (fallback != null && !isSerial) parts.push(`DEFAULT ${fallback}`);
    return '  ' + parts.join(' ');
  });

  const pkColumns = columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
  if (pkColumns.length) {
    lines.push(`  PRIMARY KEY (${pkColumns.map((c) => `"${c.name}"`).join(', ')})`);
  }

  // Foreign keys are added afterwards: tables are created in name order, so a
  // reference to a table further down the alphabet would not resolve yet.
  return `CREATE TABLE IF NOT EXISTS "${table}" (\n${lines.join(',\n')}\n);`;
}

function buildForeignKeys(db, table) {
  const statements = [];
  for (const fk of db.prepare(`PRAGMA foreign_key_list("${table}")`).all()) {
    if (isFts(fk.table)) continue;
    const onDelete =
      fk.on_delete && fk.on_delete !== 'NO ACTION' ? ` ON DELETE ${fk.on_delete}` : '';
    const name = `fk_${table}_${fk.from}`;
    statements.push(
      `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" ` +
        `FOREIGN KEY ("${fk.from}") REFERENCES "${fk.table}" ("${fk.to}")${onDelete};`
    );
  }
  return statements;
}

function buildIndexes(db, table) {
  const statements = [];
  for (const index of db.prepare(`PRAGMA index_list("${table}")`).all()) {
    if (index.origin !== 'c') continue; // pk/unique constraints come with the table
    const columns = db.prepare(`PRAGMA index_info("${index.name}")`).all();
    if (!columns.length || columns.some((c) => c.name == null)) continue; // expression index
    const unique = index.unique ? 'UNIQUE ' : '';
    statements.push(
      `CREATE ${unique}INDEX IF NOT EXISTS "${index.name}" ON "${table}" ` +
        `(${columns.map((c) => `"${c.name}"`).join(', ')});`
    );
  }
  return statements;
}

async function main() {
  const db = new Database(SOURCE, { readonly: true, fileMustExist: true });
  const verdict = db.pragma('quick_check', { simple: true });
  if (verdict !== 'ok') {
    throw new Error(`Source database is not healthy: ${verdict}`);
  }

  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map((row) => row.name)
    .filter((name) => !isFts(name));

  const ddl = [];
  for (const table of tables) ddl.push(buildCreateTable(db, table));
  const indexDdl = tables.flatMap((table) => buildIndexes(db, table));
  const fkDdl = tables.flatMap((table) => buildForeignKeys(db, table));

  if (DRY_RUN) {
    console.log(ddl.join('\n\n'));
    console.log('\n' + fkDdl.join('\n'));
    console.log('\n' + indexDdl.join('\n'));
    console.log(
      `\n-- ${tables.length} tables, ${fkDdl.length} foreign keys, ${indexDdl.length} indexes`
    );
    db.close();
    return;
  }

  const client = new pg.Client({
    host: process.env.PGHOST || 'plum-postgres',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'plumcode',
    user: process.env.PGUSER || 'plumcode',
    password: process.env.PGPASSWORD || '',
  });
  await client.connect();

  console.log(`Creating ${tables.length} tables…`);
  // Foreign keys reference tables that may not exist yet, so defer enforcement
  // until the whole schema is in place.
  await client.query('SET session_replication_role = replica');
  for (const statement of ddl) await client.query(statement);
  for (const statement of fkDdl) {
    try {
      await client.query(statement);
    } catch (error) {
      // Duplicate on a re-run, or a reference the SQLite schema never enforced.
      if (!/already exists/i.test(error.message)) {
        console.warn(`  fk skipped: ${error.message.slice(0, 90)}`);
      }
    }
  }
  for (const statement of indexDdl) {
    try {
      await client.query(statement);
    } catch (error) {
      console.warn(`  index skipped: ${error.message.slice(0, 80)}`);
    }
  }

  if (!SCHEMA_ONLY) {
    // One TRUNCATE for everything, before any insert. Doing it per table inside
    // the loop was wrong: CASCADE on a parent wipes the children that were
    // already filled earlier in the alphabet, so `sessions` emptied `messages`,
    // `session_events` and 19 other tables after they had been copied.
    await client.query(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`);

    for (const table of tables) {
      const columns = db
        .prepare(`PRAGMA table_info("${table}")`)
        .all()
        .map((c) => c.name);
      const rows = db.prepare(`SELECT * FROM "${table}"`).all();
      if (!rows.length) {
        console.log(`  ${table}: empty`);
        continue;
      }

      const columnList = columns.map((c) => `"${c}"`).join(', ');
      // Batched: one statement per row is unusable at 99k messages.
      const BATCH = 500;
      for (let offset = 0; offset < rows.length; offset += BATCH) {
        const slice = rows.slice(offset, offset + BATCH);
        const params = [];
        const tuples = slice.map((row) => {
          const placeholders = columns.map((column) => {
            params.push(row[column] ?? null);
            return `$${params.length}`;
          });
          return `(${placeholders.join(', ')})`;
        });
        await client.query(
          `INSERT INTO "${table}" (${columnList}) VALUES ${tuples.join(', ')}`,
          params
        );
      }
      console.log(`  ${table}: ${rows.length} rows`);
    }
  }

  await client.query('SET session_replication_role = DEFAULT');
  await client.end();
  db.close();
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
