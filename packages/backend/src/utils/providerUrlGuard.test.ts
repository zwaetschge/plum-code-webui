import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isPublicHost, providerBaseUrlProblem } from './providerUrlGuard.js';

const operator = { allowPrivateNetwork: true };
const account = { allowPrivateNetwork: false };

test('the shape of the URL is checked for everyone', () => {
  assert.equal(providerBaseUrlProblem('https://api.example.com/v1', operator), null);
  assert.match(providerBaseUrlProblem('ftp://api.example.com', operator) ?? '', /http/);
  assert.match(
    providerBaseUrlProblem('https://user:pw@api.example.com', operator) ?? '',
    /credentials/
  );
  // A query in front of the appended path would rewrite the request.
  assert.match(
    providerBaseUrlProblem('http://10.0.0.5:2375/containers/json?', operator) ?? '',
    /query/
  );
  assert.match(providerBaseUrlProblem('https://api.example.com/v1#x', operator) ?? '', /query/);
  assert.match(providerBaseUrlProblem('not a url', operator) ?? '', /valid/);
});

test('an operator may point at the local network', () => {
  assert.equal(providerBaseUrlProblem('http://192.168.1.126:8090/v1', operator), null);
  assert.equal(providerBaseUrlProblem('http://host.docker.internal:11434/v1', operator), null);
});

test('other accounts are held to public hosts', () => {
  assert.equal(providerBaseUrlProblem('https://api.deepseek.com', account), null);
  for (const internal of [
    'http://192.168.1.126:8090/v1',
    'http://10.0.0.5/v1',
    'http://172.18.0.4:2375',
    'http://127.0.0.1:3001',
    'http://localhost:3001',
    'http://169.254.169.254/latest',
    'http://docker-socket-proxy:2375',
    'http://plum-postgres:5432',
    'http://nas.local/v1',
    'http://host.docker.internal:11434',
    'http://[::1]:3001',
    'http://[fd00::1]/v1',
    'http://[fe80::1]/v1',
    'http://[::ffff:127.0.0.1]/v1',
    'http://[::ffff:c0a8:17e]/v1',
    'http://0.0.0.0:3001',
  ]) {
    assert.match(providerBaseUrlProblem(internal, account) ?? '', /public hosts/, internal);
  }
});

test('host classification', () => {
  assert.equal(isPublicHost('api.mistral.ai'), true);
  assert.equal(isPublicHost('8.8.8.8'), true);
  assert.equal(isPublicHost('2606:4700::1111'), true);
  assert.equal(isPublicHost('100.64.1.1'), false);
  assert.equal(isPublicHost('service.internal.'), false);
  assert.equal(isPublicHost(''), false);
});
