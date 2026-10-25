import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'chat-memory-fixture-encryption-key-00000000';
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { run, get } = await import('../src/db/pg.js');
const { createResource, BODY_SCHEMAS } = await import('../src/services/assistant/resources.js');
const { updatePersonalization } = await import('../src/services/assistant/personalization.js');
const { systemContext, updateApiChat } = await import('../src/services/assistant/apiChats.js');
const { enqueueMemory, memorySource, processMemoryJob } =
  await import('../src/services/assistant/memory.js');
const { safeEncrypt } = await import('../src/utils/encryption.js');
const { writeOpenCodeProvidersForUser } = await import('../src/utils/opencodeProviderKeys.js');
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
  await writeOpenCodeProvidersForUser(user, [
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
    preferences: { memoryEnabled: true, memoryLearning: true, chatHistory: true },
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
