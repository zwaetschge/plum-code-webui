import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'workbench-session-fixture-000000000000000';
process.env.JWT_SECRET = 'workbench-jwt-fixture-00000000000000000000';
process.env.ENCRYPTION_KEY = 'workbench-encryption-fixture-000000000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, all } = await import('../src/db/pg.js');
const { safeEncrypt } = await import('../src/utils/encryption.js');
const { writeModelProvidersForUser } = await import('../src/utils/modelProviderKeys.js');
const { createApiChat, startApiTurn, apiChatTurns, purgeTemporaryApiChat } =
  await import('../src/services/assistant/apiChats.js');
const { importChats, exportChat, shareChat, parseChatArchive } =
  await import('../src/services/assistant/chatPortability.js');
const { ingestSource } = await import('../src/services/assistant/ingestion.js');
const { listResources, createResource, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const { taskSourceContext } = await import('../src/services/assistant/taskSources.js');
const { CHAT_OPTIONS } = await import('../src/services/assistant/chatOptions.js');
const { streamApiChat, apiChatEndpoint } =
  await import('../src/services/assistant/apiTransport.js');
const originalFetch = globalThis.fetch,
  root = await mkdtemp(path.join(tmpdir(), 'plum-workbench-'));
const requests: Array<Record<string, any>> = [];
function sse(items: unknown[]) {
  return new Response(
    items
      .map((item) => 'data: ' + (typeof item === 'string' ? item : JSON.stringify(item)) + '\n\n')
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  );
}
let toolMode = false;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, 'workbench.fixture.invalid', 'test never accesses real network');
  const body = JSON.parse(String(init?.body));
  requests.push(body);
  if (body.input)
    return Response.json({
      embeddings: body.input.map((text: string) =>
        Array.from({ length: 16 }, (_, i) =>
          i === 0 ? 1 : text.includes('semantisch') && i === 1 ? 0.4 : 0
        )
      ),
    });
  if (body.model === 'claude-sonnet-4-6')
    return sse([
      {
        type: 'message_start',
        message: { model: body.model, usage: { input_tokens: 8, output_tokens: 0 } },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: 'Vergleich aus Claude' },
      },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
      { type: 'message_stop' },
    ]);
  if (toolMode && body.tools?.length && !body.messages.some((m: any) => m.role === 'tool')) {
    const name = body.tools.find((t: any) => t.function.name.startsWith('mcp_'))?.function.name;
    return sse([
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: 'fixture_call', function: { name, arguments: '{"x":21}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      },
      '[DONE]',
    ]);
  }
  return sse([
    {
      model: body.model,
      choices: [
        {
          index: 0,
          delta: {
            content: body.messages?.some((m: any) => m.role === 'tool')
              ? 'Werkzeug bestätigt: 42'
              : 'Belegte Antwort',
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    },
    '[DONE]',
  ]);
};
async function settled(chat: string, turn: string) {
  for (let i = 0; i < 200; i++) {
    const item = (await apiChatTurns('workbench-alice', chat)).turns.find((t) => t.id === turn);
    if (item && item.status !== 'running') return item;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Turn timed out');
}
async function newChat(extra = {}) {
  return createApiChat('workbench-alice', {
    commandId: randomUUID(),
    title: 'Test',
    providerId: 'openai',
    model: 'gpt-5.5',
    sourceIds: [],
    ...extra,
  });
}
if (!(await databaseReachable())) throw new Error('isolated test database unavailable');
try {
  await createTestSchema();
  for (const name of ['alice', 'bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id,role) VALUES(?,?,'test',?,'admin')",
      `workbench-${name}`,
      `${name}@workbench.invalid`,
      name
    );
  const now = new Date().toISOString();
  await writeModelProvidersForUser(
    'workbench-alice',
    ['openai', 'anthropic'].map((id) => ({
      id,
      name: id,
      enabled: true,
      baseUrl: 'https://workbench.fixture.invalid/v1',
      apiKey: safeEncrypt('fixture-key')!,
      models: [id === 'openai' ? 'gpt-5.5' : 'claude-sonnet-4-6'],
      createdAt: now,
      updatedAt: now,
    }))
  );
  const temporary = await newChat({ temporary: true });
  const source = await ingestSource(
    'workbench-alice',
    {
      buffer: Buffer.from('Dateiinhalt für die Frage'),
      originalname: 'probe.txt',
      mimetype: 'text/plain',
    },
    undefined,
    undefined,
    { temporaryChatId: temporary.id }
  );
  assert(!(await listResources('workbench-alice', 'source')).some((s) => s.id === source.id));
  const first = await startApiTurn('workbench-alice', temporary.id, {
    commandId: randomUUID(),
    expectedRevision: temporary.revision,
    prompt: 'Was steht im Dokument?',
    documentSourceIds: [source.id],
  });
  const done = await settled(temporary.id, first.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.sources?.[0]?.text, 'Dateiinhalt für die Frage');
  const next = await startApiTurn('workbench-alice', temporary.id, {
    commandId: randomUUID(),
    expectedRevision: temporary.revision,
    prompt: 'Und nochmals?',
  });
  assert.equal((await settled(temporary.id, next.id)).sources?.[0]?.id, source.id);
  await assert.rejects(() => shareChat('workbench-alice', temporary.id));
  await assert.rejects(() => exportChat('workbench-bob', temporary.id));
  const assetId = source.body.assetId;
  await purgeTemporaryApiChat('workbench-alice', temporary.id, true);
  assert.equal(await get('SELECT id FROM assistant_resources WHERE id=?', source.id), undefined);
  assert.equal(await get('SELECT id FROM assistant_assets WHERE id=?', assetId), undefined);
  console.log(
    'PASS: direct documents persist across turns, remain owner-scoped, stay out of temporary source library, and expire with original bytes'
  );

  const file = path.join(root, 'mcp.mjs');
  await writeFile(
    file,
    `import {createInterface} from 'node:readline';const rl=createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(!m.id)return;let result=m.method==='initialize'?{protocolVersion:'2024-11-05'}:m.method==='tools/list'?{tools:[{name:'double',description:'Double a number',inputSchema:{type:'object',properties:{x:{type:'number'}},required:['x']},annotations:{readOnlyHint:true}},{name:'write',inputSchema:{type:'object'},annotations:{readOnlyHint:false}}]}:{content:[{type:'text',text:String(m.params.arguments.x*2)}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`
  );
  await run(
    "INSERT INTO mcp_servers(id,user_id,name,type,command,args,env,enabled) VALUES(?,?,?,'subprocess',?,?,'{}',1)",
    'fixture-mcp',
    'workbench-alice',
    'Fixture',
    process.execPath,
    JSON.stringify([file])
  );
  const tools = await newChat({
    chatOptions: CHAT_OPTIONS.parse({
      mcpServerIds: ['fixture-mcp'],
      toolLoading: 'eager',
      comparisonModels: [{ providerId: 'anthropic', model: 'claude-sonnet-4-6' }],
    }),
  });
  toolMode = true;
  const started = await startApiTurn('workbench-alice', tools.id, {
    commandId: randomUUID(),
    expectedRevision: tools.revision,
    prompt: 'Verdopple 21',
  });
  const toolDone = await settled(tools.id, started.id);
  assert.equal(toolDone.status, 'completed');
  assert.match(toolDone.response, /42/);
  assert.equal(toolDone.toolEvents?.[0]?.status, 'completed');
  assert.equal(toolDone.comparisons?.[0]?.status, 'completed');
  const request = requests.find((r) =>
    r.tools?.some((t: any) => t.function?.name?.startsWith('mcp_'))
  )!;
  assert(!request.tools.some((t: any) => t.function.name.endsWith('_write')));
  assert(
    requests.some((r) =>
      r.messages?.some((m: any) => m.role === 'tool' && m.content.includes('42'))
    )
  );
  const billing = await all(
    'SELECT provider_id,model,status,usage_json FROM assistant_api_usage WHERE chat_id=?',
    tools.id
  );
  assert.equal(billing.length, 3);
  assert(billing.every((row) => row.status === 'completed'));
  assert.equal(billing.filter((row) => row.provider_id === 'anthropic').length, 1);
  assert.equal(toolDone.usage?.input, 30);
  console.log(
    'PASS: real subprocess MCP handshake/tool result/model continuation, write tools excluded, parallel models and per-call/provider billing'
  );
  toolMode = false;
  const merged = await startApiTurn('workbench-alice', tools.id, {
    commandId: randomUUID(),
    expectedRevision: tools.revision,
    prompt: toolDone.prompt,
    mergeTurnId: toolDone.id,
  });
  assert.equal((await settled(tools.id, merged.id)).comparisons?.length, 0);
  assert(
    requests.some((r) =>
      r.messages?.some(
        (m: any) =>
          String(m.content).includes('Vergleich aus Claude') &&
          String(m.content).includes('Synthesize')
      )
    )
  );
  const share = await shareChat('workbench-alice', tools.id);
  const snapshot = await get('SELECT snapshot_json FROM assistant_shares WHERE id=?', share.id);
  assert(!snapshot.snapshot_json.includes('fixture-key'));
  assert(!snapshot.snapshot_json.includes('system'));
  await assert.rejects(() => shareChat('workbench-bob', tools.id));
  console.log(
    'PASS: comparison merge uses actual candidates, sharing snapshots exclude private model context and enforce ownership'
  );

  const graph = [
    {
      id: 'old-1',
      chat: {
        title: 'Open WebUI',
        history: {
          currentId: 'a2',
          messages: {
            u: { id: 'u', role: 'user', content: 'Frage', parentId: null },
            a: { id: 'a', role: 'assistant', content: 'Erste Antwort', parentId: 'u' },
            a2: { id: 'a2', role: 'assistant', content: 'Andere Antwort', parentId: 'u' },
          },
        },
      },
    },
  ];
  const imported = await importChats(
    'workbench-alice',
    Buffer.from(JSON.stringify(graph)),
    'openai',
    'gpt-5.5'
  );
  assert.equal(imported.count, 2);
  assert.equal(
    (await apiChatTurns('workbench-alice', imported.chats[0].id)).turns[0]?.response,
    'Andere Antwort'
  );
  assert.deepEqual(
    await importChats('workbench-alice', Buffer.from(JSON.stringify(graph)), 'openai', 'gpt-5.5'),
    imported
  );
  assert.equal(
    (await exportChat('workbench-alice', imported.chats[1].id)).chat.messages[1]?.content,
    'Erste Antwort'
  );
  assert.throws(() =>
    parseChatArchive({
      chat: { history: { messages: { a: { role: 'user', parentId: 'a', content: 'cycle' } } } },
    })
  );
  console.log(
    'PASS: Open WebUI selected branch plus alternatives, durable deduplicated import, export and graph corruption rejection'
  );

  process.env.PLUM_MEMORY_EMBEDDING_URL = 'https://workbench.fixture.invalid/embeddings';
  const long = await createResource(
    'workbench-alice',
    'source',
    'Lange Quelle',
    BODY_SCHEMAS.source.parse({
      text:
        'Einleitung '.repeat(800) +
        'semantisch relevante Stelle '.repeat(150) +
        'Andere Passage '.repeat(600),
    })
  );
  const passages = await taskSourceContext(
    'workbench-alice',
    [{ id: long.id, revision: 1 }],
    'semantisch'
  );
  assert(passages.length > 1);
  assert(passages.some((s) => s.retrieval === 'hybrid'));
  assert(
    passages.every(
      (s) => String(long.body.text).slice(s.excerptStart, s.excerptStart + s.text.length) === s.text
    )
  );
  const full = await taskSourceContext(
    'workbench-alice',
    [{ id: long.id, revision: 1 }],
    'alles',
    true
  );
  assert.equal(full[0]?.text, long.body.text);
  console.log(
    'PASS: hybrid document ranking, multiple exact revision-bound passages, offset correctness and full-document mode'
  );
  const { uploadApiImage } = await import('../src/services/assistant/apiFiles.js');
  const roundtrip = await newChat();
  const image = await uploadApiImage('workbench-alice', roundtrip.id, {
    originalname: 'pixel.png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    ),
  });
  const attached = await startApiTurn('workbench-alice', roundtrip.id, {
    commandId: randomUUID(),
    expectedRevision: roundtrip.revision,
    prompt: 'Bild und Datei',
    documentSourceIds: [long.id],
    imageAssetIds: [image.id],
  });
  await settled(roundtrip.id, attached.id);
  const regenerated = await startApiTurn('workbench-alice', roundtrip.id, {
    commandId: randomUUID(),
    expectedRevision: roundtrip.revision,
    prompt: 'Bild und Datei anders',
    regenerate: attached.id,
    imageAssetIds: [image.id],
  });
  await settled(roundtrip.id, regenerated.id);
  const backup = await exportChat('workbench-alice', roundtrip.id);
  const restored = await importChats(
    'workbench-alice',
    Buffer.from(JSON.stringify(backup)),
    'openai',
    'gpt-5.5'
  );
  const restoredChat = await apiChatTurns('workbench-alice', restored.chats[0].id);
  assert.equal(restoredChat.turns.length, 1);
  assert.equal(restoredChat.turns[0]?.versions?.length, 2);
  assert.equal(restoredChat.turns[0]?.imageAssetIds?.length, 1);
  assert.notEqual(restoredChat.turns[0]?.id, regenerated.id);
  assert(restoredChat.turns[0]?.sources?.length);
  assert.notEqual(restoredChat.turns[0]?.sources?.[0]?.id, long.id);
  console.log(
    'PASS: Plum JSON roundtrip restores hidden answer versions, original images/documents, rebinds source IDs and creates no duplicate usage'
  );

  const endpoint = await apiChatEndpoint('workbench-alice', 'anthropic', 'claude-sonnet-4-6');
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    sse([
      { type: 'message_start', message: { model: 'claude-sonnet-4-6' } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'native_call', name: 'calculate', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"x":42}' },
      },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      { type: 'message_stop' },
    ]);
  const native = await streamApiChat(
    endpoint,
    endpoint.models[0]!,
    '',
    [{ role: 'user', content: '42' }],
    new AbortController().signal,
    async () => {},
    undefined,
    { tools: [{ name: 'calculate', description: '', parameters: { type: 'object' } }] }
  );
  assert.equal(native.toolCalls?.[0]?.arguments, '{"x":42}');
  assert.deepEqual((native.nativeBlocks?.[0] as any).input, { x: 42 });
  globalThis.fetch = previous;
  console.log('PASS: Anthropic native streamed tool JSON is reassembled for continuation');
} finally {
  globalThis.fetch = originalFetch;
  await dropTestSchema();
  await rm(root, { recursive: true, force: true });
}
