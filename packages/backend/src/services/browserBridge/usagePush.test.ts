/**
 * Alerts go to the desktop and the browser as system notifications, so a
 * misfire is noise on every screen and a miss hides a used-up plan.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { usageAlerts } from './usagePush.js';

const row = (utilization: number, exhausted = false) =>
  ({
    provider: 'claude',
    label: 'Claude',
    estimate: false,
    exhausted,
    active: true,
    analyticsPath: '/analytics?provider=claude',
    windows: [
      { label: 'Woche', utilization, resetsAt: null, forecast: { state: 'unknown', at: null } },
    ],
  }) as never;

test('the first reading after a restart only seeds the state', () => {
  const seen = new Map<string, number>();
  assert.deepEqual(usageAlerts(seen, [row(95)], 80), []);
  assert.equal(seen.get('claude:Woche'), 95);
});

test('crossing the threshold, running out and resetting alert once each', () => {
  const seen = new Map<string, number>([['claude:Woche', 70]]);
  assert.deepEqual(
    usageAlerts(seen, [row(82)], 80).map((a) => a.level),
    ['warning']
  );
  assert.deepEqual(usageAlerts(seen, [row(85)], 80), []);
  assert.deepEqual(
    usageAlerts(seen, [row(100)], 80).map((a) => a.level),
    ['exhausted']
  );
  assert.deepEqual(
    usageAlerts(seen, [row(3)], 80).map((a) => a.level),
    ['reset']
  );
});

test('an allowance reported used up counts as 100 % even below it', () => {
  const seen = new Map<string, number>([['claude:Woche', 40]]);
  assert.deepEqual(
    usageAlerts(seen, [row(40, true)], 80).map((a) => a.level),
    ['exhausted']
  );
});
