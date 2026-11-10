import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'voice-failure-test-session-secret-00000000000000';
process.env.JWT_SECRET ||= 'voice-failure-test-jwt-secret-000000000000000000';

const { describeMistralSpeechFailure, speechKeyFor } = await import('./voice.js');

const budget = (resetAt: string | null) => ({
  usagePercentage: 100,
  initialBudget: 255,
  currency: 'EUR',
  resetAt,
  paygEnabled: false,
});

test('a used-up plan budget is named, with the day it comes back', () => {
  // What the API answers once the coding plan's allowance is gone.
  const refusal = {
    object: 'error',
    message: 'Vibe budget exhausted.',
    type: 'billing_vibe_budget_exhausted',
    code: '2304',
  };
  const billing = {
    planName: null,
    vibe: budget('2026-12-01T00:00:00Z'),
    api: { ...budget('2026-12-15T00:00:00Z'), usagePercentage: 0 },
    checkedAt: '2026-11-10T16:00:00Z',
  };
  assert.deepEqual(describeMistralSpeechFailure(402, refusal, billing), {
    message: 'Das Mistral-Budget ist aufgebraucht; es wird am 1. Dezember zurückgesetzt.',
    statusCode: 402,
    code: 'VOICE_BUDGET_EXHAUSTED',
  });
  // Without billing figures the reason still stands, just without a date.
  assert.equal(
    describeMistralSpeechFailure(402, refusal).message,
    'Das Mistral-Budget ist aufgebraucht.'
  );
});

test('other refusals keep their own meaning', () => {
  assert.equal(describeMistralSpeechFailure(401, {}).code, 'VOICE_KEY_REJECTED');
  assert.equal(describeMistralSpeechFailure(429, {}).statusCode, 429);
  assert.match(describeMistralSpeechFailure(403, {}).message, /Moderation/);
  assert.deepEqual(describeMistralSpeechFailure(500, null), {
    message: 'Mistral konnte die Sprachausgabe nicht erzeugen.',
    statusCode: 502,
    code: 'VOICE_REQUEST_FAILED',
  });
});

test('the speech key replaces the deployment key only', () => {
  const environment = { MISTRAL_API_KEY: 'plan-key', MISTRAL_VOICE_API_KEY: 'voice-key' };
  assert.equal(speechKeyFor('plan-key', environment), 'voice-key');
  // An account with a key of its own keeps it.
  assert.equal(speechKeyFor('own-key', environment), 'own-key');
  // No speech key configured: nothing changes.
  assert.equal(speechKeyFor('plan-key', { MISTRAL_API_KEY: 'plan-key' }), 'plan-key');
  assert.equal(speechKeyFor(null, environment), null);
});
