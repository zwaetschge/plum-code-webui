import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'github-auth-test-session-secret-000000000000000';
process.env.JWT_SECRET ||= 'github-auth-test-jwt-secret-0000000000000000000';

const { gitHubAuthEnvironment, withoutUrlCredentials } = await import('./github.js');

test('the token reaches git as a header for github.com only', () => {
  const env = gitHubAuthEnvironment('tok-123', { PATH: '/usr/bin', HOME: '/home/node' });
  assert.equal(env.GIT_CONFIG_COUNT, '1');
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.equal(
    env.GIT_CONFIG_VALUE_0,
    `Authorization: Basic ${Buffer.from('x-access-token:tok-123').toString('base64')}`
  );
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.PATH, '/usr/bin');
});

test('without a token git gets no credentials and still never prompts', () => {
  const env = gitHubAuthEnvironment(null, { PATH: '/usr/bin' });
  assert.equal(env.GIT_CONFIG_COUNT, undefined);
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
});

test('inherited GIT_ variables are not passed on', () => {
  const env = gitHubAuthEnvironment(null, {
    PATH: '/usr/bin',
    GIT_SSH_COMMAND: 'ssh -o x',
    GIT_DIR: '/x',
  });
  assert.equal(env.GIT_SSH_COMMAND, undefined);
  assert.equal(env.GIT_DIR, undefined);
});

test('a remote that still carries a token is recognised and cleaned', () => {
  assert.equal(
    withoutUrlCredentials('https://tok-123@github.com/owner/repo.git'),
    'https://github.com/owner/repo.git'
  );
  assert.equal(
    withoutUrlCredentials('https://user:tok-123@github.com/owner/repo.git'),
    'https://github.com/owner/repo.git'
  );
  assert.equal(withoutUrlCredentials('https://github.com/owner/repo.git'), null);
  assert.equal(withoutUrlCredentials('git@github.com:owner/repo.git'), null);
});
