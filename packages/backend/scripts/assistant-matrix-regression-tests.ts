import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'matrix-fixture-session-secret-00000000';
process.env.JWT_SECRET = 'matrix-fixture-jwt-secret-00000000000';
process.env.ENCRYPTION_KEY = 'matrix-fixture-encryption-key-0000000';
process.env.PLUM_MATRIX_HOMESERVER = 'https://matrix.fixture.invalid';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const matrix = await import('../src/services/assistant/matrix.js');
const { createResource, reviseResource, BODY_SCHEMAS, findResource } =
  await import('../src/services/assistant/resources.js');
const { executeNativeTaskCommand } = await import('../src/services/assistant/nativeTasks.js');
const { commandHash } = await import('../src/services/assistant/tasks.js');
const { uploadApiImage } = await import('../src/services/assistant/apiFiles.js');
const { uploadTaskImage } = await import('../src/services/assistant/taskFiles.js');

const originalFetch = globalThis.fetch;
const joined = new Set(['!lobby:fixture.invalid']);
const sent = new Map<
  string,
  { event_id: string; content: Record<string, unknown>; actor: string }
>();
let switchDuringRead = false,
  loseAssignmentResponse = false,
  uploads = 0,
  switchDuringUpload = false;
const actor = (options?: RequestInit) =>
  new Headers(options?.headers).get('Authorization') === 'Bearer fixture-bob'
    ? '@bob:fixture.invalid'
    : '@alice:fixture.invalid';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
if (!(await databaseReachable())) {
  await closePool();
  process.exitCode = 2;
  console.log('NOT RUN: isolated Matrix/owner database tests');
} else
  try {
    await createTestSchema();
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES('matrix-fixture','matrix@fixture.invalid','test','matrix-fixture')"
    );
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      assert.equal(
        url.origin,
        'https://matrix.fixture.invalid',
        'fixture must never access a live homeserver'
      );
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/media/v3/upload')) {
        uploads++;
        assert.equal(new Headers(options?.headers).get('Content-Type'), 'image/png');
        if (switchDuringUpload) {
          switchDuringUpload = false;
          await matrix.connectMatrix('matrix-fixture', { accessToken: 'fixture-bob' });
        }
        return json({ content_uri: `mxc://fixture.invalid/image-${uploads}` });
      }
      if (pathname.endsWith('/account/whoami'))
        return json({ user_id: actor(options), device_id: 'fixture-device' });
      if (pathname.endsWith('/joined_rooms')) {
        if (switchDuringRead) {
          switchDuringRead = false;
          await matrix.connectMatrix('matrix-fixture', { accessToken: 'fixture-bob' });
        }
        return json({ joined_rooms: [...joined] });
      }
      if (pathname.endsWith('/state/m.room.encryption'))
        return json({ errcode: 'M_NOT_FOUND' }, 404);
      if (pathname.endsWith('/state'))
        return json([
          { type: 'm.room.name', content: { name: 'Fixture Lobby' } },
          { type: 'm.room.canonical_alias', content: { alias: '#schwarm-lobby:fixture.invalid' } },
          {
            type: 'ch.zwaetschge.swarm.agent',
            state_key: 'brian',
            sender: '@schwarm:fixture.invalid',
            content: {
              v: 1,
              id: 'brian',
              name: 'Brian / Hermes',
              status: 'online',
              mode: 'native',
              room: '!brian:fixture.invalid',
            },
          },
        ]);
      if (pathname.endsWith('/sync'))
        return json({
          rooms: {
            invite: joined.has('!invited:fixture.invalid')
              ? {}
              : {
                  '!invited:fixture.invalid': {
                    invite_state: {
                      events: [
                        { type: 'm.room.name', content: { name: 'Eingeladen' } },
                        {
                          type: 'm.room.member',
                          state_key: actor(options),
                          sender: '@host:fixture.invalid',
                          content: { membership: 'invite' },
                        },
                      ],
                    },
                  },
                },
          },
        });
      if (pathname.endsWith('/members'))
        return json({
          chunk: [
            {
              type: 'm.room.member',
              state_key: actor(options),
              content: { membership: 'join', displayname: 'Fixture' },
            },
          ],
        });
      if (
        pathname.endsWith('/join') ||
        pathname.endsWith('/leave') ||
        pathname.endsWith('/invite')
      ) {
        const room = pathname.split('/rooms/')[1]!.split('/')[0]!;
        if (pathname.endsWith('/join')) joined.add(room);
        if (pathname.endsWith('/leave')) joined.delete(room);
        if (pathname.endsWith('/invite'))
          assert.equal(JSON.parse(String(options?.body)).user_id, '@guest:fixture.invalid');
        return json({ room_id: room });
      }
      if (pathname.includes('/send/')) {
        const content = JSON.parse(String(options?.body)),
          receipt = sent.get(pathname) ?? {
            event_id: `$fixture-${sent.size}`,
            content,
            actor: actor(options),
          };
        assert.deepEqual(
          receipt.content,
          content,
          'retries must preserve their exact native payload'
        );
        sent.set(pathname, receipt);
        if (loseAssignmentResponse && String(content.body).startsWith('!auftrag')) {
          loseAssignmentResponse = false;
          return json({ errcode: 'M_UNKNOWN' }, 503);
        }
        return json({ event_id: receipt.event_id });
      }
      throw new Error(`Unhandled fixture request: ${pathname}`);
    };
    await matrix.connectMatrix('matrix-fixture', { accessToken: 'fixture-alice' });
    const first = await matrix.matrixSend(
      'matrix-fixture',
      '!lobby:fixture.invalid',
      'same-command',
      'm.room.message',
      { body: 'Hallo' },
      '@alice:fixture.invalid'
    );
    assert.deepEqual(
      await matrix.matrixSend(
        'matrix-fixture',
        '!lobby:fixture.invalid',
        'same-command',
        'm.room.message',
        { body: 'Hallo' },
        '@alice:fixture.invalid'
      ),
      first
    );
    assert.equal(sent.size, 1);
    await assert.rejects(
      () =>
        matrix.matrixSend(
          'matrix-fixture',
          '!lobby:fixture.invalid',
          'same-command',
          'm.room.message',
          { body: 'Changed' }
        ),
      /anderen Inhalt/
    );
    switchDuringRead = true;
    await assert.rejects(
      () =>
        matrix.matrixSend(
          'matrix-fixture',
          '!lobby:fixture.invalid',
          'stale-command',
          'm.room.message',
          { body: 'must not send' }
        ),
      /inzwischen gewechselt/
    );
    assert.equal(sent.size, 1);
    assert.equal(
      await get(
        "SELECT command_id FROM assistant_matrix_commands WHERE command_id='stale-command'"
      ),
      undefined
    );
    await assert.rejects(
      () =>
        matrix.matrixSend(
          'matrix-fixture',
          '!lobby:fixture.invalid',
          'new-actor',
          'm.room.message',
          { body: 'old outbox' },
          '@alice:fixture.invalid'
        ),
      /passt nicht/
    );
    await matrix.connectMatrix('matrix-fixture', { accessToken: 'fixture-alice' });
    assert.equal((await matrix.matrixInvitations('matrix-fixture'))[0]!.name, 'Eingeladen');
    await matrix.matrixMembership('matrix-fixture', '!invited:fixture.invalid', {
      action: 'join',
      nativeUserId: '@alice:fixture.invalid',
    });
    await matrix.matrixMembership('matrix-fixture', '!invited:fixture.invalid', {
      action: 'join',
      nativeUserId: '@alice:fixture.invalid',
    });
    assert.equal(
      (await matrix.matrixMembers('matrix-fixture', '!invited:fixture.invalid'))[0]!.membership,
      'join'
    );
    await matrix.matrixMembership('matrix-fixture', '!invited:fixture.invalid', {
      action: 'invite',
      nativeUserId: '@alice:fixture.invalid',
      target: '@guest:fixture.invalid',
    });
    await matrix.matrixMembership('matrix-fixture', '!invited:fixture.invalid', {
      action: 'leave',
      nativeUserId: '@alice:fixture.invalid',
    });
    assert.equal(joined.has('!invited:fixture.invalid'), false);
    console.log(
      'PASS: Matrix desired membership, native actor binding, payload/idempotency ledger and reconnect during an in-flight read'
    );
    const source = await createResource(
      'matrix-fixture',
      'source',
      'Wissen',
      BODY_SCHEMAS.source.parse({ text: 'Pinned original source' })
    );
    const task = await createResource(
      'matrix-fixture',
      'task',
      'Recherche',
      BODY_SCHEMAS.task.parse({
        goal: 'Auswerten',
        agentId: 'matrix:brian',
        sourceIds: [source.id],
      })
    );
    const command = { commandId: randomUUID(), action: 'submit' as const, expectedRevision: 1 },
      hash = commandHash(task.id, command);
    loseAssignmentResponse = true;
    await assert.rejects(
      () => executeNativeTaskCommand('matrix-fixture', task.id, command, hash),
      /fehlgeschlagen/
    );
    await reviseResource('matrix-fixture', source.id, 1, source.title, {
      ...source.body,
      text: 'Changed later source',
    });
    const before = sent.size;
    const accepted = await executeNativeTaskCommand('matrix-fixture', task.id, command, hash);
    assert.equal(accepted.status, 'accepted');
    assert.equal(sent.size, before);
    const assignment = [...sent.values()].find((item) =>
      String(item.content.body).startsWith('!auftrag')
    )!;
    assert.equal(assignment.actor, '@alice:fixture.invalid');
    assert.ok(String(assignment.content.body).includes('Pinned original source'));
    assert.ok(!String(assignment.content.body).includes('Changed later source'));
    const saved = await findResource('matrix-fixture', task.id);
    assert.deepEqual(saved.body.sourceVersions, [{ id: source.id, revision: 1 }]);
    assert.equal(saved.body.matrixUserId, '@alice:fixture.invalid');
    console.log(
      'PASS: native assignment retry after a lost reply uses the same event/worker and frozen source revision'
    );
    const chat = await createResource(
      'matrix-fixture',
      'api-chat',
      'Bildkontext',
      BODY_SCHEMAS['api-chat'].parse({ providerId: 'fixture', model: 'fixture' })
    );
    const image = await uploadApiImage('matrix-fixture', chat.id, {
      originalname: 'Original.png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      ),
    });
    const turnId = randomUUID(),
      now = new Date().toISOString();
    await run(
      "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,source_versions,image_asset_ids,created_at,updated_at,expires_at) VALUES(?,?,1,'fixture','Welche Farbe?','Grün','completed','fixture','{}','[]',?,?,?,?)",
      turnId,
      chat.id,
      JSON.stringify([image.id]),
      now,
      now,
      now
    );
    const imageTask = await createResource(
      'matrix-fixture',
      'task',
      'Mit Bild',
      BODY_SCHEMAS.task.parse({
        goal: 'Das Bild bearbeiten',
        budgetUsd: 2.5,
        dueAt: '2026-10-12T12:00:00Z',
        agentId: 'matrix:brian',
        originResourceId: chat.id,
        originTurnId: turnId,
      })
    );
    const imageCommand = {
      commandId: randomUUID(),
      action: 'submit' as const,
      expectedRevision: 1,
    };
    loseAssignmentResponse = true;
    await assert.rejects(
      () =>
        executeNativeTaskCommand(
          'matrix-fixture',
          imageTask.id,
          imageCommand,
          commandHash(imageTask.id, imageCommand)
        ),
      /fehlgeschlagen/
    );
    assert.equal(uploads, 1);
    const pendingTask = await findResource('matrix-fixture', imageTask.id);
    await reviseResource('matrix-fixture', imageTask.id, pendingTask.revision, 'Später geändert', {
      ...pendingTask.body,
      goal: 'Neues Ziel darf die Wiederholung nicht ändern',
    });
    const sentBefore = sent.size;
    await executeNativeTaskCommand(
      'matrix-fixture',
      imageTask.id,
      imageCommand,
      commandHash(imageTask.id, imageCommand)
    );
    assert.equal(uploads, 1, 'confirmed upload is reused');
    assert.equal(sent.size, sentBefore, 'stable images/root/assignment IDs');
    const imageEvent = [...sent.values()].find((item) => item.content.msgtype === 'm.image')!;
    assert.equal(imageEvent.content.url, 'mxc://fixture.invalid/image-1');
    assert.deepEqual(imageEvent.content.info, { mimetype: 'image/png', size: image.byteLength });
    const imageAssignment = [...sent.values()].find(
      (item) =>
        String(item.content.body).startsWith('!auftrag') &&
        String(item.content.body).includes('mxc://')
    )!;
    assert.ok(String(imageAssignment.content.body).includes('Das Bild bearbeiten'));
    assert.ok(!String(imageAssignment.content.body).includes('Neues Ziel'));
    assert.ok(String(imageAssignment.content.body).includes(imageEvent.event_id));
    const nativeSpec = imageAssignment.content['ch.zwaetschge.plum.task'] as Record<
      string,
      unknown
    >;
    assert.equal(
      nativeSpec.budgetUsd,
      '2.5',
      'room-version-12 canonical JSON has no fractional number'
    );
    assert.equal(nativeSpec.deadline, '2026-10-12T12:00:00Z');
    assert.equal(nativeSpec.goal, 'Das Bild bearbeiten');

    const rejected = await createResource(
      'matrix-fixture',
      'task',
      'Rejected',
      BODY_SCHEMAS.task.parse({ goal: 'Native rejected', agentId: 'matrix:brian' })
    );
    const nativeCommandId = randomUUID();
    await reviseResource('matrix-fixture', rejected.id, 1, rejected.title, {
      ...rejected.body,
      status: 'queued',
      matrixThreadId: '$rejected-root',
      nativeCommandId,
    });
    const { archiveMatrixEvents } = await import('../src/services/assistant/matrixArchive.js');
    const rejection = {
      event_id: '$rejection',
      type: 'm.room.message',
      sender: '@schwarm:fixture.invalid',
      origin_server_ts: 200,
      content: {
        body: '🚫 Abgelehnt (unknown-agent): nicht vorhanden',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$rejected-root' },
      },
    };
    await archiveMatrixEvents(
      'matrix-fixture',
      '@alice:fixture.invalid',
      '!lobby:fixture.invalid',
      [{ ...rejection, sender: '@other:fixture.invalid' }]
    );
    assert.equal((await findResource('matrix-fixture', rejected.id)).body.status, 'queued');
    await archiveMatrixEvents(
      'matrix-fixture',
      '@alice:fixture.invalid',
      '!lobby:fixture.invalid',
      [rejection]
    );
    assert.equal((await findResource('matrix-fixture', rejected.id)).body.status, 'failed');
    const directTask = await createResource(
      'matrix-fixture',
      'task',
      'Direktes Foto',
      BODY_SCHEMAS.task.parse({ goal: 'Foto beschreiben', agentId: 'matrix:brian' })
    );
    const directUpload = await uploadTaskImage('matrix-fixture', directTask.id, 1, {
      originalname: 'Direkt.png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      ),
    });
    const directCommand = {
      commandId: randomUUID(),
      expectedRevision: directUpload.task.revision,
      action: 'submit' as const,
    };
    const beforeDirect = uploads;
    await executeNativeTaskCommand(
      'matrix-fixture',
      directTask.id,
      directCommand,
      commandHash(directTask.id, directCommand)
    );
    assert.equal(uploads, beforeDirect + 1);
    const directAssignment = [...sent.values()].find(
      (entry) =>
        String(entry.content.body ?? '').includes('Foto beschreiben') &&
        entry.content['ch.zwaetschge.plum.task']
    );
    assert(directAssignment);
    assert(String(directAssignment.content.body).includes('mxc://fixture.invalid/image-2'));
    await assert.rejects(
      uploadTaskImage('matrix-fixture', directTask.id, 1, {
        originalname: 'Late.png',
        buffer: Buffer.from('GIF89a-fixture'),
      })
    );
    switchDuringUpload = true;
    await assert.rejects(
      () =>
        matrix.matrixUploadOnce(
          'matrix-fixture',
          '!lobby:fixture.invalid',
          randomUUID(),
          Buffer.from('fixture'),
          'Test.png',
          'image/png',
          '@alice:fixture.invalid'
        ),
      /inzwischen gewechselt/
    );
    console.log(
      'PASS: actual owned image bytes uploaded, threaded native media/reference delivery, confirmed upload reuse, immutable task goal on retry and upload identity-change rejection'
    );
  } finally {
    globalThis.fetch = originalFetch;
    await dropTestSchema();
    await closePool();
  }
