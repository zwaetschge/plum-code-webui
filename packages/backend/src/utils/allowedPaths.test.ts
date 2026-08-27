/**
 * `isAllowedBasePath` is the workspace boundary: every file, git and gh route
 * resolves user input through it. A regression here is a path traversal, so the
 * cases below are the attacks it has to keep refusing, not a happy path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// config reads process.env at import time, so the allowlist has to be set first.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-allowed-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-outside-'));
process.env.ALLOWED_BASE_PATHS = sandbox;
process.env.SESSION_SECRET ||= 'x'.repeat(32);
process.env.JWT_SECRET ||= 'y'.repeat(32);

const { isAllowedBasePath, isPathInside } = await import('./allowedPaths.js');

test.after(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test('accepts the base itself and paths under it', () => {
  assert.equal(isAllowedBasePath(sandbox), true);
  assert.equal(isAllowedBasePath(path.join(sandbox, 'project')), true);
  assert.equal(isAllowedBasePath(path.join(sandbox, 'a', 'b', 'c.txt')), true);
});

test('rejects paths outside every base', () => {
  assert.equal(isAllowedBasePath(outside), false);
  assert.equal(isAllowedBasePath('/etc/passwd'), false);
  assert.equal(isAllowedBasePath('/'), false);
});

test('rejects traversal that climbs out of the base', () => {
  assert.equal(isAllowedBasePath(path.join(sandbox, '..')), false);
  assert.equal(isAllowedBasePath(path.join(sandbox, '..', 'etc', 'passwd')), false);
  assert.equal(isAllowedBasePath(`${sandbox}/./../..`), false);
});

test('rejects a sibling whose name merely starts with the base', () => {
  // path.relative() alone would call this "inside"; the guard must not.
  assert.equal(isAllowedBasePath(`${sandbox}-evil/secret`), false);
});

test('follows symlinks before deciding', () => {
  const link = path.join(sandbox, 'escape');
  fs.symlinkSync(outside, link);
  // The link sits inside the sandbox but resolves out of it.
  assert.equal(isAllowedBasePath(link), false);
  assert.equal(isAllowedBasePath(path.join(link, 'loot.txt')), false);
});

test('allows a path that does not exist yet inside the base', () => {
  // Creating a new file has to be possible; only the nearest existing parent
  // can be resolved, and that parent is what gets checked.
  assert.equal(isAllowedBasePath(path.join(sandbox, 'not-created-yet', 'file.txt')), true);
});

test('isPathInside treats the parent itself as inside', () => {
  assert.equal(isPathInside('/a/b', '/a/b'), true);
  assert.equal(isPathInside('/a/b', '/a/b/c'), true);
  assert.equal(isPathInside('/a/b', '/a/bc'), false);
  assert.equal(isPathInside('/a/b', '/a'), false);
});
