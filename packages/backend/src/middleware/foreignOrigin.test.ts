import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from 'express';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'foreign-origin-test-session-secret-00000000000';
process.env.JWT_SECRET ||= 'foreign-origin-test-jwt-secret-000000000000000';
process.env.FRONTEND_URL = 'https://code.example.test';

const { isForeignOriginWrite } = await import('./auth.js');

const request = (method: string, headers: Record<string, string>): Request =>
  ({ method, headers: { host: 'code.example.test', ...headers } }) as unknown as Request;

test('reads are never a foreign write', () => {
  assert.equal(isForeignOriginWrite(request('GET', { origin: 'https://evil.example' })), false);
  assert.equal(isForeignOriginWrite(request('HEAD', { origin: 'null' })), false);
});

test('a write from the app itself passes', () => {
  assert.equal(
    isForeignOriginWrite(request('POST', { origin: 'https://code.example.test' })),
    false
  );
  // Reached under another name (LAN address, second hostname): same host as the request.
  assert.equal(
    isForeignOriginWrite(
      request('POST', { host: '192.168.1.124:4545', origin: 'http://192.168.1.124:4545' })
    ),
    false
  );
});

test('a sibling subdomain, another site and an opaque origin are refused', () => {
  assert.equal(
    isForeignOriginWrite(request('POST', { origin: 'https://preview-1.example.test' })),
    true
  );
  assert.equal(isForeignOriginWrite(request('DELETE', { origin: 'https://evil.example' })), true);
  assert.equal(isForeignOriginWrite(request('POST', { origin: 'null' })), true);
  assert.equal(isForeignOriginWrite(request('POST', { origin: 'not a url' })), true);
});

test('without an Origin the fetch metadata decides, and native clients pass', () => {
  assert.equal(isForeignOriginWrite(request('POST', { 'sec-fetch-site': 'same-site' })), true);
  assert.equal(isForeignOriginWrite(request('POST', { 'sec-fetch-site': 'cross-site' })), true);
  assert.equal(isForeignOriginWrite(request('POST', { 'sec-fetch-site': 'same-origin' })), false);
  assert.equal(isForeignOriginWrite(request('POST', {})), false);
});
