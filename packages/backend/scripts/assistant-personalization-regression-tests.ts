import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { writeFileSync } from 'node:fs';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'personalization-fixture-session-secret-00000000';
process.env.JWT_SECRET = 'personalization-fixture-jwt-secret-00000000000';
process.env.ENCRYPTION_KEY = 'personalization-fixture-encryption-key-000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get } = await import('../src/db/pg.js');
const { readPersonalization, updatePersonalization, changeReferencePhoto, referencePhoto } =
  await import('../src/services/assistant/personalization.js');
const { createResource, BODY_SCHEMAS } = await import('../src/services/assistant/resources.js');
const { buildAssistantContext, bindProfile } = await import('../src/services/assistant/context.js');
const { systemContext } = await import('../src/services/assistant/apiChats.js');
const { executeAssistantTool } = await import('../src/services/assistant/tools.js');
const { assistantExportSnapshot } = await import('../src/services/assistant/accountExport.js');
const { default: assistantRouter } = await import('../src/routes/assistant.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
if (!(await databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await createTestSchema();
let serving = false;
try {
  for (const id of ['personal-alice', 'personal-bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      id,
      id + '@example.invalid',
      id
    );
  await run(
    'INSERT INTO user_settings(user_id,settings_json) VALUES(?,?)',
    'personal-alice',
    JSON.stringify({ unrelated: { keep: true } })
  );
  for (const [id, surface] of [
    ['personal-chat', 'chat'],
    ['personal-code', 'code'],
    ['personal-temp', 'chat'],
    ['personal-task', 'task'],
  ]) {
    await run(
      'INSERT INTO sessions(id,user_id,name,working_directory,surface) VALUES(?,?,?,?,?)',
      id,
      'personal-alice',
      id,
      '/tmp',
      surface
    );
    if (id === 'personal-temp')
      await run('INSERT INTO assistant_session_bindings(session_id,temporary) VALUES(?,1)', id);
  }
  const memory = await createResource(
    'personal-alice',
    'memory',
    'Meine Erinnerung',
    BODY_SCHEMAS.memory.parse({ text: 'MEMORY-ALICE-PRIVATE' })
  );
  await createResource(
    'personal-bob',
    'memory',
    'Andere Erinnerung',
    BODY_SCHEMAS.memory.parse({ text: 'MEMORY-BOB-PRIVATE' })
  );
  await createResource(
    'personal-alice',
    'meeting',
    'Sprachnotiz',
    BODY_SCHEMAS.meeting.parse({ transcript: 'VOICE-ALICE-PRIVATE' })
  );
  const initial = await readPersonalization('personal-alice');
  assert.equal(initial.revision, 0);
  assert(
    !(await buildAssistantContext('personal-chat', 'personal-alice'))!.includes(
      'MEMORY-ALICE-PRIVATE'
    )
  );
  let settings = await updatePersonalization('personal-alice', {
    expectedRevision: 0,
    preferences: {
      memoryEnabled: true,
      nickname: 'Ada',
      aboutYou: 'USER-ABOUT',
      chatInstructions: 'CHAT-INSTRUCTION',
      taskInstructions: 'TASK-INSTRUCTION',
      codeInstructions: 'CODE-INSTRUCTION',
      writingStyleEnabled: true,
      writingSample: 'MY-WRITING-SAMPLE',
      voiceHistory: true,
      emoji: 'less',
    },
  });
  assert.equal((await readPersonalization('personal-bob')).revision, 0);
  assert.deepEqual(
    JSON.parse(
      (await get('SELECT settings_json FROM user_settings WHERE user_id=?', 'personal-alice'))
        .settings_json
    ).unrelated,
    { keep: true }
  );
  await assert.rejects(
    () =>
      updatePersonalization('personal-alice', {
        expectedRevision: 0,
        preferences: { nickname: 'stale' },
      }),
    /inzwischen/
  );
  const race = await Promise.allSettled([
    updatePersonalization('personal-alice', {
      expectedRevision: settings.revision,
      preferences: { warmth: 'more' },
    }),
    updatePersonalization('personal-alice', {
      expectedRevision: settings.revision,
      preferences: { warmth: 'less' },
    }),
  ]);
  assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1);
  settings = await readPersonalization('personal-alice');
  const ctx = (await buildAssistantContext('personal-chat', 'personal-alice'))!;
  for (const value of [
    'CHAT-INSTRUCTION',
    'MEMORY-ALICE-PRIVATE',
    'VOICE-ALICE-PRIVATE',
    'MY-WRITING-SAMPLE',
    'USER-ABOUT',
  ])
    assert(ctx.includes(value), value);
  assert(!ctx.includes('MEMORY-BOB-PRIVATE'));
  assert(
    (await buildAssistantContext('personal-task', 'personal-alice'))!.includes('TASK-INSTRUCTION')
  );
  const restrictive = await createResource(
    'personal-alice',
    'profile',
    'Ohne Erinnerungen',
    BODY_SCHEMAS.profile.parse({ memory: 'off' })
  );
  await bindProfile('personal-alice', 'personal-chat', restrictive.id);
  const restricted = (await buildAssistantContext('personal-chat', 'personal-alice'))!;
  assert(!restricted.includes('VOICE-ALICE-PRIVATE'));
  assert(!restricted.includes('MEMORY-ALICE-PRIVATE'));
  await bindProfile('personal-alice', 'personal-chat', null);
  const code = (await buildAssistantContext('personal-code', 'personal-alice'))!;
  assert(code.includes('CODE-INSTRUCTION'));
  assert(!code.includes('MY-WRITING-SAMPLE'));
  assert(!code.includes('MEMORY-ALICE-PRIVATE'));
  assert(!code.includes('USER-ABOUT'));
  const temporary = (await buildAssistantContext('personal-temp', 'personal-alice'))!;
  assert(!temporary.includes('MEMORY-ALICE-PRIVATE'));
  assert(!temporary.includes('VOICE-ALICE-PRIVATE'));
  const apiResource = await createResource(
    'personal-alice',
    'api-chat',
    'Test',
    BODY_SCHEMAS['api-chat'].parse({ providerId: 'fixture', model: 'fixture' })
  );
  const restrictedApi = await systemContext('personal-alice', {
    ...apiResource,
    body: { ...apiResource.body, profileId: restrictive.id, profileRevision: restrictive.revision },
  });
  assert(!restrictedApi.system.includes('VOICE-ALICE-PRIVATE'));
  assert(!restrictedApi.system.includes('MEMORY-ALICE-PRIVATE'));
  const api = await systemContext('personal-alice', apiResource);
  assert(api.system.includes('CHAT-INSTRUCTION'));
  assert(api.system.includes('MEMORY-ALICE-PRIVATE'));
  assert.equal(api.personalizationRevision, settings.revision);
  await executeAssistantTool('personal-chat', 'personal-alice', {
    name: 'plum_read_resource',
    arguments: { id: memory.id },
  });
  settings = await updatePersonalization('personal-alice', {
    expectedRevision: settings.revision,
    preferences: { memoryEnabled: false },
  });
  assert(
    !(await buildAssistantContext('personal-chat', 'personal-alice'))!.includes(
      'MEMORY-ALICE-PRIVATE'
    )
  );
  assert(
    !(await systemContext('personal-alice', apiResource)).system.includes('VOICE-ALICE-PRIVATE')
  );
  await assert.rejects(
    () =>
      executeAssistantTool('personal-chat', 'personal-alice', {
        name: 'plum_read_resource',
        arguments: { id: memory.id },
      }),
    /keinen Zugriff/
  );
  await assert.rejects(
    () =>
      executeAssistantTool('personal-chat', 'personal-alice', {
        name: 'plum_remember',
        arguments: { title: 'Blocked', text: 'Blocked' },
      }),
    /kein Speichern/
  );
  const source = await createResource(
    'personal-alice',
    'source',
    'Recherche',
    BODY_SCHEMAS.source.parse({ text: 'needle-personalization' })
  );
  assert.equal(
    (
      (await executeAssistantTool('personal-chat', 'personal-alice', {
        name: 'plum_search_knowledge',
        arguments: { query: 'needle-personalization' },
      })) as unknown[]
    ).length,
    0
  );
  settings = await updatePersonalization('personal-alice', {
    expectedRevision: settings.revision,
    preferences: { projectSearch: true },
  });
  assert(
    (
      (await executeAssistantTool('personal-chat', 'personal-alice', {
        name: 'plum_search_knowledge',
        arguments: { query: 'needle-personalization' },
      })) as Array<{ id: string }>
    ).some((x) => x.id === source.id)
  );
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  settings = await changeReferencePhoto('personal-alice', 'portrait', settings.revision, {
    buffer: bytes,
    originalname: 'portrait.png',
  });
  assert.deepEqual((await referencePhoto('personal-alice', 'portrait')).bytes, bytes);
  await assert.rejects(() => referencePhoto('personal-bob', 'portrait'), /nicht gefunden/);
  await assert.rejects(
    () =>
      executeAssistantTool('personal-temp', 'personal-alice', {
        name: 'plum_read_reference_photo',
        arguments: { slot: 'portrait' },
      }),
    /nicht verfügbar/
  );
  await assert.rejects(
    () =>
      changeReferencePhoto('personal-alice', 'portrait', settings.revision, {
        buffer: Buffer.from('invalid'),
        originalname: 'bad.svg',
      }),
    /PNG/
  );
  const reference = (await buildAssistantContext('personal-chat', 'personal-alice'))!;
  assert(reference.includes('plum_read_reference_photo'));
  assert(
    !(await buildAssistantContext('personal-temp', 'personal-alice'))!.includes(
      'plum_read_reference_photo'
    )
  );
  assert((await assistantExportSnapshot('personal-alice')).personalization);
  settings = await changeReferencePhoto('personal-alice', 'portrait', settings.revision);
  await assert.rejects(() => referencePhoto('personal-alice', 'portrait'), /nicht gefunden/);
  console.log(
    'PASS personalisation: account isolation, concurrent revisions, preserved settings, CLI/API/Task/Code context, memory withdrawal/tool enforcement, voice history, project search, private photo lifecycle, temporary exclusions, export.'
  );
  const httpApp = express();
  httpApp.use(express.json());
  httpApp.use('/api/assistant', assistantRouter);
  httpApp.use(errorHandler);
  const httpServer = httpApp.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));
  try {
    const address = httpServer.address();
    assert(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}/api/assistant/personalization`;
    const headers = {
      Authorization: 'Bearer ' + jwt.sign({ userId: 'personal-alice' }, process.env.JWT_SECRET!),
      'Content-Type': 'application/json',
    };
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(
      (
        await fetch(url, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ expectedRevision: 0, preferences: { nickname: 'stale' } }),
        })
      ).status,
      409
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            expectedRevision: settings.revision,
            preferences: { referencePhotos: { portrait: 'foreign' } },
          }),
        })
      ).status,
      400
    );
    const large = new FormData();
    large.append('expectedRevision', String(settings.revision));
    large.append('file', new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)]), 'too-large.png');
    assert.equal(
      (
        await fetch(url + '/photos/portrait', {
          method: 'POST',
          headers: { Authorization: headers.Authorization },
          body: large,
        })
      ).status,
      413
    );
    const bob = {
      Authorization: 'Bearer ' + jwt.sign({ userId: 'personal-bob' }, process.env.JWT_SECRET!),
    };
    assert.equal((await fetch(url + '/photos/portrait', { headers: bob })).status, 404);
    console.log(
      'PASS personalisation HTTP: authentication, private cache, stale saves, forbidden photo injection, 5 MB upload response and account separation.'
    );
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
  if (process.env.PLUM_PERSONALIZATION_FIXTURE_RECORD) {
    const app = express();
    app.use(express.json({limit:'2mb'}));
    app.use('/api/assistant', assistantRouter);
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert(address && typeof address === 'object');
      writeFileSync(
        process.env.PLUM_PERSONALIZATION_FIXTURE_RECORD!,
        JSON.stringify({
          url: `http://127.0.0.1:${address.port}`,
          token: jwt.sign({ userId: 'personal-alice' }, process.env.JWT_SECRET!, {
            expiresIn: '1h',
          }),
        }),
        { mode: 0o600 }
      );
      console.log('Personalisation isolated HTTP fixture ready');
    });
    serving = true;
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      server.close(() => void dropTestSchema().then(() => process.exit(0)));
    };
    process.on('SIGTERM', close);
    process.on('SIGINT', close);
    // Reset only the fixture settings for a clean UI starting point.
    await run(
      'UPDATE user_settings SET settings_json=? WHERE user_id=?',
      JSON.stringify({ unrelated: { keep: true } }),
      'personal-alice'
    );
  }
} finally {
  if (!serving) await dropTestSchema();
}
