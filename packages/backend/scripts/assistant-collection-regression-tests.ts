import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const {
  createResource,
  reviseResource,
  findResource,
  resourceReferences,
  archiveResource,
  BODY_SCHEMAS,
} = await import('../src/services/assistant/resources.js');
if (!(await databaseReachable())) {
  await closePool();
  throw new Error('Isolated test database unavailable');
}
try {
  await createTestSchema();
  for (const user of ['collection-alice', 'collection-bob'])
    await run(
      'INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,?,?)',
      user,
      `${user}@fixture.invalid`,
      'test',
      user
    );
  const first = await createResource(
    'collection-alice',
    'artifact',
    'Dokument',
    BODY_SCHEMAS.artifact.parse({ content: 'Äpfel' })
  );
  const second = await createResource(
    'collection-alice',
    'source',
    'Angebot',
    BODY_SCHEMAS.source.parse({ text: '12 CHF' })
  );
  const foreign = await createResource(
    'collection-bob',
    'artifact',
    'Fremd',
    BODY_SCHEMAS.artifact.parse({ content: 'private' })
  );
  const body = BODY_SCHEMAS.collection.parse({
    resourceIds: [first.id, second.id],
    favoriteIds: [second.id],
    tags: ['Alltag'],
  });
  const collection = await createResource('collection-alice', 'collection', 'Bibliothek', body);
  assert.deepEqual((await findResource('collection-alice', collection.id)).body.favoriteIds, [
    second.id,
  ]);
  await assert.rejects(
    createResource(
      'collection-alice',
      'collection',
      'Fremd',
      BODY_SCHEMAS.collection.parse({ resourceIds: [foreign.id], favoriteIds: [foreign.id] })
    )
  );
  assert.throws(() =>
    BODY_SCHEMAS.collection.parse({ resourceIds: [first.id], favoriteIds: [second.id] })
  );
  assert.throws(() => BODY_SCHEMAS.collection.parse({ resourceIds: [first.id, first.id] }));
  const proposals = await Promise.allSettled([
    reviseResource('collection-alice', collection.id, 1, collection.title, {
      ...body,
      resourceIds: [second.id, first.id],
    }),
    reviseResource('collection-alice', collection.id, 1, collection.title, {
      ...body,
      favoriteIds: [first.id],
    }),
  ]);
  assert.equal(
    proposals.filter((p) => p.status === 'fulfilled').length,
    1,
    'concurrent edits cannot overwrite each other'
  );
  assert.deepEqual(JSON.parse((await get('SELECT body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=1',collection.id))!.body_json).favoriteIds,[second.id]);
  await archiveResource('collection-alice', second.id, second.revision);
  const refs = await resourceReferences('collection-alice', [first.id, second.id, foreign.id]);
  assert.deepEqual(
    refs.map((ref) => ref.id),
    [first.id]
  );
  const latest = await findResource('collection-alice', collection.id);
  await reviseResource('collection-alice', collection.id, latest.revision, latest.title, {
    ...latest.body,
    resourceIds: [first.id],
    favoriteIds: [],
  });
  assert.equal(
    (await findResource('collection-alice', first.id)).body.content,
    'Äpfel',
    'removing a collection reference preserves the original'
  );
  console.log(
    'PASS: personal collection order/favorites/tags, own-resource references, foreign/archived exclusion, original preservation, immutable revision and concurrent-save protection'
  );
} finally {
  await dropTestSchema();
  await closePool();
}
