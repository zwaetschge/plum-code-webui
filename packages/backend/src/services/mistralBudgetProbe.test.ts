/**
 * The probe decides whether the limit card shows 100 %, so a misread either
 * hides an exhausted allowance or blocks a usable one. Responses below are the
 * shapes Mistral returned on 2026-10-30.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyMistralBudgetResponse } from './mistralBudgetProbe.js';

test('402 budget errors read as exhausted, keeping Mistral’s error type', () => {
  const result = classifyMistralBudgetResponse(402, {
    object: 'error',
    message: 'Vibe budget exhausted.',
    type: 'billing_vibe_budget_exhausted',
    code: '2304',
  });
  assert.deepEqual(result, { state: 'exhausted', errorType: 'billing_vibe_budget_exhausted' });
});

test('a validation error means the budget check passed', () => {
  assert.equal(
    classifyMistralBudgetResponse(400, { type: 'invalid_request_error' }).state,
    'available'
  );
  assert.equal(classifyMistralBudgetResponse(422, { detail: [] }).state, 'available');
});

test('an unknown probe model says nothing about the budget', () => {
  assert.equal(classifyMistralBudgetResponse(400, { type: 'invalid_model' }).state, 'unknown');
});

test('auth failures and outages stay distinct from budget answers', () => {
  assert.equal(
    classifyMistralBudgetResponse(401, { detail: 'Invalid API Key' }).state,
    'unauthorized'
  );
  assert.equal(classifyMistralBudgetResponse(429, null).state, 'unknown');
  assert.equal(classifyMistralBudgetResponse(503, null).state, 'unknown');
});
