import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isEmptyNotificationResult } from './notificationResult.js';

test('the result after a stale task notification carries no turn', () => {
  // As emitted by the CLI on resume, before it reads the waiting prompt.
  assert.equal(
    isEmptyNotificationResult({
      type: 'result',
      num_turns: 0,
      duration_api_ms: 0,
      result: '',
    }),
    true
  );
});

test('a real turn is never mistaken for it', () => {
  assert.equal(
    isEmptyNotificationResult({
      type: 'result',
      num_turns: 1,
      duration_api_ms: 1711,
      result: 'OK',
    }),
    false
  );
  // A turn that ended without text still spent API time.
  assert.equal(
    isEmptyNotificationResult({ type: 'result', num_turns: 0, duration_api_ms: 240, result: '' }),
    false
  );
  // Results that do not state their turns are taken at face value.
  assert.equal(isEmptyNotificationResult({ type: 'result', result: '' }), false);
  assert.equal(
    isEmptyNotificationResult({ type: 'system', num_turns: 0, duration_api_ms: 0 }),
    false
  );
});
