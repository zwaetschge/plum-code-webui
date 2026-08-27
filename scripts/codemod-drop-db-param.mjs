#!/usr/bin/env node
/**
 * Drops the database handle that helpers take as their first parameter.
 *
 * `userOwnsSession(db, sessionId, userId)` made sense when the handle was a
 * synchronous object passed around. The pg helpers reach the pool themselves, so
 * once a body is rewritten the parameter is dead — but every caller still passes
 * it, and the declaration it came from is gone.
 *
 * Removes the parameter and the matching argument at each call site.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from '../packages/backend/node_modules/typescript/lib/typescript.js';

const backend = path.resolve('packages/backend');
const config = ts.readConfigFile(path.join(backend, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, backend);
const program = ts.createProgram(parsed.fileNames, parsed.options);

const HANDLE_TYPE = /ReturnType<typeof getDatabase>|Database\.Database/;
const HANDLE_ARG = /^(db|database)$|^getDatabase\(\)$/;

/** Functions whose first parameter is the handle, by name. */
const targets = new Set();

for (const sourceFile of program.getSourceFiles()) {
  if (sourceFile.isDeclarationFile) continue;
  if (!sourceFile.fileName.startsWith(path.join(backend, 'src'))) continue;
  // db/index.ts and migrations.ts still own a real handle; leave them alone.
  if (/src\/db\/(index|migrations)\.ts$/.test(sourceFile.fileName)) continue;

  const text = sourceFile.getFullText();
  const edits = [];

  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      node.parameters.length > 0
    ) {
      const first = node.parameters[0];
      const typeText = first.type ? text.slice(first.type.pos, first.type.end) : '';
      if (HANDLE_TYPE.test(typeText)) {
        targets.add(node.name.getText(sourceFile));
        const next = node.parameters[1];
        edits.push({
          start: first.getStart(sourceFile),
          end: next ? next.getStart(sourceFile) : first.end,
          replacement: '',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  if (edits.length) {
    let out = text;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
    }
    fs.writeFileSync(sourceFile.fileName, out);
  }
}

// Second pass: strip the argument wherever those functions are called.
const after = ts.createProgram(parsed.fileNames, parsed.options);
let callEdits = 0;

for (const sourceFile of after.getSourceFiles()) {
  if (sourceFile.isDeclarationFile) continue;
  if (!sourceFile.fileName.startsWith(path.join(backend, 'src'))) continue;

  const text = sourceFile.getFullText();
  const edits = [];

  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : '';
      if (targets.has(name)) {
        const first = node.arguments[0];
        const firstText = text.slice(first.getStart(sourceFile), first.end).trim();
        if (HANDLE_ARG.test(firstText)) {
          const next = node.arguments[1];
          edits.push({
            start: first.getStart(sourceFile),
            end: next ? next.getStart(sourceFile) : first.end,
            replacement: '',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  if (edits.length) {
    let out = text;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
    }
    fs.writeFileSync(sourceFile.fileName, out);
    callEdits += edits.length;
  }
}

console.log(`${targets.size} helpers, ${callEdits} call sites`);
