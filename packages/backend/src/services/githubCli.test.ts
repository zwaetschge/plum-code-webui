/**
 * The CI badge on every pull request row comes from this reducer. gh returns one
 * entry per check with two independent fields (status, conclusion), and getting
 * the precedence wrong shows a green PR with a broken build.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET ||= 'x'.repeat(32);
process.env.JWT_SECRET ||= 'y'.repeat(32);

const { summarizeChecks } = await import('./githubCli.js');

test('no checks at all yields no badge', () => {
  assert.equal(summarizeChecks(undefined), undefined);
  assert.equal(summarizeChecks([]), undefined);
  assert.equal(summarizeChecks('not an array'), undefined);
});

test('all successful checks read as SUCCESS', () => {
  const result = summarizeChecks([
    { status: 'COMPLETED', conclusion: 'SUCCESS' },
    { status: 'COMPLETED', conclusion: 'SUCCESS' },
  ]);
  assert.deepEqual(result, { state: 'SUCCESS', total: 2, failed: 0 });
});

test('one failure outranks any number of passes', () => {
  const result = summarizeChecks([
    { status: 'COMPLETED', conclusion: 'SUCCESS' },
    { status: 'COMPLETED', conclusion: 'FAILURE' },
    { status: 'COMPLETED', conclusion: 'SUCCESS' },
  ]);
  assert.deepEqual(result, { state: 'FAILURE', total: 3, failed: 1 });
});

test('timed out and cancelled count as failures, not as pending', () => {
  const result = summarizeChecks([
    { status: 'COMPLETED', conclusion: 'TIMED_OUT' },
    { status: 'COMPLETED', conclusion: 'CANCELLED' },
  ]);
  assert.deepEqual(result, { state: 'FAILURE', total: 2, failed: 2 });
});

test('a running check makes the whole rollup pending', () => {
  const result = summarizeChecks([
    { status: 'COMPLETED', conclusion: 'SUCCESS' },
    { status: 'IN_PROGRESS' },
  ]);
  assert.equal(result?.state, 'PENDING');
});

test('failure still wins over a check that is still running', () => {
  // Otherwise a long-running job would mask an already-red build.
  const result = summarizeChecks([
    { status: 'IN_PROGRESS' },
    { status: 'COMPLETED', conclusion: 'FAILURE' },
  ]);
  assert.equal(result?.state, 'FAILURE');
});

test('lowercase conclusions from gh are handled', () => {
  assert.equal(summarizeChecks([{ status: 'completed', conclusion: 'failure' }])?.state, 'FAILURE');
  assert.equal(summarizeChecks([{ status: 'completed', conclusion: 'success' }])?.state, 'SUCCESS');
});
