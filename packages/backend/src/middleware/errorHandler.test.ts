import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clientErrorOf } from './errorHandler.js';

test('a body over the limit is the client\u2019s 413, not a server error', () => {
  const error = Object.assign(new Error('request entity too large'), {
    type: 'entity.too.large',
    status: 413,
  });
  assert.deepEqual(clientErrorOf(error), {
    statusCode: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Request body too large',
  });
});

test('malformed JSON is a 400 and does not echo the parser message', () => {
  const error = Object.assign(new SyntaxError('Unexpected token } in JSON at position 3'), {
    type: 'entity.parse.failed',
    statusCode: 400,
  });
  assert.deepEqual(clientErrorOf(error), {
    statusCode: 400,
    code: 'INVALID_JSON',
    message: 'Request body is not valid JSON',
  });
});

test('other body-parser refusals keep their 4xx status', () => {
  const error = Object.assign(new Error('unsupported charset'), {
    type: 'charset.unsupported',
    status: 415,
  });
  assert.equal(clientErrorOf(error)?.statusCode, 415);
});

test('an error is only a client error with a parser type and a 4xx status', () => {
  assert.equal(clientErrorOf(new Error('boom')), null);
  assert.equal(clientErrorOf(Object.assign(new Error('x'), { status: 404 })), null);
  assert.equal(
    clientErrorOf(Object.assign(new Error('x'), { type: 'db.down', status: 503 })),
    null
  );
  assert.equal(clientErrorOf(Object.assign(new Error('x'), { type: 'entity.too.large' })), null);
  assert.equal(clientErrorOf(null), null);
});
