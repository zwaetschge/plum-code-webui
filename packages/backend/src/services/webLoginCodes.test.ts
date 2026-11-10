/**
 * The browser login hands over a one-time code, never the token itself; the
 * code is useless without the nonce cookie of the browser that logged in.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { WebLoginCodeStore } from './webLoginCodes.js';

const value = (seed: string) => seed.repeat(43).slice(0, 43);

test('a code is exchanged once, with its nonce, for the user', () => {
  const store = new WebLoginCodeStore();
  const { code, nonce } = store.issue('user-1');
  assert.equal(store.exchange(code, nonce), 'user-1');
  assert.equal(store.exchange(code, nonce), null, 'a code works once');
});

test('a code without the right nonce is refused and spent', () => {
  const store = new WebLoginCodeStore();
  const { code, nonce } = store.issue('user-1');
  // Someone else's browser has a different (or no) nonce cookie.
  assert.equal(store.exchange(code, value('x')), null);
  assert.equal(store.exchange(code, nonce), null, 'no second guess after a wrong nonce');
});

test('codes expire and malformed input never matches', () => {
  let now = 1_000;
  const store = new WebLoginCodeStore(() => now);
  const { code, nonce } = store.issue('user-1');
  now += 61_000;
  assert.equal(store.exchange(code, nonce), null);
  assert.equal(store.exchange('short', nonce), null);
  assert.throws(() => store.issue(''));
});

test('the pending set is bounded', () => {
  let counter = 0;
  const store = new WebLoginCodeStore(
    Date.now,
    () => String(counter++).padStart(43, 'a'),
    60_000,
    2
  );
  const first = store.issue('user-1');
  store.issue('user-2');
  const third = store.issue('user-3');
  assert.equal(store.exchange(first.code, first.nonce), null, 'oldest entry was dropped');
  assert.equal(store.exchange(third.code, third.nonce), 'user-3');
});
