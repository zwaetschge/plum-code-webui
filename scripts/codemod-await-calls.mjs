#!/usr/bin/env node
/**
 * Awaits calls that now return a Promise.
 *
 * Keyed on the call, not on the error. A Program plus the type checker gives the
 * return type of every call expression; anything that resolved to a Promise and
 * is not already awaited, returned, chained with .then or collected by
 * Promise.all gets wrapped, and the function containing it becomes async. Repeat
 * until nothing changes: each round makes more functions async, which makes more
 * of their callers wrong.
 *
 * The earlier attempt keyed on compiler error positions and wrapped the innermost
 * node there, which is usually a fragment of the expression that holds the
 * Promise. That produced 773 syntax errors. Wrapping the whole call expression
 * cannot do that.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from '../packages/backend/node_modules/typescript/lib/typescript.js';

const backend = path.resolve('packages/backend');
const rounds = Number(process.argv[process.argv.indexOf('--rounds') + 1]) || 10;
const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1].split(',')
  : null;

function createProgram() {
  const configPath = path.join(backend, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, backend);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

function isPromiseType(type, checker) {
  if (!type) return false;
  const symbol = type.getSymbol?.() ?? type.symbol;
  if (symbol?.getName?.() === 'Promise') return true;
  // A union such as Promise<T> | undefined still needs awaiting.
  if (type.isUnion?.()) return type.types.some((t) => isPromiseType(t, checker));
  return false;
}

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
    if (ts.isClassDeclaration(current) || ts.isSourceFile(current)) return null;
    current = current.parent;
  }
  return null;
}

/** Places where a Promise is the intended value and must stay unawaited. */
function alreadyHandled(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isAwaitExpression(parent)) return true;
  // `return db.get(...)` from an async function is fine as it stands.
  if (ts.isReturnStatement(parent)) return true;
  // .then / .catch / .finally chains
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    return ['then', 'catch', 'finally'].includes(parent.name.text);
  }
  // Promise.all([...]) and friends, and `void somePromise`
  if (ts.isArrayLiteralExpression(parent)) return true;
  if (ts.isVoidExpression(parent)) return true;
  return false;
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

let total = 0;

for (let round = 1; round <= rounds; round++) {
  const program = createProgram();
  const checker = program.getTypeChecker();
  let applied = 0;

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (!sourceFile.fileName.startsWith(path.join(backend, 'src'))) continue;
    if (only && !only.some((fragment) => sourceFile.fileName.includes(fragment))) continue;

    const edits = [];
    const asyncTargets = new Set();
    const text = sourceFile.getFullText();

    const visit = (node) => {
      if (ts.isCallExpression(node) && !alreadyHandled(node)) {
        const type = checker.getTypeAtLocation(node);
        if (isPromiseType(type, checker)) {
          const fn = enclosingFunction(node);
          // A promise at module top level has nowhere to be awaited from.
          if (fn) {
            edits.push({
              start: node.getStart(sourceFile),
              end: node.end,
              replacement: `(await ${text.slice(node.getStart(sourceFile), node.end)})`,
            });
            if (!(fn.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
              asyncTargets.add(fn);
            }
            return; // do not descend: inner calls get their turn next round
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);

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

    if (!edits.length) continue;
    let out = text;
    for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
      out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
    }
    fs.writeFileSync(sourceFile.fileName, out);
    applied += edits.length;
  }

  total += applied;
  console.log(`round ${round}: ${applied} edits`);
  if (!applied) break;
}

console.log(`${total} edits total`);
