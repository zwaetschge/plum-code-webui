import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'library-fixture-encryption-key-0000000';
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { run, get, transaction } = await import('../src/db/pg.js');
const { createResource, reviseResource, findResource, listResources, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const { libraryAccess, changeLibraryMember, writeLibrary, libraryFile, readableSource } =
  await import('../src/services/assistant/libraryAccess.js');
const { captureTaskSources, taskSourceContext } =
  await import('../src/services/assistant/taskSources.js');
if (!(await testing.databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await testing.createTestSchema();
try {
  const owner = 'library-owner',
    editor = 'library-editor',
    viewer = 'library-viewer',
    stranger = 'library-stranger';
  for (const id of [owner, editor, viewer, stranger])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      id,
      id + '@example.invalid',
      id
    );
  const assetId = randomUUID();
  await run(
    'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?)',
    assetId,
    owner,
    'source.txt',
    'text/plain',
    'fixture-sha',
    Buffer.from('Original file'),
    new Date().toISOString()
  );
  const project = await createResource(
    owner,
    'project',
    'Private project',
    BODY_SCHEMAS.project.parse({})
  );
  const source = await createResource(owner, 'source', 'Source', {
    ...BODY_SCHEMAS.source.parse({ text: 'Private old text', projectId: project.id }),
    assetId,
  });
  const _current = await reviseResource(owner, source.id, 1, source.title, {
    ...source.body,
    text: 'Current allowed evidence',
  });
  const collection = await createResource(
    owner,
    'collection',
    'Notebook',
    BODY_SCHEMAS.collection.parse({
      knowledge: true,
      resourceIds: [source.id],
      notes: 'Notebook notes',
    })
  );
  await assert.rejects(libraryAccess(stranger, source.id));
  await changeLibraryMember(owner, collection.id, {
    expectedRevision: 1,
    email: viewer + '@example.invalid',
    role: 'viewer',
  });
  const shared = await libraryAccess(viewer, source.id);
  assert.equal(shared.resource.body.text, 'Current allowed evidence');
  assert.equal(
    shared.resource.body.projectId,
    undefined,
    'a library grant does not expose the private project reference'
  );
  await assert.rejects(libraryAccess(viewer, source.id, undefined, 1));
  assert.equal((await libraryFile(viewer, source.id)).bytes.toString(), 'Original file');
  assert(
    (await listResources(viewer, 'source')).some((item) => item.id === source.id),
    'shared sources are reachable by normal source pickers'
  );
  const versions = await transaction((tx) => captureTaskSources(tx, viewer, [source.id]));
  const context = await taskSourceContext(viewer, versions, undefined, true);
  assert(
    context.some((item) => item.text.includes('Current allowed evidence')),
    'retrieval accepts an explicitly granted source'
  );
  await assert.rejects(
    writeLibrary(viewer, source.id, { expectedRevision: 2, title: 'Overwrite', text: 'No' }),
    /schreibgeschützt/
  );
  await assert.rejects(
    changeLibraryMember(viewer, collection.id, {
      expectedRevision: 1,
      email: stranger + '@example.invalid',
      role: 'viewer',
    })
  );
  await changeLibraryMember(owner, source.id, {
    expectedRevision: 2,
    email: editor + '@example.invalid',
    role: 'editor',
  });
  const edited = await writeLibrary(editor, source.id, {
    expectedRevision: 2,
    title: 'Edited source',
    text: 'Approved edited evidence',
  });
  assert.equal(edited.resource.revision, 3);
  assert.equal((await findResource(owner, source.id)).body.projectId, project.id);
  assert.equal(
    (await readableSource(editor, source.id, undefined, 2)).resource.body.text,
    'Current allowed evidence'
  );
  await assert.rejects(readableSource(editor, source.id, undefined, 1));
  await assert.rejects(
    writeLibrary(editor, source.id, { expectedRevision: 2, title: 'Stale', text: 'No' }),
    /inzwischen/
  );
  await changeLibraryMember(owner, collection.id, {
    expectedRevision: 1,
    email: viewer + '@example.invalid',
    role: null,
  });
  assert.equal(
    (await taskSourceContext(viewer, versions, undefined, true)).length,
    0,
    'revocation blocks already pinned source revisions'
  );
  await assert.rejects(libraryFile(viewer, source.id));
  assert(!(await listResources(viewer, 'source')).some((item) => item.id === source.id));
  await assert.rejects(libraryAccess(viewer, project.id));
  const chat = await createResource(
    owner,
    'api-chat',
    'Private chat',
    BODY_SCHEMAS['api-chat'].parse({ providerId: 'fixture', model: 'fixture' })
  );
  const mixed = await createResource(
    owner,
    'collection',
    'Mixed',
    BODY_SCHEMAS.collection.parse({ resourceIds: [source.id, chat.id] })
  );
  await assert.rejects(
    changeLibraryMember(owner, mixed.id, {
      expectedRevision: 1,
      email: viewer + '@example.invalid',
      role: 'viewer',
    }),
    /Quellensammlungen/
  );
  assert(
    await get("SELECT id FROM audit_log WHERE actor_user_id=? AND action='library-edit'", editor)
  );
  console.log(
    'PASS owner/editor/viewer, collection inheritance, private revision floor, source picker/retrieval/file, revocation and actual-actor audit; no model calls'
  );
} finally {
  await testing.dropTestSchema();
}
