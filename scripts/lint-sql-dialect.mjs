#!/usr/bin/env node
/**
 * Finds SQLite-only SQL in statements that now run on Postgres.
 *
 * The type checker cannot see inside a SQL string, so the port compiles cleanly
 * while `INSERT OR IGNORE` is a syntax error and `datetime('now')` is an
 * undefined function. This walks the AST for calls to the pg helpers and checks
 * the statement each one carries.
 *
 * Every string and template literal that looks like SQL is checked, not just the
 * ones passed directly to a helper: a good part of this codebase builds
 * statements from fragments returned by functions like `sessionIconSelect`, and
 * an earlier version that only looked at the helpers' first argument missed
 * `instr()` and a negative `substr()` hiding in two of them.
 *
 * Each candidate is run through `translateDialect` first, the same function the
 * query layer applies at runtime, and the rules are checked against what comes
 * out. So the linter never has to keep a second list of what the translator
 * covers: if a construct survives translation, it reaches Postgres, and that is
 * exactly what gets reported.
 *
 * Usage: node scripts/lint-sql-dialect.mjs [--json]
 */

import path from 'node:path';
import ts from '../packages/backend/node_modules/typescript/lib/typescript.js';
import { translateDialect } from '../packages/backend/src/db/dialect.ts';

const backend = path.resolve('packages/backend');
const config = ts.readConfigFile(path.join(backend, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, backend);

/**
 * Parsed per file with parent pointers, not through a Program.
 *
 * `createProgram` sets parents lazily — only once something asks the checker
 * for types — so walking up from a node silently hit `undefined` and every
 * literal looked like it was outside a `prepare()` call. No types are needed
 * here anyway, and parsing alone is far quicker.
 */
const sourceFiles = parsed.fileNames.map((fileName) =>
  ts.createSourceFile(
    fileName,
    ts.sys.readFile(fileName) ?? '',
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true
  )
);

/**
 * A literal is SQL if it reads like a statement or a fragment of one.
 *
 * Deliberately generous: a false positive costs one look, a false negative is a
 * statement that fails in production. The rules below are specific enough that
 * ordinary prose does not trip them.
 */
const SQL_SHAPE =
  /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(TABLE|INDEX)|ALTER\s+TABLE|JOIN|WHERE|ORDER\s+BY|GROUP\s+BY|COALESCE|\bAS\s+\w+\s*$)/i;

function looksLikeSql(text) {
  return SQL_SHAPE.test(text);
}

/**
 * True for a literal that belongs to a deliberate better-sqlite3 call.
 *
 * Three readers open Codex's own state file and the backup verifier opens a
 * copy it made; those are SQLite databases and their SQL should stay SQLite.
 * Without this the linter reports its own correct code.
 */
function insideSqliteCall(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      ['prepare', 'exec', 'pragma'].includes(current.expression.name.text)
    ) {
      return true;
    }
    // A fragment assigned to a variable and interpolated into a prepare() call
    // later is still SQLite; the walk up stops at the function that holds both.
    if (ts.isSourceFile(current)) return false;
  }
  return false;
}

const RULES = [
  {
    id: 'insert-or-ignore',
    severity: 'error',
    test: /\bINSERT\s+OR\s+(IGNORE|REPLACE|ABORT|FAIL|ROLLBACK)\b/i,
    hint: 'use ON CONFLICT ... DO NOTHING / DO UPDATE',
  },
  {
    // `datetime('now', ...)` is handled by translateDialect in db/pg.ts; the
    // other three are not, and would reach Postgres as undefined functions.
    id: 'datetime-fn',
    severity: 'error',
    test: /\b(datetime|strftime|julianday|unixepoch)\s*\(/i,
    hint: 'no Postgres equivalent, and translateDialect did not handle this form',
  },
  {
    id: 'json-fn',
    severity: 'error',
    test: /\bjson_(extract|valid|each|array_length|type|quote)\s*\(/i,
    hint: "use ->> / #>> operators, or a jsonb cast",
  },

  { id: 'pragma', severity: 'error', test: /\bPRAGMA\b/i, hint: 'SQLite-only' },
  { id: 'sqlite-master', severity: 'error', test: /\bsqlite_master\b/i, hint: 'SQLite-only' },
  { id: 'rowid', severity: 'error', test: /\browid\b/i, hint: 'SQLite-only implicit column' },
  { id: 'autoincrement', severity: 'error', test: /\bAUTOINCREMENT\b/i, hint: 'use BIGSERIAL' },
  {
    id: 'glob',
    severity: 'error',
    test: /\bGLOB\b/,
    hint: 'use LIKE or ~',
  },
  {
    id: 'ifnull',
    severity: 'error',
    test: /\bIFNULL\s*\(/i,
    hint: 'use COALESCE',
  },
  {
    id: 'group-concat',
    severity: 'error',
    test: /\bGROUP_CONCAT\s*\(/i,
    hint: 'use string_agg',
  },
  {
    // `x IS ?` is SQLite's null-safe equality. Postgres only allows IS with
    // NULL/TRUE/FALSE/UNKNOWN or DISTINCT FROM, so this is a syntax error.
    id: 'is-null-safe-compare',
    severity: 'error',
    test: /\bIS\s+(\?|\$\d)/i,
    hint: 'use IS NOT DISTINCT FROM',
  },
  {
    id: 'instr',
    severity: 'error',
    test: /\binstr\s*\(/i,
    hint: 'use strpos (note the argument order is the same)',
  },
  {
    id: 'hex',
    severity: 'error',
    test: /\bhex\s*\(/i,
    hint: "use encode(convert_to(x, 'UTF8'), 'hex')",
  },
  {
    // SQLite counts a negative start from the end of the string; Postgres
    // treats it as a position before the start and returns the whole thing.
    id: 'negative-substr',
    severity: 'wrong',
    test: /\bsubstr\s*\([^,]+,\s*-\d/i,
    hint: 'use right(x, n)',
  },
  {
    id: 'printf',
    severity: 'error',
    test: /\bprintf\s*\(/i,
    hint: 'use format()',
  },
  {
    id: 'sqlite-scalar',
    severity: 'error',
    test: /\b(typeof|randomblob|zeroblob|last_insert_rowid|total_changes|likelihood)\s*\(/i,
    hint: 'SQLite-only scalar function',
  },
  {
    id: 'limit-negative',
    severity: 'error',
    test: /\bLIMIT\s+-1\b/i,
    hint: 'Postgres has no LIMIT -1; drop the clause or use LIMIT ALL',
  },

];

const findings = [];

for (const sourceFile of sourceFiles) {
  if (sourceFile.isDeclarationFile) continue;
  if (!sourceFile.fileName.startsWith(path.join(backend, 'src'))) continue;
  if (sourceFile.fileName.endsWith('.test.ts')) continue;
  // The SQLite side of the migration keeps its own dialect on purpose.
  if (/src\/db\/(index|migrations)\.ts$/.test(sourceFile.fileName)) continue;

  const visit = (node) => {
    const isLiteral =
      ts.isStringLiteral(node) ||
      ts.isTemplateExpression(node) ||
      ts.isNoSubstitutionTemplateLiteral(node);

    if (isLiteral) {
      // The delimiters have to go before translation: translateDialect skips
      // string literals, and a leading quote makes it treat the whole statement
      // as one — which silently reports every construct as untranslated.
      const raw = sourceFile
        .getFullText()
        .slice(node.getStart(sourceFile), node.end)
        .replace(/^[`'"]/, '')
        .replace(/[`'"]$/, '');
      if (looksLikeSql(raw) && !insideSqliteCall(node)) {
        // What Postgres will actually receive.
        const sql = translateDialect(raw);
        for (const rule of RULES) {
          if (rule.test.test(sql)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            findings.push({
              file: sourceFile.fileName.replace(backend + '/', ''),
              line: line + 1,
              rule: rule.id,
              severity: rule.severity,
              hint: rule.hint,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  const order = [...byRule.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [rule, hits] of order) {
    console.log(`\n${hits[0].severity.toUpperCase()}  ${rule} — ${hits.length} sites`);
    console.log(`  ${hits[0].hint}`);
    const files = new Map();
    for (const h of hits) files.set(h.file, (files.get(h.file) ?? 0) + 1);
    for (const [file, count] of [...files].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${file.replace('src/', '')}: ${count}`);
    }
  }
  console.log(`\n${findings.length} findings across ${new Set(findings.map((f) => f.file)).size} files`);
}
