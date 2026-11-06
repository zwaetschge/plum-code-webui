import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'assistant-test-session-secret-000000000000';
process.env.JWT_SECRET ||= 'assistant-test-jwt-secret-0000000000000000';
process.env.ENCRYPTION_KEY ||= 'assistant-test-encryption-key-00000000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const { BODY_SCHEMAS, createResource, reviseResource, findResource, archiveResource } =
  await import('../src/services/assistant/resources.js');
const { bindProfile, buildAssistantContext } = await import('../src/services/assistant/context.js');
const { taskTransition, commandHash } = await import('../src/services/assistant/tasks.js');
const { executeAssistantTool } = await import('../src/services/assistant/tools.js');
const { archiveMatrixEvents } = await import('../src/services/assistant/matrixArchive.js');

assert.equal(taskTransition('waiting_input', 'complete'), 'completed');
assert.throws(() => taskTransition('running', 'complete'), /aktuellen Zustand/);
assert.throws(() => taskTransition('completed', 'submit'), /aktuellen Zustand/);
assert.notEqual(
  commandHash('a', { commandId: 'same', expectedRevision: 1, action: 'submit' }),
  commandHash('b', { commandId: 'same', expectedRevision: 1, action: 'submit' })
);
assert.notEqual(
  commandHash('a', { commandId: 'same', expectedRevision: 1, action: 'input', text: 'one' }),
  commandHash('a', { commandId: 'same', expectedRevision: 1, action: 'input', text: 'two' })
);
assert.equal(BODY_SCHEMAS.task.safeParse({ goal: 'work', status: 'completed' }).success, false);
assert.equal(
  BODY_SCHEMAS.profile.safeParse({ instructions: 'one', memory: 'invalid' }).success,
  false
);
console.log('PASS: task transitions, idempotency payload and input validation');
if (!(await databaseReachable())) {
  await closePool();
  console.log('NOT RUN: isolated Postgres resource/ownership tests (database unavailable)');
  process.exitCode = 2;
} else {
  try {
    await createTestSchema();
    await createTestSchema();
    for (const id of ['alice', 'bob'])
      await run(
        "INSERT INTO users (id,email,provider,provider_id) VALUES (?, ?, 'test', ?)",
        id,
        `${id}@example.invalid`,
        id
      );
    const alice = createResource(
      'alice',
      'profile',
      'Alice',
      BODY_SCHEMAS.profile.parse({ instructions: 'Say WELCOME ALICE', memory: 'read' })
    );
    const profile = await alice;
    await assert.rejects(() => findResource('bob', profile.id), /nicht gefunden/);
    const revision = await reviseResource('alice', profile.id, 1, 'Alice', {
      ...profile.body,
      instructions: 'Say NEW PROFILE',
    });
    assert.equal(revision.revision, 2);
    await assert.rejects(
      () => reviseResource('alice', profile.id, 1, 'Alice', profile.body),
      /inzwischen geändert/
    );
    const races = await Promise.allSettled([
      reviseResource('alice', profile.id, 2, 'Alice', { ...profile.body, instructions: 'one' }),
      reviseResource('alice', profile.id, 2, 'Alice', { ...profile.body, instructions: 'two' }),
    ]);
    assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
    const session = 'assistant-test-session';
    await run(
      "INSERT INTO sessions (id,user_id,name,working_directory,surface) VALUES (?, 'alice','Chat','/tmp','chat')",
      session
    );
    await assert.rejects(() => bindProfile('bob', session, profile.id), /nicht gefunden/);
    const selected = await findResource('alice', profile.id);
    await bindProfile('alice', session, profile.id);
    await createResource(
      'alice',
      'memory',
      'Own',
      BODY_SCHEMAS.memory.parse({ text: 'ALICE MEMORY' })
    );
    await createResource(
      'bob',
      'memory',
      'Other',
      BODY_SCHEMAS.memory.parse({ text: 'BOB PRIVATE MEMORY' })
    );
    await createResource(
      'alice',
      'memory',
      'Agent',
      BODY_SCHEMAS.memory.parse({ text: 'AGENT SECRET', scope: 'agent', agentId: 'brian' })
    );
    const context = await buildAssistantContext(session, 'alice');
    assert.ok(context?.includes('ALICE MEMORY'));
    assert.ok(!context?.includes('BOB PRIVATE MEMORY'));
    assert.ok(!context?.includes('AGENT SECRET'));
    await reviseResource('alice', profile.id, selected.revision, 'Alice', {
      ...selected.body,
      instructions: 'FUTURE INSTRUCTIONS',
    });
    assert.ok(!(await buildAssistantContext(session, 'alice'))?.includes('FUTURE INSTRUCTIONS'));
    await archiveResource('alice', profile.id, selected.revision + 1);
    assert.ok(!(await buildAssistantContext(session, 'alice'))?.includes('Profile instructions:'));
    const versions = await get(
      'SELECT count(*) AS count FROM assistant_resource_revisions WHERE resource_id = ?',
      profile.id
    );
    assert.equal(Number(versions.count), 4);
    await assert.rejects(
      () =>
        executeAssistantTool(session, 'alice', {
          name: 'plum_remember',
          arguments: { title: 'Rejected', text: 'Do not save' },
        }),
      /kein Speichern/
    );
    const writable = await createResource(
      'alice',
      'profile',
      'Writable',
      BODY_SCHEMAS.profile.parse({ memory: 'read-write' })
    );
    await bindProfile('alice', session, writable.id);
    const saved = await executeAssistantTool(session, 'alice', {
      name: 'plum_remember',
      arguments: { title: 'Remember', text: 'Allowed memory' },
    });
    assert.equal((saved as { kind: string }).kind, 'memory');
    const privateProject = await createResource(
      'alice',
      'project',
      'Private project',
      BODY_SCHEMAS.project.parse({ instructions: 'PROJECT PRIVATE INSTRUCTIONS' })
    );
    await createResource(
      'alice',
      'source',
      'Private project source',
      BODY_SCHEMAS.source.parse({ projectId: privateProject.id, text: 'PROJECT PRIVATE SOURCE' })
    );
    await run(
      'UPDATE assistant_session_bindings SET project_id=? WHERE session_id=?',
      privateProject.id,
      session
    );
    assert.ok((await buildAssistantContext(session, 'alice'))?.includes('PROJECT PRIVATE SOURCE'));
    await run('UPDATE assistant_session_bindings SET temporary = 1 WHERE session_id = ?', session);
    const temporaryContext = await buildAssistantContext(session, 'alice');
    assert.ok(!temporaryContext?.includes('PROJECT PRIVATE INSTRUCTIONS'));
    assert.ok(!temporaryContext?.includes('PROJECT PRIVATE SOURCE'));
    assert.ok(!temporaryContext?.includes('ALICE MEMORY'));

    await assert.rejects(
      () =>
        executeAssistantTool(session, 'alice', {
          name: 'plum_remember',
          arguments: { title: 'Rejected temporary', text: 'Never persist' },
        }),
      /kein Speichern/
    );
    await assert.rejects(
      () =>
        executeAssistantTool(session, 'alice', {
          name: 'plum_create_artifact',
          arguments: { title: 'Do not persist', body: { content: 'Temporary text' } },
        }),
      /Temporäre Chats/
    );
    await run('UPDATE assistant_session_bindings SET temporary = 0 WHERE session_id = ?', session);
    const foreignSource = await createResource(
      'bob',
      'source',
      'Bob source',
      BODY_SCHEMAS.source.parse({ text: 'Private' })
    );
    await assert.rejects(
      () =>
        executeAssistantTool(session, 'alice', {
          name: 'plum_create_artifact',
          arguments: { title: 'Bad reference', body: { sourceIds: [foreignSource.id] } },
        }),
      /nicht gefunden/
    );
    const event = {
      event_id: '$native-card',
      type: 'm.room.message',
      sender: '@schwarm:example.invalid',
      origin_server_ts: 100,
      content: {
        body: 'Card',
        'ch.zwaetschge.swarm.task': {
          v: 1,
          id: 'T-0042',
          state: 'submitted',
          goal: 'Native goal',
          assignee: 'brian',
        },
      },
    };
    await archiveMatrixEvents('alice', '@alice:example.invalid', '!agent', [
      event,
      {
        ...event,
        event_id: '$forged',
        sender: '@mallory:example.invalid',
        content: {
          'ch.zwaetschge.swarm.task': {
            id: 'T-0066',
            goal: 'Forged',
            state: 'completed',
            assignee: 'brian',
          },
        },
      },
    ]);
    const mapped = await get(
      "SELECT resource_id FROM assistant_source_mappings WHERE user_id = 'alice' AND source = 'matrix-task:example.invalid' AND native_id = 'T-0042'"
    );
    assert.ok(mapped);
    assert.equal(
      await get("SELECT resource_id FROM assistant_source_mappings WHERE native_id = 'T-0066'"),
      undefined
    );
    await archiveMatrixEvents('alice', '@alice:example.invalid', '!board', [
      {
        event_id: '$board',
        type: 'm.room.message',
        sender: '@schwarm:example.invalid',
        origin_server_ts: 200,
        content: { body: '✅ T-0042 · completed · brian\nNative goal' },
      },
    ]);
    assert.equal((await findResource('alice', mapped.resource_id)).body.status, 'completed');
    const stableRevision = (await findResource('alice', mapped.resource_id)).revision;
    await archiveMatrixEvents('alice', '@alice:example.invalid', '!agent', [event]);
    assert.equal((await findResource('alice', mapped.resource_id)).revision, stableRevision);
    const ownTask = await createResource(
      'alice',
      'task',
      'Own request',
      BODY_SCHEMAS.task.parse({ goal: 'Native goal', agentId: 'matrix:brian' })
    );
    await reviseResource('alice', ownTask.id, ownTask.revision, ownTask.title, {
      ...ownTask.body,
      matrixThreadId: '$own-root',
      coordinator: 'matrix',
      status: 'queued',
    });
    await archiveMatrixEvents('alice', '@alice:example.invalid', '!lobby', [
      {
        event_id: '$receipt',
        type: 'm.room.message',
        sender: '@schwarm:example.invalid',
        origin_server_ts: 90,
        content: {
          body: '📥 T-0042 → Brian · Native goal',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$own-root' },
        },
      },
    ]);
    const correlated = await get(
      "SELECT resource_id FROM assistant_source_mappings WHERE user_id = 'alice' AND native_id = 'T-0042'"
    );
    assert.equal(correlated.resource_id, ownTask.id);
    assert.equal((await findResource('alice', ownTask.id)).body.status, 'completed');
    await assert.rejects(() => findResource('alice', mapped.resource_id), /nicht gefunden/);
    await archiveMatrixEvents('alice', '@alice:other.invalid', '!other', [
      {
        ...event,
        event_id: '$different-hub',
        sender: '@schwarm:other.invalid',
      },
    ]);
    const otherHub = await get(
      "SELECT resource_id FROM assistant_source_mappings WHERE user_id='alice' AND source='matrix-task:other.invalid' AND native_id='T-0042'"
    );
    assert.ok(otherHub);
    assert.notEqual(otherHub.resource_id, ownTask.id);
    await run(
      "INSERT INTO assistant_credentials(user_id,service,public_json,secret_encrypted,updated_at) VALUES('alice','matrix',?, 'fixture',?)",
      JSON.stringify({ userId: '@alice:example.invalid', epoch: 'new-session' }),
      new Date().toISOString()
    );
    await assert.rejects(
      () =>
        archiveMatrixEvents(
          'alice',
          '@alice:example.invalid',
          '!agent',
          [{ ...event, event_id: '$stale-import' }],
          'old-session'
        ),
      /inzwischen gewechselt/
    );
    assert.equal(
      await get("SELECT event_id FROM assistant_matrix_events WHERE event_id='$stale-import'"),
      undefined
    );
    await archiveMatrixEvents('alice', '@alice:example.invalid', '!agent', [], 'new-session');
    await run("DELETE FROM assistant_credentials WHERE user_id='alice' AND service='matrix'");
    console.log(
      'PASS: native Hub/task namespace, sender authority and stale Matrix-session import fence'
    );
    const { getCLIArgs } = await import('../src/services/cli-providers.js');
    const ephemeral = getCLIArgs('codex', {
      ephemeral: true,
      resumeSessionId: 'must-not-resume',
      mode: 'auto-accept',
    });
    assert.ok(ephemeral.includes('--ephemeral'));
    assert.ok(!ephemeral.includes('resume'));
    assert.ok(!ephemeral.includes('must-not-resume'));
    const { temporaryRuntime, purgeTemporarySession } =
      await import('../src/services/assistant/temporary.js');
    const { createAssistantWorkspace } = await import('../src/services/assistant/workspaces.js');
    const fs = await import('node:fs/promises'),
      path = await import('node:path'),
      crypto = await import('node:crypto');
    process.env.PLUM_ASSISTANT_WORKSPACE_ROOT = path.resolve(
      '../../.probe/plum-assistant/temporary-workspaces'
    );
    const temporaryId = crypto.randomUUID(),
      workspace = await createAssistantWorkspace('alice');
    await fs.writeFile(path.join(workspace, 'private.txt'), 'Must disappear');
    await run(
      "INSERT INTO sessions(id,user_id,name,working_directory,surface) VALUES (?,'alice','Private title',?,'chat')",
      temporaryId,
      workspace
    );
    await run(
      'INSERT INTO assistant_session_bindings(session_id,temporary,temporary_expires_at) VALUES (?,1,?)',
      temporaryId,
      new Date(Date.now() - 1000).toISOString()
    );
    await run(
      "INSERT INTO messages(id,session_id,role,content) VALUES (? ,?,'user','Private retained text')",
      crypto.randomUUID(),
      temporaryId
    );
    await assert.rejects(() => temporaryRuntime(temporaryId), /abgelaufen/);
    let stopped = false;
    assert.equal(
      await purgeTemporarySession(temporaryId, async (id, user) => {
        assert.equal(id, temporaryId);
        assert.equal(user, 'alice');
        stopped = true;
      }),
      true
    );
    assert.ok(stopped);
    assert.equal(await get('SELECT id FROM messages WHERE session_id = ?', temporaryId), undefined);
    assert.equal(
      (await get('SELECT name,archived FROM sessions WHERE id = ?', temporaryId)).archived,
      1
    );
    assert.ok(
      (
        await get(
          'SELECT temporary_purged_at FROM assistant_session_bindings WHERE session_id = ?',
          temporaryId
        )
      ).temporary_purged_at
    );
    await assert.rejects(() => fs.stat(workspace), { code: 'ENOENT' });
    assert.equal(
      await purgeTemporarySession(temporaryId, async () => {
        throw Error('Already purged');
      }),
      false
    );
    console.log(
      'PASS: Codex ephemeral/no native resume, expired turn rejection, transcript/workspace retention and idempotent purge'
    );
    const { branchConversation } = await import('../src/services/assistant/branches.js');
    const { assistantExportSnapshot } = await import('../src/services/assistant/accountExport.js');
    const { ingestSource } = await import('../src/services/assistant/ingestion.js');
    await run(
      "INSERT INTO messages(id,session_id,role,content) VALUES ('branch-first',?,'user','Original question')",
      session
    );
    await run(
      "INSERT INTO messages(id,session_id,role,content) VALUES ('branch-answer',?,'assistant','Original answer')",
      session
    );
    await run(
      "INSERT INTO messages(id,session_id,role,content) VALUES ('branch-future',?,'user','Must not leak into branch')",
      session
    );
    await run(
      `INSERT INTO message_media(id,message_id,session_id,user_id,storage_key,filename,mime_type,byte_size,sha256,source,source_id)
      VALUES ('branch-media','branch-first',?,'alice','00000000-0000-4000-8000-000000000001.png','original.png','image/png',4,'fixture','upload','original-source')`,
      session
    );
    await assert.rejects(
      () =>
        branchConversation('bob', session, {
          messageId: 'branch-answer',
          includeMessage: true,
          title: 'Denied',
        }),
      /nicht gefunden/
    );
    const branch = await branchConversation('alice', session, {
      messageId: 'branch-answer',
      includeMessage: true,
      title: 'Frozen copy',
    });
    assert.equal(branch.copiedMessages, 2);
    const copied = await import('../src/db/pg.js').then((pg) =>
      pg.all('SELECT id,content FROM messages WHERE chat_id = ? ORDER BY seq', branch.chatId)
    );
    assert.deepEqual(
      copied.map((row) => row.content),
      ['Original question', 'Original answer']
    );
    assert.notEqual(copied[0]!.id, 'branch-first');
    const copiedMedia = await get(
      'SELECT * FROM message_media WHERE message_id = ?',
      copied[0]!.id
    );
    assert.equal(copiedMedia.storage_key, '00000000-0000-4000-8000-000000000001.png');
    assert.equal(copiedMedia.source_id, null);
    assert.equal(
      (await get('SELECT provider_session_id FROM session_chats WHERE id = ?', branch.chatId))
        .provider_session_id,
      null
    );
    await run('UPDATE sessions SET active_chat_id = ? WHERE id = ?', branch.chatId, session);
    const branchContext = await buildAssistantContext(session, 'alice');
    assert.ok(branchContext?.includes('Original question'));
    assert.ok(!branchContext?.includes('Must not leak'));
    await run("UPDATE messages SET content='Modified original' WHERE id='branch-first'");
    assert.equal(
      (await get('SELECT content FROM messages WHERE id = ?', copied[0]!.id)).content,
      'Original question'
    );
    const before = await branchConversation('alice', session, {
      messageId: 'branch-answer',
      includeMessage: false,
      title: 'Before answer',
    });
    assert.equal(before.copiedMessages, 1);
    const source = await ingestSource('alice', {
      buffer: Buffer.from('Äpfel, Birnen und Zwetschgen'),
      originalname: 'Äpfel.txt',
      mimetype: 'text/plain',
    });
    const sourceAgain = await ingestSource('alice', {
      buffer: Buffer.from('Äpfel, Birnen und Zwetschgen'),
      originalname: 'Original.txt',
      mimetype: 'text/plain',
    });
    assert.equal(source.body.assetId, sourceAgain.body.assetId);
    assert.equal(
      (
        await get('SELECT bytes FROM assistant_assets WHERE id = ?', source.body.assetId)
      ).bytes.toString(),
      'Äpfel, Birnen und Zwetschgen'
    );
    await assert.rejects(
      () =>
        ingestSource('alice', {
          buffer: Buffer.from([0xff, 0xfe]),
          originalname: 'broken.txt',
          mimetype: 'text/plain',
        }),
      /UTF|Text/
    );
    const { searchSourceChunks } = await import('../src/services/assistant/sourceChunks.js');
    const knowledgeProject = await createResource(
      'alice',
      'project',
      'Wissen',
      BODY_SCHEMAS.project.parse({})
    );
    const oldSource = await ingestSource(
      'alice',
      {
        buffer: Buffer.from('Originalauszug '.repeat(600) + 'Äpfel sind Obst'),
        originalname: 'lange-notiz.txt',
        mimetype: 'text/plain',
      },
      knowledgeProject.id
    );
    const indexed = await searchSourceChunks('alice', knowledgeProject.id, 'Äpfel');
    assert.equal(indexed.length, 1);
    assert.equal(indexed[0]!.revision, 1);
    assert.ok(indexed[0]!.excerpt.includes('Äpfel'));
    assert.ok(indexed[0]!.excerptStart > 4000);
    assert.equal((await searchSourceChunks('bob', knowledgeProject.id, 'Äpfel')).length, 0);
    const replacement = await ingestSource(
      'alice',
      {
        buffer: Buffer.from('Neue Quelle über Birnen'),
        originalname: 'ersetzt.txt',
        mimetype: 'text/plain',
      },
      undefined,
      { id: oldSource.id, expectedRevision: 1 }
    );
    assert.equal(replacement.revision, 2);
    assert.equal(replacement.id, oldSource.id);
    assert.equal(replacement.body.projectId, knowledgeProject.id);
    assert.notEqual(replacement.body.assetId, oldSource.body.assetId);
    assert.equal((await searchSourceChunks('alice', knowledgeProject.id, 'Äpfel')).length, 0);
    assert.equal(
      (await searchSourceChunks('alice', knowledgeProject.id, 'Birnen'))[0]!.revision,
      2
    );
    assert.equal(
      (
        await get(
          'SELECT body_json FROM assistant_resource_revisions WHERE resource_id = ? AND revision = 1',
          oldSource.id
        )
      ).body_json.includes('Äpfel'),
      true
    );
    await assert.rejects(
      () =>
        ingestSource(
          'alice',
          { buffer: Buffer.from('Stale'), originalname: 'stale.txt', mimetype: 'text/plain' },
          undefined,
          { id: oldSource.id, expectedRevision: 1 }
        ),
      /inzwischen geändert/
    );
    await archiveResource('alice', replacement.id, 2);
    assert.equal((await searchSourceChunks('alice', knowledgeProject.id, 'Birnen')).length, 0);
    const watched = await ingestSource(
      'alice',
      {
        buffer: Buffer.from('Ausgangsstand mit Äpfeln'),
        originalname: 'beobachtet.txt',
        mimetype: 'text/plain',
      },
      knowledgeProject.id
    );
    const frozen = await import('../src/db/pg.js').then((pg) =>
      pg.transaction((tx) =>
        import('../src/services/assistant/taskSources.js').then((module) =>
          module.captureTaskSources(tx, 'alice', [watched.id])
        )
      )
    );
    const subscription = await createResource(
      'alice',
      'event-subscription',
      'Beobachten',
      BODY_SCHEMAS['event-subscription'].parse({
        sourceId: watched.id,
        event: 'source.changed',
        goal: 'Fasse Änderungen zusammen',
        enabled: true,
      })
    );
    const changed = await reviseResource('alice', watched.id, 1, watched.title, {
      ...watched.body,
      text: 'Neuer Stand mit Birnen',
    });
    const pg = await import('../src/db/pg.js');
    const proposals = await pg.all(
      `SELECT * FROM assistant_resources WHERE kind='task' AND (body_json::jsonb)->'sourceEvent'->>'sourceId'=?`,
      watched.id
    );
    assert.equal(proposals.length, 1);
    assert.equal(JSON.parse(proposals[0]!.body_json).status, 'draft');
    await pg.transaction((tx) =>
      import('../src/services/assistant/sourceEvents.js').then((module) =>
        module.proposeSourceTasks(tx, 'alice', watched.id, 2, watched.title)
      )
    );
    assert.equal(
      (
        await pg.all(
          `SELECT id FROM assistant_resources WHERE kind='task' AND (body_json::jsonb)->'sourceEvent'->>'sourceId'=?`,
          watched.id
        )
      ).length,
      1
    );
    await reviseResource('alice', subscription.id, 1, subscription.title, {
      ...subscription.body,
      enabled: false,
    });
    await reviseResource('alice', changed.id, 2, changed.title, {
      ...changed.body,
      text: 'Dritter Stand',
    });
    assert.equal(
      (
        await pg.all(
          `SELECT id FROM assistant_resources WHERE kind='task' AND (body_json::jsonb)->'sourceEvent'->>'sourceId'=?`,
          watched.id
        )
      ).length,
      1
    );
    await run(
      `INSERT INTO sessions(id,user_id,name,working_directory,surface) VALUES ('pinned-source-task','alice','Quellenauftrag','/tmp','task')`
    );
    await createResource('alice', 'task', 'Eingefrorene Quelle', {
      ...BODY_SCHEMAS.task.parse({ goal: 'Ausgang auswerten', sourceIds: [watched.id] }),
      sessionId: 'pinned-source-task',
      sourceVersions: frozen,
    });
    const frozenContext = await buildAssistantContext('pinned-source-task', 'alice');
    assert.ok(frozenContext?.includes('Ausgangsstand mit Äpfeln'));
    assert.ok(!frozenContext?.includes('Dritter Stand'));
    const toolSource = (await executeAssistantTool('pinned-source-task', 'alice', {
      name: 'plum_read_resource',
      arguments: { id: watched.id },
    })) as { revision: number; body: { text: string } };
    assert.equal(toolSource.revision, 1);
    assert.equal(toolSource.body.text, 'Ausgangsstand mit Äpfeln');
    const evidence = {
      claim: 'Die Quelle erwähnt Äpfel',
      sourceId: watched.id,
      sourceRevision: 1,
      quote: 'Äpfeln',
      reviewed: true,
    };
    const report = (await executeAssistantTool(session, 'alice', {
      name: 'plum_create_artifact',
      arguments: {
        title: 'Recherchebeleg',
        body: { type: 'research', content: 'Eine belegte Aussage', evidence: [evidence] },
      },
    })) as { body: { evidence: Array<{ reviewed: boolean }> } };
    assert.equal(report.body.evidence[0]!.reviewed, false);
    await assert.rejects(
      () =>
        executeAssistantTool(session, 'alice', {
          name: 'plum_create_artifact',
          arguments: {
            title: 'Falscher Beleg',
            body: { evidence: [{ ...evidence, quote: 'Auszug fehlt' }] },
          },
        }),
      /Belegauszug/
    );
    console.log(
      'PASS: source-change drafts are idempotent/disabled correctly, task input revision stays pinned, exact research quotes are checked and model output cannot claim human review'
    );
    const { resourceReferences } = await import('../src/services/assistant/resources.js');
    assert.equal((await resourceReferences('alice', [watched.id, foreignSource.id])).length, 1);
    const treeRoot = await createResource(
      'alice',
      'task',
      'Wurzel',
      BODY_SCHEMAS.task.parse({ goal: 'Plan' })
    );
    const treeChild = await createResource(
      'alice',
      'task',
      'Kind',
      BODY_SCHEMAS.task.parse({ goal: 'Schritt', parentId: treeRoot.id })
    );
    await assert.rejects(
      () =>
        reviseResource('alice', treeRoot.id, 1, treeRoot.title, {
          ...treeRoot.body,
          parentId: treeChild.id,
        }),
      /Kreis/
    );
    await assert.rejects(
      () =>
        reviseResource('alice', treeChild.id, 1, treeChild.title, {
          ...treeChild.body,
          parentId: treeChild.id,
        }),
      /Kreis/
    );
    assert.equal((await findResource('alice', treeRoot.id)).revision, 1);
    const _pageSource = await createResource('alice', 'source', 'Seiten', {
      text: '[Seite 1]\nkurz vor Marke\n[Seite 2]\nzweite',
      pageCount: 2,
      projectId: knowledgeProject.id,
    });
    assert.equal((await searchSourceChunks('alice', knowledgeProject.id, 'vor Marke'))[0]!.page, 1);
    assert.equal((await searchSourceChunks('alice', knowledgeProject.id, 'zweite'))[0]!.page, 2);
    console.log(
      'PASS: owner-scoped reference metadata, acyclic task hierarchy and exact page-boundary citations'
    );
    console.log(
      'PASS: bounded source chunks with offsets, owner/project scope, file replacement revision/original preservation and current-only retrieval after replace/archive'
    );
    const { exportArtifact } = await import('../src/services/assistant/exports.js');
    const { officeArtifact } = await import('../src/services/assistant/office.js');
    for (const [format, body] of [
      ['docx', { type: 'document', format: 'markdown', content: '# Titel\nÄpfel und Birnen' }],
      [
        'xlsx',
        {
          type: 'table',
          format: 'json',
          content: JSON.stringify({ type: 'plum-sheet', version: 1, cells: [['2', '=SUM(A1,3)']] }),
        },
      ],
      ['pptx', { type: 'slides', format: 'text', content: 'Erste Folie\n\n---\n\nZweite Folie' }],
    ] as const) {
      const origin = await createResource(
        'alice',
        'artifact',
        `Office ${format}`,
        BODY_SCHEMAS.artifact.parse(body)
      );
      const exported = await exportArtifact(origin, format);
      const imported = await ingestSource(
        'alice',
        { buffer: exported.data, originalname: `original.${format}`, mimetype: exported.mimeType },
        knowledgeProject.id
      );
      assert.equal((imported.body.office as { kind: string }).kind, format);
      assert.equal(
        Buffer.compare(
          (await get('SELECT bytes FROM assistant_assets WHERE id=?', imported.body.assetId)).bytes,
          exported.data
        ),
        0
      );
      const command = { commandId: crypto.randomUUID(), expectedRevision: 1, sheet: 0 };
      const editable = await officeArtifact('alice', imported.id, command);
      assert.equal((await officeArtifact('alice', imported.id, command)).id, editable.id);
      await assert.rejects(
        () => officeArtifact('bob', imported.id, { ...command, commandId: crypto.randomUUID() }),
        /nicht gefunden/
      );
      await assert.rejects(
        () => officeArtifact('alice', imported.id, { ...command, sheet: 1 }),
        /anderen Inhalt/
      );
      await assert.rejects(
        () =>
          officeArtifact('alice', imported.id, {
            ...command,
            commandId: crypto.randomUUID(),
            expectedRevision: 9,
          }),
        /inzwischen geändert/
      );
      if (format === 'xlsx')
        assert.deepEqual(JSON.parse(String(editable.body.content)).cells[0], ['2', '=SUM(A1,3)']);
      const edited = await reviseResource('alice', editable.id, 1, editable.title, {
        ...BODY_SCHEMAS.artifact.parse(editable.body),
        format: format === 'docx' ? 'text' : editable.body.format,
        content: 'Edited',
      });
      assert.deepEqual(edited.body.importOrigin, editable.body.importOrigin);
    }
    console.log(
      'PASS: DOCX/XLSX/PPTX actual ZIP import, byte-identical originals, editable copies, formulas, import provenance, permanent transaction IDs and owner/revision checks'
    );
    const { assistantAppState } = await import('../src/services/assistant/appState.js');
    const appArtifact = await createResource(
      'alice',
      'artifact',
      'Interaktive App',
      BODY_SCHEMAS.artifact.parse({
        type: 'app',
        format: 'html',
        content: '<button>Hallo</button>',
      })
    );
    assert.deepEqual(await assistantAppState('alice', appArtifact.id, 1), {
      version: 0,
      state: null,
    });
    await assert.rejects(() => assistantAppState('bob', appArtifact.id, 1), /nicht gefunden/);
    await assistantAppState('alice', appArtifact.id, 1, {
      expectedVersion: 0,
      state: { count: 3 },
    });
    assert.deepEqual(await assistantAppState('alice', appArtifact.id, 1), {
      version: 1,
      state: { count: 3 },
    });
    await assert.rejects(
      () =>
        assistantAppState('alice', appArtifact.id, 1, { expectedVersion: 0, state: { count: 9 } }),
      /inzwischen geändert/
    );
    const appRevision = await reviseResource('alice', appArtifact.id, 1, appArtifact.title, {
      ...appArtifact.body,
      content: '<button>Neue App</button>',
    });
    assert.deepEqual(await assistantAppState('alice', appArtifact.id, appRevision.revision), {
      version: 0,
      state: null,
    });
    await assert.rejects(
      () =>
        assistantAppState('alice', appArtifact.id, 1, {
          expectedVersion: 1,
          state: 'x'.repeat(33000),
        }),
      /32 KB/
    );
    console.log(
      'PASS: app inputs are owner/version scoped, retained across reload, CAS protected and size bounded'
    );
    const { submitQuiz } = await import('../src/services/assistant/learning.js');
    const course = await createResource(
      'alice',
      'course',
      'Äpfel lernen',
      BODY_SCHEMAS.course.parse({
        lessons: [
          {
            title: 'Obst',
            content: 'Äpfel wachsen am Baum',
            sourceIds: [source.id],
            questions: [
              {
                prompt: 'Wo wachsen Äpfel?',
                choices: ['Baum', 'Meer'],
                correct: 0,
                explanation: 'Ein Apfelbaum trägt Früchte.',
              },
            ],
          },
        ],
      })
    );
    await assert.rejects(
      () =>
        submitQuiz('bob', course.id, {
          attemptId: '00000000-0000-4000-8000-000000000020',
          expectedRevision: 1,
          lesson: 0,
          answers: [0],
        }),
      /nicht gefunden/
    );
    const answer = {
      attemptId: '00000000-0000-4000-8000-000000000020',
      expectedRevision: 1,
      lesson: 0,
      answers: [0],
    };
    const quiz = await submitQuiz('alice', course.id, answer);
    assert.equal(quiz.attempt.correct, 1);
    assert.equal(quiz.attempt.courseRevision, 1);
    const again = await submitQuiz('alice', course.id, answer);
    assert.equal(again.course.revision, 2);
    assert.equal((again.course.body.attempts as unknown[]).length, 1);
    await assert.rejects(
      () => submitQuiz('alice', course.id, { ...answer, answers: [1] }),
      /anders verwendet/
    );
    await assert.rejects(
      () =>
        submitQuiz('alice', course.id, {
          ...answer,
          attemptId: '00000000-0000-4000-8000-000000000021',
          expectedRevision: 1,
        }),
      /inzwischen geändert/
    );
    await assert.rejects(
      () =>
        submitQuiz('alice', course.id, {
          ...answer,
          attemptId: '00000000-0000-4000-8000-000000000021',
          expectedRevision: 2,
          answers: [7],
        }),
      /gültig beantworten/
    );
    const meeting = await createResource(
      'alice',
      'meeting',
      'Besprechung',
      BODY_SCHEMAS.meeting.parse({
        audioAssetId: source.body.assetId,
        transcript: 'Original',
        originalTranscript: 'Original',
        words: [{ word: 'Original', start: 1, end: 2 }],
      })
    );
    const edited = await reviseResource('alice', meeting.id, 1, meeting.title, {
      transcript: 'Korrigiert',
      summary: 'Kurz',
      taskIds: [],
      originalTranscript: 'Manipuliert',
      words: [],
    });
    assert.equal(edited.body.originalTranscript, 'Original');
    assert.deepEqual(edited.body.words, meeting.body.words);
    assert.equal(edited.body.audioAssetId, meeting.body.audioAssetId);
    await assert.rejects(
      () =>
        executeAssistantTool(session, 'bob', {
          name: 'plum_read_resource',
          arguments: { id: course.id },
        }),
      /nicht gefunden/
    );
    const { default: express } = await import('express');
    const { default: jwt } = await import('jsonwebtoken');
    const { config } = await import('../src/config.js');
    const { default: assistantRouter } = await import('../src/routes/assistant.js');
    const app = express();
    app.use(express.json());
    app.use('/api/assistant', assistantRouter);
    app.use(
      (
        error: Error & { statusCode?: number },
        _req: unknown,
        res: import('express').Response,
        _next: unknown
      ) => res.status(error.statusCode ?? 500).json({ error: { message: error.message } })
    );
    const http = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => http.once('listening', resolve));
    const httpAddress = http.address();
    assert.ok(httpAddress && typeof httpAddress === 'object');
    const base = `http://127.0.0.1:${httpAddress.port}/api/assistant`;
    const request = async (path: string, user: string | null, method = 'GET', body?: unknown) =>
      fetch(base + path, {
        method,
        headers: {
          ...(user
            ? {
                Authorization: `Bearer ${jwt.sign({ userId: user }, config.jwtSecret, { expiresIn: '5m' })}`,
              }
            : {}),
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    try {
      const artifact = await createResource(
        'alice',
        'artifact',
        'Share proof',
        BODY_SCHEMAS.artifact.parse({ content: 'Original snapshot' })
      );
      const shareInput = {
        resourceId: artifact.id,
        revision: 1,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
      assert.equal((await request('/shares', 'bob', 'POST', shareInput)).status, 404);
      const response = await request('/shares', 'alice', 'POST', shareInput);
      assert.equal(response.status, 201);
      const share = (await response.json()).data;
      const sharePath = share.viewPath.replace('/shared/', '/shared/');
      assert.equal((await request(sharePath, null)).status, 401);
      const shared = (await (await request(sharePath, 'bob')).json()).data;
      assert.equal(shared.body.content, 'Original snapshot');
      await reviseResource('alice', artifact.id, 1, artifact.title, {
        ...artifact.body,
        content: 'New source version',
      });
      assert.equal(
        (await (await request(sharePath, 'bob')).json()).data.body.content,
        'Original snapshot'
      );
      assert.equal((await request('/shares/' + share.id, 'bob', 'DELETE')).status, 404);
      assert.equal((await request('/shares/' + share.id, 'alice', 'DELETE')).status, 200);
      assert.equal((await request(sharePath, 'bob')).status, 404);
      const second = (
        await (await request('/shares', 'alice', 'POST', { ...shareInput, revision: 2 })).json()
      ).data;
      await run(
        'UPDATE assistant_shares SET expires_at = ? WHERE id = ?',
        new Date(0).toISOString(),
        second.id
      );
      assert.equal((await request(second.viewPath, 'alice')).status, 404);
      const historic = await request(`/sources/${watched.id}/file?revision=1`, 'alice');
      assert.equal(historic.status, 200);
      assert.equal(await historic.text(), 'Ausgangsstand mit Äpfeln');
      assert.equal((await request(`/sources/${watched.id}/file?revision=1`, 'bob')).status, 404);
      const download = await request('/export?format=zip&nativeMedia=false', 'alice');
      assert.equal(download.status, 200);
      const fs = await import('node:fs/promises'),
        os = await import('node:os'),
        path = await import('node:path'),
        cp = await import('node:child_process');
      const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-assistant-export-test-'));
      try {
        const file = path.join(folder, 'export.zip');
        await fs.writeFile(file, Buffer.from(await download.arrayBuffer()));
        cp.execFileSync('python3', [
          '-c',
          `import zipfile,json,hashlib,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
m=json.loads(z.read('manifest.json')); d=json.loads(z.read('data.json'))
assert m['credentialsIncluded'] is False
assert all(r['user_id']=='alice' for r in d['resources'])
assert all(hashlib.sha256(z.read(f['path'])).hexdigest()==f['sha256'] for f in m['files'])
assert any(z.read(f['path'])=='Äpfel, Birnen und Zwetschgen'.encode() for f in m['files'])
assert m['missing'] and not m['complete']
assert 'credentials' not in d
`,
          file,
        ]);
      } finally {
        await fs.rm(folder, { recursive: true, force: true });
      }
      console.log(
        'PASS: authenticated share snapshots, foreign-owner denial, revision pinning, revoke/expiry and ZIP-original checksums/missing-media manifest'
      );
    } finally {
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve()))
      );
    }
    console.log(
      'PASS: source-bound quiz, owner separation, durable idempotency and revision conflicts; immutable meeting original and timecodes'
    );
    const exported = await assistantExportSnapshot('alice');
    assert.ok(exported.chats.some((row) => row.id === branch.chatId));
    assert.ok(exported.messages.some((row) => row.id === copied[0]!.id));
    assert.ok(exported.assets.some((row) => row.id === source.body.assetId));
    assert.ok(exported.resources.every((row) => row.user_id === 'alice'));
    const other = await assistantExportSnapshot('bob');
    assert.ok(!other.sessions.some((row) => row.id === session));
    assert.equal(other.assets.length, 0);
    console.log(
      'PASS: branch cut/ownership/media/native-resume isolation, frozen history, source bytes/dedup/UTF-8 and owner-scoped complete snapshot'
    );
    console.log(
      'PASS: MCP memory authority, temporary memory denial, foreign artifact references, native task provenance, stale terminal replay and exact receipt correlation'
    );
    console.log(
      'PASS: repeated migration, ownership, revision conflicts, parallel save, immutable profile binding, memory scopes, archived profile removal'
    );
  } finally {
    await dropTestSchema();
  }
}
