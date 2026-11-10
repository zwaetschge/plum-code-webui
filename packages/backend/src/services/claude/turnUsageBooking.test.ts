import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planTurnBooking, recordTurnBooking, type TurnBookingState } from './turnUsageBooking.js';

const counters = (input: number, output: number, cacheRead = 0, cacheCreation = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheCreationTokens: cacheCreation,
});

test('every result of a turn is booked, each for what came since the last', () => {
  const state: TurnBookingState = {};

  // The turn's first result.
  const first = planTurnBooking(state, 'msg-1', counters(10, 200, 5000, 300));
  assert.deepEqual(first, { turnId: 'msg-1', tokens: counters(10, 200, 5000, 300) });
  recordTurnBooking(state, 'msg-1', counters(10, 200, 5000, 300));

  // The same state again — a shutdown flush, a retry: nothing to write.
  assert.equal(planTurnBooking(state, 'msg-1', counters(10, 200, 5000, 300)), null);

  // A background agent finished and Claude carried on by itself: the counters
  // kept running, the message id did not change. This used to be dropped.
  const second = planTurnBooking(state, 'msg-1', counters(14, 260, 9000, 300));
  assert.deepEqual(second, { turnId: 'msg-1:c1', tokens: counters(4, 60, 4000, 0) });
  recordTurnBooking(state, 'msg-1', counters(14, 260, 9000, 300));

  const third = planTurnBooking(state, 'msg-1', counters(15, 300, 9500, 300));
  assert.equal(third?.turnId, 'msg-1:c2');
  assert.deepEqual(third?.tokens, counters(1, 40, 500, 0));
});

test('a new message starts from zero under its own id', () => {
  const state: TurnBookingState = {};
  recordTurnBooking(state, 'msg-1', counters(10, 200));
  recordTurnBooking(state, 'msg-1', counters(14, 260));

  // The counters are reset when the next message is sent.
  state.turnBookedTokens = undefined;
  const next = planTurnBooking(state, 'msg-2', counters(3, 50));
  assert.deepEqual(next, { turnId: 'msg-2', tokens: counters(3, 50) });
});

test('counters reset in the middle of a turn do not reuse an id', () => {
  const state: TurnBookingState = {};
  recordTurnBooking(state, 'msg-1', counters(10, 200));
  state.turnBookedTokens = undefined; // a compaction cleared the turn's counters
  assert.equal(planTurnBooking(state, 'msg-1', counters(2, 20))?.turnId, 'msg-1:c1');
});
