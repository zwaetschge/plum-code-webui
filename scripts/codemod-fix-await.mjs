#!/usr/bin/env node
/**
 * Finishes the Postgres port by following the type checker.
 *
 * The first codemod turned call sites async. Every caller of those functions now
 * holds a Promise where it expects a value, and TypeScript reports each one
 * precisely — `Property 'status' does not exist on type 'Promise<...>'`. That
 * error list is a worklist: insert the missing `await`, mark the enclosing
 * function async, run the compiler again, repeat until it stops complaining.
 *
 * Driven by real compiler output rather than by guessing which functions became
 * async, so it cannot invent an await where the value was never a Promise.
 *
 * KNOWN BROKEN — kept as a record of what not to do. Selecting the node to wrap
 * from an error's line and column picks the innermost node at that position,
 * which is often a fragment of the expression that actually has the Promise
 * type. Wrapping that fragment produced 773 syntax errors across the backend on
 * the first run. Doing this correctly needs ts.createProgram and
 * checker.getTypeAtLocation to identify the Promise-typed expression, then the
 * *whole* expression wrapped — not a guess from a text position.
 *
 * Usage: node scripts/codemod-fix-await.mjs [--rounds N]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ts from '../packages/backend/node_modules/typescript/lib/typescript.js';

const backend = 'packages/backend';
const rounds = Number(process.argv[process.argv.indexOf('--rounds') + 1]) || 12;

function typecheck() {
  try {
    execFileSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], {
      cwd: backend,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return [];
  } catch (error) {
    return String(error.stdout || '')
      .split('\n')
      .filter(Boolean);
  }
}

/** `src/x.ts(12,34): error TS2339: Property 'a' does not exist on type 'Promise<...>'.` */
function parse(line) {
  const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/.exec(line);
  if (!match) return null;
  return {
    file: match[1],
    line: Number(match[2]),
    col: Number(match[3]),
    code: match[4],
    message: match[5],
  };
}

const AWAITABLE = new Set(['TS2339', 'TS2459', 'TS2345', 'TS2322', 'TS2571', 'TS18046']);

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

function nodeAt(sourceFile, position) {
  let found = null;
  const visit = (node) => {
    if (node.getStart(sourceFile) <= position && position < node.end) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

let totalAwaits = 0;

for (let round = 1; round <= rounds; round++) {
  const errors = typecheck().map(parse).filter(Boolean);
  const promiseErrors = errors.filter(
    (e) => AWAITABLE.has(e.code) && /Promise<|'Promise/.test(e.message)
  );
  if (!promiseErrors.length) {
    console.log(`round ${round}: no promise errors left (${errors.length} other errors)`);
    break;
  }

  const byFile = new Map();
  for (const error of promiseErrors) {
    if (!byFile.has(error.file)) byFile.set(error.file, []);
    byFile.get(error.file).push(error);
  }

  let applied = 0;
  for (const [relative, fileErrors] of byFile) {
    const file = path.join(backend, relative);
    const text = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const lineStarts = sourceFile.getLineStarts();
    const edits = [];
    const asyncTargets = new Set();

    for (const error of fileErrors) {
      const position = lineStarts[error.line - 1] + error.col - 1;
      const node = nodeAt(sourceFile, position);
      if (!node) continue;

      // The Promise is the thing being read from, called on, or passed.
      let target = node;
      if (
        ts.isIdentifier(target) &&
        target.parent &&
        ts.isPropertyAccessExpression(target.parent)
      ) {
        target = target.parent.expression;
      }
      while (
        target.parent &&
        ts.isPropertyAccessExpression(target.parent) &&
        target.parent.expression === target
      ) {
        break;
      }
      if (ts.isAwaitExpression(target) || (target.parent && ts.isAwaitExpression(target.parent)))
        continue;

      const start = target.getStart(sourceFile);
      if (edits.some((e) => e.start === start)) continue;
      edits.push({
        start,
        end: target.end,
        replacement: `(await ${text.slice(start, target.end)})`,
      });

      const fn = enclosingFunction(target);
      if (fn && !(fn.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
        asyncTargets.add(fn);
      }
    }

    for (const fn of asyncTargets) {
      const start = fn.getStart(sourceFile);
      edits.push({ start, end: start, replacement: 'async ' });
      if (fn.type && !/^Promise</.test(text.slice(fn.type.pos, fn.type.end).trim())) {
        edits.push({
          start: fn.type.getStart(sourceFile),
          end: fn.type.getStart(sourceFile),
          replacement: 'Promise<',
        });
        edits.push({ start: fn.type.end, end: fn.type.end, replacement: '>' });
      }
    }

    if (!edits.length) continue;
    let out = text;
    for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
      out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
    }
    fs.writeFileSync(file, out);
    applied += edits.length;
  }

  totalAwaits += applied;
  console.log(`round ${round}: ${promiseErrors.length} promise errors, ${applied} edits`);
  if (!applied) break;
}

console.log(`\n${totalAwaits} edits total`);
