/**
 * The SQLite dialect the statements are written in, translated for Postgres.
 *
 * Kept apart from the connection pool on purpose: this is pure string work with
 * no dependencies, so it can be unit-tested exhaustively and imported by
 * `scripts/lint-sql-dialect.mjs`, which checks that nothing SQLite-only survives
 * translation. Importing it from pg.ts would drag a pool and a logger into a
 * static analysis script.
 */

/**
 * Splits a statement into code and string-literal spans.
 *
 * Every rewrite below has to leave literals alone: `WHERE note = '?'` must not
 * become `WHERE note = '$1'`, and a row whose text happens to contain
 * `CURRENT_TIMESTAMP` must come back unchanged.
 */
function* spans(sql: string): Generator<{ text: string; literal: boolean }> {
  let start = 0;
  let quote: string | null = null;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!;

    if (quote) {
      if (char === quote) {
        // '' inside a single-quoted string is an escaped quote, not the end.
        if (quote === "'" && sql[i + 1] === "'") {
          i++;
          continue;
        }
        yield { text: sql.slice(start, i + 1), literal: true };
        start = i + 1;
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      if (i > start) yield { text: sql.slice(start, i), literal: false };
      start = i;
      quote = char;
    }
  }

  if (start < sql.length) yield { text: sql.slice(start), literal: quote !== null };
}

/** Rewrites SQLite's `?` into Postgres's `$n`. */
export function convertPlaceholders(sql: string): string {
  let out = '';
  let index = 0;

  for (const span of spans(sql)) {
    out += span.literal ? span.text : span.text.replace(/\?/g, () => `$${++index}`);
  }

  return out;
}

/**
 * The timestamp shape the schema and the code both assume.
 *
 * `created_at` and friends are TEXT holding `YYYY-MM-DD HH:MM:SS` in UTC —
 * what SQLite's CURRENT_TIMESTAMP produces — and 161 places compare, slice and
 * sort those strings. Postgres's CURRENT_TIMESTAMP is a timestamptz whose text
 * form carries fractional seconds and an offset, so writing it into those
 * columns would produce values that sort and compare differently from every row
 * already there. Formatting explicitly keeps old and new rows in one order.
 */
const UTC_TIMESTAMP = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;

/**
 * SQLite's strftime format into to_char's.
 *
 * Anything that is not a `%` token is literal text, and to_char treats bare
 * letters as pattern characters — an unquoted `T` in `%Y-%m-%dT...` would be
 * read as a format code and silently produce garbage. Literal runs are
 * double-quoted so they come back as themselves.
 */
const STRFTIME_TOKENS: Record<string, string> = {
  Y: 'YYYY',
  m: 'MM',
  d: 'DD',
  H: 'HH24',
  M: 'MI',
  S: 'SS',
  // SQLite's %f is seconds with milliseconds, not just the fraction.
  f: 'SS.MS',
  j: 'DDD',
  W: 'WW',
  w: 'D',
};

function translateStrftimeFormat(format: string): string | null {
  let out = '';
  let literal = '';

  const flush = () => {
    if (!literal) return;
    // Only letters and digits can be mistaken for pattern characters; quoting
    // separators too would work but makes every generated statement unreadable.
    out += /[A-Za-z0-9]/.test(literal) ? `"${literal.replace(/"/g, '')}"` : literal;
    literal = '';
  };

  for (let i = 0; i < format.length; i++) {
    if (format[i] === '%' && i + 1 < format.length) {
      const token = STRFTIME_TOKENS[format[i + 1]!];
      if (!token) return null;
      flush();
      out += token;
      i++;
      continue;
    }
    // Each literal run is flushed on its own so a separator between two tokens
    // does not get swallowed into a quoted span with the next word.
    literal += format[i];
    if (!/[A-Za-z0-9]/.test(format[i]!)) flush();
  }
  flush();

  return out;
}

/** `strftime('%Y-%m-%dT%H:%M:%fZ', created_at)` and `strftime('%s', col)`. */
function translateStrftime(args: string): string | null {
  const match = /^'([^']*)'\s*,\s*([\s\S]+)$/.exec(args.trim());
  if (!match) return null;
  const [, format, column] = match;

  // The columns are TEXT holding 'YYYY-MM-DD HH:MM:SS', so they need a cast
  // before any date function will look at them.
  const value = `(${column!.trim()})::timestamp`;

  if (format === '%s') return `EXTRACT(EPOCH FROM ${value})`;

  const pattern = translateStrftimeFormat(format!);
  return pattern === null ? null : `to_char(${value}, '${pattern}')`;
}

/** `datetime('now', '-7 days')` and its variants. */
function translateDatetime(args: string): string | null {
  const parts = args.split(',').map((part) => part.trim());
  if (!parts.length || !/^'now'$/i.test(parts[0]!)) return null;

  let expression = "now() AT TIME ZONE 'UTC'";
  for (const modifier of parts.slice(1)) {
    // A bound parameter carries the modifier at runtime. SQLite's syntax for
    // one — '+30 seconds' — is also valid interval input, so it goes through
    // the cast unchanged rather than being parsed here.
    if (modifier === '?') {
      expression = `${expression} + (?)::interval`;
      continue;
    }
    // Literal modifiers are strings like '-7 days' or '+1 hour'.
    const match = /^'([+-]?)\s*(\d+)\s+(second|minute|hour|day|month|year)s?'$/i.exec(modifier);
    if (!match) return null;
    const sign = match[1] === '-' ? '-' : '+';
    expression = `${expression} ${sign} interval '${match[2]} ${match[3]!.toLowerCase()}'`;
  }

  return `to_char(${expression}, 'YYYY-MM-DD HH24:MI:SS')`;
}

/**
 * Rewrites `name(...)` calls, matching the closing paren rather than assuming
 * the arguments contain none.
 */
function replaceCall(
  sql: string,
  name: string,
  translate: (args: string) => string | null
): string {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'gi');
  let out = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(sql))) {
    if (match.index < cursor) continue;
    let depth = 1;
    let i = pattern.lastIndex;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
      i++;
    }
    if (depth !== 0) break;

    const args = sql.slice(pattern.lastIndex, i - 1);
    const replacement = translate(args);
    out += sql.slice(cursor, match.index) + (replacement ?? sql.slice(match.index, i));
    cursor = i;
    pattern.lastIndex = i;
  }

  return out + sql.slice(cursor);
}

/**
 * Translates the SQLite dialect the statements are written in.
 *
 * Done here rather than at the call sites because it is the same two constructs
 * in 120 statements, and a translation in one place can be tested once instead
 * of reviewed 120 times. Anything that needs a real decision — `INSERT OR
 * IGNORE` without a conflict target, `rowid` as an ordering key — is not
 * translated and was rewritten by hand instead; `scripts/lint-sql-dialect.mjs`
 * is what proves none are left.
 */
export function translateDialect(sql: string): string {
  let out = '';

  for (const span of spans(sql)) {
    if (span.literal) {
      out += span.text;
      continue;
    }

    let text = span.text.replace(/\bCURRENT_TIMESTAMP\b/gi, UTC_TIMESTAMP);

    // `chat_id IS ?` is SQLite's null-safe equality, used so one query handles
    // both "the default chat" (NULL) and a named one. Postgres allows IS only
    // with NULL/TRUE/FALSE/UNKNOWN, so this is a syntax error rather than a
    // wrong answer — every message query would have failed on the first call.
    text = text.replace(/\bIS\s+\?/gi, 'IS NOT DISTINCT FROM ?');

    // datetime(...) needs its arguments, which the span split may have cut in
    // half; it is matched against the whole statement below instead.
    out += text;
  }

  // Balanced, because the argument is often a subquery:
  // `strftime(fmt, COALESCE((SELECT MAX(...) FROM ...), s.updated_at))`. A
  // `[^()]*` match stops at the first inner paren and silently leaves the call
  // untranslated.
  out = replaceCall(out, 'datetime', translateDatetime);
  out = replaceCall(out, 'strftime', translateStrftime);

  return out;
}
