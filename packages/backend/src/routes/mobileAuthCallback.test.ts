import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'mobile-callback-test-session-secret-0000000000000';
process.env.JWT_SECRET ||= 'mobile-callback-test-jwt-secret-00000000000000000';

const { mobileAuthCallback } = await import('./auth.js');

test('the Plum app gets a login callback no other app claims', () => {
  // The Plum Flipper app registers claudewebui://auth/callback exactly, so a
  // login sent there never reached the Plum app.
  assert.equal(mobileAuthCallback('plum'), 'claudewebui://plum-auth/callback');
});

test('callers that name no app, or an unknown one, keep the old callback', () => {
  for (const app of [undefined, '', 'flipper', ['plum'], 'https://evil.example']) {
    assert.equal(mobileAuthCallback(app), 'claudewebui://auth/callback');
  }
});
