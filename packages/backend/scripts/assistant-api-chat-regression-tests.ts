import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'api-chat-fixture-session-secret-0000000000';
process.env.JWT_SECRET = 'api-chat-fixture-jwt-secret-00000000000000';
process.env.ENCRYPTION_KEY = 'api-chat-fixture-encryption-key-000000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const { BODY_SCHEMAS, createResource, reviseResource, archiveResource } =
  await import('../src/services/assistant/resources.js');
const { safeEncrypt } = await import('../src/utils/encryption.js');
const { writeOpenCodeProvidersForUser } = await import('../src/utils/opencodeProviderKeys.js');
const { apiChatProviders } = await import('../src/services/assistant/apiTransport.js');
const { apiUsage } = await import('../src/services/assistant/apiUsage.js');
const {
  createApiChat,
  systemContext,
  updateApiChat,
  startApiTurn,
  apiChatTurns,
  stopApiTurn,
  branchApiChat,
  materializeApiAnswer,
  applyApiSelection,
  purgeTemporaryApiChat,
} = await import('../src/services/assistant/apiChats.js');
const { taskOriginContext } = await import('../src/services/assistant/taskSources.js');
const { executeAssistantTool } = await import('../src/services/assistant/tools.js');
const { uploadApiImage, apiChatImages, apiChatImage } =
  await import('../src/services/assistant/apiFiles.js');
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const imageWorkspace = await mkdtemp(path.join(tmpdir(), 'plum-api-task-image-'));
const { assistantExportSnapshot } = await import('../src/services/assistant/accountExport.js');
const originalFetch = globalThis.fetch,
  requests: Array<{
    headers: Headers;
    body: Record<string, unknown> & {
      messages?: Array<{ role: string; content: string }>;
      system?: string;
    };
  }> = [];
let mode: 'openai' | 'anthropic' | 'broken' | 'wait' = 'openai',
  release: () => void = () => {};
let researchReply: string | null = null;
const stream = (events: string) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(events);
        for (let n = 0; n < bytes.length; n += 7) controller.enqueue(bytes.slice(n, n + 7));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  );
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, 'api-chat.fixture.invalid', 'test may only call its fake endpoint');
  const headers = new Headers(init?.headers),
    body = JSON.parse(String(init?.body));
  requests.push({ headers, body });
  if (mode === 'wait')
    await new Promise<void>((resolve, reject) => {
      release = resolve;
      init?.signal?.addEventListener('abort', () => reject(new Error('fixture cancelled')), {
        once: true,
      });
      if (init?.signal?.aborted) reject(new Error('fixture cancelled'));
    });
  if (mode === 'broken')
    return stream(
      'data: ' +
        JSON.stringify({ choices: [{ index: 0, delta: { content: 'Teilantwort' } }] }) +
        '\n\n'
    );
  if (mode === 'anthropic') {
    assert(url.pathname.endsWith('/v1/messages'));
    assert(!headers.has('authorization'));
    assert.equal(headers.get('x-api-key'), 'fixture-key-alice');
    return stream(
      [
        {
          type: 'message_start',
          message: {
            model: 'claude-sonnet-4-6',
            usage: {
              input_tokens: 7,
              cache_read_input_tokens: 3,
              cache_creation_input_tokens: 2,
              output_tokens: 0,
            },
          },
        },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Äpfel 🍎' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
        { type: 'message_stop' },
      ]
        .map((event) => 'data: ' + JSON.stringify(event) + '\r\n\r\n')
        .join('')
    );
  }
  assert(url.pathname.endsWith('/v1/chat/completions'));
  assert.equal(headers.get('authorization'), 'Bearer fixture-key-alice');
  assert.equal(body.stream, true);
  return stream(
    [
      JSON.stringify({
        model: 'gpt-5.5',
        choices: [{ index: 0, delta: { content: researchReply ?? 'Hallo ä 🍎' } }],
      }),
      JSON.stringify({
        choices: [
          { index: 0, delta: { content: researchReply ? '' : ' aus Plum' }, finish_reason: 'stop' },
        ],
      }),
      JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: 10,
          prompt_tokens_details: { cached_tokens: 3 },
          completion_tokens: 4,
        },
      }),
      '[DONE]',
    ]
      .map((event) => 'data: ' + event + '\r\n\r\n')
      .join('')
  );
};
async function settled(owner: string, id: string, turnId: string) {
  for (let n = 0; n < 200; n++) {
    const result = (await apiChatTurns(owner, id)).turns.find((turn) => turn.id === turnId);
    if (result?.status !== 'running') return result!;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('fixture turn did not settle');
}
if (!(await databaseReachable())) {
  await closePool();
  throw new Error('isolated database unavailable');
}
try {
  await createTestSchema();
  for (const id of ['api-alice', 'api-bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES (?,?,'test',?)",
      id,
      `${id}@example.invalid`,
      id
    );
  const stamp = new Date().toISOString();
  await writeOpenCodeProvidersForUser('api-alice', [
    {
      id: 'openai',
      name: 'Fixture API',
      enabled: true,
      apiKey: safeEncrypt('fixture-key-alice')!,
      baseUrl: 'https://api-chat.fixture.invalid/v1',
      models: ['gpt-5.5'],
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'anthropic',
      name: 'Fixture Claude',
      enabled: true,
      apiKey: safeEncrypt('fixture-key-alice')!,
      baseUrl: 'https://api-chat.fixture.invalid',
      models: ['claude-sonnet-4-6'],
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]);
  assert.equal((await apiChatProviders('api-bob')).length, 0);
  assert(!JSON.stringify(await apiChatProviders('api-alice')).includes('fixture-key'));
  const profile = await createResource(
    'api-alice',
    'profile',
    'Profil',
    BODY_SCHEMAS.profile.parse({ instructions: 'OLD PROFILE', memory: 'read' })
  );
  await createResource(
    'api-alice',
    'memory',
    'Eigenes',
    BODY_SCHEMAS.memory.parse({ text: 'ALICE MEMORY' })
  );
  await createResource(
    'api-bob',
    'memory',
    'Fremdes',
    BODY_SCHEMAS.memory.parse({ text: 'BOB MEMORY' })
  );
  const source = await createResource(
    'api-alice',
    'source',
    'Original',
    BODY_SCHEMAS.source.parse({ text: 'SOURCE VERSION ONE' })
  );
  const input = {
    commandId: randomUUID(),
    title: 'Gespräch',
    providerId: 'openai',
    model: 'gpt-5.5',
    profileId: profile.id,
    sourceIds: [source.id],
  };
  const chat = await createApiChat('api-alice', input);
  const image = await uploadApiImage('api-alice', chat.id, {
    originalname: '../probe.png',
    buffer: pixel,
  });
  assert.equal(image.filename, 'probe.png');
  assert.equal(
    (await uploadApiImage('api-alice', chat.id, { originalname: 'same.png', buffer: pixel })).id,
    image.id
  );
  assert.equal((await apiChatImages('api-alice', chat.id)).length, 1);
  assert((await apiChatImage('api-alice', chat.id, image.id)).bytes.equals(pixel));
  await assert.rejects(
    () => uploadApiImage('api-bob', chat.id, { originalname: 'foreign.png', buffer: pixel }),
    /nicht gefunden/
  );
  await assert.rejects(() => apiChatImage('api-bob', chat.id, image.id), /nicht gefunden/);
  await assert.rejects(
    () =>
      uploadApiImage('api-alice', chat.id, {
        originalname: 'injected.svg',
        buffer: Buffer.from('<svg onload="bad()"></svg>'),
      }),
    /PNG/
  );
  assert.equal((await createApiChat('api-alice', input)).id, chat.id);
  await assert.rejects(
    () => createApiChat('api-alice', { ...input, title: 'changed' }),
    /bereits verwendet/
  );
  await reviseResource('api-alice', profile.id, 1, 'Profil', {
    ...profile.body,
    instructions: 'NEW PROFILE',
  });
  await assert.rejects(
    () =>
      startApiTurn('api-bob', chat.id, {
        commandId: randomUUID(),
        expectedRevision: 1,
        prompt: 'foreign',
      }),
    /nicht gefunden/
  );
  const command = {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Erste Frage',
    imageAssetIds: [image.id],
  };
  await startApiTurn('api-alice', chat.id, command);
  const done = await settled('api-alice', chat.id, command.commandId);
  assert.equal(done.response, 'Hallo ä 🍎 aus Plum');
  assert.equal(done.status, 'completed');
  assert.equal(done.profileRevision, 1);
  assert.deepEqual(done.sourceVersions, [{ id: source.id, revision: 1 }]);
  assert.equal(done.usage?.input, 7);
  assert.equal(done.usage?.cached, 3);
  assert.equal(done.usage?.output, 4);
  assert(done.usage?.costUsd !== null);
  const system = JSON.stringify(requests[0].body.messages![0]);
  assert(
    JSON.stringify(requests[0].body.messages!.at(-1)).includes(
      'data:image/png;base64,' + pixel.toString('base64')
    )
  );
  assert(system.includes('OLD PROFILE'));
  assert(!system.includes('NEW PROFILE'));
  assert(system.includes('ALICE MEMORY'));
  assert(!system.includes('BOB MEMORY'));
  assert(system.includes('SOURCE VERSION ONE'));
  const calls = requests.length;
  await startApiTurn('api-alice', chat.id, command);
  assert.equal(requests.length, calls);
  assert.equal((await apiUsage('api-alice')).calls, 1);
  assert.equal((await apiUsage('api-bob')).calls, 0);
  await assert.rejects(
    () => startApiTurn('api-alice', chat.id, { ...command, prompt: 'changed' }),
    /anderem Inhalt/
  );
  console.log(
    'PASS: owner-bound API credentials, secret-free catalog, immutable profile/source context, fragmented UTF-8 SSE, disjoint token accounting and permanent command receipts'
  );
  const branchId = randomUUID(),
    branch = await branchApiChat('api-alice', chat.id, done.id, true, branchId);
  assert.equal(
    (await branchApiChat('api-alice', chat.id, done.id, true, branchId)).chat.id,
    branch.chat.id
  );
  const fork = (await apiChatTurns('api-alice', branch.chat.id)).turns;
  assert.equal(fork[0].response, done.response);
  assert.notEqual(fork[0].id, done.id);
  assert.equal(fork[0].usage, null);
  assert.deepEqual(fork[0].imageAssetIds, [image.id]);
  assert((await apiChatImage('api-alice', branch.chat.id, image.id)).bytes.equals(pixel));
  assert.equal(
    (await apiUsage('api-alice')).calls,
    1,
    'a copied branch must not duplicate API usage'
  );
  const edit = await branchApiChat('api-alice', chat.id, done.id, false, randomUUID());
  assert.equal(edit.prompt, 'Erste Frage');
  assert.deepEqual(edit.imageAssetIds, [image.id]);
  assert((await apiChatImage('api-alice', edit.chat.id, image.id)).bytes.equals(pixel));
  assert.equal((await apiChatTurns('api-alice', edit.chat.id)).turns.length, 0);
  assert.equal((await apiChatTurns('api-alice', chat.id)).turns[0].response, done.response);
  const save = { commandId: randomUUID(), turnId: done.id, kind: 'document' as const };
  const artifact = await materializeApiAnswer('api-alice', chat.id, save);
  assert.equal((await materializeApiAnswer('api-alice', chat.id, save)).id, artifact.id);
  assert.equal(artifact.body.content, done.response);
  const task = await materializeApiAnswer('api-alice', chat.id, {
    commandId: randomUUID(),
    turnId: done.id,
    kind: 'task',
    goal: 'Folgeauftrag',
  });
  assert.equal(task.body.status, 'draft');
  assert.equal((await taskOriginContext('api-alice', task.body))?.response, done.response);
  await run(
    "INSERT INTO sessions(id,user_id,name,working_directory,cli_provider,surface) VALUES ('api-task-worker','api-alice','Fixture worker',?,'codex','task')",
    imageWorkspace
  );
  await reviseResource('api-alice', task.id, task.revision, task.title, {
    ...task.body,
    sessionId: 'api-task-worker',
  });
  const taskImage = (await executeAssistantTool('api-task-worker', 'api-alice', {
    name: 'plum_read_task_image',
    arguments: { chatId: chat.id, assetId: image.id },
  })) as { image: { data: string; mimeType: string } };
  assert.equal(taskImage.image.mimeType, 'image/png');
  assert.equal(taskImage.image.data, pixel.toString('base64'));
  await assert.rejects(
    () =>
      executeAssistantTool('different-worker', 'api-alice', {
        name: 'plum_read_task_image',
        arguments: { chatId: chat.id, assetId: image.id },
      }),
    /keine Eingabe/
  );
  await assert.rejects(
    () =>
      executeAssistantTool('api-task-worker', 'api-bob', {
        name: 'plum_read_task_image',
        arguments: { chatId: chat.id, assetId: image.id },
      }),
    /keine Eingabe/
  );
  await assert.rejects(() => materializeApiAnswer('api-bob', chat.id, save), /nicht gefunden/);
  assert.equal((await assistantExportSnapshot('api-alice')).apiChatTurns.length, 2);
  assert.equal((await assistantExportSnapshot('api-bob')).apiChatTurns.length, 0);
  const original = 'Vorher 🍏 alte Stelle danach 🌙';
  const editable = await createResource(
    'api-alice',
    'artifact',
    'Text ändern',
    BODY_SCHEMAS.artifact.parse({ content: original })
  );
  const selectionInput = {
    ...input,
    profileId: undefined,
    sourceIds: [],
    commandId: randomUUID(),
    artifactEdit: {
      artifactId: editable.id,
      revision: 1,
      start: original.indexOf('alte'),
      end: original.indexOf(' danach'),
      selectedText: 'alte Stelle',
    },
  };
  await assert.rejects(
    () => createApiChat('api-bob', { ...selectionInput, commandId: randomUUID() }),
    /nicht verfügbar|nicht gefunden|Verbindung/
  );
  await assert.rejects(
    () =>
      createApiChat('api-alice', {
        ...selectionInput,
        commandId: randomUUID(),
        artifactEdit: { ...selectionInput.artifactEdit, selectedText: 'anderer Text' },
      }),
    /Textauswahl/
  );
  const selectionChat = await createApiChat('api-alice', selectionInput);
  const proposal = await startApiTurn('api-alice', selectionChat.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Formuliere diese Stelle schöner',
  });
  await settled('api-alice', selectionChat.id, proposal.id);
  assert(JSON.stringify(requests.at(-1)!.body).includes('return only replacement text'));
  const apply = { commandId: randomUUID(), turnId: proposal.id, replacement: 'neue Stelle' };
  const applied = await applyApiSelection('api-alice', selectionChat.id, apply);
  assert.equal(applied.body.content, 'Vorher 🍏 neue Stelle danach 🌙');
  assert.equal(applied.revision, 2);
  assert.equal((await applyApiSelection('api-alice', selectionChat.id, apply)).revision, 2);
  await assert.rejects(
    () => applyApiSelection('api-alice', selectionChat.id, { ...apply, replacement: 'changed' }),
    /bereits verwendet/
  );
  await assert.rejects(
    () => applyApiSelection('api-alice', selectionChat.id, { ...apply, commandId: randomUUID() }),
    /inzwischen geändert/
  );
  await reviseResource('api-alice', editable.id, 2, editable.title, {
    ...applied.body,
    content: 'spätere Revision',
  });
  assert.equal(
    (await applyApiSelection('api-alice', selectionChat.id, apply)).revision,
    2,
    'lost-ack replay retains its exact revision receipt'
  );
  await assert.rejects(
    () => applyApiSelection('api-bob', selectionChat.id, apply),
    /nicht gefunden/
  );
  console.log(
    'PASS: exact UTF-16 selection snapshot, reviewed replacement, untouched surrounding text, revision conflict and stable replay after later edits'
  );
  const richModel = {
    type: 'plum-document',
    version: 1,
    blocks: [
      {
        type: 'paragraph',
        align: 'right',
        runs: [
          { text: 'Vorher ', bold: true },
          { text: 'alte Stelle', italic: true },
          { text: ' danach 🍏', href: 'https://example.invalid/original' },
        ],
      },
      {
        type: 'table',
        rows: [[[{ text: 'unverändert', underline: true }], [{ text: 'Preis 10 €', bold: true }]]],
      },
    ],
  };
  const richArtifact = await createResource(
    'api-alice',
    'artifact',
    'Formatierte Auswahl',
    BODY_SCHEMAS.artifact.parse({
      type: 'document',
      format: 'json',
      content: JSON.stringify(richModel),
    })
  );
  const richInput = {
    ...selectionInput,
    commandId: randomUUID(),
    artifactEdit: {
      artifactId: richArtifact.id,
      revision: 1,
      documentPath: { block: 0 },
      start: 7,
      end: 18,
      selectedText: 'alte Stelle',
    },
  };
  const richChat = await createApiChat('api-alice', richInput);
  const richTurn = await startApiTurn('api-alice', richChat.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Kurz und freundlich',
  });
  await settled('api-alice', richChat.id, richTurn.id);
  assert(JSON.stringify(requests.at(-1)!.body).includes('Vorher '));
  const richApplied = await applyApiSelection('api-alice', richChat.id, {
    commandId: randomUUID(),
    turnId: richTurn.id,
    replacement: 'neue Passage',
  });
  const richResult = JSON.parse(String(richApplied.body.content));
  assert.deepEqual(richResult.blocks[1], richModel.blocks[1]);
  assert.deepEqual(richResult.blocks[0].runs, [
    { text: 'Vorher ', bold: true },
    { text: 'neue Passage', italic: true },
    { text: ' danach 🍏', href: 'https://example.invalid/original' },
  ]);
  assert.equal(richResult.blocks[0].align, 'right');
  const tableInput = {
    ...richInput,
    commandId: randomUUID(),
    artifactEdit: {
      artifactId: richArtifact.id,
      revision: 2,
      documentPath: { block: 1, row: 0, column: 1 },
      start: 6,
      end: 8,
      selectedText: '10',
    },
  };
  const tableChat = await createApiChat('api-alice', tableInput);
  const tableTurn = await startApiTurn('api-alice', tableChat.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Preis aktualisieren',
  });
  await settled('api-alice', tableChat.id, tableTurn.id);
  const tableApply = { commandId: randomUUID(), turnId: tableTurn.id, replacement: '20' };
  const tableApplied = await applyApiSelection('api-alice', tableChat.id, tableApply);
  assert.deepEqual(JSON.parse(String(tableApplied.body.content)).blocks[0], richResult.blocks[0]);
  assert.deepEqual(JSON.parse(String(tableApplied.body.content)).blocks[1].rows[0][1], [
    { text: 'Preis 20 €', bold: true },
  ]);
  assert.equal((await applyApiSelection('api-alice', tableChat.id, tableApply)).revision, 3);
  await assert.rejects(
    () =>
      createApiChat('api-alice', {
        ...tableInput,
        commandId: randomUUID(),
        artifactEdit: {
          ...tableInput.artifactEdit,
          revision: 3,
          documentPath: { block: 1, row: 99, column: 1 },
        },
      }),
    /Textauswahl/
  );
  await assert.rejects(
    () => applyApiSelection('api-bob', tableChat.id, tableApply),
    /nicht gefunden/
  );
  console.log(
    'PASS: structured paragraph/table selection preserves original surrounding runs, formatting, links, alignment and other blocks; immutable revision, exact quote, bounds, ownership and durable manual-apply receipt'
  );
  console.log(
    'PASS: preserved original replies, explicit edit branches, no duplicated branch billing, durable result/task materialisation and complete owner-scoped export'
  );
  mode = 'broken';
  const broken = await startApiTurn('api-alice', chat.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Abbruch',
  });
  const partial = await settled('api-alice', chat.id, broken.id);
  assert.equal(partial.status, 'failed');
  assert.equal(partial.response, 'Teilantwort');
  assert.equal(partial.usage, null);
  mode = 'wait';
  const slow = await startApiTurn('api-alice', chat.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Langsam',
  });
  await assert.rejects(
    () =>
      startApiTurn('api-alice', chat.id, {
        commandId: randomUUID(),
        expectedRevision: 1,
        prompt: 'Parallel',
      }),
    /bereits eine Antwort/
  );
  await stopApiTurn('api-alice', chat.id, slow.id);
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await settled('api-alice', chat.id, slow.id)).status, 'cancelled');
  assert(
    (await apiUsage('api-alice')).missingUsage >= 2,
    'failed/cancelled calls are not guessed as free'
  );
  mode = 'anthropic';
  const changed = await updateApiChat('api-alice', chat.id, {
    title: chat.title,
    providerId: 'anthropic',
    model: 'claude-sonnet-4-6',
    profileId: profile.id,
    sourceIds: [],
    expectedRevision: 1,
  });
  const native = await startApiTurn('api-alice', chat.id, {
      commandId: randomUUID(),
      expectedRevision: changed.revision,
      prompt: 'Claude',
      imageAssetIds: [image.id],
    }),
    answer = await settled('api-alice', chat.id, native.id);
  assert.equal(answer.response, 'Äpfel 🍎');
  assert.equal(answer.usage?.cached, 3);
  assert.equal(answer.usage?.cacheWrite, 2);
  assert.equal(answer.usage?.input, 7);
  assert.equal(answer.usage?.output, 4);
  assert(requests.at(-1)?.body.system?.includes('NEW PROFILE'));
  assert(
    JSON.stringify(requests.at(-1)?.body.messages?.at(-1)).includes('"media_type":"image/png"')
  );
  assert(
    (await apiUsage('api-alice')).byModel.some(
      (row) => row.providerId === 'anthropic' && row.model === answer.model
    )
  );
  assert(
    (await apiUsage('api-alice')).byModel.some((row) => row.providerId === 'openai'),
    'changing provider retains the original usage attribution'
  );
  const restarted = await createApiChat('api-alice', {
      ...input,
      commandId: randomUUID(),
      title: 'Restart',
    }),
    now = new Date().toISOString();
  await run(
    "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,status,model,profile_json,created_at,updated_at,expires_at) VALUES (?,?,1,'hash','stale','running','gpt-5.5','{}',?,?,'2000-01-01T00:00:00.000Z')",
    randomUUID(),
    restarted.id,
    now,
    now
  );
  assert.equal((await apiChatTurns('api-alice', restarted.id)).turns[0].status, 'interrupted');
  mode = 'openai';
  const project = await createResource(
    'api-alice',
    'project',
    'Wissen',
    BODY_SCHEMAS.project.parse({ instructions: 'OWN PROJECT' })
  );
  const knowledge = await createResource(
    'api-alice',
    'source',
    'Späte Quelle',
    BODY_SCHEMAS.source.parse({
      projectId: project.id,
      text: 'Einleitung '.repeat(900) + 'Quantencomputer liefern das gezielte Ergebnis.',
    })
  );
  const contextualProfile = await createResource(
    'api-alice',
    'profile',
    'Wissensprofil',
    BODY_SCHEMAS.profile.parse({
      instructions: 'PROJECT STYLE',
      projectId: project.id,
      memory: 'read',
    })
  );
  await createResource(
    'api-alice',
    'memory',
    'Projektgedächtnis',
    BODY_SCHEMAS.memory.parse({
      scope: 'project',
      projectId: project.id,
      text: 'ACTIVE PROJECT MEMORY',
    })
  );
  const contextual = await createApiChat('api-alice', {
    ...input,
    commandId: randomUUID(),
    profileId: contextualProfile.id,
    sourceIds: [],
  });
  const question = await startApiTurn('api-alice', contextual.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Was liefert der Quantencomputer?',
  });
  const answerWithContext = await settled('api-alice', contextual.id, question.id);
  assert.deepEqual(answerWithContext.sourceVersions, [{ id: knowledge.id, revision: 1 }]);
  const transmitted = JSON.stringify(requests.at(-1)?.body.messages?.[0]);
  assert(transmitted.includes('OWN PROJECT'));
  assert(transmitted.includes('gezielte Ergebnis'));
  assert(transmitted.includes('ACTIVE PROJECT MEMORY'));
  // Projects work without an assistant, and explicit null overrides inherited projects.
  const directProject = await createApiChat('api-alice', {
    ...input,
    commandId: randomUUID(),
    profileId: null,
    projectId: project.id,
    sourceIds: [],
  });
  assert.equal(directProject.body.projectId, project.id);
  const directTurn = await startApiTurn('api-alice', directProject.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Quantencomputer?',
  });
  assert.deepEqual((await settled('api-alice', directProject.id, directTurn.id)).sourceVersions, [
    { id: knowledge.id, revision: 1 },
  ]);
  assert(JSON.stringify(requests.at(-1)?.body.messages?.[0]).includes('OWN PROJECT'));
  const detached = await updateApiChat('api-alice', directProject.id, {
    title: directProject.title,
    providerId: input.providerId,
    model: input.model,
    profileId: contextualProfile.id,
    projectId: null,
    sourceIds: [],
    expectedRevision: 1,
  });
  const detachedTurn = await startApiTurn('api-alice', detached.id, {
    commandId: randomUUID(),
    expectedRevision: detached.revision,
    prompt: 'Nur Assistentenanweisungen',
  });
  assert.deepEqual((await settled('api-alice', detached.id, detachedTurn.id)).sourceVersions, []);
  assert(!JSON.stringify(requests.at(-1)?.body.messages?.[0]).includes('OWN PROJECT'));
  const foreignProject = await createResource(
    'api-bob',
    'project',
    'Privat',
    BODY_SCHEMAS.project.parse({ instructions: 'BOB PROJECT' })
  );
  await assert.rejects(
    createApiChat('api-alice', { ...input, commandId: randomUUID(), projectId: foreignProject.id })
  );
  const otherProject = await createResource(
    'api-alice',
    'project',
    'Anderes Thema',
    BODY_SCHEMAS.project.parse({ instructions: 'OTHER PROJECT' })
  );
  const switched = await updateApiChat('api-alice', detached.id, {
    title: detached.title,
    providerId: input.providerId,
    model: input.model,
    profileId: contextualProfile.id,
    projectId: otherProject.id,
    sourceIds: [],
    expectedRevision: detached.revision,
  });
  const switchedTurn = await startApiTurn('api-alice', switched.id, {
    commandId: randomUUID(),
    expectedRevision: switched.revision,
    prompt: 'Welches Projekt?',
  });
  assert.deepEqual((await settled('api-alice', switched.id, switchedTurn.id)).sourceVersions, []);
  assert(JSON.stringify(requests.at(-1)?.body.messages?.[0]).includes('OTHER PROJECT'));
  assert(!JSON.stringify(requests.at(-1)?.body.messages?.[0]).includes('OWN PROJECT'));
  const knowledgeable = await createResource(
    'api-alice',
    'profile',
    'Eigener Assistent',
    BODY_SCHEMAS.profile.parse({
      instructions: 'ASSISTANT KNOWLEDGE',
      sourceIds: [source.id],
      apiProviderId: input.providerId,
    })
  );
  const knowledgeChat = await createApiChat('api-alice', {
    ...input,
    commandId: randomUUID(),
    profileId: knowledgeable.id,
    projectId: null,
    sourceIds: [],
  });
  await reviseResource('api-alice', knowledgeable.id, 1, knowledgeable.title, {
    ...knowledgeable.body,
    sourceIds: [knowledge.id],
  });
  const knowledgeTurn = await startApiTurn('api-alice', knowledgeChat.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Was weisst du?',
  });
  const pinnedAnswer = await settled('api-alice', knowledgeChat.id, knowledgeTurn.id);
  assert.equal(pinnedAnswer.sourceVersions.length, 1);
  assert.equal(
    pinnedAnswer.sourceVersions[0].id,
    source.id,
    'assistant knowledge uses the pinned profile revision'
  );
  assert(!JSON.stringify(requests.at(-1)?.body.messages?.[0]).includes('BOB PROJECT'));
  console.log(
    'PASS: direct project context, explicit detach, project switch/isolation, ownership and pinned assistant knowledge'
  );
  const workspaceProject = await createResource(
    'api-alice',
    'project',
    'Workspace sharing',
    BODY_SCHEMAS.project.parse({ instructions: 'WORKSPACE INSTRUCTIONS', memoryMode: 'default' })
  );
  const expert = await createResource(
    'api-alice',
    'profile',
    'Prompt expert',
    BODY_SCHEMAS.profile.parse({
      instructions: 'PINNED EXPERT PROMPT',
      sharedMemories: 'OLD EXPERT NOTES',
    })
  );
  const workspaceChat = await createApiChat('api-alice', {
    ...input,
    commandId: randomUUID(),
    profileId: expert.id,
    projectId: workspaceProject.id,
  });
  const sibling = await createApiChat('api-alice', {
    ...input,
    commandId: randomUUID(),
    profileId: null,
    projectId: workspaceProject.id,
  });
  const excluded = await createApiChat('api-alice', {
    ...input,
    commandId: randomUUID(),
    profileId: null,
    projectId: otherProject.id,
  });
  const archivedSibling = await createApiChat('api-alice', {
    ...input,
    commandId: randomUUID(),
    profileId: null,
    projectId: workspaceProject.id,
  });
  const temporarySibling = await createApiChat('api-alice', {
    ...input,
    commandId: randomUUID(),
    profileId: null,
    temporary: true,
    projectId: null,
  });
  const foreignSibling = await createResource(
    'api-bob',
    'api-chat',
    'Foreign chat',
    BODY_SCHEMAS['api-chat'].parse({
      providerId: input.providerId,
      model: input.model,
      projectId: null,
    })
  );
  for (const [resource, marker] of [
    [sibling, 'SHARED SIBLING FACT'],
    [excluded, 'OTHER PROJECT FACT'],
    [archivedSibling, 'ARCHIVED SIBLING FACT'],
    [temporarySibling, 'TEMPORARY SIBLING FACT'],
    [foreignSibling, 'OTHER OWNER FACT'],
  ] as const) {
    await run(
      "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,created_at,updated_at,expires_at) VALUES (?,?,1,'workspace-fixture',?,?,'completed','gpt-5.5','{}',?,?,?)",
      randomUUID(),
      resource.id,
      marker,
      marker,
      stamp,
      stamp,
      '2999-01-01T00:00:00.000Z'
    );
  }
  // Malformed legacy owner/temporary bindings must still never enter shared excerpts.
  await run(
    "UPDATE assistant_resources SET body_json=(body_json::jsonb || jsonb_build_object('projectId', ?::text))::text WHERE id=?",
    workspaceProject.id,
    foreignSibling.id
  );
  await run(
    "UPDATE assistant_resources SET body_json=(body_json::jsonb || jsonb_build_object('projectId', ?::text))::text WHERE id=?",
    workspaceProject.id,
    temporarySibling.id
  );
  await archiveResource('api-alice', archivedSibling.id, 1);
  await reviseResource(
    'api-alice',
    expert.id,
    1,
    expert.title,
    BODY_SCHEMAS.profile.parse({
      ...expert.body,
      instructions: 'NEW UNPINNED PROMPT',
      sharedMemories: 'LIVE EXPERT NOTES',
    })
  );
  const sharedContext = (await systemContext('api-alice', workspaceChat, 'SIBLING')).system;
  assert(sharedContext.includes('PINNED EXPERT PROMPT'));
  assert(!sharedContext.includes('NEW UNPINNED PROMPT'));
  assert(sharedContext.includes('LIVE EXPERT NOTES'), 'legacy notes stay live until re-saved');
  assert(!sharedContext.includes('OLD EXPERT NOTES'));
  assert(sharedContext.includes('SHARED SIBLING FACT'));
  for (const excludedMarker of [
    'OTHER PROJECT FACT',
    'ARCHIVED SIBLING FACT',
    'TEMPORARY SIBLING FACT',
    'OTHER OWNER FACT',
  ])
    assert(!sharedContext.includes(excludedMarker), excludedMarker);
  const { memorySource, relevantMemories } = await import('../src/services/assistant/memory.js');
  const { memoryScope } = await import('../src/services/assistant/memorySemantic.js');
  const memory = (title: string, body: Record<string, unknown>) =>
    createResource('api-alice', 'memory', title, BODY_SCHEMAS.memory.parse(body));
  await memory('Personal', { text: 'PERSONAL MEMORY FACT', scope: 'personal' });
  await memory('Workspace', {
    text: 'WORKSPACE MEMORY FACT',
    scope: 'project',
    projectId: workspaceProject.id,
  });
  await memory('Other', {
    text: 'OTHER DEFAULT PROJECT MEMORY',
    scope: 'project',
    projectId: otherProject.id,
  });
  const texts = async (projectId: string | null) =>
    (await relevantMemories('api-alice', projectId, '')).map((m) => m.text).join('|');
  // Default memory (ChatGPT): saved memories flow across default projects and plain chats.
  for (const scoped of [workspaceProject.id, null]) {
    const seen = await texts(scoped);
    for (const fact of [
      'PERSONAL MEMORY FACT',
      'WORKSPACE MEMORY FACT',
      'OTHER DEFAULT PROJECT MEMORY',
    ])
      assert(seen.includes(fact), fact + ' in default scope ' + scoped);
  }
  await reviseResource(
    'api-alice',
    workspaceProject.id,
    1,
    workspaceProject.title,
    BODY_SCHEMAS.project.parse({ ...workspaceProject.body, memoryMode: 'project-only' })
  );
  assert.deepEqual(await memoryScope('api-alice', workspaceProject.id), {
    personal: false,
    projects: [workspaceProject.id],
    prefer: workspaceProject.id,
  });
  assert.equal(
    await texts(workspaceProject.id),
    'WORKSPACE MEMORY FACT',
    'project-only is sealed in'
  );
  const outside = await texts(null);
  assert(!outside.includes('WORKSPACE MEMORY FACT'), 'project-only memories never leak out');
  assert(
    outside.includes('PERSONAL MEMORY FACT') && outside.includes('OTHER DEFAULT PROJECT MEMORY')
  );
  const sealedContext = (await systemContext('api-alice', workspaceChat, 'SIBLING')).system;
  assert(sealedContext.includes('SHARED SIBLING FACT'), 'project chats still see each other');
  assert(sealedContext.includes('WORKSPACE INSTRUCTIONS'));
  assert(sealedContext.includes('Project-only memory'));
  assert(!sealedContext.includes('OTHER PROJECT FACT'));
  const siblingTurn = await get('SELECT id FROM assistant_api_turns WHERE chat_id=?', sibling.id);
  assert.equal(
    (await memorySource('api-alice', 'api', sibling.id, siblingTurn.id))?.projectId,
    workspaceProject.id,
    'project-only chats keep learning into their own project'
  );
  const legacy = await createResource(
    'api-alice',
    'project',
    'Legacy separate',
    BODY_SCHEMAS.project.parse({ contextMode: 'separate' })
  );
  assert.equal(
    (await memoryScope('api-alice', legacy.id)).personal,
    false,
    'separate → project-only'
  );
  console.log(
    'PASS: ChatGPT project memory (default vs project-only) for saved memories and history; project chats reference each other in both modes; owner, archive, temporary and cross-project exclusion; legacy expert notes and separate mode'
  );
  // ChatGPT-style regenerate/edit in place with a version switcher, and real deletion.
  const { activateApiTurnVersion, deleteApiChat, updateApiChatMeta } =
    await import('../src/services/assistant/apiChats.js');
  const versioned = await createApiChat('api-alice', {
    ...input,
    commandId: randomUUID(),
    profileId: null,
    projectId: null,
    sourceIds: [],
  });
  const ask = async (prompt: string, regenerate?: string) => {
    const started = await startApiTurn('api-alice', versioned.id, {
      commandId: randomUUID(),
      expectedRevision: versioned.revision,
      prompt,
      ...(regenerate ? { regenerate } : {}),
    });
    await settled('api-alice', versioned.id, started.id);
    return started.id;
  };
  const visible = async () => (await apiChatTurns('api-alice', versioned.id)).turns;
  const first = await ask('ERSTE FRAGE');
  const second = await ask('ZWEITE FRAGE');
  const again = await ask('ZWEITE FRAGE', second);
  assert.deepEqual(
    (await visible()).map((t) => t.id),
    [first, again],
    'regenerate stays in the same chat and replaces the answer'
  );
  assert.deepEqual((await visible())[1]!.versions, [second, again]);
  const resent = JSON.stringify(requests.at(-1)?.body.messages);
  assert.equal(resent.split('ZWEITE FRAGE').length - 1, 1, 'hidden version is not resent');
  assert(resent.includes('ERSTE FRAGE'));
  const edited = await ask('ERSTE FRAGE GEÄNDERT', first);
  assert.deepEqual(
    (await visible()).map((t) => t.id),
    [edited],
    'editing an earlier message hides the thread that followed it'
  );
  assert(!JSON.stringify(requests.at(-1)?.body.messages).includes('ZWEITE FRAGE'));
  await activateApiTurnVersion('api-alice', versioned.id, first);
  assert.deepEqual(
    (await visible()).map((t) => [t.id, t.versions?.length ?? 1]),
    [
      [first, 2],
      [again, 2],
    ],
    'switching back restores the whole earlier thread'
  );
  await activateApiTurnVersion('api-alice', versioned.id, second);
  assert.deepEqual(
    (await visible()).map((t) => t.id),
    [first, second]
  );
  await activateApiTurnVersion('api-alice', versioned.id, edited);
  assert.deepEqual(
    (await visible()).map((t) => t.id),
    [edited]
  );
  await activateApiTurnVersion('api-alice', versioned.id, first);
  assert.deepEqual(
    (await visible()).map((t) => t.id),
    [first, second],
    'each version keeps the follow-up it last showed'
  );
  await assert.rejects(
    startApiTurn('api-alice', versioned.id, {
      commandId: randomUUID(),
      expectedRevision: versioned.revision,
      prompt: 'X',
      regenerate: again,
    }),
    /nicht mehr sichtbar/
  );
  const renamed = await updateApiChatMeta('api-alice', versioned.id, {
    expectedRevision: versioned.revision,
    title: 'Umbenannt',
    projectId: workspaceProject.id,
  });
  assert.equal(renamed.title, 'Umbenannt');
  assert.equal(renamed.body.projectId, workspaceProject.id);
  assert.equal(renamed.body.model, versioned.body.model);
  await assert.rejects(
    updateApiChatMeta('api-alice', versioned.id, {
      expectedRevision: renamed.revision,
      projectId: foreignProject.id,
    })
  );
  await assert.rejects(deleteApiChat('api-bob', versioned.id), /nicht gefunden/);
  await deleteApiChat('api-alice', versioned.id);
  await assert.rejects(apiChatTurns('api-alice', versioned.id));
  assert.equal(
    (await get('SELECT COUNT(*) AS n FROM assistant_api_turns WHERE chat_id=?', versioned.id)).n,
    0,
    'deletion removes all versions'
  );
  console.log(
    'PASS: regenerate and edit in place with version switching that restores whole threads; hidden versions excluded from context; owner-checked permanent deletion'
  );
  await archiveResource('api-alice', project.id, 1);
  const archived = await startApiTurn('api-alice', contextual.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Nach Archivierung',
  });
  await settled('api-alice', contextual.id, archived.id);
  assert(!JSON.stringify(requests.at(-1)?.body.messages?.[0]).includes('ACTIVE PROJECT MEMORY'));
  assert.equal(
    (await apiChatTurns('api-alice', contextual.id)).turns.at(-1)?.sourceVersions.length,
    0
  );
  for (let seq = 2; seq <= 60; seq++)
    await run(
      "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,created_at,updated_at,expires_at) VALUES (?,?,?,'fixture','p','r','completed','gpt-5.5','{}',?,?,?)",
      randomUUID(),
      restarted.id,
      seq,
      now,
      now,
      now
    );
  const head = (await apiChatTurns('api-alice', restarted.id)).turns;
  assert.equal(head[0].seq, 11);
  await run(
    "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,created_at,updated_at,expires_at) VALUES (?,?,61,'fixture','new','r','completed','gpt-5.5','{}',?,?,?)",
    randomUUID(),
    restarted.id,
    now,
    now,
    now
  );
  assert.deepEqual(
    (await apiChatTurns('api-alice', restarted.id, 0, head[0].seq)).turns.map((item) => item.seq),
    Array.from({ length: 10 }, (_, n) => n + 1)
  );
  console.log(
    'PASS: actual profile metadata, private project retrieval from later document passages, archived-project memory removal and gap-free history during concurrent append'
  );
  const researchInput = {
    ...input,
    commandId: randomUUID(),
    workflow: 'research' as const,
    profileId: undefined,
  };
  await assert.rejects(
    () => createApiChat('api-alice', { ...researchInput, sourceIds: [] }),
    /benötigt eigene Quellen/
  );
  const research = await createApiChat('api-alice', researchInput);
  const report = {
    title: 'Quellenvergleich',
    report: 'Belegter Bericht [1].\n\nGrenze: nur bereitgestellte Quellen.',
    claims: [
      {
        claim: 'Erste Quellenfassung',
        sourceId: source.id,
        sourceRevision: 1,
        quote: 'SOURCE VERSION ONE',
        note: 'Vollständigkeit persönlich prüfen',
      },
    ],
  };
  researchReply = JSON.stringify(report);
  const researchTurn = await startApiTurn('api-alice', research.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Vergleiche die Fakten der Quelle',
  });
  await settled('api-alice', research.id, researchTurn.id);
  assert(JSON.stringify(requests.at(-1)!.body).includes('Source-bound research'));
  await reviseResource('api-alice', source.id, 1, source.title, {
    ...source.body,
    text: 'SOURCE VERSION TWO',
  });
  const receipt = { commandId: randomUUID(), turnId: researchTurn.id, kind: 'research' as const };
  const researchArtifact = await materializeApiAnswer('api-alice', research.id, receipt);
  assert.equal(researchArtifact.body.type, 'research');
  assert.equal(researchArtifact.body.content, report.report);
  assert.equal((researchArtifact.body.evidence as Array<{ reviewed: boolean }>)[0].reviewed, false);
  assert.equal(
    (await materializeApiAnswer('api-alice', research.id, receipt)).id,
    researchArtifact.id
  );
  for (const [change, expected] of [
    [{ quote: 'INVENTED QUOTE', sourceRevision: 2 }, /Belegauszug/],
    [{ sourceRevision: 1 }, /gebundene Quellrevision/],
    [{ sourceId: knowledge.id, sourceRevision: 1 }, /gebundene Quellrevision/],
    [{ reviewed: true, sourceRevision: 2 }, /menschliche Prüfungen/],
  ] as Array<[Record<string, unknown>, RegExp]>) {
    researchReply = JSON.stringify({ ...report, claims: [{ ...report.claims[0], ...change }] });
    const invalid = await startApiTurn('api-alice', research.id, {
      commandId: randomUUID(),
      expectedRevision: 1,
      prompt: 'Nächste Recherche',
    });
    await settled('api-alice', research.id, invalid.id);
    await assert.rejects(
      () =>
        materializeApiAnswer('api-alice', research.id, {
          commandId: randomUUID(),
          turnId: invalid.id,
          kind: 'research',
        }),
      expected
    );
  }
  researchReply = null;
  const temporary = await createApiChat('api-alice', {
    ...input,
    commandId: randomUUID(),
    temporary: true,
  });
  const sharedTempImage = await uploadApiImage('api-alice', temporary.id, {
    originalname: 'shared.png',
    buffer: pixel,
  });
  const orphanImage = await uploadApiImage('api-alice', temporary.id, {
    originalname: 'temporary.png',
    buffer: Buffer.concat([pixel, Buffer.from([0])]),
  });
  const temporaryTurn = await startApiTurn('api-alice', temporary.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Privates temporäres Gespräch',
    imageAssetIds: [sharedTempImage.id, orphanImage.id],
  });
  await settled('api-alice', temporary.id, temporaryTurn.id);
  assert(!JSON.stringify(requests.at(-1)!.body).includes('ALICE MEMORY'));
  assert(JSON.stringify(requests.at(-1)!.body).includes('temporary conversation'));
  await assert.rejects(
    () =>
      materializeApiAnswer('api-alice', temporary.id, {
        commandId: randomUUID(),
        turnId: temporaryTurn.id,
        kind: 'memory',
      }),
    /keine dauerhaften/
  );
  await assert.rejects(
    () => branchApiChat('api-alice', temporary.id, temporaryTurn.id, true, randomUUID()),
    /nicht dauerhaft/
  );
  assert.equal(
    await purgeTemporaryApiChat('api-alice', temporary.id),
    false,
    'unexpired temporary chat is retained'
  );
  await run(
    "UPDATE assistant_resources SET body_json=jsonb_set(body_json::jsonb,'{expiresAt}','\"2000-01-01T00:00:00.000Z\"'::jsonb)::text WHERE id=?",
    temporary.id
  );
  await assert.rejects(() => apiChatTurns('api-alice', temporary.id), /abgelaufen/);
  assert.equal(await purgeTemporaryApiChat('api-bob', temporary.id), false);
  assert.equal(await purgeTemporaryApiChat('api-alice', temporary.id), true);
  const afterPurge = await assistantExportSnapshot('api-alice');
  assert(!afterPurge.apiChatTurns.some((row) => row.chat_id === temporary.id));
  assert(!afterPurge.resources.some((row) => row.id === temporary.id));
  const retained = afterPurge.apiChatUsage.find((row) => row.id === temporaryTurn.id)!;
  assert(retained && retained.chat_id === null && retained.usage_json);
  assert(!JSON.stringify(retained).includes('Privates temporäres Gespräch'));
  assert(
    await get('SELECT id FROM assistant_assets WHERE id=?', image.id),
    'an image retained by other owned conversations survives temporary cleanup'
  );
  assert.equal(
    await get('SELECT id FROM assistant_assets WHERE id=?', orphanImage.id),
    undefined,
    'unreferenced temporary image bytes are deleted'
  );
  assert.equal(
    afterPurge.apiChatFiles.some((row) => row.chat_id === temporary.id),
    false
  );
  mode = 'openai';
  const uiChat = await createApiChat('api-alice', {
    ...input,
    commandId: randomUUID(),
    title: 'UI revisions',
  });
  const uiSpec = {
    version: 1,
    state: { amount: 10 },
    root: {
      type: 'stack',
      id: 'panel',
      children: [
        { type: 'input', id: 'amountInput', bind: 'amount', label: 'Betrag' },
        { type: 'text', id: 'summary', text: 'Alt' },
      ],
    },
  };
  researchReply = 'Rechner.\n```plum-ui\n' + JSON.stringify(uiSpec) + '\n```';
  const uiFirst = await startApiTurn('api-alice', uiChat.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Rechner erstellen',
  });
  const uiOriginal = await settled('api-alice', uiChat.id, uiFirst.id);
  assert.equal(uiOriginal.ui?.viewId, uiFirst.id);
  // Force the base off the next history page and outside model-history limits.
  for (let seq = 2; seq <= 55; seq++)
    await run(
      "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,created_at,updated_at,expires_at) VALUES (?,?,?,'fixture','p','Nur Text','completed','gpt-5.5','{}',?,?,?)",
      randomUUID(),
      uiChat.id,
      seq,
      stamp,
      stamp,
      stamp
    );
  researchReply =
    'Ergänzt.\n```plum-ui\n' +
    JSON.stringify({
      version: 1,
      patch: [{ op: 'replace', target: 'summary', node: { type: 'text', text: 'Neu' } }],
    }) +
    '\n```';
  const uiNextInput = {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Nur den Text ändern',
  };
  await startApiTurn('api-alice', uiChat.id, uiNextInput);
  const uiNext = await settled('api-alice', uiChat.id, uiNextInput.commandId);
  assert.equal(uiNext.ui?.viewId, uiFirst.id);
  assert.match(JSON.stringify(uiNext.ui), /Neu/);
  assert.match(JSON.stringify(uiNext.ui), /amountInput/);
  assert(JSON.stringify(requests.at(-1)?.body).includes('Latest interactive view'));
  const reread = await apiChatTurns('api-alice', uiChat.id);
  assert(!reread.turns.some((row) => row.id === uiFirst.id));
  assert.deepEqual(reread.turns.at(-1)?.ui, uiNext.ui);
  assert.deepEqual((await startApiTurn('api-alice', uiChat.id, uiNextInput)).ui, uiNext.ui);
  const emptyUiChat = await createApiChat('api-alice', {
    ...input,
    commandId: randomUUID(),
    title: 'Separate UI chat',
  });
  const noBase = await startApiTurn('api-alice', emptyUiChat.id, {
    commandId: randomUUID(),
    expectedRevision: 1,
    prompt: 'Ändern',
  });
  const isolatedUi = await settled('api-alice', emptyUiChat.id, noBase.id);
  assert.equal(isolatedUi.ui, null);
  assert.match(isolatedUi.uiError ?? '', /vorherige Ansicht/);
  researchReply = null;
  console.log(
    'PASS: UI edits pin an owned base across pagination/replay, expose current schema to the model and never cross chat boundaries'
  );
  console.log(
    'PASS: private image original bytes, deduplication, owned chat binding, OpenAI/Anthropic image payloads, lossless media branches and temporary orphan cleanup'
  );
  console.log(
    'PASS: content-free API ledger, no duplicate branch accounting, original provider attribution, private 24h chat expiry and deletion of transcript/context/receipts'
  );
  console.log(
    'PASS: source-bound research report, exact immutable citations, durable result receipt and rejection of invented quotes, unsupplied revisions and forged human review'
  );
  console.log(
    'PASS: unknown/truncated streams retain partial replies, explicit stop cannot resurrect, Anthropic native streaming/usage and honest expired-run recovery'
  );
} finally {
  await rm(imageWorkspace, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
  release();
  await dropTestSchema();
  await closePool();
}
