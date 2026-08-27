import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { convertPlaceholders, translateDialect } from './dialect.js';

/**
 * The translation layer carries 120 statements that were written for SQLite, so
 * a mistake here is a mistake in every one of them at once. These tests are the
 * reason those statements were not edited individually.
 */

describe('convertPlaceholders', () => {
  it('numbers placeholders in order', () => {
    assert.equal(
      convertPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?'),
      'SELECT * FROM t WHERE a = $1 AND b = $2'
    );
  });

  it('leaves a question mark inside a literal alone', () => {
    assert.equal(
      convertPlaceholders("SELECT * FROM t WHERE note = '?' AND id = ?"),
      "SELECT * FROM t WHERE note = '?' AND id = $1"
    );
  });

  it('handles an escaped quote inside a literal', () => {
    assert.equal(
      convertPlaceholders("SELECT * FROM t WHERE s = 'it''s ?' AND id = ?"),
      "SELECT * FROM t WHERE s = 'it''s ?' AND id = $1"
    );
  });

  it('leaves a quoted identifier alone', () => {
    assert.equal(
      convertPlaceholders('SELECT "weird?column" FROM t WHERE id = ?'),
      'SELECT "weird?column" FROM t WHERE id = $1'
    );
  });
});

describe('translateDialect', () => {
  const formatted = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

  it('formats CURRENT_TIMESTAMP to the TEXT shape the columns hold', () => {
    assert.equal(
      translateDialect('UPDATE t SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
      `UPDATE t SET updated_at = ${formatted} WHERE id = ?`
    );
  });

  it('translates every occurrence, not just the first', () => {
    const out = translateDialect(
      'INSERT INTO t (created_at, updated_at) VALUES (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
    );
    assert.equal(out.match(/to_char/g)?.length, 2);
    assert.ok(!/CURRENT_TIMESTAMP/.test(out));
  });

  it('leaves the words alone inside a literal', () => {
    assert.equal(
      translateDialect("INSERT INTO t (note) VALUES ('CURRENT_TIMESTAMP')"),
      "INSERT INTO t (note) VALUES ('CURRENT_TIMESTAMP')"
    );
  });

  it("translates datetime('now')", () => {
    assert.equal(translateDialect("SELECT datetime('now')"), `SELECT ${formatted}`);
  });

  it('translates a negative modifier', () => {
    assert.equal(
      translateDialect("DELETE FROM t WHERE created_at < datetime('now', '-7 days')"),
      "DELETE FROM t WHERE created_at < to_char(now() AT TIME ZONE 'UTC' - interval '7 day', 'YYYY-MM-DD HH24:MI:SS')"
    );
  });

  it('translates a positive modifier and singular units', () => {
    assert.equal(
      translateDialect("SELECT datetime('now', '+1 hour')"),
      "SELECT to_char(now() AT TIME ZONE 'UTC' + interval '1 hour', 'YYYY-MM-DD HH24:MI:SS')"
    );
  });

  it('leaves a datetime form it does not understand untouched', () => {
    // Better a loud Postgres error than a silently wrong timestamp.
    const sql = "SELECT datetime(created_at, 'localtime')";
    assert.equal(translateDialect(sql), sql);
  });

  it('leaves a statement with nothing to translate byte-identical', () => {
    const sql = 'SELECT id, content FROM messages WHERE session_id = ? ORDER BY created_at DESC';
    assert.equal(translateDialect(sql), sql);
  });
});

describe('translateDialect: strftime', () => {
  it('quotes literal text so to_char does not read it as a pattern', () => {
    // The bare `T` and `Z` are the whole point: unquoted, to_char treats them
    // as format codes and returns something that is not an ISO timestamp.
    assert.equal(
      translateDialect("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS c FROM t"),
      `SELECT to_char((created_at)::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS c FROM t`
    );
  });

  it('translates the seconds-precision variant', () => {
    assert.equal(
      translateDialect("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', sent_at)"),
      `SELECT to_char((sent_at)::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
    );
  });

  it('translates a grouping format', () => {
    assert.equal(
      translateDialect("SELECT strftime('%Y-%m', created_at) AS bucket"),
      `SELECT to_char((created_at)::timestamp, 'YYYY-MM') AS bucket`
    );
  });

  it('translates epoch seconds to EXTRACT', () => {
    assert.equal(
      translateDialect("SELECT CAST(strftime('%s', recorded_at) AS INTEGER)"),
      'SELECT CAST(EXTRACT(EPOCH FROM (recorded_at)::timestamp) AS INTEGER)'
    );
  });

  it('leaves an unknown format code untranslated', () => {
    const sql = "SELECT strftime('%Q', created_at)";
    assert.equal(translateDialect(sql), sql);
  });
});

describe('translateDialect: parameterised datetime', () => {
  it('keeps the parameter and casts it to an interval', () => {
    // The caller passes '+30 seconds', which is valid interval input, so the
    // modifier does not have to be understood here.
    assert.equal(
      translateDialect("UPDATE t SET next_attempt_at = datetime('now', ?) WHERE id = ?"),
      "UPDATE t SET next_attempt_at = to_char(now() AT TIME ZONE 'UTC' + (?)::interval, 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?"
    );
  });

  it('still numbers the placeholders left to right afterwards', () => {
    assert.equal(
      convertPlaceholders(
        translateDialect("UPDATE t SET a = ?, b = datetime('now', ?) WHERE id = ?")
      ),
      "UPDATE t SET a = $1, b = to_char(now() AT TIME ZONE 'UTC' + ($2)::interval, 'YYYY-MM-DD HH24:MI:SS') WHERE id = $3"
    );
  });
});

describe('translateDialect: strftime hour buckets', () => {
  it('quotes a literal that would otherwise read as a pattern', () => {
    assert.equal(
      translateDialect("SELECT strftime('%Y-%m-%d %H:00', created_at) AS bucket"),
      `SELECT to_char((created_at)::timestamp, 'YYYY-MM-DD HH24:"00"') AS bucket`
    );
  });
});
