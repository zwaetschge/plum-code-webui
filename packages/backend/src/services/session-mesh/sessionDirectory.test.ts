import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'session-directory-test-session-secret-00000000000';
process.env.JWT_SECRET ||= 'session-directory-test-jwt-secret-0000000000000000';

const { resolveSessionTarget } = await import('./sessionDirectory.js');

const sessions = [
  { id: 'task-1', name: 'homeassistant' },
  { id: 'code-1', name: 'tv laptop' },
  { id: 'code-2', name: 'Trackmania Port Android' },
  { id: 'code-3', name: 'skyrim android' },
  { id: 'code-4', name: 'skyrim tools' },
];

test('a session is found by id, by name in any case, or by a unique part of it', () => {
  assert.equal(resolveSessionTarget(sessions, 'code-1', 'task-1').id, 'code-1');
  assert.equal(resolveSessionTarget(sessions, 'TV Laptop', 'task-1').id, 'code-1');
  assert.equal(resolveSessionTarget(sessions, 'trackmania', 'task-1').id, 'code-2');
});

test('it never guesses between several sessions', () => {
  assert.throws(
    () => resolveSessionTarget(sessions, 'skyrim', 'task-1'),
    (error: Error & { code?: string }) =>
      error.code === 'AMBIGUOUS_SESSION' && /skyrim android \(code-3\)/.test(error.message)
  );
});

test('unknown names and the caller itself are refused', () => {
  assert.throws(
    () => resolveSessionTarget(sessions, 'blender', 'task-1'),
    (error: Error & { code?: string }) => error.code === 'SESSION_NOT_FOUND'
  );
  assert.throws(
    () => resolveSessionTarget(sessions, 'task-1', 'task-1'),
    (error: Error & { code?: string }) => error.code === 'SELF_MESSAGE'
  );
  // Its own name is not a way around that either.
  assert.throws(() => resolveSessionTarget(sessions, 'homeassistant', 'task-1'));
});
