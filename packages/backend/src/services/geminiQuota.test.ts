import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'gemini-quota-test-session-secret-0000000000000000';
process.env.JWT_SECRET ||= 'gemini-quota-test-jwt-secret-000000000000000000000';

const { parseAgyUsageScreen } = await import('./geminiQuota.js');

// agy 1.5.9's /usage screen on 2026-11-15 (colours and cursor moves included).
const SCREEN = [
  '\x1b[1m└ Models & Quota\x1b[0m',
  '\x1b[38;5;75mGEMINI MODELS\x1b[0m',
  ' Models within this group: Gemini 4 Carbon, Gemini 4 Argon, Gemini 4 Hydrogen',
  ' Weekly Limit Remaining',
  '[██████████████████████████████████████████████████] 99.25%',
  'Refreshes in 166h 59m',
  '\x1b[2C Five Hour Limit Remaining',
  '[█████████████████████████████████████████████████░] 97.01%',
  'Refreshes in 3h 59m',
  'CLAUDE AND GPT MODELS',
  ' Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B',
  ' Weekly Limit Remaining',
  '[██████████████████████████████████████████████████] 100.00%',
  'Quota available',
  ' Five Hour Limit Remaining',
  '[██████████████████████████████████████████████████] 100.00%',
  'Quota available',
  ' │Within each group, models share a weekly limit and a 5-hour limit.',
  // A later partial repaint must not override the first full block.
  '\x1b[12;3HGEMINI MODELS Five Hour Limit Remaining 4%',
].join('\r\n');

test('reads both groups and windows from the agy /usage screen', () => {
  const now = Date.parse('2026-11-15T16:00:00Z');
  const groups = parseAgyUsageScreen(SCREEN, now);
  assert.deepEqual(
    groups.map((group) => group.name),
    ['GEMINI MODELS', 'CLAUDE AND GPT MODELS']
  );
  const [gemini, claude] = groups;
  assert.equal(gemini!.fiveHour!.utilization, 2.99);
  assert.equal(gemini!.fiveHour!.resetsAt, '2026-11-15T19:59:00.000Z');
  assert.equal(gemini!.weekly!.utilization, 0.75);
  assert.equal(gemini!.weekly!.resetsAt, '2026-11-22T14:59:00.000Z');
  assert.equal(claude!.fiveHour!.utilization, 0);
  assert.equal(claude!.fiveHour!.resetsAt, null);
});

test('an unrelated screen yields nothing', () => {
  assert.deepEqual(parseAgyUsageScreen('Welcome to the Antigravity CLI. Select login method:'), []);
});
