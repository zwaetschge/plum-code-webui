import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
process.env.NODE_ENV = 'test';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, transaction, closePool } = await import('../src/db/pg.js');
const { createResource, reviseResource, findResource, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const {
  documentAccess,
  sharedDocuments,
  documentMembers,
  changeDocumentMember,
  writeSharedDocument,
} = await import('../src/services/assistant/documentAccess.js');
const { readArtifactImage } = await import('../src/services/assistant/artifactImages.js');
const { documentFromText } = await import('@plum-code-webui/shared');
if (!(await databaseReachable())) {
  await closePool();
  throw new Error('Own test database unavailable');
}
try {
  await createTestSchema();
  for (const id of ['doc-owner', 'doc-reader', 'doc-editor', 'doc-other'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      id,
      `${id}@fixture.invalid`,
      id
    );
  const hidden = await createResource(
    'doc-owner',
    'source',
    'Private source',
    BODY_SCHEMAS.source.parse({ text: 'Hidden' })
  );
  const task = await createResource(
    'doc-owner',
    'task',
    'Privater Task',
    BODY_SCHEMAS.task.parse({ goal: 'Private goal' })
  );
  const doc = await createResource(
    'doc-owner',
    'artifact',
    'Gemeinsamer Bericht',
    BODY_SCHEMAS.artifact.parse({
      type: 'document',
      format: 'json',
      content: JSON.stringify(documentFromText('Äpfel')),
      sourceIds: [hidden.id],
      taskId: task.id,
    })
  );
  await reviseResource('doc-owner', doc.id, 1, doc.title, {
    ...doc.body,
    content: JSON.stringify(documentFromText('Revision zwei')),
  });
  await assert.rejects(documentAccess('doc-reader', doc.id), /nicht verfügbar/);
  const reader = {
    commandId: randomUUID(),
    expectedRevision: 2,
    email: 'doc-reader@fixture.invalid',
    role: 'viewer' as const,
  };
  const duplicate = await Promise.all([
    changeDocumentMember('doc-owner', doc.id, reader),
    changeDocumentMember('doc-owner', doc.id, reader),
  ]);
  assert.deepEqual(duplicate[0], duplicate[1]);
  const initial = await documentAccess('doc-reader', doc.id);
  assert.equal(initial.role, 'viewer');
  assert.equal(initial.resource.body.taskId, undefined);
  assert.equal(initial.resource.body.sourceIds, undefined);
  await assert.rejects(documentAccess('doc-reader', doc.id, undefined, 1), /nicht verfügbar/);
  assert.equal((await sharedDocuments('doc-reader')).length, 1);
  assert.equal((await sharedDocuments('doc-other')).length, 0);
  await assert.rejects(
    findResource('doc-reader', doc.id),
    'Sharing does not convert private owner getter into general access'
  );
  const edit = {
    commandId: randomUUID(),
    expectedRevision: 2,
    title: 'Überarbeiteter Bericht',
    content: JSON.stringify(documentFromText('Editor Äpfel')),
  };
  await assert.rejects(writeSharedDocument('doc-reader', doc.id, edit), /nur lesen/);
  await assert.rejects(
    changeDocumentMember('doc-reader', doc.id, { ...reader, email: 'doc-other@fixture.invalid' })
  );
  await changeDocumentMember('doc-owner', doc.id, {
    ...reader,
    commandId: randomUUID(),
    email: 'doc-editor@fixture.invalid',
    role: 'editor',
  });
  const saved = await Promise.all([
    writeSharedDocument('doc-editor', doc.id, edit),
    writeSharedDocument('doc-editor', doc.id, edit),
  ]);
  assert.deepEqual(saved[0], saved[1]);
  assert.equal(saved[0]!.resource.revision, 3);
  assert.equal(
    (await findResource('doc-owner', doc.id)).body.taskId,
    task.id,
    'Edit keeps unshared origin metadata'
  );
  await assert.rejects(
    writeSharedDocument('doc-editor', doc.id, { ...edit, title: 'Changed payload' }),
    /anderen Inhalt/
  );
  const competing = await Promise.allSettled([
    writeSharedDocument('doc-editor', doc.id, {
      ...edit,
      commandId: randomUUID(),
      expectedRevision: 3,
      content: JSON.stringify(documentFromText('A')),
    }),
    writeSharedDocument('doc-owner', doc.id, {
      ...edit,
      commandId: randomUUID(),
      expectedRevision: 3,
      content: JSON.stringify(documentFromText('B')),
    }),
  ]);
  assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await findResource('doc-owner', doc.id)).revision, 4);
  assert.equal((await documentAccess('doc-reader', doc.id, undefined, 2)).resource.revision, 2);
  await assert.rejects(documentMembers('doc-editor', doc.id));
  const members = await documentMembers('doc-owner', doc.id);
  assert.equal(members.members.length, 2);
  assert.equal(members.audit.filter((row) => row.action === 'document-edit').length, 2);
  assert(
    !JSON.stringify(members.audit).includes('Editor Äpfel'),
    'Audit contains identifiers/revisions, not document contents'
  );
  // Original bindings may be preserved/reordered, but private owner assets cannot be added by a collaborator.
  const original = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    ),
    assetId = randomUUID();
  await run(
    'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?)',
    assetId,
    'doc-owner',
    'Original.png',
    'image/png',
    createHash('sha256').update(original).digest('hex'),
    original,
    new Date().toISOString()
  );
  const withImage = documentFromText('Mit Original');
  withImage.blocks.push({ type: 'image', assetId, alt: 'Original', caption: 'Caption' });
  const current = await findResource('doc-owner', doc.id);
  await reviseResource('doc-owner', doc.id, 4, current.title, {
    ...current.body,
    content: JSON.stringify(withImage),
  });
  const scoped = await documentAccess('doc-reader', doc.id);
  assert.deepEqual(
    (await readArtifactImage(scoped.ownerId, scoped.resource.body, assetId)).bytes,
    original
  );
  const next = {
    commandId: randomUUID(),
    expectedRevision: 5,
    title: current.title,
    content: JSON.stringify({ ...withImage, blocks: [withImage.blocks[1], withImage.blocks[0]] }),
  };
  assert.equal((await writeSharedDocument('doc-editor', doc.id, next)).resource.revision, 6);
  await assert.rejects(
    writeSharedDocument('doc-editor', doc.id, {
      ...next,
      commandId: randomUUID(),
      expectedRevision: 6,
      content: JSON.stringify({
        ...withImage,
        blocks: [{ type: 'image', assetId: randomUUID(), alt: 'private', caption: '' }],
      }),
    }),
    /bereits geteilte/
  );
  // Revoke under the same document row lock; a later queued edit must fail, including receipt retries.
  let locked!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
      locked = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const revoking = transaction(async (tx) => {
    await tx.get('SELECT id FROM assistant_resources WHERE id=? FOR UPDATE', doc.id);
    await tx.run(
      'DELETE FROM assistant_document_members WHERE resource_id=? AND user_id=?',
      doc.id,
      'doc-editor'
    );
    locked();
    await gate;
  });
  await ready;
  const later = writeSharedDocument('doc-editor', doc.id, {
    ...edit,
    commandId: randomUUID(),
    expectedRevision: 6,
  });
  release();
  await revoking;
  await assert.rejects(later, /nicht verfügbar/);
  await assert.rejects(writeSharedDocument('doc-editor', doc.id, next), /nicht verfügbar/);
  assert.equal((await sharedDocuments('doc-editor')).length, 0);
  const revoke = { ...reader, commandId: randomUUID(), expectedRevision: 6, role: null };
  await changeDocumentMember('doc-owner', doc.id, revoke);
  await changeDocumentMember('doc-owner', doc.id, revoke);
  await assert.rejects(documentAccess('doc-reader', doc.id), /nicht verfügbar/);
  await changeDocumentMember('doc-owner', doc.id, {
    ...reader,
    commandId: randomUUID(),
    expectedRevision: 6,
  });
  await assert.rejects(documentAccess('doc-reader', doc.id, undefined, 5), /nicht verfügbar/);
  await run("UPDATE users SET status='suspended' WHERE id=?", 'doc-owner');
  await assert.rejects(documentAccess('doc-reader', doc.id), /nicht verfügbar/);
  assert.equal(Number((await get('SELECT COUNT(*) AS n FROM assistant_document_members')).n), 1);
  await run("UPDATE users SET status='active' WHERE id=?", 'doc-owner');
  const live = await createResource('doc-owner', 'artifact', 'Live document', BODY_SCHEMAS.artifact.parse({ type: 'document', format: 'text', content: 'Alpha\nBeta\nGamma' }));
  await changeDocumentMember('doc-owner', live.id, { commandId: randomUUID(), expectedRevision: 1, email: 'doc-editor@fixture.invalid', role: 'editor' });
  await writeSharedDocument('doc-owner', live.id, { commandId: randomUUID(), expectedRevision: 1, title: live.title, content: 'Alpha geändert\nBeta\nGamma', autoMerge: true });
  const merged = await writeSharedDocument('doc-editor', live.id, { commandId: randomUUID(), expectedRevision: 1, title: live.title, content: 'Alpha\nBeta\nGamma geändert', autoMerge: true });
  assert.equal(merged.resource.body.content, 'Alpha geändert\nBeta\nGamma geändert');
  await assert.rejects(writeSharedDocument('doc-editor', live.id, { commandId: randomUUID(), expectedRevision: 1, title: live.title, content: 'Alpha anderer Text\nBeta\nGamma', autoMerge: true }), /überschneiden/);
  assert.equal((await documentAccess('doc-owner', live.id)).resource.revision, 3, 'conflicting live edits do not write');
  console.log(
    'PASS: real own PostgreSQL grants/editor/viewer/revocation, grant-bound history, sanitized references, same-UUID lost-ack receipts, concurrent CAS and revocation fencing, actual original pixels and private asset refusal, content-free audit, owner suspension; no live migration'
  );
} finally {
  await dropTestSchema();
}
