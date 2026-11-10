import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'preview-frame-test-session-secret-0000000000000';
process.env.JWT_SECRET ||= 'preview-frame-test-jwt-secret-00000000000000000';

const { previewFrameSources } = await import('./preview-vhost.js');

test('the preview host and its aliases may be framed, over https and http', () => {
  assert.deepEqual(previewFrameSources('preview.example.test', ['p2.example.test']), [
    'https://preview.example.test',
    'http://preview.example.test',
    'https://p2.example.test',
    'http://p2.example.test',
  ]);
});

test('no preview host means no extra frame source', () => {
  assert.deepEqual(previewFrameSources('', []), []);
});

test('a host name that could carry policy syntax is dropped', () => {
  assert.deepEqual(previewFrameSources('preview.example.test; script-src *', ['ok.example.test']), [
    'https://ok.example.test',
    'http://ok.example.test',
  ]);
  assert.deepEqual(previewFrameSources('a.example.test', ['a.example.test']), [
    'https://a.example.test',
    'http://a.example.test',
  ]);
});
