import assert from 'node:assert/strict';
import os from 'node:os';
import { createTestSchema, dropTestSchema, useTestSchema } from '../src/db/testing.js';
import { buildContinuationHandoff, CONTEXT_CONTINUATION_PROMPT } from '../src/utils/contextHandoff.js';

useTestSchema();
const { run, get } = await import('../src/db/pg.js');
const { ClaudeProcessManager, isClaudeContextLimitAssistantReply, isClaudeContextLimitErrorText } =
  await import('../src/services/claude/ClaudeProcessManager.js');

for (const rejection of ['Prompt is too long', 'API Error: Prompt is too long']) {
  assert.equal(isClaudeContextLimitErrorText(rejection), true);
  assert.equal(isClaudeContextLimitAssistantReply(rejection), true);
}
assert.equal(isClaudeContextLimitAssistantReply('API Error: The model has reached its context window limit.'), true);
assert.equal(isClaudeContextLimitAssistantReply('API Error: 500 Internal Server Error'), false);
assert.equal(isClaudeContextLimitAssistantReply('The previous run said "Prompt is too long"; I fixed it.'), false);

// Old progress must never push the latest steering off the end of the handoff.
for (const maxChars of [2000, 60000]) {
  const text = buildContinuationHandoff({
    original: 'Build the video dashboard.',
    users: ['Build the video dashboard.', 'Use the small screen for chat.', 'weiter'],
    recent: [{ role: 'assistant', content: 'Old progress '.repeat(10000) + '\nLatest milestone: layout complete; verify playback next.' }],
    maxChars,
  })!;
  assert(text.length <= maxChars);
  assert.match(text, /Build the video dashboard/);
  assert.match(text, /Use the small screen for chat/);
  assert.match(text, /layout complete; verify playback next/);
  assert.match(text, /Completed work stays completed/);
}
assert.equal(buildContinuationHandoff({ original: null, users: [], recent: [], maxChars: 2000 }), null);

await createTestSchema();
try {
  await run("INSERT INTO users(id,email,name,provider,provider_id,role) VALUES('owner','fixture@local','Fixture','cli','fixture','admin')");
  let nextId = 0;
  const events: Array<{ name: string; data: any }> = [];
  const io = { to: () => ({ emit: (name: string, data: any) => events.push({ name, data }) }) };
  async function fixture() {
    const id = `context-${++nextId}`;
    await run("INSERT INTO sessions(id,user_id,name,working_directory,cli_provider,claude_session_id) VALUES(?,'owner','GLM compact','/tmp','zai','oversized-native')", id);
    const manager = new ClaudeProcessManager(io as never, () => 1) as any;
    const proc: any = {
      userId: 'owner', cliProvider: 'zai', workingDirectory: os.tmpdir(), currentChatId: null,
      claudeSessionId: 'oversized-native', streamingText: '', pendingChatMedia: [],
      process: { kill() { proc.killed = true; return true; }, stdin: { end() {} } },
    };
    manager.processes.set(id, proc);
    manager.emitCompact = async (_id: string, data: any) => events.push({ name: 'compact', data });
    manager.emitUsage = async () => {};
    manager.emitStatus = () => {};
    manager.completeActiveSubagents = () => {};
    manager.discardQueuedTurns = () => {};
    manager.buildContextSummary = async () => 'Saved original request; latest steering; completed work; next step.';
    return { id, manager, proc };
  }

  // The database query must retain the original request beyond the recent window.
  {
    const { id, manager } = await fixture();
    await run("INSERT INTO messages(id,session_id,role,content) VALUES(? ,?,'user','Original dashboard request')", id + '-original', id);
    await run("INSERT INTO messages(id,session_id,role,content) SELECT ? || '-' || n,?,'assistant',repeat('earlier progress ',100) FROM generate_series(1,90) n", id, id);
    await run("INSERT INTO messages(id,session_id,role,content) VALUES(?,?,'user','Latest steering: use one window'),(?,?,'assistant','Latest work: layout finished; test playback next')", id + '-steering', id, id + '-latest', id);
    const summary = await (ClaudeProcessManager.prototype as any).buildContextSummary.call(manager, id, 80, 2000, null);
    assert.match(summary, /Original dashboard request/);
    assert.match(summary, /Latest steering: use one window/);
    assert.match(summary, /layout finished; test playback next/);
  }

  // Bare API rejection must enter recovery rather than persist a bogus reply.
  {
    const { id, manager } = await fixture();
    const recovered: string[] = [];
    manager.handleContextLimit = async (_id: string, _proc: unknown, text: string) => recovered.push(text);
    for (const text of ['Prompt is too long', 'API Error: Prompt is too long']) await manager.saveAssistantMessage(id, text);
    assert.equal(recovered.length, 2);
  }

  // Save before terminating, resume exactly once, and keep synthetic prompts out of chat.
  {
    const { id, manager, proc } = await fixture();
    let starts = 0, sends = 0;
    manager.startSession = async () => { starts++; };
    manager.sendMessage = async (sid: string, user: string, prompt: string, _attachments: unknown, options: any) => {
      sends++;
      assert.equal(sid, id); assert.equal(user, 'owner'); assert.equal(prompt, CONTEXT_CONTINUATION_PROMPT);
      assert.equal(options.recordMessage, false); assert.equal(options.updateLastMessage, false);
    };
    await manager.handleContextLimit(id, proc, 'Prompt is too long');
    const saved = await get('SELECT context_handoff_json,claude_session_id FROM sessions WHERE id=?', id);
    assert.equal(saved?.claude_session_id, null);
    assert.equal(JSON.parse(String(saved?.context_handoff_json)).attempts, 1);
    assert.equal(JSON.parse(String(saved?.context_handoff_json)).summary.includes('latest steering'), true);
    assert.equal(proc.killed, true);
    await manager.cleanupProcess(id, proc);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(starts, 1); assert.equal(sends, 1);
    assert.equal(manager.contextContinuations.has(id), false);
    await manager.resumeAfterContextLimit(id);
    assert.equal(starts, 1);
    // A fresh manager sees the checkpoint even after all process memory is gone.
    assert.equal(JSON.parse(String((await get('SELECT context_handoff_json FROM sessions WHERE id=?', id))?.context_handoff_json)).provider, 'zai');
  }

  // Three failures may auto-resume; the fourth must retain the handoff and stop.
  {
    const { id, manager, proc } = await fixture();
    await run('UPDATE sessions SET context_handoff_json=? WHERE id=?', JSON.stringify({ attempts: 3 }), id);
    await manager.handleContextLimit(id, proc, 'Prompt is too long');
    assert.equal(manager.contextContinuations.has(id), false);
    assert.equal(JSON.parse(String((await get('SELECT context_handoff_json FROM sessions WHERE id=?', id))?.context_handoff_json)).attempts, 4);
  }

  // Stop during the gap between exit and restart cancels the pending send.
  for (const command of ['interrupt', 'stopSession']) {
    const { id, manager, proc } = await fixture();
    await manager.handleContextLimit(id, proc, 'Prompt is too long');
    manager.processes.delete(id);
    await manager[command](id, 'owner');
    manager.startSession = async () => { throw new Error('must not restart after stop'); };
    await manager.resumeAfterContextLimit(id);
    assert.equal(manager.contextContinuations.has(id), false);
  }

  // An explicit fresh restart must not revive the previous automatic turn.
  {
    const { id, manager, proc } = await fixture();
    await manager.handleContextLimit(id, proc, 'Prompt is too long');
    let starts = 0;
    manager.startSession = async () => { starts++; };
    await manager.restartSession(id, 'owner');
    await manager.resumeAfterContextLimit(id);
    assert.equal(starts, 1);
    assert.equal(manager.contextContinuations.has(id), false);
  }

  // A newer user message (or stop) arriving while startup awaits must win.
  for (const command of ['interrupt', 'stopSession', 'new-message']) {
    const { id, manager, proc } = await fixture();
    await manager.handleContextLimit(id, proc, 'Prompt is too long');
    manager.processes.delete(id);
    let started!: () => void, release!: () => void;
    const starting = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    manager.startSession = async () => { started(); await gate; };
    let sends = 0;
    manager.sendMessage = async () => { sends++; };
    const resume = manager.resumeAfterContextLimit(id);
    await starting;
    if (command === 'new-message') manager.contextContinuations.delete(id);
    else await manager[command](id, 'owner');
    release(); await resume;
    assert.equal(sends, 0, command);
  }

  // Another user must not cancel the owner's queued recovery.
  {
    const { id, manager, proc } = await fixture();
    await manager.handleContextLimit(id, proc, 'Prompt is too long');
    await assert.rejects(manager.interrupt(id, 'someone-else'), /Unauthorized/);
    await assert.rejects(manager.stopSession(id, 'someone-else'), /Unauthorized/);
    await assert.rejects(manager.sendMessage(id, 'someone-else', 'hello'), /Unauthorized/);
    assert.equal(manager.contextContinuations.has(id), true);
  }

  // Stop during handoff construction must not resurrect the interrupted turn.
  {
    const { id, manager, proc } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    manager.buildContextSummary = async () => { await gate; return 'handoff'; };
    const recovery = manager.handleContextLimit(id, proc, 'Prompt is too long');
    await manager.interrupt(id, 'owner');
    release(); await recovery;
    assert.equal(manager.contextContinuations.has(id), false);
  }

  // Ignore trailing dying-child output so it cannot clear the saved handoff.
  {
    const { id, manager, proc } = await fixture();
    await manager.handleContextLimit(id, proc, 'Prompt is too long');
    await manager.processStreamMessage(id, { type: 'result', result: 'Prompt is too long' });
    assert.notEqual((await get('SELECT context_handoff_json FROM sessions WHERE id=?', id))?.context_handoff_json, null);
  }

  // Retiring Kimi changes only the runtime choice; messages and usage survive.
  {
    await run("INSERT INTO sessions(id,user_id,name,working_directory,cli_provider,cli_model,claude_session_id) VALUES('legacy-kimi','owner','History','/tmp','kimi','k3','old-kimi-id')");
    await run("INSERT INTO messages(id,session_id,role,content) VALUES('legacy-message','legacy-kimi','user','Keep this conversation')");
    await run("INSERT INTO usage_history(user_id,session_id,turn_id,provider,model,input_tokens) VALUES('owner','legacy-kimi','legacy-turn','kimi','k3',321)");
    const { runPendingMigrations } = await import('../src/db/migrations.js');
    await run("DELETE FROM schema_migrations WHERE id='017-retire-kimi-code'");
    await runPendingMigrations();
    const session = await get('SELECT cli_provider,claude_session_id,status FROM sessions WHERE id=?', 'legacy-kimi');
    assert.equal(session?.cli_provider, 'codex'); assert.equal(session?.claude_session_id, null);
    assert.equal(session?.status, 'stopped');
    assert.equal((await get('SELECT content FROM messages WHERE id=?', 'legacy-message'))?.content, 'Keep this conversation');
    assert.equal((await get('SELECT provider,input_tokens FROM usage_history WHERE turn_id=?', 'legacy-turn'))?.provider, 'kimi');
  }
} finally {
  await dropTestSchema();
}
console.log('Claude/Z.AI context-limit recovery and Kimi retirement regressions passed');
process.exit(0);
