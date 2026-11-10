import assert from 'node:assert/strict';
import test from 'node:test';

import { LoginThrottle } from './loginThrottle.js';

test('a few misses are free, then the account locks with a doubling time', () => {
  let now = 0;
  const throttle = new LoginThrottle(3, 1_000, 8_000, 60_000, () => now);
  throttle.fail('Vale');
  throttle.fail('vale');
  assert.equal(throttle.retryAfterMs('VALE'), 0, 'two misses, case-insensitive');
  throttle.fail('vale');
  assert.equal(throttle.retryAfterMs('vale'), 1_000);
  now += 1_000;
  assert.equal(throttle.retryAfterMs('vale'), 0);
  throttle.fail('vale');
  assert.equal(throttle.retryAfterMs('vale'), 2_000);
  for (let i = 0; i < 6; i += 1) throttle.fail('vale');
  assert.equal(throttle.retryAfterMs('vale'), 8_000, 'capped');
  assert.equal(throttle.retryAfterMs('someone-else'), 0);
});

test('a successful login clears the count; old failures are forgotten', () => {
  let now = 0;
  const throttle = new LoginThrottle(2, 1_000, 8_000, 10_000, () => now);
  throttle.fail('a');
  throttle.succeed('a');
  throttle.fail('a');
  assert.equal(throttle.retryAfterMs('a'), 0);
  now += 11_000;
  throttle.fail('a');
  assert.equal(throttle.retryAfterMs('a'), 0, 'counted from one again');
});
