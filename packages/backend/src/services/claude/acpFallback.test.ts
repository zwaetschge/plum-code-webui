/**
 * Vibe 3 advertises fewer modes and thinking levels than 2.x; a value it lost
 * must land on the closest one it still offers instead of being dropped.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { acpFallbackValue } from './ClaudeProcessManager.js';

const select = (id: string, values: string[]) => ({
  id,
  name: id,
  type: 'select' as const,
  currentValue: values[0]!,
  options: values.map((value) => ({ value, name: value })),
});

const vibe3 = [
  select('mode', ['ask', 'accept-edits', 'smart-approve', 'auto-approve']),
  select('thinking', ['low', 'high', 'max']),
];

test('advertised values pass through unchanged', () => {
  assert.equal(acpFallbackValue(vibe3, 'thinking', 'max'), 'max');
  assert.equal(acpFallbackValue(vibe3, 'mode', 'auto-approve'), 'auto-approve');
});

test('dropped thinking levels move to the nearest one, ties upward', () => {
  assert.equal(acpFallbackValue(vibe3, 'thinking', 'medium'), 'high');
  assert.equal(acpFallbackValue(vibe3, 'thinking', 'off'), 'low');
});

test('plan mode falls back to ask; unknown values stay unset', () => {
  assert.equal(acpFallbackValue(vibe3, 'mode', 'plan'), 'ask');
  assert.equal(acpFallbackValue(vibe3, 'mode', 'nonsense'), null);
  assert.equal(acpFallbackValue(vibe3, 'model', 'gone-model'), null);
});
