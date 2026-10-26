import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'memory-topic-fixture-encryption-key-00000';
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { run, get } = await import('../src/db/pg.js');
const { createResource, reviseResource, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const { memoryTopics, memoryTopic, forgetMemoryTopic } =
  await import('../src/services/assistant/memoryTopics.js');
const { resourceRevisionDiff } = await import('../src/services/assistant/revisionDiff.js');
if (!(await testing.databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await testing.createTestSchema();
try {
  for (const id of ['topic-owner', 'topic-other'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      id,
      id + '@example.invalid',
      id
    );
  const user = 'topic-owner';
  const project = await createResource(user, 'project', 'Projekt', BODY_SCHEMAS.project.parse({}));
  const fact = async (
    owner: string,
    title: string,
    scope: 'personal' | 'project' | 'agent' = 'personal'
  ) =>
    createResource(
      owner,
      'memory',
      title,
      BODY_SCHEMAS.memory.parse({
        text: title + ' exact text',
        topic: 'Gemeinsames Thema',
        scope,
        ...(scope === 'project'
          ? { projectId: project.id }
          : scope === 'agent'
            ? { agentId: 'agent' }
            : {}),
      })
    );
  const first = await fact(user, 'Erster Fakt');
  const second = await fact(user, 'Zweiter Fakt');
  const projectFact = await fact(user, 'Projektfakt', 'project');
  await fact(user, 'Agentenfakt', 'agent');
  await fact('topic-other', 'Fremder Fakt');
  const topics = await memoryTopics(user);
  assert.equal(topics.topics.length, 3, 'identical topic names retain separate scopes');
  const personal = topics.topics.find((t) => t.scope === 'personal')!;
  assert.equal(personal.count, 2);
  assert.equal(
    (await memoryTopics(user, 'Erster')).topics[0]!.count,
    2,
    'search matches a whole topic, not a misleading partial count'
  );
  const doc = await memoryTopic(user, personal.id);
  assert.deepEqual(new Set(doc.entries.map((e) => e.id)), new Set([first.id, second.id]));
  await assert.rejects(memoryTopic('topic-other', personal.id), /nicht gefunden/);
  const updated = await reviseResource(user, first.id, first.revision, first.title, {
    ...first.body,
    text: 'Korrigiertes Wissen',
    pinned: true,
  });
  const diff = await resourceRevisionDiff(user, 'memory', first.id, 1, updated.revision);
  assert(
    diff.lines.some(
      (line) => line.type === 'removed' && line.text.includes('Erster Fakt exact text')
    )
  );
  assert(
    diff.lines.some((line) => line.type === 'added' && line.text.includes('Korrigiertes Wissen'))
  );
  await assert.rejects(
    resourceRevisionDiff('topic-other', 'memory', first.id, 1, updated.revision),
    /nicht gefunden/
  );
  const live = await memoryTopic(user, personal.id);
  assert(live.entries.some((e) => e.body.text === 'Korrigiertes Wissen'));
  assert.notEqual(live.version, doc.version);
  await assert.rejects(forgetMemoryTopic(user, personal.id, doc.version), /inzwischen geändert/);
  assert.equal((await forgetMemoryTopic(user, personal.id, live.version)).forgotten, 2);
  await assert.rejects(memoryTopic(user, personal.id), /nicht gefunden/);
  assert(
    await get('SELECT id FROM assistant_resources WHERE id=?', projectFact.id),
    'forgetting the personal topic leaves project scope intact'
  );
  assert.equal(
    Number(
      (
        await get(
          'SELECT COUNT(*) AS n FROM assistant_resource_revisions WHERE resource_id IN (?,?)',
          first.id,
          second.id
        )
      ).n
    ),
    0
  );
  console.log(
    'PASS: live topics use original facts; personal/project/agent/owner isolation, whole-topic search counts, edits and immutable diffs, concurrent-change guard, full-topic forgetting and revision purge'
  );
} finally {
  await testing.dropTestSchema();
}
