import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from 'express';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'hook-secret-test-session-secret-000000000000000';
process.env.JWT_SECRET ||= 'hook-secret-test-jwt-secret-0000000000000000000';
process.env.WEBUI_HOOK_SECRET = 'undivided-secret-for-the-test-only';

const { bindHookCaller, identifyHookCaller, sessionHookToken } = await import('./hookSecret.js');

const request = (headers: Record<string, string>): Request =>
  ({
    headers,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  }) as unknown as Request;

test('a session token identifies exactly its session', () => {
  const token = sessionHookToken('session-a');
  assert.deepEqual(identifyHookCaller(token), { kind: 'session', sessionId: 'session-a' });
  assert.notEqual(token, sessionHookToken('session-b'));
  assert.ok(!token.includes('undivided-secret'));
});

test('a token cannot be re-labelled for another session', () => {
  const [prefix, , mac] = sessionHookToken('session-a').split('.');
  const forged = `${prefix}.${Buffer.from('session-b').toString('base64url')}.${mac}`;
  assert.equal(identifyHookCaller(forged), null);
  assert.equal(identifyHookCaller(`${prefix}..${mac}`), null);
  assert.equal(identifyHookCaller('pst1.garbage'), null);
});

test('the undivided secret is the backend itself; anything else is nobody', () => {
  assert.deepEqual(identifyHookCaller('undivided-secret-for-the-test-only'), { kind: 'internal' });
  assert.equal(identifyHookCaller('undivided-secret-for-the-test-onlY'), null);
  assert.equal(identifyHookCaller(''), null);
});

test('the session header is taken from the token, not from the caller', () => {
  const req = request({
    'x-webui-hook-secret': sessionHookToken('session-a'),
    'x-webui-session-id': 'session-b',
  });
  assert.deepEqual(bindHookCaller(req), { kind: 'session', sessionId: 'session-a' });
  assert.equal(req.headers['x-webui-session-id'], 'session-a');

  // The backend's own helpers may still name the session they act for.
  const internal = request({
    'x-webui-hook-secret': 'undivided-secret-for-the-test-only',
    'x-webui-session-id': 'session-b',
  });
  assert.deepEqual(bindHookCaller(internal), { kind: 'internal' });
  assert.equal(internal.headers['x-webui-session-id'], 'session-b');
});
