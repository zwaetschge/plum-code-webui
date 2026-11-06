import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'management-fixture-encryption-key-00000';
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { run, get } = await import('../src/db/pg.js');
const { createResource, BODY_SCHEMAS, findResource } =
  await import('../src/services/assistant/resources.js');
const { managedChats, bulkManageChats } =
  await import('../src/services/assistant/chatManagement.js');
const { selectedChatReferences } = await import('../src/services/assistant/chatReferences.js');
const { memoryScope } = await import('../src/services/assistant/memorySemantic.js');
const { updatePersonalization } = await import('../src/services/assistant/personalization.js');
const { systemContext } = await import('../src/services/assistant/apiChats.js');
const { forgetMemory } = await import('../src/services/assistant/memory.js');
if (!(await testing.databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await testing.createTestSchema();
try {
  const user = 'management-owner',
    other = 'management-other';
  for (const id of [user, other])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      id,
      id + '@example.invalid',
      id
    );
  const project = await createResource(user, 'project', 'Projekt', BODY_SCHEMAS.project.parse({}));
  const sealed = await createResource(
    user,
    'project',
    'Isoliert',
    BODY_SCHEMAS.project.parse({ memoryMode: 'project-only' })
  );
  const foreignProject = await createResource(
    other,
    'project',
    'Fremd',
    BODY_SCHEMAS.project.parse({})
  );
  const makeChat = async (owner = user, body = {}) =>
    createResource(
      owner,
      'api-chat',
      'Chat ' + randomUUID(),
      BODY_SCHEMAS['api-chat'].parse({ providerId: 'fixture', model: 'fixture', ...body })
    );
  const first = await makeChat(),
    second = await makeChat(),
    foreign = await makeChat(other);
  const items = [first, second].map((chat) => ({ id: chat.id, expectedRevision: chat.revision }));
  await assert.rejects(
    bulkManageChats(user, {
      commandId: randomUUID(),
      action: 'archive',
      chats: [items[0]!, { id: foreign.id, expectedRevision: foreign.revision }],
    }),
    /nicht gefunden/
  );
  assert(await findResource(user, first.id), 'mixed-owner request has no partial changes');
  await assert.rejects(
    bulkManageChats(user, {
      commandId: randomUUID(),
      action: 'move',
      chats: items,
      projectId: foreignProject.id,
    }),
    /nicht gefunden/
  );
  await bulkManageChats(user, {
    commandId: randomUUID(),
    action: 'move',
    chats: items,
    projectId: project.id,
  });
  assert.equal((await findResource(user, first.id)).body.projectId, project.id);
  await assert.rejects(
    bulkManageChats(user, { commandId: randomUUID(), action: 'archive', chats: items }),
    /inzwischen geändert/
  );
  const moved = await Promise.all([first, second].map((chat) => findResource(user, chat.id)));
  const archive = {
    commandId: randomUUID(),
    action: 'archive' as const,
    chats: moved.map((chat) => ({ id: chat.id, expectedRevision: chat.revision })),
  };
  const result = await bulkManageChats(user, archive);
  assert.deepEqual(
    await bulkManageChats(user, archive),
    result,
    'replay is durable and idempotent'
  );
  assert.equal((await managedChats(user)).entries.length, 0);
  const archived = await managedChats(user, true);
  assert.equal(archived.entries.length, 2);
  await bulkManageChats(user, {
    commandId: randomUUID(),
    action: 'restore',
    chats: archived.entries.map((chat) => ({ id: chat.id, expectedRevision: chat.revision })),
  });
  assert.equal((await managedChats(user)).entries.length, 2);
  assert.equal((await managedChats(user, true)).entries.length, 0);
  assert.equal((await findResource(user, second.id)).body.projectId, project.id);
  const busy = await makeChat();
  const now = new Date().toISOString();
  await run(
    "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,status,model,profile_json,created_at,updated_at,expires_at) VALUES(?,?,1,'fixture','waiting','queued','fixture','{}',?,?,?)",
    randomUUID(),
    busy.id,
    now,
    now,
    now
  );
  assert.equal((await managedChats(user)).busyChats[busy.id], 'queued');
  const current = await findResource(user, first.id);
  await assert.rejects(
    bulkManageChats(user, {
      commandId: randomUUID(),
      action: 'archive',
      chats: [
        { id: current.id, expectedRevision: current.revision },
        { id: busy.id, expectedRevision: busy.revision },
      ],
    }),
    /laufende oder wartende/
  );
  assert(await findResource(user, first.id), 'busy batch remains atomic');
  assert((await managedChats(other)).entries.every((chat) => chat.id === foreign.id));
  const reference = await makeChat(user, { projectId: project.id });
  const privateReference = await makeChat(user, { projectId: sealed.id });
  const temporary = await makeChat(user, {
    temporary: true,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const referenceTurn = randomUUID();
  for (const chat of [reference, privateReference, foreign, temporary])
    await run(
      "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,created_at,updated_at,expires_at) VALUES(?,?,1,'fixture','REFERENCE QUOTE','REFERENCE ANSWER','completed','fixture','{}',?,?,?)",
      chat.id === reference.id ? referenceTurn : randomUUID(),
      chat.id,
      now,
      now,
      now
    );
  const reader = await makeChat(user, {
    projectId: project.id,
    chatOptions: {
      referenceChatIds: [reference.id, privateReference.id, foreign.id, temporary.id],
    },
  });
  const refs = await selectedChatReferences(
    user,
    reader.id,
    [reference.id, privateReference.id, foreign.id, temporary.id],
    await memoryScope(user, project.id)
  );
  assert.deepEqual(
    refs.map((ref) => ref.chatId),
    [reference.id],
    'explicit references retain owner/project/temporary boundaries'
  );
  assert.equal(refs[0]?.turnId, referenceTurn);
  await updatePersonalization(user, {
    expectedRevision: 0,
    preferences: { memoryEnabled: true, memoryLearning: false, chatHistory: true },
  });
  const context = await systemContext(user, reader);
  assert(
    context.memoryContext.references.some(
      (ref) => ref.kind === 'chat-reference' && ref.id === reference.id
    )
  );
  const noRead = { ...reader, body: { ...reader.body, memoryRead: false } };
  assert(
    !(await systemContext(user, noRead)).memoryContext.references.some(
      (ref) => ref.kind === 'chat-reference'
    )
  );
  const fact = await createResource(
    user,
    'memory',
    'Forget reference',
    BODY_SCHEMAS.memory.parse({
      text: 'REFERENCE QUOTE',
      origins: [{ type: 'api', id: reference.id, turnId: referenceTurn, quote: 'REFERENCE QUOTE' }],
    })
  );
  await forgetMemory(user, fact.id, fact.revision);
  assert.equal(
    (
      await selectedChatReferences(
        user,
        reader.id,
        [reference.id],
        await memoryScope(user, project.id)
      )
    ).length,
    0
  );
  assert(
    await get('SELECT id FROM assistant_api_turns WHERE id=?', referenceTurn),
    'original remains, forgotten source is excluded'
  );
  console.log(
    'PASS: owner-scoped atomic bulk move/archive/restore, durable replay, stale/busy guards; explicit references preserve scopes, read ceiling, exact turn IDs and forgotten-source exclusion; no model calls'
  );
} finally {
  await testing.dropTestSchema();
}
