import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'chat-memory-fixture-encryption-key-00000000';
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { run, get } = await import('../src/db/pg.js');
const { createResource, BODY_SCHEMAS } = await import('../src/services/assistant/resources.js');
const { updatePersonalization } = await import('../src/services/assistant/personalization.js');
const { systemContext, updateApiChat, createApiChat, API_CHAT_INPUT } =
  await import('../src/services/assistant/apiChats.js');
const { contextReceipts } = await import('../src/services/assistant/chatContextReceipts.js');
const { enqueueMemory, memorySource, processMemoryJob, forgetMemory } =
  await import('../src/services/assistant/memory.js');
const { safeEncrypt } = await import('../src/utils/encryption.js');
const { writeModelProvidersForUser } = await import('../src/utils/modelProviderKeys.js');
if (!(await testing.databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await testing.createTestSchema();
try {
  const user = 'chat-memory-controls';
  await run(
    "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
    user,
    user + '@example.invalid',
    user
  );
  const stamp = new Date().toISOString();
  await writeModelProvidersForUser(user, [
    {
      id: 'fixture',
      name: 'Fixture',
      enabled: true,
      apiKey: safeEncrypt('fake-key')!,
      baseUrl: 'https://fixture.invalid/v1',
      models: ['fixture'],
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]);
  let pref = await updatePersonalization(user, {
    expectedRevision: 0,
    preferences: {
      memoryEnabled: true,
      memoryLearning: true,
      chatHistory: true,
      chatInstructions: 'ACCOUNT CHAT RULE',
      nickname: 'Style fixture',
    },
  });
  const project = await createResource(
    user,
    'project',
    'Projekt',
    BODY_SCHEMAS.project.parse({ instructions: 'PROJECT INSTRUCTIONS', memoryMode: 'project-only' })
  );
  const profile = await createResource(
    user,
    'profile',
    'Profil',
    BODY_SCHEMAS.profile.parse({
      instructions: 'PROFILE INSTRUCTIONS',
      memory: 'off',
      sharedMemories: 'LEGACY SAVED FACT',
    })
  );
  await createResource(
    user,
    'memory',
    'Projektwissen',
    BODY_SCHEMAS.memory.parse({
      text: 'PROJECT SAVED FACT',
      scope: 'project',
      projectId: project.id,
    })
  );
  const sibling = await createResource(
    user,
    'api-chat',
    'Nachbar',
    BODY_SCHEMAS['api-chat'].parse({
      providerId: 'fixture',
      model: 'fixture',
      projectId: project.id,
    })
  );
  async function insertTurn(chatId: string, memoryLearn = true) {
    const id = randomUUID();
    const now = new Date(Date.now() + 1000).toISOString();
    await run(
      "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,created_at,updated_at,expires_at) VALUES(?,?,?,'fixture','SIBLING HISTORY FACT','Antwort','completed','fixture',?,?,?,?)",
      id,
      chatId,
      Number(
        (
          await get(
            'SELECT COALESCE(MAX(seq),0)+1 AS seq FROM assistant_api_turns WHERE chat_id=?',
            chatId
          )
        ).seq
      ),
      JSON.stringify({ memoryLearn }),
      now,
      now,
      new Date(Date.now() + 86400000).toISOString()
    );
    return id;
  }
  await insertTurn(sibling.id);
  const isolatedProject = await createResource(
    user,
    'project',
    'Eigene Anweisungen',
    BODY_SCHEMAS.project.parse({
      instructions: 'PROJECT OWN RULE',
      includeGlobalChatInstructions: false,
    })
  );
  const isolatedChat = await createResource(
    user,
    'api-chat',
    'Isoliert',
    BODY_SCHEMAS['api-chat'].parse({
      providerId: 'fixture',
      model: 'fixture',
      projectId: isolatedProject.id,
    })
  );
  const isolatedContext = await systemContext(user, isolatedChat);
  assert(!isolatedContext.system.includes('ACCOUNT CHAT RULE'));
  assert(isolatedContext.system.includes('PROJECT OWN RULE'));
  assert(
    isolatedContext.system.includes('Style fixture'),
    'instruction opt-out keeps independent personalisation'
  );
  const isolatedProfile = await createResource(
    user,
    'profile',
    'Eigener Assistent',
    BODY_SCHEMAS.profile.parse({
      instructions: 'PROFILE OWN RULE',
      includeGlobalChatInstructions: false,
    })
  );
  const profileChat = await createResource(
    user,
    'api-chat',
    'Assistent isoliert',
    BODY_SCHEMAS['api-chat'].parse({
      providerId: 'fixture',
      model: 'fixture',
      profileId: isolatedProfile.id,
      profileRevision: isolatedProfile.revision,
    })
  );
  const profileContext = await systemContext(user, profileChat);
  assert(!profileContext.system.includes('ACCOUNT CHAT RULE'));
  assert(profileContext.system.includes('PROFILE OWN RULE'));
  assert(
    (await systemContext(user, sibling)).system.includes('ACCOUNT CHAT RULE'),
    'inheritance remains default'
  );
  console.log(
    'PASS: project/profile opt-out removes global Chat instructions only; default inheritance and personalisation remain'
  );
  const bundle = await createResource(
    user,
    'profile',
    'Fähigkeitsbündel',
    BODY_SCHEMAS.profile.parse({
      chatOptions: { webSearch: true, contextTurns: 50, maxOutputTokens: 1024, temperature: 0.3 },
    })
  );
  const bundleInput = API_CHAT_INPUT.parse({
    commandId: randomUUID(),
    title: 'Geerbt',
    providerId: 'fixture',
    model: 'fixture',
    profileId: bundle.id,
    chatOptions: {},
  });
  const inheritedChat = await createApiChat(user, bundleInput);
  assert.equal((inheritedChat.body.chatOptions as Record<string, unknown>).contextTurns, 50);
  assert.equal((inheritedChat.body.chatOptions as Record<string, unknown>).webSearch, true);
  const overriddenChat = await createApiChat(user, {
    ...bundleInput,
    commandId: randomUUID(),
    chatOptions: { maxOutputTokens: 2048 },
  });
  assert.equal((overriddenChat.body.chatOptions as Record<string, unknown>).maxOutputTokens, 2048);
  assert.equal(
    (overriddenChat.body.chatOptions as Record<string, unknown>).contextTurns,
    50,
    'per-chat overrides preserve other bundle defaults'
  );
  console.log(
    'PASS: profile capability defaults survive an empty client options object; explicit per-chat parameter override preserves inherited values'
  );
  for (const memoryRead of [false, true])
    for (const memoryLearn of [false, true]) {
      const chat = await createResource(
        user,
        'api-chat',
        'Kontrolle',
        BODY_SCHEMAS['api-chat'].parse({
          providerId: 'fixture',
          model: 'fixture',
          projectId: project.id,
          profileId: profile.id,
          profileRevision: profile.revision,
          memoryRead,
          memoryLearn,
        })
      );
      const context = await systemContext(user, chat, 'PROJECT SIBLING');
      for (const marker of ['PROJECT SAVED FACT', 'SIBLING HISTORY FACT', 'LEGACY SAVED FACT'])
        assert.equal(context.system.includes(marker), memoryRead, marker);
      assert(context.system.includes('PROJECT INSTRUCTIONS'));
      assert(context.system.includes('PROFILE INSTRUCTIONS'));
      assert.equal(context.memoryRead, memoryRead);
      const turnId = await insertTurn(chat.id, memoryLearn);
      await enqueueMemory(user, 'api', chat.id, turnId);
      assert.equal(
        !!(await get(
          'SELECT id FROM assistant_memory_jobs WHERE user_id=? AND source_id=?',
          user,
          chat.id
        )),
        memoryLearn,
        'learning independent from read flag'
      );
    }
  console.log(
    'PASS: all four read/learn combinations; project history, memories and legacy notes obey read; instructions remain; jobs obey learn'
  );
  const budgetChat = { ...sibling, body: { ...sibling.body, chatOptions: { contextTurns: 7 } } };
  assert(
    (await systemContext(user, budgetChat)).system.includes('latest 7 turns and 64000 characters')
  );
  const enabled = await createResource(
    user,
    'api-chat',
    'Global',
    BODY_SCHEMAS['api-chat'].parse({
      providerId: 'fixture',
      model: 'fixture',
      projectId: project.id,
      profileId: profile.id,
      profileRevision: profile.revision,
      memoryRead: true,
      memoryLearn: true,
    })
  );
  pref = await updatePersonalization(user, {
    expectedRevision: pref.revision,
    preferences: { chatHistory: false },
  });
  let context = (await systemContext(user, enabled, 'SIBLING PROJECT')).system;
  assert(!context.includes('SIBLING HISTORY FACT'));
  assert(context.includes('PROJECT SAVED FACT'));
  pref = await updatePersonalization(user, {
    expectedRevision: pref.revision,
    preferences: { memoryEnabled: false, chatHistory: true },
  });
  context = (await systemContext(user, enabled, 'SIBLING PROJECT')).system;
  for (const marker of ['SIBLING HISTORY FACT', 'PROJECT SAVED FACT', 'LEGACY SAVED FACT'])
    assert(!context.includes(marker));
  const globalTurn = await insertTurn(enabled.id);
  await enqueueMemory(user, 'api', enabled.id, globalTurn);
  assert(!(await get('SELECT id FROM assistant_memory_jobs WHERE source_id=?', enabled.id)));
  console.log(
    'PASS: global off cannot be overridden; history off blocks project excerpts while facts remain permitted'
  );
  await updatePersonalization(user, {
    expectedRevision: pref.revision,
    preferences: { memoryEnabled: true },
  });
  const queuedChat = await createResource(
    user,
    'api-chat',
    'Wartend',
    BODY_SCHEMAS['api-chat'].parse({ providerId: 'fixture', model: 'fixture', memoryLearn: true })
  );
  const queuedTurn = await insertTurn(queuedChat.id);
  await enqueueMemory(user, 'api', queuedChat.id, queuedTurn);
  const job = await get('SELECT id FROM assistant_memory_jobs WHERE source_id=?', queuedChat.id);
  assert(job);
  const change = {
    title: queuedChat.title,
    providerId: 'fixture',
    model: 'fixture',
    sourceIds: [],
    memoryLearn: false,
    expectedRevision: queuedChat.revision,
  };
  const revoked = await updateApiChat(user, queuedChat.id, change);
  assert.equal(
    (await get('SELECT status FROM assistant_memory_jobs WHERE id=? AND user_id=?', job.id, user))
      .status,
    'cancelled'
  );
  await processMemoryJob(user, job.id, async () => {
    throw new Error('Cancelled learning must not call an extractor');
  });
  assert.equal(await memorySource(user, 'api', queuedChat.id, queuedTurn), null);
  // A turn begun with learning off stays ineligible after enabling it later.
  const noLearnTurn = await insertTurn(enabled.id, false);
  assert.equal(await memorySource(user, 'api', enabled.id, noLearnTurn), null);
  const restored = await updateApiChat(user, queuedChat.id, {
    ...change,
    expectedRevision: revoked.revision,
    memoryLearn: true,
  });
  assert.equal(restored.body.memoryLearn, true);
  assert.equal(
    (await get('SELECT status FROM assistant_memory_jobs WHERE id=? AND user_id=?', job.id, user))
      .status,
    'cancelled'
  );
  console.log(
    'PASS: revocation cancels queued extraction; turn-time off survives later enable; re-enable does not resurrect cancelled work'
  );
  const inFlight = await createResource(
    user,
    'api-chat',
    'Analyse läuft',
    BODY_SCHEMAS['api-chat'].parse({ providerId: 'fixture', model: 'fixture', memoryLearn: true })
  );
  const inFlightTurn = await insertTurn(inFlight.id);
  await enqueueMemory(user, 'api', inFlight.id, inFlightTurn);
  const inFlightJob = await get(
    'SELECT id FROM assistant_memory_jobs WHERE source_id=?',
    inFlight.id
  );
  const countBefore = (
    await get(
      "SELECT COUNT(*) AS n FROM assistant_resources WHERE user_id=? AND kind='memory'",
      user
    )
  ).n;
  await processMemoryJob(user, inFlightJob.id, async () => {
    await updateApiChat(user, inFlight.id, {
      ...change,
      expectedRevision: inFlight.revision,
      memoryLearn: false,
    });
    return {
      extracted: {
        memories: [
          {
            key: 'late',
            title: 'Zu spät',
            text: 'SIBLING HISTORY FACT',
            quote: 'SIBLING HISTORY FACT',
            keywords: [],
            sensitive: false,
          },
        ],
        summary: 'SIBLING HISTORY FACT',
        writingStyle: '',
      },
      usage: { model: 'fixture' },
    };
  });
  assert.equal(
    (
      await get(
        'SELECT status FROM assistant_memory_jobs WHERE id=? AND user_id=?',
        inFlightJob.id,
        user
      )
    ).status,
    'cancelled'
  );
  assert.equal(
    (
      await get(
        "SELECT COUNT(*) AS n FROM assistant_resources WHERE user_id=? AND kind='memory'",
        user
      )
    ).n,
    countBefore
  );
  assert(!(await get('SELECT id FROM assistant_memory_history WHERE source_id=?', inFlight.id)));
  console.log(
    'PASS: disabling learning while extraction runs prevents both fact and summary commit'
  );
  const forgetProject = await createResource(
    user,
    'project',
    'Vergessen',
    BODY_SCHEMAS.project.parse({ memoryMode: 'project-only' })
  );
  const originalChat = await createResource(
    user,
    'api-chat',
    'Original bleibt',
    BODY_SCHEMAS['api-chat'].parse({
      providerId: 'fixture',
      model: 'fixture',
      projectId: forgetProject.id,
    })
  );
  const originalTurn = await insertTurn(originalChat.id);
  const laterChat = await createResource(
    user,
    'api-chat',
    'Später',
    BODY_SCHEMAS['api-chat'].parse({
      providerId: 'fixture',
      model: 'fixture',
      projectId: forgetProject.id,
    })
  );
  const remembered = await createResource(
    user,
    'memory',
    'Wird vergessen',
    BODY_SCHEMAS.memory.parse({
      text: 'SIBLING HISTORY FACT',
      scope: 'project',
      projectId: forgetProject.id,
      origins: [
        { type: 'api', id: originalChat.id, turnId: originalTurn, quote: 'SIBLING HISTORY FACT' },
      ],
    })
  );
  const supplied = await systemContext(user, laterChat, 'SIBLING');
  assert(supplied.system.includes('SIBLING HISTORY FACT'));
  assert(
    supplied.memoryContext.references.some(
      (ref) =>
        ref.kind === 'memory' && ref.id === remembered.id && ref.revision === remembered.revision
    )
  );
  assert(
    supplied.memoryContext.references.some(
      (ref) =>
        ref.kind === 'project-chat' && ref.id === originalChat.id && ref.turnId === originalTurn
    )
  );
  const receiptTurn = {
    id: randomUUID(),
    status: 'completed',
    profile_json: JSON.stringify(supplied),
  };
  const beforeForget = (await contextReceipts(user, laterChat.id, [receiptTurn])).get(
    receiptTurn.id
  )!;
  assert(
    beforeForget.references.some(
      (ref) => ref.id === remembered.id && ref.text === 'SIBLING HISTORY FACT' && ref.available
    )
  );
  assert.equal(
    (await contextReceipts('another-owner', laterChat.id, [receiptTurn]))
      .get(receiptTurn.id)!
      .references.filter((ref) => ref.available).length,
    0,
    'receipt resolution remains owner-bound'
  );
  await forgetMemory(user, remembered.id, remembered.revision);
  const afterForget = (await contextReceipts(user, laterChat.id, [receiptTurn])).get(
    receiptTurn.id
  )!;
  assert(
    afterForget.references.every(
      (ref) => ref.id !== remembered.id || (!ref.available && !ref.text)
    ),
    'forget must not re-expose facts through receipts'
  );
  assert(
    afterForget.references.every((ref) => ref.turnId !== originalTurn || !ref.available),
    'forgotten source tombstones also apply to receipt links'
  );
  assert.equal(
    (await contextReceipts(user, laterChat.id, [{ ...receiptTurn, profile_json: '{}' }])).size,
    0,
    'old turns never receive invented context receipts'
  );
  assert(
    !(await systemContext(user, laterChat, 'SIBLING')).system.includes('SIBLING HISTORY FACT'),
    'forgotten origin must not return through project excerpts'
  );
  assert.equal(
    (await get('SELECT prompt FROM assistant_api_turns WHERE id=?', originalTurn)).prompt,
    'SIBLING HISTORY FACT',
    'forgetting preserves original user chat'
  );
  console.log(
    'PASS: forgotten origins stay out of automatic project recall; original chat remains intact'
  );
  const temporary = await createResource(
    user,
    'api-chat',
    'Temporär',
    BODY_SCHEMAS['api-chat'].parse({
      providerId: 'fixture',
      model: 'fixture',
      temporary: true,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      memoryRead: true,
      memoryLearn: true,
    })
  );
  assert.equal((await systemContext(user, temporary)).memoryRead, false);
  assert.equal((await systemContext(user, temporary)).memoryLearn, false);
  assert.equal(await memorySource(user, 'api', temporary.id, await insertTurn(temporary.id)), null);
  console.log(
    'PASS: temporary chats deny both permissions even with forged true body flags; no model invoked'
  );
} finally {
  await testing.dropTestSchema();
}
