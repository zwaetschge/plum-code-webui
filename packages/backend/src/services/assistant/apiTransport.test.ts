/**
 * Mistral rejects `reasoning_effort` for models without reasoning (400
 * "reasoning_effort is not enabled for this model") instead of ignoring it, so
 * a chat with the effort rail set and such a model must still answer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { streamApiChat } from './apiTransport.js';

const endpoint = {
  id: 'mistral',
  name: 'Mistral',
  protocol: 'openai' as const,
  baseUrl: 'https://api.mistral.test/v1',
  key: 'secret-key',
  models: ['mistral-large-latest'],
};

function sse(text: string): Response {
  const body = [
    `data: ${JSON.stringify({ model: 'mistral-large-latest', choices: [{ index: 0, delta: { content: text } }] })}`,
    `data: ${JSON.stringify({ model: 'mistral-large-latest', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } })}`,
    'data: [DONE]',
    '',
  ].join('\n\n');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function mockFetch(handler: (body: Record<string, unknown>) => Response) {
  const bodies: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return handler(body);
  }) as typeof fetch;
  return { bodies, restore: () => (globalThis.fetch = original) };
}

const refuseEffort = (body: Record<string, unknown>) =>
  'reasoning_effort' in body
    ? new Response(
        JSON.stringify({
          object: 'error',
          message: 'reasoning_effort is not enabled for this model',
          type: 'invalid_request_invalid_args',
          code: '3051',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    : sse('ok');

test('a model without reasoning answers without the effort setting and is remembered', async () => {
  const mock = mockFetch(refuseEffort);
  try {
    let text = '';
    const run = () =>
      streamApiChat(
        endpoint,
        'mistral-large-latest',
        'system',
        [{ role: 'user', content: 'hallo' }],
        new AbortController().signal,
        async (chunk) => {
          text += chunk;
        },
        'high'
      );
    await run();
    assert.equal(text, 'ok');
    assert.deepEqual(
      mock.bodies.map((body) => body.reasoning_effort ?? null),
      ['high', null]
    );
    await run();
    assert.equal(mock.bodies.length, 3, 'the second turn skips the refused setting');
    assert.equal(mock.bodies[2]?.reasoning_effort, undefined);
  } finally {
    mock.restore();
  }
});

test('other rejections keep failing and name the upstream reason without the key', async () => {
  const mock = mockFetch(
    () =>
      new Response(JSON.stringify({ message: 'Invalid model: nope (key secret-key)' }), {
        status: 400,
      })
  );
  try {
    await assert.rejects(
      streamApiChat(
        endpoint,
        'nope',
        'system',
        [{ role: 'user', content: 'hallo' }],
        new AbortController().signal,
        async () => {},
        'high'
      ),
      (error: Error) => {
        assert.match(error.message, /HTTP 400: Invalid model: nope/);
        assert.doesNotMatch(error.message, /secret-key/);
        return true;
      }
    );
    assert.equal(mock.bodies.length, 1);
  } finally {
    mock.restore();
  }
});
