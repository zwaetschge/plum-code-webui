#!/usr/bin/env node
/**
 * Rewrites better-sqlite3 call sites to the async Postgres helpers.
 *
 * Done with the TypeScript compiler rather than regexes because 290 of the 536
 * call sites put the SQL on its own lines, so the statement text spans the
 * pattern a line-based replace would need to match. The AST gives the exact
 * span of `db.prepare(<sql>).get(<args>)` regardless of formatting.
 *
 * What it rewrites:
 *   db.prepare(SQL).get(a, b)   ->  await pgGet(SQL, a, b)
 *   db.prepare(SQL).all(a)      ->  await pgAll(SQL, a)
 *   db.prepare(SQL).run(a)      ->  await pgRun(SQL, a)
 *
 * What it deliberately leaves alone, because a mechanical answer would be wrong:
 *   - `const stmt = db.prepare(...)` reused in a loop: the point of preparing
 *     once is gone, and the rewrite depends on what the loop does.
 *   - `db.transaction(fn)`: the callback runs synchronously in better-sqlite3;
 *     each one needs reading to decide what belongs inside the transaction.
 *   - `.exec()`, `.pragma()`: DDL and SQLite-specific settings.
 *
 * It reports those so the remaining work is a list, not a search.
 *
 * Usage: node scripts/codemod-sqlite-to-pg.mjs <file...> [--write]
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from '../packages/backend/node_modules/typescript/lib/typescript.js';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const files = args.filter((a) => !a.startsWith('--'));

if (!files.length) {
  console.error('usage: node scripts/codemod-sqlite-to-pg.mjs <file...> [--write]');
  process.exit(1);
}

const METHOD_MAP = { get: 'pgGet', all: 'pgAll', run: 'pgRun' };

/** `db.prepare(...)` / `getDatabase().prepare(...)` / `database.prepare(...)` */
function isPrepareCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'prepare'
  );
}

/** The function, method or arrow whose body contains `node`. */
function enclosingFunction(node) {
  let current = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function hasAsyncModifier(fn) {
  return (fn.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
}

/**
 * `async` goes after the modifiers, not before them.
 *
 * `fn.getStart()` returns the start of the first modifier, so inserting there
 * produces `async export function`, which is not valid TypeScript. The parser is
 * error-tolerant and reads it as an expression statement `async` followed by
 * `export function`, so nothing crashes — the next round rewrites the file and
 * the `export` silently disappears. That cost 45 broken exports before it was
 * spotted, because the only symptom is an import error in a different file.
 */
function asyncInsertion(fn, sourceFile) {
  const modifiers = (fn.modifiers ?? []).filter((m) => !ts.isDecorator?.(m));
  if (!modifiers.length) {
    const start = fn.getStart(sourceFile);
    return { start, end: start, replacement: 'async ' };
  }
  const last = modifiers[modifiers.length - 1];
  return { start: last.end, end: last.end, replacement: ' async' };
}

function analyse(sourceFile, text) {
  const edits = [];
  const manual = [];
  const asCasts = [];
  const asyncTargets = new Set();

  const visit = (node) => {
    // db.prepare(SQL).get(args)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      METHOD_MAP[node.expression.name.text] &&
      isPrepareCall(node.expression.expression)
    ) {
      const prepare = node.expression.expression;
      const sql = prepare.arguments[0];
      if (sql) {
        const sqlText = text.slice(sql.pos, sql.end).trim();
        const callArgs = node.arguments.map((a) => text.slice(a.pos, a.end).trim());
        // Parenthesised: the result is often immediately cast or a property is
        // read off it, and `await x as T` parses as `await (x as T)`.
        const replacement = `(await ${METHOD_MAP[node.expression.name.text]}(${[sqlText, ...callArgs].join(', ')}))`;
        edits.push({ start: node.getStart(sourceFile), end: node.end, replacement });

        // The helpers return Record<string, unknown>; the existing casts go
        // straight to a row interface, which TypeScript refuses without a step
        // through unknown.
        if (ts.isAsExpression(node.parent)) {
          asCasts.push({ start: node.parent.type.getStart(sourceFile) });
        }

        // A handler that gained an await has to be async.
        const fn = enclosingFunction(node);
        if (fn && !hasAsyncModifier(fn)) asyncTargets.add(fn);
      }
      return;
    }

    // Patterns that need a human.
    if (isPrepareCall(node)) {
      const parent = node.parent;
      const reused = ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent);
      if (reused) {
        manual.push({
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          kind: 'reused prepared statement',
        });
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['transaction', 'exec', 'pragma'].includes(node.expression.name.text)
    ) {
      manual.push({
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        kind: node.expression.name.text + '()',
      });
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  // `as T` -> `as unknown as T`
  for (const cast of asCasts) {
    edits.push({ start: cast.start, end: cast.start, replacement: 'unknown as ' });
  }

  // `(req, res) => {` -> `async (req, res) => {`, and a declared return type
  // has to become a Promise or TypeScript rejects the function outright.
  for (const fn of asyncTargets) {
    edits.push(asyncInsertion(fn, sourceFile));

    if (fn.type && !/^Promise</.test(text.slice(fn.type.pos, fn.type.end).trim())) {
      edits.push({
        start: fn.type.getStart(sourceFile),
        end: fn.type.getStart(sourceFile),
        replacement: 'Promise<',
      });
      edits.push({ start: fn.type.end, end: fn.type.end, replacement: '>' });
    }
  }

  // `const db = getDatabase();` is dead once every call on it was rewritten.
  // The exceptions are the three things this codemod does not touch — a
  // transaction, exec() or pragma() still needs the handle — so a file keeping
  // any of those keeps its declarations too.
  const keepsHandle = /\.(transaction|exec|pragma)\(/.test(text);
  const deadDbDecls = [];
  if (!keepsHandle) {
    const findDead = (node) => {
      if (
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.length === 1 &&
        node.declarationList.declarations[0].initializer &&
        /getDatabase\(\)$/.test(
          text
            .slice(
              node.declarationList.declarations[0].initializer.pos,
              node.declarationList.declarations[0].initializer.end
            )
            .trim()
        )
      ) {
        deadDbDecls.push({ start: node.getStart(sourceFile), end: node.end });
      }
      ts.forEachChild(node, findDead);
    };
    ts.forEachChild(sourceFile, findDead);
  }

  return { edits, manual, deadDbDecls };
}

let totalEdits = 0;
const summary = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const { edits, manual, deadDbDecls } = analyse(sourceFile, text);

  if (WRITE && edits.length) {
    // Back to front so earlier offsets stay valid.
    let out = text;
    for (const dead of deadDbDecls) {
      edits.push({ start: dead.start, end: dead.end, replacement: '' });
    }
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
    }
    if (!/from '\.\.\/db\/pg\.js'|from '\.\/pg\.js'/.test(out)) {
      const rel = path
        .relative(path.dirname(file), 'packages/backend/src/db/pg.js')
        .replace(/^(?!\.)/, './');
      out = `import { get as pgGet, all as pgAll, run as pgRun } from '${rel}';\n` + out;
    }
    fs.writeFileSync(file, out);
  }

  totalEdits += edits.length;
  summary.push({
    file: file.replace(/^.*backend\/src\//, ''),
    auto: edits.length,
    manual: manual.length,
  });
}

summary.sort((a, b) => b.manual - a.manual || b.auto - a.auto);
console.log(`${WRITE ? 'Rewrote' : 'Would rewrite'} ${totalEdits} call sites\n`);
console.log('file'.padEnd(48) + 'auto'.padStart(6) + 'manual'.padStart(8));
for (const row of summary) {
  if (!row.auto && !row.manual) continue;
  console.log(row.file.padEnd(48) + String(row.auto).padStart(6) + String(row.manual).padStart(8));
}
const manualTotal = summary.reduce((sum, r) => sum + r.manual, 0);
console.log(`\n${totalEdits} mechanical, ${manualTotal} need reading.`);
