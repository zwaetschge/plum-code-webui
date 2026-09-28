import assert from 'node:assert/strict';
import {
  mergeSubagentRuns,
  reconcileSubagentSnapshot,
  subagentCounts,
  type SubagentRun,
} from '@plum-code-webui/shared';
import { subagentWaitOutcomes } from '../src/utils/subagentStatus.js';

const run = (
  id: string,
  revision = 10,
  lifecycle: SubagentRun['lifecycle'] = 'running'
): SubagentRun => ({
  id,
  agentType: 'worker',
  status: lifecycle === 'running' ? 'started' : 'completed',
  lifecycle,
  startedAt: 5,
  updatedAt: revision,
  revision,
});
const forty = Array.from({ length: 40 }, (_, i) => run(String(i)));
assert.equal(subagentCounts(mergeSubagentRuns([], forty)).active, 40);
assert.equal(subagentCounts(mergeSubagentRuns(forty, [run('2', 20, 'completed')])).active, 39);
assert.equal(
  mergeSubagentRuns([run('a', 20, 'completed')], [run('a', 30)])[0]?.lifecycle,
  'completed'
);
assert.equal(mergeSubagentRuns([run('a', 20)], [run('a', 10)])[0]?.revision, 20);
assert.deepEqual(
  reconcileSubagentSnapshot(
    [run('old'), run('new', 30), { ...run('other'), chatId: 'other' }],
    [],
    20,
    null
  )
    .map((r) => r.id)
    .sort(),
  ['new', 'other']
);
assert.deepEqual(subagentWaitOutcomes({ status: { a: 'running' }, timed_out: true }), {});
assert.deepEqual(
  subagentWaitOutcomes({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ status: { a: { completed: 'done' }, b: 'running' } }),
      },
    ],
  }),
  { a: 'completed' }
);
assert.deepEqual(
  subagentWaitOutcomes({
    status: 'completed',
    agents_states: {
      a: { status: 'running' },
      b: { status: 'errored' },
      c: { status: 'interrupted' },
    },
  }),
  { b: 'failed', c: 'interrupted' }
);

process.env.NODE_ENV = 'test';
const { useTestSchema, createTestSchema, dropTestSchema } = await import('../src/db/testing.js');
useTestSchema();
const { run: sql } = await import('../src/db/pg.js');
const { persistSubagentRun, getSubagentHistory } =
  await import('../src/services/subagentHistory.js');
const { ClaudeProcessManager } = await import('../src/services/claude/ClaudeProcessManager.js');
await createTestSchema();
try {
  await sql(
    `INSERT INTO users (id,email,provider,provider_id) VALUES ('agents-user','agents@test.invalid','test','agents-user')`
  );
  await sql(
    `INSERT INTO sessions (id,user_id,name,working_directory) VALUES ('agents-test','agents-user','agent tests','/tmp')`
  );
  const manager = new ClaudeProcessManager({ to: () => ({ emit: () => {} }) } as never) as any;
  const events: unknown[] = [];
  manager.emitBufferedEvent = (_session: string, _type: string, event: unknown) => {
    events.push(event);
  };
  const proc: any = {
    subagentRuns: new Map(),
    cliProvider: 'zai',
    currentChatId: null,
    currentUsageTurnId: 'turn-1',
    pendingToolResults: new Map(),
    outputBuffer: [],
    emittedTools: new Set(),
  };
  manager.processes.set('agents-test', proc);
  for (let i = 0; i < 40; i++)
    manager.startSubagentRun('agents-test', proc, {
      agentId: String(i),
      agentType: 'worker',
      background: i === 0,
    });
  assert.equal(manager.snapshotSubagentRuns(proc).length, 40);
  manager.completeSubagentRun('agents-test', proc, { agentId: 'unknown' }, { status: 'completed' });
  assert.equal(subagentCounts([...proc.subagentRuns.values()]).active, 40);
  manager.completeActiveSubagents('agents-test', proc);
  assert.equal(
    subagentCounts([...proc.subagentRuns.values()]).active,
    1,
    'background agent survives parent turn'
  );
  assert.equal(
    proc.subagentRuns.get('1').lifecycle,
    'interrupted',
    'turn completion must not imply worker success'
  );
  manager.reportCliSubagent('agents-test', {
    id: 'bridge',
    provider: 'codex',
    model: 'gpt-5.5',
    status: 'started',
    description: 'test',
  });
  assert.equal(proc.subagentRuns.get('cli-bridge').provider, 'codex');
  assert.equal(proc.subagentRuns.get('cli-bridge').chatId, null);
  manager.reportCliSubagent('agents-test', {
    id: 'bridge',
    provider: 'codex',
    status: 'completed',
    result: 'done',
  });
  manager.reportCliSubagent('agents-test', { id: 'bridge', provider: 'codex', status: 'started' });
  assert.equal(proc.subagentRuns.get('cli-bridge').status, 'completed');
  manager.updateSubagentActivity('agents-test', proc, '0', 'Tool: Read', 'Read');
  assert.equal(proc.subagentRuns.get('0').activities[0].toolName, 'Read');
  manager.updateSubagentActivity(
    'agents-test',
    proc,
    '0',
    'Tool: AskUserQuestion',
    'AskUserQuestion'
  );
  assert.equal(proc.subagentRuns.get('0').activity, 'waiting');
  const native = (
    id: string,
    tool: string,
    states: Record<string, unknown>,
    target = 'native-worker'
  ) =>
    manager.translateCodexItem(
      'agents-test',
      {
        item: {
          id,
          type: 'collab_tool_call',
          tool,
          status: 'completed',
          receiver_thread_ids: [target],
          prompt: 'Native task',
          agents_states: states,
        },
      },
      true
    );
  native('spawn', 'spawn_agent', { 'native-worker': { status: 'running' } });
  native('wait', 'wait', { 'native-worker': { status: 'running' } });
  assert.equal(
    manager.findSubagentRun(proc, { externalAgentId: 'native-worker' }).status,
    'started'
  );
  native('wait2', 'wait', { 'native-worker': { status: 'completed', message: 'finished' } });
  const first = manager.findSubagentRun(proc, { externalAgentId: 'native-worker' });
  assert.equal(first.result, 'finished');
  native('follow', 'send_input', { 'native-worker': { status: 'running' } });
  const follow = manager.findSubagentRun(proc, { externalAgentId: 'native-worker' });
  assert.notEqual(first.id, follow.id, 'follow-up creates a new invocation');
  native('close', 'close_agent', { 'native-worker': { status: 'shutdown' } });
  assert.equal(manager.findSubagentRun(proc, { agentId: follow.id }).lifecycle, 'cancelled');
  manager.startSubagentRun('agents-test', proc, {
    agentId: 'native-claude',
    toolId: 'task-use',
    agentType: 'review',
    background: true,
  });
  await manager.processStreamMessage('agents-test', {
    type: 'system',
    subtype: 'task_started',
    task_id: 'task-real',
    tool_use_id: 'task-use',
  });
  await manager.processStreamMessage('agents-test', {
    type: 'system',
    subtype: 'task_progress',
    task_id: 'task-real',
    description: 'Reviewing routes',
    last_tool_name: 'Read',
  });
  assert.equal(proc.subagentRuns.get('native-claude').activitySummary, 'Reviewing routes');
  await manager.processStreamMessage('agents-test', {
    type: 'stream_event',
    parent_tool_use_id: 'task-use',
    event: { content_block: { type: 'tool_use', name: 'Grep' } },
  });
  assert.equal(proc.subagentRuns.get('native-claude').activities.at(-1).toolName, 'Grep');
  await manager.processStreamMessage('agents-test', {
    type: 'system',
    subtype: 'task_notification',
    task_id: 'unrelated',
    status: 'completed',
  });
  assert.equal(proc.subagentRuns.get('native-claude').status, 'started');
  await manager.processStreamMessage('agents-test', {
    type: 'system',
    subtype: 'task_notification',
    task_id: 'task-real',
    status: 'completed',
    summary: 'Routes checked',
  });
  assert.equal(proc.subagentRuns.get('native-claude').result, 'Routes checked');
  // Actual Pi extension shape: exitCode=0 can still be a partial running result.
  manager.startSubagentRun('agents-test', proc, {
    agentId: 'pi:0',
    toolId: 'pi',
    agentType: 'review',
  });
  manager.startSubagentRun('agents-test', proc, {
    agentId: 'pi:1',
    toolId: 'pi',
    agentType: 'test',
  });
  manager.applyPiSubagentResults(
    'agents-test',
    proc,
    'pi',
    {
      details: {
        mode: 'parallel',
        results: [
          { exitCode: 0, model: 'glm-5.3', messages: [] },
          { exitCode: -1, messages: [] },
        ],
      },
    },
    false
  );
  assert.equal(proc.subagentRuns.get('pi:0').status, 'started');
  manager.applyPiSubagentResults(
    'agents-test',
    proc,
    'pi',
    {
      details: {
        mode: 'parallel',
        results: [
          { exitCode: 0, messages: [] },
          { exitCode: 1, errorMessage: 'test failed', messages: [] },
        ],
      },
    },
    true
  );
  assert.equal(proc.subagentRuns.get('pi:0').status, 'completed');
  assert.equal(proc.subagentRuns.get('pi:1').status, 'error');
  // Ultracode workflow (scripts/pi-ultracode-extension.ts): agents appear as
  // the tool streams `details.agents`, as children of the workflow card.
  manager.startSubagentRun('agents-test', proc, {
    agentId: 'wf',
    toolId: 'wf',
    agentType: 'workflow',
  });
  const workflowUpdate = (agents: unknown[]) => ({
    details: { kind: 'ultracode', runId: 'wf_test', name: 'smoke', agents },
  });
  manager.applyPiWorkflowAgents(
    'agents-test',
    proc,
    'wf',
    workflowUpdate([
      { id: '1', label: 'review:a', phase: 'Review', status: 'running', activity: 'Tool: read' },
      { id: '2', label: 'review:b', phase: 'Review', status: 'queued' },
    ]),
    false
  );
  assert.equal(proc.subagentRuns.get('wf:wf:1').status, 'started');
  assert.equal(proc.subagentRuns.get('wf:wf:1').parentRunId, 'wf');
  assert.equal(proc.subagentRuns.get('wf:wf:1').description, 'Review · review:a');
  assert.equal(proc.subagentRuns.get('wf:wf:2').lifecycle, 'queued');
  manager.applyPiWorkflowAgents(
    'agents-test',
    proc,
    'wf',
    workflowUpdate([
      { id: '1', label: 'review:a', status: 'completed', output: 'ok' },
      { id: '2', label: 'review:b', status: 'failed', error: 'schema: $.x is required' },
      { id: '3', label: 'verify', status: 'running' },
    ]),
    true
  );
  assert.equal(proc.subagentRuns.get('wf:wf:1').status, 'completed');
  assert.equal(proc.subagentRuns.get('wf:wf:2').status, 'error');
  assert.equal(
    proc.subagentRuns.get('wf:wf:3').status,
    'error',
    'a finished workflow leaves no agent running'
  );
  assert.equal(proc.subagentRuns.get('wf').status, 'completed');
  manager.trackKimiSubagent(
    'agents-test',
    proc,
    'kimi',
    'Launching coder agent: review',
    { prompt: 'review', subagent_type: 'coder' },
    'in_progress'
  );
  manager.trackKimiSubagent(
    'agents-test',
    proc,
    'kimi',
    'Launching coder agent: review',
    { prompt: 'review' },
    'completed',
    'done'
  );
  assert.equal(proc.subagentRuns.get('kimi').result, 'done');
  const { useSessionStore } = await import('../../frontend/src/stores/sessionStore.js');
  useSessionStore.getState().recordAgentEvent('ui', {
    agentId: 'first',
    agentType: 'worker',
    externalAgentId: 'same-worker',
    status: 'completed',
    revision: 5,
    provider: 'zai',
    model: 'glm-5.3',
    chatId: 'thread',
  });
  useSessionStore.getState().recordAgentEvent('ui', {
    agentId: 'followup',
    agentType: 'worker',
    externalAgentId: 'same-worker',
    status: 'started',
    revision: 6,
    provider: 'codex',
    chatId: 'thread',
  });
  assert.equal(
    useSessionStore.getState().agentRuns.ui?.length,
    2,
    'new invocation retains independent identity'
  );
  assert.equal(
    useSessionStore.getState().agentRuns.ui?.find((r) => r.id === 'first')?.model,
    'glm-5.3'
  );
  useSessionStore.getState().recordAgentEvent('ui', {
    agentId: 'first',
    agentType: 'worker',
    status: 'started',
    revision: 4,
  });
  assert.equal(
    useSessionStore.getState().agentRuns.ui?.find((r) => r.id === 'first')?.status,
    'completed'
  );
  for (let i = 0; i < 75; i++)
    persistSubagentRun('agents-test', {
      ...run(`saved-${i}`, 100 + i, 'completed'),
      chatId: 'history',
    });
  const page1 = await getSubagentHistory('agents-test', 'history', () => []);
  const page2 = await getSubagentHistory('agents-test', 'history', () => [], 50);
  assert.equal(page1.runs.length, 50);
  assert.equal(page1.hasMore, true);
  assert.equal(page2.runs.length, 25);
  assert.equal(page1.totals.completed, 75);
  assert.equal(page2.totals.completed, 75);
  assert.equal(new Set([...page1.runs, ...page2.runs].map((r) => r.id)).size, 75);
  const fresh = await getSubagentHistory('agents-test', null, () => [
    ...proc.subagentRuns.values(),
  ]);
  assert.equal(fresh.runs.find((r) => r.id === '0')?.status, 'started');
  const restarted = await getSubagentHistory('agents-test', null, () => []);
  assert.equal(restarted.runs.find((r) => r.id === '0')?.lifecycle, 'interrupted');
  assert.equal(
    restarted.runs.some((r) => r.id.startsWith('saved-')),
    false,
    'chat scopes stay separate'
  );
  assert.deepEqual((await getSubagentHistory('other-session', null, () => [])).runs, []);
  assert.ok(events.length > 40);
  console.log(
    'PASS: 40 parallel, explicit IDs, background, wait timeout, mixed provider, follow-up, activity, replay, persistence, totals, pagination and chat isolation'
  );
} finally {
  await dropTestSchema();
}

// The imported browser store owns a housekeeping interval. This test process is done.
process.exit(0);
