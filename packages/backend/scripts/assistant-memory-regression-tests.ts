import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'memory-fixture-jwt-secret-0000000000000';
process.env.ENCRYPTION_KEY = 'memory-fixture-encryption-key-0000000000';
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { safeEncrypt } = await import('../src/utils/encryption.js');
const { writeOpenCodeProvidersForUser } = await import('../src/utils/opencodeProviderKeys.js');
const { run, get, all } = await import('../src/db/pg.js');
const { createResource, BODY_SCHEMAS, reviseResource, archiveResource } =
  await import('../src/services/assistant/resources.js');
const { readPersonalization, updatePersonalization } =
  await import('../src/services/assistant/personalization.js');
const {
  enqueueMemory,
  processMemoryJob,
  relevantMemories,
  memoryRecall,
  forgetMemory,
  importAgentMemory,
  memoryStatus,
  containsSecret,
  extractMemory,
  backfillMemory,
  taskMemoryContext,
  memoryWorkerTick,
} = await import('../src/services/assistant/memory.js');
const { default: assistantRouter } = await import('../src/routes/assistant.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { executeAssistantTool } = await import('../src/services/assistant/tools.js');
const { systemContext } = await import('../src/services/assistant/apiChats.js');
const { buildAssistantContext } = await import('../src/services/assistant/context.js');
if (!(await testing.databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await testing.createTestSchema();
let count = 0;
try {
  for (const u of ['memory-alice', 'memory-bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      u,
      u + '@example.invalid',
      u
    );
  const user = 'memory-alice';
  let pref = await updatePersonalization(user, {
    expectedRevision: 0,
    preferences: {
      memoryEnabled: true,
      memoryLearning: true,
      chatHistory: true,
      writingStyleEnabled: true,
      writingStyleLearning: true,
    },
  });
  const chat = await createResource(
    user,
    'api-chat',
    'Privater Chat',
    BODY_SCHEMAS['api-chat'].parse({ providerId: 'fixture', model: 'fixture' })
  );
  async function turn(prompt: string, resource = chat, owner = user) {
    const id = randomUUID(),
      now = new Date(Date.now() + 1000).toISOString();
    await run(
      "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,created_at,updated_at,expires_at) VALUES(?,?,?,'fixture',?,'Antwort','completed','fixture','{}',?,?,?)",
      id,
      resource.id,
      Number(
        (await get('SELECT COUNT(*) AS c FROM assistant_api_turns WHERE chat_id=?', resource.id)).c
      ) + 1,
      prompt,
      now,
      now,
      new Date(Date.now() + 86400000).toISOString()
    );
    await enqueueMemory(owner, 'api', resource.id, id);
    return id;
  }
  const a = await turn('Ich mag Tee lieber als Kaffee. Bitte antworte kurz.');
  let jobs = await all('SELECT id FROM assistant_memory_jobs WHERE user_id=?', user);
  assert.equal(jobs.length, 1);
  count++;
  const extracted = {
    memories: [
      {
        key: 'drink-preference',
        title: 'Getränke',
        text: 'Bevorzugt Tee gegenüber Kaffee.',
        quote: 'Ich mag Tee lieber als Kaffee.',
        keywords: ['tea', 'coffee', 'Getränke'],
        sensitive: false,
      },
    ],
    summary: 'Bevorzugt Tee und kurze Antworten.',
    writingStyle: 'Kurze direkte Sätze.',
  };
  const mock = async () => ({
    extracted,
    usage: {
      model: 'fixture',
      providerId: 'fixture',
      input: 10,
      output: 10,
      cached: 0,
      cacheWrite: 0,
      costUsd: null,
    },
  });
  await processMemoryJob(user, jobs[0].id, mock);
  await processMemoryJob(user, jobs[0].id, mock);
  let memories = await all(
    "SELECT * FROM assistant_resources WHERE kind='memory' AND user_id=?",
    user
  );
  assert.equal(memories.length, 1);
  assert.equal(JSON.parse(memories[0].body_json).origins[0].turnId, a);
  count += 2;
  assert((await systemContext(user, chat, 'coffee')).system.includes('Bevorzugt Tee'));
  count++;
  assert((await memoryRecall(user, null, 'Tee', pref)).includes('Kurze direkte Sätze'));
  count++;
  assert.equal((await relevantMemories('memory-bob', null, 'coffee')).length, 0);
  count++;
  const b = await turn('Jetzt bevorzuge ich Kaffee statt Tee.');
  const correction = async () => ({
    extracted: {
      ...extracted,
      memories: [
        {
          ...extracted.memories[0],
          text: 'Bevorzugt nun Kaffee.',
          quote: 'Jetzt bevorzuge ich Kaffee statt Tee.',
          replacesId: memories[0].id,
        },
      ],
    },
    usage: { model: 'fixture' },
  });
  jobs = await all(
    "SELECT id FROM assistant_memory_jobs WHERE user_id=? AND status='queued'",
    user
  );
  await processMemoryJob(user, jobs[0].id, correction);
  memories = await all("SELECT * FROM assistant_resources WHERE kind='memory' AND user_id=?", user);
  assert.equal(memories.length, 1);
  assert.equal(memories[0].revision, 2);
  assert.equal(JSON.parse(memories[0].body_json).text, 'Bevorzugt nun Kaffee.');
  count++;
  const versions = await all(
    'SELECT * FROM assistant_resource_revisions WHERE resource_id=?',
    memories[0].id
  );
  assert.equal(versions.length, 2);
  count++;
  await forgetMemory(user, memories[0].id, memories[0].revision);
  assert.equal(
    (await all('SELECT * FROM assistant_resource_revisions WHERE resource_id=?', memories[0].id))
      .length,
    0
  );
  count++;
  await turn('Jetzt bevorzuge ich Kaffee statt Tee.');
  jobs = await all(
    "SELECT id FROM assistant_memory_jobs WHERE user_id=? AND status='queued'",
    user
  );
  await processMemoryJob(user, jobs[0].id, correction);
  assert.equal(
    (await all("SELECT * FROM assistant_resources WHERE kind='memory' AND user_id=?", user)).length,
    0
  );
  count++;
  const secret = await turn('Mein password=supersecret');
  assert.equal(
    (await all('SELECT * FROM assistant_memory_jobs WHERE turn_id=?', secret)).length,
    0
  );
  assert(containsSecret('sk-' + 'a'.repeat(30)));
  count++;
  const invalid = await turn('Ich nutze kurze Sätze.');
  jobs = await all('SELECT id FROM assistant_memory_jobs WHERE turn_id=?', invalid);
  await processMemoryJob(user, jobs[0].id, async () => ({
    extracted: {
      ...extracted,
      memories: [
        {
          ...extracted.memories[0],
          key: 'invalid',
          quote: 'NICHT IM TEXT',
          text: 'Erfundene Angabe',
        },
      ],
    },
    usage: {},
  }));
  assert.equal(
    (await all("SELECT * FROM assistant_resources WHERE kind='memory' AND user_id=?", user)).length,
    0
  );
  count++;
  const sens = await turn('Meine Diagnose ist Migräne.');
  jobs = await all('SELECT id FROM assistant_memory_jobs WHERE turn_id=?', sens);
  await processMemoryJob(user, jobs[0].id, async () => ({
    extracted: {
      ...extracted,
      memories: [
        {
          ...extracted.memories[0],
          key: 'health',
          text: 'Hat Migräne.',
          quote: 'Meine Diagnose ist Migräne.',
          sensitive: true,
        },
      ],
      summary: 'Migräne ist die Diagnose des Nutzers.',
    },
    usage: {},
  }));
  memories = await all("SELECT * FROM assistant_resources WHERE kind='memory' AND user_id=?", user);
  assert.equal(JSON.parse(memories[0].body_json).state, 'proposed');
  assert(!(await systemContext(user, chat, 'Migräne')).system.includes('Hat Migräne.'));
  assert(!(await memoryRecall(user, null, 'Migräne', pref)).includes('Migräne'));
  assert(!(await get('SELECT id FROM assistant_memory_history WHERE turn_id=?', sens)));
  count++;
  const temp = await createResource(
    user,
    'api-chat',
    'Temporär',
    BODY_SCHEMAS['api-chat'].parse({
      providerId: 'fixture',
      model: 'fixture',
      temporary: true,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    })
  );
  const tid = await turn('Ich bevorzuge Cola.', temp);
  assert.equal((await all('SELECT * FROM assistant_memory_jobs WHERE turn_id=?', tid)).length, 0);
  assert(!(await systemContext(user, temp, 'Tee')).system.includes('Kurze direkte Sätze'));
  count++;
  const race = await turn('Ich mag das Meer.');
  jobs = await all('SELECT id FROM assistant_memory_jobs WHERE turn_id=?', race);
  await processMemoryJob(user, jobs[0].id, async () => {
    pref = await updatePersonalization(user, {
      expectedRevision: pref.revision,
      preferences: { memoryEnabled: false },
    });
    return {
      extracted: {
        ...extracted,
        memories: [
          {
            ...extracted.memories[0],
            key: 'sea',
            text: 'Mag das Meer.',
            quote: 'Ich mag das Meer.',
          },
        ],
      },
      usage: {},
    };
  });
  assert.equal(
    (await get('SELECT status FROM assistant_memory_jobs WHERE id=?', jobs[0].id)).status,
    'cancelled'
  );
  assert(
    !(await all("SELECT body_json FROM assistant_resources WHERE kind='memory'")).some((r) =>
      r.body_json.includes('Mag das Meer.')
    )
  );
  count++;
  pref = await updatePersonalization(user, {
    expectedRevision: pref.revision,
    preferences: { memoryEnabled: true },
  });
  const project = await createResource(
    user,
    'project',
    'Privates Projekt',
    BODY_SCHEMAS.project.parse({ memoryMode: 'project-only' })
  );
  const profile = await createResource(
    user,
    'profile',
    'Projektprofil',
    BODY_SCHEMAS.profile.parse({ memory: 'read-write', projectId: project.id })
  );
  const pchat = await createResource(
    user,
    'api-chat',
    'Projektchat',
    BODY_SCHEMAS['api-chat'].parse({
      providerId: 'fixture',
      model: 'fixture',
      profileId: profile.id,
      profileRevision: profile.revision,
    })
  );
  const pt = await turn('Projektcode ALPHA nur hier.', pchat);
  jobs = await all('SELECT id FROM assistant_memory_jobs WHERE turn_id=?', pt);
  await processMemoryJob(user, jobs[0].id, async () => ({
    extracted: {
      ...extracted,
      summary: 'Projektcode ALPHA',
      memories: [
        {
          ...extracted.memories[0],
          key: 'project-code',
          text: 'Projektcode ALPHA.',
          quote: 'Projektcode ALPHA nur hier.',
        },
      ],
    },
    usage: {},
  }));
  assert(!(await systemContext(user, chat, 'ALPHA')).system.includes('Projektcode ALPHA'));
  assert((await systemContext(user, pchat, 'ALPHA')).system.includes('Projektcode ALPHA'));
  // ChatGPT default project memory: the same project memory now reaches ordinary chats.
  const opened = await reviseResource(
    user,
    project.id,
    project.revision,
    project.title,
    BODY_SCHEMAS.project.parse({ memoryMode: 'default' })
  );
  assert((await systemContext(user, chat, 'ALPHA')).system.includes('Projektcode ALPHA'));
  await reviseResource(
    user,
    project.id,
    opened.revision,
    project.title,
    BODY_SCHEMAS.project.parse({ memoryMode: 'project-only' })
  );
  assert(!(await systemContext(user, chat, 'ALPHA')).system.includes('Projektcode ALPHA'));
  count++;
  await archiveResource(user, pchat.id, pchat.revision);
  assert(!(await memoryRecall(user, project.id, 'ALPHA', pref)).includes('Projektcode ALPHA'));
  count++;
  const agent = await createResource(
    user,
    'memory',
    'Hermes-Wissen',
    BODY_SCHEMAS.memory.parse({
      text: 'Hermes erledigt Telefonaufträge.',
      scope: 'agent',
      agentId: 'hermes',
    })
  );
  assert(!(await systemContext(user, chat, 'Hermes')).system.includes('Telefonaufträge'));
  await importAgentMemory(user, agent.id, agent.revision);
  assert((await systemContext(user, chat, 'Hermes')).system.includes('Telefonaufträge'));
  await assert.rejects(() => importAgentMemory('memory-bob', agent.id, agent.revision));
  count++;
  await run(
    "INSERT INTO sessions(id,user_id,name,working_directory,surface) VALUES('memory-cli',?,'CLI','/tmp','chat')",
    user
  );
  const cid = randomUUID();
  await run(
    "INSERT INTO messages(id,session_id,role,content,created_at) VALUES(?,'memory-cli','user','Ich arbeite gern morgens.',?)",
    cid,
    new Date(Date.now() + 2000).toISOString()
  );
  await enqueueMemory(user, 'cli', 'memory-cli', cid);
  jobs = await all('SELECT id FROM assistant_memory_jobs WHERE turn_id=?', cid);
  await processMemoryJob(user, jobs[0].id, async () => ({
    extracted: {
      ...extracted,
      memories: [
        {
          ...extracted.memories[0],
          key: 'work-time',
          text: 'Arbeitet gern morgens.',
          quote: 'Ich arbeite gern morgens.',
        },
      ],
    },
    usage: {},
  }));
  assert(
    (await buildAssistantContext('memory-cli', user, 'morgens'))?.includes('Arbeitet gern morgens.')
  );
  count++;
  // Recall searches old relevant memories ahead of many newer unrelated entries.
  for (let i = 0; i < 35; i++)
    await createResource(
      user,
      'memory',
      'Sonstiges ' + i,
      BODY_SCHEMAS.memory.parse({ text: 'Unrelated preference ' + i })
    );
  assert((await relevantMemories(user, null, 'Telefonaufträge'))[0].title === 'Hermes-Wissen');
  count++;
  // Real transport serialization and owner API credential resolution with a local fake upstream.
  const stamp = new Date().toISOString();
  await writeOpenCodeProvidersForUser(user, [
    {
      id: 'openai',
      name: 'Memory fixture',
      enabled: true,
      apiKey: safeEncrypt('owner-fixture-key')!,
      baseUrl: 'https://memory.fixture.invalid/v1',
      models: ['gpt-5.5'],
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]);
  const actualChat = await createResource(
    user,
    'api-chat',
    'API Transport',
    BODY_SCHEMAS['api-chat'].parse({ providerId: 'openai', model: 'gpt-5.5' })
  );
  const actual = await turn('Ich schreibe lieber auf Deutsch.', actualChat);
  jobs = await all('SELECT id FROM assistant_memory_jobs WHERE turn_id=?', actual);
  const originalFetch = globalThis.fetch;
  let apiCalls = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).hostname, 'memory.fixture.invalid');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer owner-fixture-key');
    const body = JSON.parse(String(init?.body));
    assert(body.messages[0].content.includes('untrusted reference data'));
    assert(body.messages[1].content.includes('Ich schreibe lieber auf Deutsch.'));
    apiCalls++;
    const content = JSON.stringify({
      ...extracted,
      memories: [
        {
          ...extracted.memories[0],
          key: 'language',
          text: 'Bevorzugt Deutsch.',
          quote: 'Ich schreibe lieber auf Deutsch.',
        },
      ],
    });
    return new Response(
      'data: ' +
        JSON.stringify({
          model: 'gpt-5.5',
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        }) +
        '\n\ndata: ' +
        JSON.stringify({
          model: 'gpt-5.5',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }) +
        '\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } }
    );
  };
  try {
    await processMemoryJob(user, jobs[0].id, async (source, pref, existing) => {
      try {
        return await extractMemory(source, pref, existing);
      } catch (e) {
        console.error('FIXTURE EXTRACTION ERROR', e);
        throw e;
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(apiCalls, 1);
  assert.equal(
    (await get('SELECT status FROM assistant_memory_jobs WHERE id=?', jobs[0].id)).status,
    'completed'
  );
  assert(
    (
      await get(
        'SELECT usage_json FROM assistant_api_usage WHERE id LIKE ?',
        'memory-' + jobs[0].id + '-%'
      )
    ).usage_json.includes('costUsd')
  );
  count++;
  assert.equal(await taskMemoryContext(user, { goal: 'Telefonaufträge' }), '');
  pref = await updatePersonalization(user, {
    expectedRevision: pref.revision,
    preferences: { agentMemorySharing: true },
  });
  assert((await taskMemoryContext(user, { goal: 'Telefonaufträge' })).includes('Hermes'));
  count++;
  assert.equal((await backfillMemory(user, pref.revision, 5)).considered, 5);
  count++;
  await assert.rejects(() => backfillMemory('memory-bob', 999, 5));
  count++;
  const nativeTask = await createResource(
    user,
    'task',
    'Hermes-Auftrag',
    BODY_SCHEMAS.task.parse({ goal: 'Ich möchte jeden Morgen eine kurze Übersicht.' })
  );
  await run(
    "UPDATE assistant_resources SET body_json=jsonb_set(body_json::jsonb,'{status}','\"completed\"'::jsonb)::text,updated_at=? WHERE id=?",
    new Date(Date.now() + 1000).toISOString(),
    nativeTask.id
  );
  await enqueueMemory(user, 'task', nativeTask.id, String(nativeTask.revision));
  const nt = await get(
    "SELECT id FROM assistant_memory_jobs WHERE source_type='task' AND source_id=?",
    nativeTask.id
  );
  await processMemoryJob(user, nt.id, async () => ({
    extracted: {
      ...extracted,
      memories: [
        {
          ...extracted.memories[0],
          key: 'morning-brief',
          text: 'Möchte morgens eine kurze Übersicht.',
          quote: 'Ich möchte jeden Morgen eine kurze Übersicht.',
        },
      ],
    },
    usage: {},
  }));
  assert((await systemContext(user, chat, 'Übersicht')).system.includes('Möchte morgens'));
  count++;
  const manual = await createResource(
    user,
    'memory',
    'Korrektur',
    BODY_SCHEMAS.memory.parse({ text: 'Mag lange Antworten.' })
  );
  await executeAssistantTool('memory-cli', user, {
    name: 'plum_revise_memory',
    arguments: {
      id: manual.id,
      expectedRevision: manual.revision,
      title: 'Antwortstil',
      text: 'Mag kurze Antworten.',
    },
  });
  await assert.rejects(() =>
    executeAssistantTool('memory-cli', 'memory-bob', {
      name: 'plum_forget_memory',
      arguments: { id: manual.id, expectedRevision: 2 },
    })
  );
  await executeAssistantTool('memory-cli', user, {
    name: 'plum_forget_memory',
    arguments: { id: manual.id, expectedRevision: 2 },
  });
  assert(!(await get('SELECT id FROM assistant_resources WHERE id=?', manual.id)));
  count++;
  const forgetTarget = await createResource(
    user,
    'memory',
    'Vergessen',
    BODY_SCHEMAS.memory.parse({ text: 'Mag Hafermilch.' })
  );
  const ft = await turn('Vergiss meine Vorliebe für Hafermilch.');
  const fj = await get('SELECT id FROM assistant_memory_jobs WHERE turn_id=?', ft);
  await processMemoryJob(user, fj.id, async () => ({
    extracted: {
      memories: [],
      forget: [{ id: forgetTarget.id, quote: 'Vergiss meine Vorliebe für Hafermilch.' }],
      summary: 'Hafermilch',
      writingStyle: '',
    },
    usage: {},
  }));
  assert(!(await get('SELECT id FROM assistant_resources WHERE id=?', forgetTarget.id)));
  assert(!(await get('SELECT id FROM assistant_memory_history WHERE turn_id=?', ft)));
  count++;
  const app = express();
  app.use(express.json());
  app.use('/api/assistant', assistantRouter);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const root = `http://127.0.0.1:${address.port}/api/assistant`;
  const headers = {
    Authorization: 'Bearer ' + jwt.sign({ userId: user }, process.env.JWT_SECRET!),
    'Content-Type': 'application/json',
  };
  const other = {
    Authorization: 'Bearer ' + jwt.sign({ userId: 'memory-bob' }, process.env.JWT_SECRET!),
    'Content-Type': 'application/json',
  };
  try {
    assert.equal((await fetch(root + '/memory-system')).status, 401);
    count++;
    const result = await fetch(root + '/memory-system', { headers });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    count++;
    assert.equal(
      (await (await fetch(root + '/memory-system', { headers: other })).json()).data.jobs.length,
      0
    );
    count++;
    assert.equal(
      (
        await fetch(root + '/memory-system/import', {
          method: 'POST',
          headers: other,
          body: JSON.stringify({ id: agent.id, expectedRevision: agent.revision }),
        })
      ).status,
      404
    );
    count++;
    assert.equal(
      (
        await fetch(root + '/memory-system', {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ expectedRevision: 0, historyOnly: true }),
        })
      ).status,
      409
    );
    count++;
    assert.equal(
      (
        await fetch(root + '/memory-system', {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ expectedRevision: pref.revision, historyOnly: true }),
        })
      ).status,
      200
    );
    assert.equal(
      (await all('SELECT id FROM assistant_memory_history WHERE user_id=?', user)).length,
      0
    );
    count++;
    assert.equal(
      (
        await fetch(root + '/memory-system', {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ expectedRevision: pref.revision }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await all(
          "SELECT id FROM assistant_resources WHERE user_id=? AND kind='memory' AND body_json::jsonb->>'scope'<>'agent'",
          user
        )
      ).length,
      0
    );
    assert(await get('SELECT id FROM assistant_resources WHERE id=?', agent.id));
    count++;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const restored = await turn('Merk dir: Ich bevorzuge Kaffee.');
  const restoreJob = await get('SELECT id FROM assistant_memory_jobs WHERE turn_id=?', restored);
  await processMemoryJob(user, restoreJob.id, async () => ({
    extracted: {
      ...extracted,
      memories: [
        { ...extracted.memories[0], text: 'Bevorzugt nun Kaffee.', quote: 'Ich bevorzuge Kaffee.' },
      ],
    },
    usage: {},
  }));
  const restoredMemory = await get(
    "SELECT * FROM assistant_resources WHERE user_id=? AND kind='memory' AND body_json::jsonb->>'topic'='drink-preference'",
    user
  );
  assert(restoredMemory);
  assert(JSON.parse(restoredMemory.body_json).pinned);
  assert.equal(JSON.parse(restoredMemory.body_json).state, 'active');
  assert(
    !(await get(
      'SELECT fingerprint FROM assistant_memory_forgotten WHERE user_id=? AND fingerprint=?',
      user,
      (await import('../src/services/assistant/memory.js')).memoryFingerprint('drink-preference')
    ))
  );
  count++;
  await forgetMemory(user, restoredMemory.id, restoredMemory.revision);
  const pending = await createResource(
    user,
    'memory',
    'Gesundheit',
    BODY_SCHEMAS.memory.parse({
      text: 'Hat Migräne.',
      topic: 'health',
      state: 'proposed',
      learned: true,
    })
  );
  const approved = await turn('Merk dir: Meine Diagnose ist Migräne.');
  const approveJob = await get('SELECT id FROM assistant_memory_jobs WHERE turn_id=?', approved);
  await processMemoryJob(user, approveJob.id, async () => ({
    extracted: {
      ...extracted,
      memories: [
        {
          ...extracted.memories[0],
          key: 'health',
          text: 'Hat Migräne.',
          quote: 'Meine Diagnose ist Migräne.',
          sensitive: true,
        },
      ],
    },
    usage: {},
  }));
  const approvedMemory = await get(
    'SELECT revision,body_json FROM assistant_resources WHERE id=?',
    pending.id
  );
  assert.equal(approvedMemory.revision, 2);
  assert.equal(JSON.parse(approvedMemory.body_json).state, 'active');
  assert(JSON.parse(approvedMemory.body_json).pinned);
  await forgetMemory(user, pending.id, approvedMemory.revision);
  count++;
  await memoryWorkerTick();
  assert((await all("SELECT id FROM assistant_memory_jobs WHERE status='skipped'")).length > 0);
  count++;
  const status = await memoryStatus(user);
  assert(status.jobs.some((j) => j.status === 'cancelled'));
  assert(!JSON.stringify(status).includes('supersecret'));
  count++;
  console.log(
    `${count} long-term memory checks passed (isolated PostgreSQL, API/CLI, correction, deletion, opt-out race, scopes, history, agent import)`
  );
} finally {
  await testing.dropTestSchema();
}
