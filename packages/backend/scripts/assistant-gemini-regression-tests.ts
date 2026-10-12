import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'gemini-fixture-encryption-key-000000000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, closePool } = await import('../src/db/pg.js');
const { safeEncrypt } = await import('../src/utils/encryption.js');
const { writeOpenCodeProvidersForUser } = await import('../src/utils/opencodeProviderKeys.js');
const { apiChatProviders, apiChatEndpoint, streamApiChat } =
  await import('../src/services/assistant/apiTransport.js');
const { createApiChat, startApiTurn, apiChatTurns } =
  await import('../src/services/assistant/apiChats.js');
let events: unknown[] = [];
const nativeFetch = globalThis.fetch,
  requests: Array<{ url: URL; headers: Headers; body: any }> = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, 'gemini.fixture.invalid');
  requests.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
  const text = events.map((event) => 'data: ' + JSON.stringify(event) + '\r\n\r\n').join('');
  return new Response(
    new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(text);
        for (let n = 0; n < bytes.length; n += 3) controller.enqueue(bytes.slice(n, n + 3));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  );
};
async function settled(chatId: string, turnId: string) {
  for (let n = 0; n < 200; n++) {
    const turn = (await apiChatTurns('gemini-alice', chatId)).turns.find(
      (value) => value.id === turnId
    );
    if (turn && turn.status !== 'running') return turn;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Fixture did not settle');
}
if (!(await databaseReachable())) {
  await closePool();
  throw new Error('Own test database unavailable');
}
try {
  await createTestSchema();
  await run(
    "INSERT INTO users(id,email,provider,provider_id) VALUES('gemini-alice','gemini@fixture.invalid','test','gemini-alice')"
  );
  const stamp = new Date().toISOString();
  await writeOpenCodeProvidersForUser('gemini-alice', [
    {
      id: 'google',
      name: 'Own Gemini',
      enabled: true,
      apiKey: safeEncrypt('gemini-fixture-key')!,
      baseUrl: 'https://gemini.fixture.invalid/v1beta',
      models: ['gemini-3.1-pro-preview'],
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]);
  const providers = await apiChatProviders('gemini-alice');
  assert.equal(providers[0]?.protocol, 'gemini');
  assert(!JSON.stringify(providers).includes('fixture-key'));
  const endpoint = await apiChatEndpoint('gemini-alice', 'google', 'gemini-3.1-pro-preview');
  events = [
    {
      modelVersion: 'gemini-3.1-pro-preview',
      candidates: [
        {
          index: 0,
          content: { parts: [{ text: 'Hidden thoughts', thought: true }, { text: 'Äpfel 🍎' }] },
        },
      ],
    },
    {
      candidates: [{ index: 0, content: { parts: [{ text: ' sind gut' }] }, finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 20,
        cachedContentTokenCount: 4,
        candidatesTokenCount: 5,
        thoughtsTokenCount: 3,
      },
    },
  ];
  let output = '';
  const result = await streamApiChat(
    endpoint,
    'gemini-3.1-pro-preview',
    'Profil ä',
    [
      {
        role: 'user',
        content: 'Original',
        images: [{ mimeType: 'image/png', data: 'fixture-original-base64' }],
      },
      { role: 'assistant', content: 'Vorher' },
      { role: 'user', content: 'Weiter' },
    ],
    new AbortController().signal,
    async (value) => {
      output += value;
    }
  );
  assert.equal(output, 'Äpfel 🍎 sind gut');
  assert.deepEqual(result.usage, { input: 16, output: 8, cached: 4, cacheWrite: 0 });
  const request = requests[0]!;
  assert.equal(request.url.pathname, '/v1beta/models/gemini-3.1-pro-preview:streamGenerateContent');
  assert.equal(request.url.search, '?alt=sse');
  assert.equal(request.headers.get('x-goog-api-key'), 'gemini-fixture-key');
  assert(!request.headers.has('authorization'));
  assert(!request.url.href.includes('fixture-key'));
  assert.deepEqual(request.body.systemInstruction, { parts: [{ text: 'Profil ä' }] });
  assert.equal(request.body.contents[1].role, 'model');
  assert.deepEqual(request.body.contents[0].parts[1], {
    inlineData: { mimeType: 'image/png', data: 'fixture-original-base64' },
  });
  const chat = await createApiChat('gemini-alice', {
    commandId: randomUUID(),
    providerId: 'google',
    model: 'gemini-3.1-pro-preview',
    title: 'Gemini',
    sourceIds: [],
  });
  const accepted = await startApiTurn('gemini-alice', chat.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Eigene Frage',
  });
  const done = await settled(chat.id, accepted.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.response, output);
  assert.equal(done.usage?.output, 8);
  for (const [stream, pattern] of [
    [[{ promptFeedback: { blockReason: 'SAFETY' } }], /Eingabe abgewiesen/],
    [
      [
        {
          candidates: [
            { content: { parts: [{ functionCall: { name: 'tool' } }] }, finishReason: 'STOP' },
          ],
        },
      ],
      /Werkzeuge/,
    ],
    [[{ candidates: [{ content: { parts: [{ text: 'Teilantwort' }] } }] }], /bestätigten Antwort/],
  ] as const) {
    events = [...stream];
    await assert.rejects(
      streamApiChat(
        endpoint,
        'gemini-3.1-pro-preview',
        '',
        [],
        new AbortController().signal,
        async () => {}
      ),
      pattern
    );
  }
  events = [
    {
      candidates: [{ content: { parts: [{ text: 'Abgeschnitten' }] }, finishReason: 'MAX_TOKENS' }],
    },
  ];
  assert.match(
    (
      await streamApiChat(
        endpoint,
        'gemini-3.1-pro-preview',
        '',
        [],
        new AbortController().signal,
        async () => {}
      )
    ).warning!,
    /MAX_TOKENS/
  );
  await assert.rejects(
    streamApiChat(
      endpoint,
      '../models/foreign',
      '',
      [],
      new AbortController().signal,
      async () => {}
    ),
    /Gemini-Modell/
  );
  console.log(
    'PASS: own encrypted Google catalog and actual API chat persistence, fragmented native Gemini SSE with text/image/system/history, disjoint cache/reasoning usage, bounded headers, block/tool/interruption/errors; no external model called'
  );
} finally {
  globalThis.fetch = nativeFetch;
  await dropTestSchema();
}
