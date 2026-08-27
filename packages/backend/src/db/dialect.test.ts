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

describe('translateDialect: nested arguments', () => {
  it('matches the closing paren rather than the first inner one', () => {
    // A `[^()]*` argument match stops inside the subquery and leaves the call
    // untranslated, which then reaches Postgres as an unknown function.
    assert.equal(
      translateDialect(
        "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.session_id = s.id), s.updated_at)) AS activityAt"
      ),
      `SELECT to_char((COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.session_id = s.id), s.updated_at))::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "activityAt"`
    );
  });

  it('translates two calls in one statement', () => {
    const out = translateDialect("SELECT strftime('%Y-%m', a), strftime('%Y-%m', b) FROM t");
    assert.equal(out.match(/to_char/g)?.length, 2);
    assert.ok(!/strftime/.test(out));
  });
});

describe('translateDialect: null-safe equality', () => {
  it('rewrites IS ? to IS NOT DISTINCT FROM', () => {
    assert.equal(
      translateDialect('SELECT * FROM messages WHERE session_id = ? AND chat_id IS ?'),
      'SELECT * FROM messages WHERE session_id = ? AND chat_id IS NOT DISTINCT FROM ?'
    );
  });

  it('leaves IS NULL and IS NOT NULL alone', () => {
    const sql = 'SELECT * FROM t WHERE a IS NULL AND b IS NOT NULL';
    assert.equal(translateDialect(sql), sql);
  });

  it('leaves the phrase inside a literal alone', () => {
    assert.equal(
      translateDialect("INSERT INTO t (note) VALUES ('what IS ?')"),
      "INSERT INTO t (note) VALUES ('what IS ?')"
    );
  });
});

describe('translateDialect: identifier case', () => {
  it('quotes a mixed-case alias so the column keeps its name', () => {
    // Unquoted, Postgres returns `tokenhash` and every `row.tokenHash` in the
    // codebase reads undefined — no error, just a missing field.
    assert.equal(
      translateDialect('SELECT token_hash AS tokenHash FROM gateway_tokens'),
      'SELECT token_hash AS "tokenHash" FROM gateway_tokens'
    );
  });

  it('leaves a cast alone', () => {
    // An all-caps word after AS is a type, and quoting it is a syntax error.
    const sql = 'SELECT CAST(strftime AS INTEGER) FROM t';
    assert.equal(translateDialect(sql), sql);
  });

  it('leaves an all-lowercase alias alone', () => {
    const sql = 'SELECT COUNT(*) AS count FROM t';
    assert.equal(translateDialect(sql), sql);
  });

  it('does not double-quote an alias that is already quoted', () => {
    const sql = 'SELECT a AS "createdAt" FROM t';
    assert.equal(translateDialect(sql), sql);
  });

  it('leaves the word inside a literal alone', () => {
    assert.equal(
      translateDialect("INSERT INTO t (note) VALUES ('AS someThing')"),
      "INSERT INTO t (note) VALUES ('AS someThing')"
    );
  });
});

describe('translateDialect: IS against a column', () => {
  it('rewrites a column-to-column comparison', () => {
    // `unread_message.chat_id IS s.active_chat_id` is how one query serves both
    // the default chat and a named one. Postgres reads the right-hand side as
    // the start of IS NULL / IS TRUE and rejects it.
    assert.equal(
      translateDialect('SELECT 1 WHERE unread_message.chat_id IS s.active_chat_id'),
      'SELECT 1 WHERE unread_message.chat_id IS NOT DISTINCT FROM s.active_chat_id'
    );
  });

  it('leaves the forms Postgres does accept alone', () => {
    const sql = 'SELECT 1 WHERE a IS NULL AND b IS NOT NULL AND c IS TRUE AND d IS FALSE';
    assert.equal(translateDialect(sql), sql);
  });

  it('does not rewrite what it already rewrote', () => {
    const sql = 'SELECT 1 WHERE a IS NOT DISTINCT FROM b';
    assert.equal(translateDialect(sql), sql);
  });

  it('quotes a lower-case alias too', () => {
    assert.equal(
      translateDialect('SELECT user_id as userId FROM t'),
      'SELECT user_id AS "userId" FROM t'
    );
  });
});

describe('translateDialect: references back to an alias', () => {
  it('quotes an ORDER BY that names a quoted alias', () => {
    // Quoting the alias without quoting the reference produces
    // `column "lastactivity" does not exist` — the SELECT now yields
    // `lastActivity` and the ORDER BY folds to lower case.
    assert.equal(
      translateDialect('SELECT x AS lastActivity FROM t ORDER BY lastActivity DESC'),
      'SELECT x AS "lastActivity" FROM t ORDER BY "lastActivity" DESC'
    );
  });

  it('quotes a GROUP BY the same way', () => {
    assert.equal(
      translateDialect('SELECT a AS userId, b FROM t GROUP BY userId'),
      'SELECT a AS "userId", b FROM t GROUP BY "userId"'
    );
  });

  it('leaves a qualified column of the same name alone', () => {
    // `s.userId` is a column reference, not a reference to the output name.
    assert.equal(
      translateDialect('SELECT s.userId AS userId FROM t'),
      'SELECT s.userId AS "userId" FROM t'
    );
  });

  it('leaves the same word inside a literal alone', () => {
    assert.equal(
      translateDialect("SELECT a AS someName FROM t WHERE note = 'someName'"),
      `SELECT a AS "someName" FROM t WHERE note = 'someName'`
    );
  });

  it('only touches names this statement introduced', () => {
    const sql = 'SELECT lastActivity FROM t ORDER BY lastActivity';
    assert.equal(translateDialect(sql), sql);
  });
});
