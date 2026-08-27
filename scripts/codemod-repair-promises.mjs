#!/usr/bin/env node
/**
 * Repairs the three ways the async conversion goes wrong, driven by the
 * compiler's own diagnostics.
 *
 * Unlike the earlier error-position codemod, nothing here edits at the error
 * position. The position only selects *which* node to look at; every edit is
 * made to a whole call expression, a whole type node or a function's modifier
 * list, so a fragment can never be wrapped in isolation.
 *
 *   missing-await   `Property 'x' does not exist on type 'Promise<T>'`
 *                   The call was skipped because it sits in a return or an
 *                   assignment. Wrap the enclosing call, make its function async.
 *
 *   missing-async   `Type 'T' is not assignable to type 'Promise<T>'`
 *                   The return type was widened but the `async` keyword was lost
 *                   to the modifier bug. Put it back.
 *
 *   over-wrapped    `Argument of type 'T' is not assignable to parameter of
 *                   type 'Promise<T>'`
 *                   `Promise<` landed on a parameter type rather than a return
 *                   type. Unwrap it.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from '../packages/backend/node_modules/typescript/lib/typescript.js';

const backend = path.resolve('packages/backend');

function program() {
  const config = ts.readConfigFile(path.join(backend, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, backend);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

/** The deepest node covering `position`. */
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

/**
 * The expression that has to be awaited for a diagnostic to go away.
 *
 * The diagnostic points at the *property* — `resolved.userId` reports on
 * `userId` — so searching from that position finds nothing awaitable. The
 * promise is one level out, on `resolved`, and if that is a variable the actual
 * fix belongs on its initialiser several lines earlier. Following the symbol to
 * its declaration is what puts the `await` where it does something.
 */
function awaitTarget(sourceFile, position, checker) {
  const node = nodeAt(sourceFile, position);
  if (!node) return null;

  let holder = node;
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
    holder = node.parent.expression;
  } else if (ts.isIdentifier(node)) {
    holder = node;
  }

  if (ts.isCallExpression(holder) || ts.isAwaitExpression(holder.parent)) {
    return ts.isAwaitExpression(holder.parent) ? null : holder;
  }

  if (ts.isIdentifier(holder)) {
    const symbol = checker.getSymbolAtLocation(holder);
    const declaration = symbol?.declarations?.[0];
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      !ts.isAwaitExpression(declaration.initializer)
    ) {
      return declaration.initializer;
    }
  }

  return null;
}

function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    if (ts.isSourceFile(current)) return null;
  }
  return null;
}

/** After the modifiers, never before them — `async export function` is invalid. */
function asyncEdit(fn, sourceFile) {
  if ((fn.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return null;
  const modifiers = fn.modifiers ?? [];
  if (!modifiers.length) {
    const start = fn.getStart(sourceFile);
    return { start, end: start, replacement: 'async ' };
  }
  const last = modifiers[modifiers.length - 1];
  return { start: last.end, end: last.end, replacement: ' async' };
}

let rounds = 0;
let totalEdits = 0;

for (let round = 1; round <= 8; round++) {
  rounds = round;
  const prog = program();
  const diagnostics = ts.getPreEmitDiagnostics(prog).filter((d) => d.file && d.start != null);
  const perFile = new Map();

  for (const diagnostic of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    const sourceFile = diagnostic.file;
    if (!sourceFile.fileName.startsWith(path.join(backend, 'src'))) continue;
    const push = (edit) => {
      if (!edit) return;
      if (!perFile.has(sourceFile.fileName)) perFile.set(sourceFile.fileName, []);
      perFile.get(sourceFile.fileName).push(edit);
    };

    // missing-await
    if (
      (diagnostic.code === 2339 || diagnostic.code === 2740 || diagnostic.code === 2739) &&
      /\bPromise</.test(message)
    ) {
      const target = awaitTarget(sourceFile, diagnostic.start, prog.getTypeChecker());
      if (!target) continue;
      const targetFile = target.getSourceFile();
      const start = target.getStart(targetFile);
      const raw = targetFile.getFullText().slice(start, target.end);
      if (!perFile.has(targetFile.fileName)) perFile.set(targetFile.fileName, []);
      perFile.get(targetFile.fileName).push({
        start,
        end: target.end,
        replacement: `(await ${raw})`,
      });
      const fn = enclosingFunction(target);
      if (fn) {
        const edit = asyncEdit(fn, targetFile);
        if (edit) perFile.get(targetFile.fileName).push(edit);
      }
      continue;
    }

    // missing-async: a return whose declared type is a Promise the body never makes.
    if (diagnostic.code === 2322 && /is not assignable to type 'Promise</.test(message)) {
      const node = nodeAt(sourceFile, diagnostic.start);
      const fn = node && enclosingFunction(node);
      if (fn) push(asyncEdit(fn, sourceFile));
      continue;
    }

    // over-wrapped parameter type.
    if (diagnostic.code === 2345 && /parameter of type 'Promise</.test(message)) {
      const call = nodeAt(sourceFile, diagnostic.start);
      const callNode = call && (ts.isCallExpression(call) ? call : call.parent && ts.isCallExpression(call.parent) ? call.parent : null);
      const signature = call && callNode && prog.getTypeChecker().getResolvedSignature(callNode);
      const declaration = signature?.getDeclaration();
      if (!declaration) continue;
      const index = callNode.arguments.findIndex(
        (a) => a.getStart(sourceFile) <= diagnostic.start && diagnostic.start < a.end
      );
      const parameter = declaration.parameters?.[index];
      const type = parameter?.type;
      if (!type) continue;
      const declFile = declaration.getSourceFile();
      const raw = declFile.getFullText().slice(type.getStart(declFile), type.end);
      const inner = /^Promise<([\s\S]*)>$/.exec(raw.trim());
      if (!inner) continue;
      if (!perFile.has(declFile.fileName)) perFile.set(declFile.fileName, []);
      perFile.get(declFile.fileName).push({
        start: type.getStart(declFile),
        end: type.end,
        replacement: inner[1],
      });
      continue;
    }
  }

  if (!perFile.size) break;

  let applied = 0;
  for (const [file, edits] of perFile) {
    // One edit per span; duplicates come from several diagnostics on one node.
    const seen = new Set();
    const unique = edits.filter((e) => {
      const key = `${e.start}:${e.end}:${e.replacement}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Overlapping spans would corrupt each other; keep the outermost.
    unique.sort((a, b) => b.start - a.start || b.end - a.end);
    let out = fs.readFileSync(file, 'utf8');
    let lastStart = Infinity;
    for (const edit of unique) {
      if (edit.end > lastStart) continue;
      out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
      lastStart = edit.start;
      applied++;
    }
    fs.writeFileSync(file, out);
  }

  totalEdits += applied;
  console.log(`round ${round}: ${applied} edits`);
  if (!applied) break;
}

console.log(`${totalEdits} edits over ${rounds} rounds`);
