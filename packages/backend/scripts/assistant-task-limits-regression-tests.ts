import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'task-limits-fixture-session-secret';
process.env.JWT_SECRET = 'task-limits-fixture-jwt-secret-00000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, closePool } = await import('../src/db/pg.js');
const { createResource, reviseResource, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const { taskLimits, assertTaskTurnAllowed } =
  await import('../src/services/assistant/taskLimits.js');
if (!(await databaseReachable())) {
  await closePool();
  process.exitCode = 2;
  console.log('NOT RUN: isolated task-limit database tests');
} else
  try {
    await createTestSchema();
    for (const user of ['limit-alice', 'limit-bob'])
      await run(
        "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
        user,
        user + '@example.invalid',
        user
      );
    const [first, second, regular] = [randomUUID(), randomUUID(), randomUUID()];
    for (const [id, surface] of [
      [first, 'task'],
      [second, 'task'],
      [regular, 'code'],
    ])
      await run(
        "INSERT INTO sessions(id,user_id,name,working_directory,surface) VALUES(?,'limit-alice','fixture','/fixture',?)",
        id,
        surface
      );
    const task = await createResource(
      'limit-alice',
      'task',
      'Budget',
      BODY_SCHEMAS.task.parse({ goal: 'Kein realer Modellturn', budgetUsd: 3 })
    );
    let current = await reviseResource('limit-alice', task.id, 1, task.title, {
      ...task.body,
      sessionId: second,
    });
    for (const session of [first, second])
      await run(
        "INSERT INTO assistant_attempts(id,task_id,command_id,status,session_id,started_at) VALUES(?,?,?,'waiting_input',?,?)",
        randomUUID(),
        task.id,
        randomUUID(),
        session,
        new Date().toISOString()
      );
    await assertTaskTurnAllowed(second, 'limit-alice');
    for (const [session, cost, user, model] of [
      [first, 1, 'limit-alice', 'gpt-5.5'],
      [second, 2, 'limit-alice', 'gpt-5.5'],
      [second, 1000, 'limit-bob', 'gpt-5.5'],
    ])
      await run(
        'INSERT INTO usage_history(user_id,session_id,total_tokens,cost_usd,model,provider,turn_id) VALUES(?,?,100,?,?,?,?)',
        user,
        session,
        cost,
        model,
        'codex',
        randomUUID()
      );
    const limits = await taskLimits('limit-alice', task.id);
    assert.equal(limits.knownCostUsd, 3);
    assert.equal(limits.exhausted, true);
    await assert.rejects(() => assertTaskTurnAllowed(second, 'limit-alice'), /Task-Budget/);
    await assert.rejects(() => taskLimits('limit-bob', task.id), /nicht gefunden/);
    await assertTaskTurnAllowed(regular, 'limit-alice');
    // Exercise actual queue drain guards without constructing a process manager or spawning a CLI.
    const { ClaudeProcessManager } = await import('../src/services/claude/ClaudeProcessManager.js');
    for (const [provider, method, field, idle] of [
      ['claude', 'drainClaudeQueuedTurns', 'claudeQueuedTurns', 'claudeIdle'],
      ['codex', 'drainCodexQueuedTurn', 'codexQueuedTurns', 'codexIdle'],
      ['vibe', 'drainAcpQueuedTurns', 'acpQueuedTurns', 'acpIdle'],
      ['opencode', 'drainOpenCodeQueuedTurns', 'opencodeQueuedTurns', 'opencodeIdle'],
    ]) {
      const manager = Object.create(ClaudeProcessManager.prototype) as Record<string, unknown>;
      let dispatched = false;
      const events: unknown[] = [];
      manager.io = {
        to: () => ({ emit: (_name: string, payload: unknown) => events.push(payload) }),
      };
      manager.emitQueueState = () => {};
      manager.notifyDiscordSessionEvent = async () => {};
      for (const name of [
        'dispatchClaudeTurn',
        'dispatchCodexTurn',
        'dispatchAcpTurn',
        'dispatchOpenCodeTurn',
      ])
        manager[name] = () => {
          dispatched = true;
          throw new Error('Fixture must never dispatch a provider');
        };
      const queued = { queueId: randomUUID() },
        proc = { cliProvider: provider, userId: 'limit-alice', [field]: [queued], [idle]: true };
      await (manager[method] as (id: string, proc: unknown) => Promise<void>)(second, proc);
      assert.equal(dispatched, false, provider);
      assert.equal(
        (proc[field] as unknown[])[0],
        queued,
        provider + ' pending contribution must remain visible'
      );
      assert(events.length > 0);
    }
    current = await reviseResource('limit-alice', task.id, current.revision, current.title, {
      ...current.body,
      budgetUsd: 4,
    });
    await assertTaskTurnAllowed(second, 'limit-alice');
    await run(
      'INSERT INTO usage_history(user_id,session_id,total_tokens,cost_usd,model,provider,turn_id) VALUES(?,?,100,900,?,?,?)',
      'limit-alice',
      second,
      'unpriced-fixture',
      'unknown',
      randomUUID()
    );
    assert.equal((await taskLimits('limit-alice', task.id)).knownCostUsd, 3);
    assert.equal((await taskLimits('limit-alice', task.id)).unpricedTurns, 1);
    await assert.rejects(() => assertTaskTurnAllowed(second, 'limit-alice'), /Modellpreise/);
    current = await reviseResource('limit-alice', task.id, current.revision, current.title, {
      ...current.body,
      budgetUsd: undefined,
      dueAt: new Date(Date.now() - 1000).toISOString(),
    });
    await assert.rejects(() => assertTaskTurnAllowed(second, 'limit-alice'), /Task-Frist/);
    const native = await createResource(
      'limit-alice',
      'task',
      'Native',
      BODY_SCHEMAS.task.parse({ goal: 'Native Budget', agentId: 'matrix:brian', budgetUsd: 2 })
    );
    assert.equal((await taskLimits('limit-alice', native.id)).knownCostUsd, null);
    assert.equal((await taskLimits('limit-alice', native.id)).scope, 'native-coordinator');
    console.log(
      'PASS: owner isolation, combined attempt costs, budget/deadline and unknown-price gates, all native provider queue drains retain blocked turns without dispatch; native costs stay labelled by coordinator'
    );
  } finally {
    await dropTestSchema();
    await closePool();
  }
