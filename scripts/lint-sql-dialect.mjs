#!/usr/bin/env node
/**
 * Finds SQLite-only SQL in statements that now run on Postgres.
 *
 * The type checker cannot see inside a SQL string, so the port compiles cleanly
 * while `INSERT OR IGNORE` is a syntax error and `datetime('now')` is an
 * undefined function. This walks the AST for calls to the pg helpers and checks
 * the statement each one carries.
 *
 * Each statement is run through `translateDialect` first, the same function the
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
const program = ts.createProgram(parsed.fileNames, parsed.options);

const HELPERS = new Set(['pgGet', 'pgAll', 'pgRun']);
const TX_METHODS = new Set(['get', 'all', 'run']);

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
    id: 'limit-negative',
    severity: 'error',
    test: /\bLIMIT\s+-1\b/i,
    hint: 'Postgres has no LIMIT -1; drop the clause or use LIMIT ALL',
  },

];

const findings = [];

for (const sourceFile of program.getSourceFiles()) {
  if (sourceFile.isDeclarationFile) continue;
  if (!sourceFile.fileName.startsWith(path.join(backend, 'src'))) continue;
  if (sourceFile.fileName.endsWith('.test.ts')) continue;
  // The SQLite side of the migration keeps its own dialect on purpose.
  if (/src\/db\/(index|migrations)\.ts$/.test(sourceFile.fileName)) continue;

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isHelper =
        (ts.isIdentifier(callee) && HELPERS.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) &&
          TX_METHODS.has(callee.name.text) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'tx');

      const sqlArg = isHelper ? node.arguments[0] : null;
      if (sqlArg && (ts.isStringLiteral(sqlArg) || ts.isTemplateLiteral(sqlArg) || ts.isNoSubstitutionTemplateLiteral(sqlArg))) {
        const raw = sourceFile.getFullText().slice(sqlArg.getStart(sourceFile), sqlArg.end);
        // What Postgres will actually receive.
        const sql = translateDialect(raw);
        for (const rule of RULES) {
          if (rule.test.test(sql)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(sqlArg.getStart(sourceFile));
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
