import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'api-transport-fixture-session-secret-0000000000';
process.env.JWT_SECRET = 'api-transport-fixture-jwt-secret-00000000000000';
const { streamApiChat } = await import('../src/services/assistant/apiTransport.js');
const original = globalThis.fetch;
try {
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://transport.fixture.invalid/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-only');
    const frames = [
      {
        choices: [
          {
            index: 0,
            delta: {
              content: [
                { type: 'thinking', thinking: [{ type: 'text', text: 'private reasoning' }] },
                { type: 'text', text: 'PLUM' },
              ],
            },
          },
        ],
      },
      { choices: [{ index: 0, delta: { content: [{ type: 'text', text: '_API' }] } }] },
      { choices: [{ index: 0, delta: { content: '_OK' }, finish_reason: 'stop' }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          prompt_tokens_details: { cached_tokens: 3 },
        },
      },
    ];
    const wire =
      frames.map((frame) => 'data: ' + JSON.stringify(frame) + '\r\n\r\n').join('') +
      'data: [DONE]\r\n\r\n';
    return new Response(
      new ReadableStream({
        start(controller) {
          const bytes = new TextEncoder().encode(wire);
          for (let n = 0; n < bytes.length; n += 3) controller.enqueue(bytes.slice(n, n + 3));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } }
    );
  };
  let text = '';
  const result = await streamApiChat(
    {
      id: 'mistral',
      name: 'Fixture',
      protocol: 'openai',
      models: ['mistral-large-4'],
      baseUrl: 'https://transport.fixture.invalid/v1',
      key: 'fixture-only',
    },
    'mistral-large-4',
    'Fixture',
    [{ role: 'user', content: 'Fixture' }],
    new AbortController().signal,
    async (chunk) => {
      text += chunk;
    }
  );
  assert.equal(text, 'PLUM_API_OK');
  assert.deepEqual(result.usage, { input: 9, output: 8, cached: 3, cacheWrite: 0 });
  assert.equal(result.warning, null);
  console.log(
    'PASS: Mistral mixed text blocks/string deltas are complete; reasoning is excluded; fragmented SSE and usage preserved'
  );
} finally {
  globalThis.fetch = original;
}
