import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, transaction, closePool } = await import('../src/db/pg.js');
const { createResource, reviseResource, findResource, BODY_SCHEMAS, listResources } =
  await import('../src/services/assistant/resources.js');
const { reviewTaskResults, assertTaskResults, taskResultCandidates } =
  await import('../src/services/assistant/taskResults.js');
const { executeTaskCommand } = await import('../src/services/assistant/tasks.js');
const { acquireAssistantExecutor } = await import('../src/services/assistant/executor.js');
if (!(await databaseReachable())) throw new Error('Own test database unavailable');
try {
  await createTestSchema();
  for (const user of ['output-alice', 'output-bob'])
    await run(
      'INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,?,?)',
      user,
      `${user}@fixture.invalid`,
      'test',
      user
    );
  const task = await createResource(
    'output-alice',
    'task',
    'Prüfung',
    BODY_SCHEMAS.task.parse({
      goal: 'Skript und Bericht liefern',
      deliverables: ['Skript', 'Bericht'],
    })
  );
  const pending = await reviseResource('output-alice', task.id, 1, task.title, {
    ...task.body,
    status: 'waiting_input',
    result: 'Alles fertig (noch keine Dateien)',
  });
  await acquireAssistantExecutor();
  await assert.rejects(
    () =>
      executeTaskCommand('output-alice', task.id, {
        commandId: randomUUID(),
        expectedRevision: pending.revision,
        action: 'complete',
      }),
    /Artefakte.*geprüft/
  );
  assert.equal((await findResource('output-alice', task.id)).revision, pending.revision);
  const script = await createResource(
    'output-alice',
    'artifact',
    'Analyse.py',
    BODY_SCHEMAS.artifact.parse({
      type: 'code',
      format: 'text',
      content: 'print(55)',
      taskId: task.id,
    })
  );
  const report = await createResource(
    'output-alice',
    'artifact',
    'Bericht',
    BODY_SCHEMAS.artifact.parse({ type: 'document', content: 'Summe: 55', taskId: task.id })
  );
  const other = await createResource(
    'output-alice',
    'artifact',
    'Unzugeordnet',
    BODY_SCHEMAS.artifact.parse({ content: 'Andere Aufgabe' })
  );
  assert.equal((await taskResultCandidates('output-alice', task.id)).length, 2);
  await assert.rejects(taskResultCandidates('output-bob', task.id));
  const input = {
    commandId: randomUUID(),
    expectedRevision: pending.revision,
    items: [
      { index: 0, artifactId: script.id, revision: 1 },
      { index: 1, artifactId: report.id, revision: 1 },
    ],
  };
  await assert.rejects(
    reviewTaskResults('output-alice', task.id, {
      ...input,
      commandId: randomUUID(),
      items: [input.items[0]!],
    }),
    /Jedes gewünschte/
  );
  await assert.rejects(
    reviewTaskResults('output-alice', task.id, {
      ...input,
      commandId: randomUUID(),
      items: [input.items[0]!, input.items[0]!],
    }),
    /Jedes gewünschte/
  );
  await assert.rejects(
    reviewTaskResults('output-alice', task.id, {
      ...input,
      commandId: randomUUID(),
      items: [input.items[0]!, { index: 1, artifactId: other.id, revision: 1 }],
    }),
    /gehört nicht/
  );
  await assert.rejects(reviewTaskResults('output-bob', task.id, input));
  await reviseResource('output-alice', report.id, 1, report.title, {
    ...report.body,
    content: 'Später geändert',
  });
  const [review, duplicate] = await Promise.all([
    reviewTaskResults('output-alice', task.id, input),
    reviewTaskResults('output-alice', task.id, input),
  ]);
  assert.deepEqual(review, duplicate);
  assert.equal(
    review.body.deliverableReviews[1].revision,
    1,
    'review pins the deliberately chosen old result'
  );
  await assert.rejects(
    reviewTaskResults('output-alice', task.id, { ...input, items: [...input.items].reverse() }),
    /anderen Inhalt/
  );
  const completed = await executeTaskCommand('output-alice', task.id, {
    commandId: randomUUID(),
    expectedRevision: review.revision,
    action: 'complete',
  });
  assert.equal(completed.status, 'accepted');
  const done = await findResource('output-alice', task.id);
  assert.equal(done.body.status, 'completed');
  const rerun = await reviseResource('output-alice', task.id, done.revision, done.title, {
    ...done.body,
    status: 'queued',
  });
  assert.equal(rerun.body.deliverableReviews, undefined);
  await assert.rejects(
    transaction((tx) => assertTaskResults(tx, 'output-alice', task.id, rerun.body)),
    /Artefakte.*geprüft/
  );
  await run('UPDATE assistant_resources SET archived=1 WHERE id=?', task.id);
  assert.deepEqual(await reviewTaskResults('output-alice', task.id, input), review);
  const boardTasks = [];
  for (const [title, priority, dueAt] of [
    ['board-important', 90, '2027-01-01T00:00:00Z'],
    ['board-urgent', 10, '2000-01-01T00:00:00Z'],
    ['board-unscheduled', 0, undefined],
  ] as const)
    boardTasks.push(
      await createResource(
        'output-alice',
        'task',
        title,
        BODY_SCHEMAS.task.parse({ goal: title, priority, dueAt })
      )
    );
  const running = await createResource(
    'output-alice',
    'task',
    'board-running',
    BODY_SCHEMAS.task.parse({ goal: 'Running fixture', priority: 100 })
  );
  await reviseResource('output-alice', running.id, 1, running.title, {
    ...running.body,
    status: 'running',
  });
  await createResource(
    'output-bob',
    'task',
    'board-foreign',
    BODY_SCHEMAS.task.parse({ goal: 'Foreign fixture', priority: 100 })
  );
  assert.deepEqual(
    (
      await listResources('output-alice', 'task', {
        search: 'board-',
        status: 'draft',
        sort: 'priority',
      })
    ).map((t) => t.id),
    boardTasks.map((t) => t.id)
  );
  assert.equal(
    (
      await listResources('output-alice', 'task', {
        search: 'board-',
        status: 'draft',
        sort: 'priority',
        offset: 1,
        limit: 1,
      })
    )[0]!.id,
    boardTasks[1]!.id
  );
  assert.deepEqual(
    (
      await listResources('output-alice', 'task', {
        search: 'board-',
        status: 'draft',
        sort: 'deadline',
      })
    ).map((t) => t.id),
    [boardTasks[1]!.id, boardTasks[0]!.id, boardTasks[2]!.id]
  );
  assert.deepEqual(
    (await listResources('output-alice', 'task', { search: 'board-', status: 'running' })).map(
      (t) => t.id
    ),
    [running.id]
  );
  console.log(
    'PASS: server-side whole-result Task status/priority/deadline filters, null deadlines last, offset/limit and foreign-owner isolation'
  );
  console.log(
    'PASS: result text cannot complete missing outputs, required mapping/count/duplicates/owner/task lineage, chosen immutable result revision, concurrent/lost-ack review, actual completion without provider start, retry invalidation and archived receipt'
  );
} finally {
  await dropTestSchema();
  await closePool();
}
