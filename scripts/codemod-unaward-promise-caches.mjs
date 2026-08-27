#!/usr/bin/env node
/**
 * Removes the awaits the async conversion put on in-flight promise caches.
 *
 * `codemod-await-calls` awaits any call whose type is a Promise. That is right
 * for a query and wrong for a deduplication cache: `jobs.get(key)` returning a
 * Promise is the whole point of the cache, and

 *     const existing = await jobs.get(key);
 *     if (existing) return existing;
 *     const job = await startJob();
 *     jobs.set(key, job);
 *
 * stores a resolved value where a promise belongs and waits for the previous
 * job before checking whether one is running — which is exactly the
 * serialisation the cache exists to avoid. It compiles, and the only visible
 * symptom is a type error somewhere downstream.
 *
 * Anything whose declared type is `Promise<T>` — a `Map<K, Promise<T>>` value, a
 * `Promise<T> | null` field — is a value to be held, not awaited at the point it
 * is read or written.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from '../packages/backend/node_modules/typescript/lib/typescript.js';

const backend = path.resolve('packages/backend');
const config = ts.readConfigFile(path.join(backend, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, backend);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

/** `Map<K, Promise<T>>`, `Promise<T> | null`, `Promise<T>` — anything holding one. */
function holdsPromise(type) {
  if (!type) return false;
  const symbol = type.getSymbol?.() ?? type.symbol;
  if (symbol?.getName?.() === 'Promise') return true;
  if (type.isUnion?.()) return type.types.some(holdsPromise);
  if (symbol && ['Map', 'WeakMap'].includes(symbol.getName?.())) {
    const args = checker.getTypeArguments?.(type) ?? [];
    return args.some(holdsPromise);
  }
  return false;
}

/**
 * The producer side of the same mistake.
 *
 * `const job = await start(); jobs.set(key, job)` stores a resolved value in a
 * cache of promises. The read side is handled above; this finds the write.
 */
function producesForCache(declaration, checker) {
  if (!ts.isVariableDeclaration(declaration)) return false;
  if (!declaration.initializer || !ts.isAwaitExpression(declaration.initializer)) return false;
  const name = declaration.name;
  if (!ts.isIdentifier(name)) return false;

  const fn = (() => {
    for (let n = declaration.parent; n; n = n.parent) {
      if (ts.isFunctionLike(n)) return n;
      if (ts.isSourceFile(n)) return n;
    }
    return null;
  })();
  if (!fn) return false;

  let stored = false;
  const scan = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'set' &&
      node.arguments.some((a) => ts.isIdentifier(a) && a.text === name.text) &&
      holdsPromise(checker.getTypeAtLocation(node.expression.expression))
    ) {
      stored = true;
    }
    ts.forEachChild(node, scan);
  };
  ts.forEachChild(fn, scan);
  return stored;
}

let total = 0;
const touched = [];

for (const sourceFile of program.getSourceFiles()) {
  if (sourceFile.isDeclarationFile) continue;
  if (!sourceFile.fileName.startsWith(path.join(backend, 'src'))) continue;

  const text = sourceFile.getFullText();
  const edits = [];

  const visit = (node) => {
    if (ts.isAwaitExpression(node)) {
      // `await cache.get(k)` / `await cache.set(k, v)` — the container's value
      // type is what decides, not the call's return type.
      const inner = node.expression;
      let container = null;
      if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression)) {
        if (['get', 'set'].includes(inner.expression.name.text)) {
          container = inner.expression.expression;
        }
      } else if (ts.isPropertyAccessExpression(inner) || ts.isIdentifier(inner)) {
        container = inner;
      }

      if (container && holdsPromise(checker.getTypeAtLocation(container))) {
        const start = node.getStart(sourceFile);
        edits.push({
          start,
          end: node.end,
          replacement: text.slice(inner.getStart(sourceFile), node.end),
        });
        return;
      }
    }
    // `cache = await produce()` where the field itself holds the promise.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isAwaitExpression(node.right) &&
      holdsPromise(checker.getTypeAtLocation(node.left))
    ) {
      const start = node.right.getStart(sourceFile);
      edits.push({
        start,
        end: node.right.end,
        replacement: text.slice(node.right.expression.getStart(sourceFile), node.right.end),
      });
      return;
    }

    if (ts.isVariableDeclaration(node) && producesForCache(node, checker)) {
      const start = node.initializer.getStart(sourceFile);
      edits.push({
        start,
        end: node.initializer.end,
        replacement: text.slice(node.initializer.expression.getStart(sourceFile), node.initializer.end),
      });
      return;
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  if (!edits.length) continue;
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  fs.writeFileSync(sourceFile.fileName, out);
  total += edits.length;
  touched.push(`${sourceFile.fileName.replace(backend + '/', '')}: ${edits.length}`);
}

for (const line of touched) console.log('  ' + line);
console.log(`${total} awaits removed from promise caches`);
