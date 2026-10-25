import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Server } from 'socket.io';
import { io as client, type Socket } from 'socket.io-client';
import WebSocket, { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'realtime-fixture-jwt-secret-00000000000000';
process.env.ENCRYPTION_KEY = 'realtime-fixture-encryption-000000000000';
const { useTestSchema, createTestSchema, dropTestSchema } = await import('../src/db/testing.js');
useTestSchema();
const { run, get, all } = await import('../src/db/pg.js');
const { safeEncrypt } = await import('../src/utils/encryption.js');
const { writeOpenCodeProvidersForUser } = await import('../src/utils/opencodeProviderKeys.js');
const { generateUserToken } = await import('../src/utils/authTokens.js');
const { createResource } = await import('../src/services/assistant/resources.js');
const { setupRealtimeVoice } = await import('../src/services/assistant/realtimeVoice.js');
const server = createServer(),
  socketServer = new Server(server),
  upstreamServer = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await once(upstreamServer, 'listening');
const upstreamAddress = upstreamServer.address();
assert(upstreamAddress && typeof upstreamAddress !== 'string');
let upstreamCount = 0;
let wire: WebSocket | undefined;
const received: Record<string, unknown>[] = [];
upstreamServer.on('connection', (socket) => {
  wire = socket;
  upstreamCount++;
  socket.on('message', (raw) => {
    const e = JSON.parse(raw.toString());
    received.push(e);
    if (e.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
  });
});
setupRealtimeVoice(socketServer, (model, key) => {
  assert.equal(model, 'gpt-realtime-2.1');
  assert.equal(key, 'fixture-secret');
  return new WebSocket(`ws://127.0.0.1:${upstreamAddress.port}`);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const clients: Socket[] = [];
const connect = (user: string, chatId: string) => {
  const socket = client(`http://127.0.0.1:${address.port}/realtime`, {
    auth: { token: generateUserToken(user), chatId },
    transports: ['websocket'],
    reconnection: false,
  });
  clients.push(socket);
  return socket;
};
const event = (socket: Socket, name: string) =>
  Promise.race([
    new Promise<unknown>((resolve) => socket.once(name, resolve)),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Event timeout: ' + name)), 10000);
      timer.unref();
    }),
  ]);
try {
  await createTestSchema();
  for (const id of ['voice-alice', 'voice-bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id,status) VALUES(?,?,'test',?,'active')",
      id,
      id + '@fixture.invalid',
      id
    );
  const now = new Date().toISOString();
  await writeOpenCodeProvidersForUser('voice-alice', [
    {
      id: 'openai',
      name: 'OpenAI',
      apiKey: safeEncrypt('fixture-secret')!,
      enabled: true,
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-realtime-2.1'],
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const chat = await createResource('voice-alice', 'api-chat', 'Audiofixture', {
    providerId: 'openai',
    model: 'gpt-realtime-2.1',
    temporary: false,
    sourceIds: [],
  });
  const unavailable = connect('voice-bob', chat.id);
  assert.match(String(await event(unavailable, 'problem')), /OpenAI-Verbindung/);
  assert.equal(upstreamCount, 0);
  const foreign = await createResource('voice-bob', 'api-chat', 'Privat', {
    providerId: 'openai',
    model: 'gpt-realtime-2.1',
    sourceIds: [],
  });
  const denied = connect('voice-alice', foreign.id);
  assert.match(String(await event(denied, 'problem')), /nicht gefunden/i);
  assert.equal(upstreamCount, 0);
  const socket = connect('voice-alice', chat.id);
  await event(socket, 'ready');
  assert.equal(upstreamCount, 1);
  assert.equal((received[0]!.session as { type: string }).type, 'realtime');
  assert.equal(
    (await all("SELECT id FROM assistant_api_turns WHERE chat_id=? AND status='running'", chat.id))
      .length,
    1
  );
  const duplicate = connect('voice-alice', chat.id);
  assert.match(String(await event(duplicate, 'problem')), /zuerst stoppen/);
  assert.equal(upstreamCount, 1);
  socket.emit('audio', 'AAAAAA==');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert(received.some((e) => e.type === 'input_audio_buffer.append' && e.audio === 'AAAAAA=='));
  const userItem = randomUUID();
  for (const e of [
    { type: 'input_audio_buffer.committed', item_id: userItem },
    { type: 'response.created', response: { id: 'response-fixture' } },
    {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: userItem,
      transcript: 'Sprich mit mir.',
    },
    {
      type: 'response.output_audio_transcript.delta',
      response_id: 'response-fixture',
      delta: 'Ich höre dich.',
    },
    { type: 'response.output_audio.delta', delta: 'AAAAAA==' },
    {
      type: 'response.done',
      response: {
        id: 'response-fixture',
        status: 'completed',
        usage: { input_tokens: 20, output_tokens: 10, input_token_details: { cached_tokens: 3 } },
      },
    },
  ])
    wire!.send(JSON.stringify(e));
  await event(socket, 'saved');
  const turn = await get(
    "SELECT prompt,response,usage_json FROM assistant_api_turns WHERE chat_id=? AND status='completed'",
    chat.id
  );
  assert.equal(turn!.prompt, 'Sprich mit mir.');
  assert.equal(turn!.response, 'Ich höre dich.');
  assert.equal(JSON.parse(turn!.usage_json).cached, 3);
  assert.equal(
    (await all('SELECT id FROM assistant_api_usage WHERE chat_id=?', chat.id)).length,
    1
  );
  wire!.send(JSON.stringify({ type: 'response.created', response: { id: 'tools-only' } }));
  wire!.send(
    JSON.stringify({
      type: 'response.done',
      response: {
        id: 'tools-only',
        status: 'completed',
        usage: { input_tokens: 5, output_tokens: 2 },
      },
    })
  );
  wire!.send(JSON.stringify({ type: 'response.created', response: { id: 'partial-response' } }));
  wire!.send(
    JSON.stringify({
      type: 'response.output_audio_transcript.delta',
      response_id: 'partial-response',
      delta: 'Noch nicht fertig.',
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const disconnected = event(socket, 'disconnect');
  socket.emit('stop');
  await disconnected;
  assert.equal(
    (await all("SELECT id FROM assistant_api_turns WHERE chat_id=? AND status='running'", chat.id))
      .length,
    0
  );
  assert.equal(
    (await all('SELECT id FROM assistant_api_usage WHERE chat_id=?', chat.id)).length,
    2,
    'tool-only API call is billed'
  );
  assert.equal(
    (await all("SELECT id FROM assistant_api_turns WHERE chat_id=? AND response=''", chat.id))
      .length,
    0,
    'tool-only calls do not create empty replies'
  );
  assert.equal(
    (await get(
      "SELECT response FROM assistant_api_turns WHERE chat_id=? AND status='stopped'",
      chat.id
    ))!.response,
    'Noch nicht fertig.',
    'closing preserves partial spoken reply'
  );
  console.log(
    'PASS: authenticated bidirectional audio, owned chat isolation, missing-provider boundary, concurrent-turn guard, real WebSocket continuation, transcript/usage persistence and disconnect cleanup'
  );
} finally {
  for (const socket of clients) socket.disconnect();
  await new Promise<void>((resolve) => socketServer.close(() => resolve()));
  for (const socket of upstreamServer.clients) socket.terminate();
  await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
  await dropTestSchema();
}
