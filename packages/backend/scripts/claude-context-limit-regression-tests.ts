import assert from 'node:assert/strict';
import os from 'node:os';
import {
  ClaudeProcessManager,
  isClaudeContextLimitAssistantReply,
  isClaudeContextLimitErrorText,
} from '../src/services/claude/ClaudeProcessManager.js';

// Claude Code returned this exact bare reply in the live unreal session.
for (const rejection of ['Prompt is too long', 'API Error: Prompt is too long']) {
  assert.equal(isClaudeContextLimitErrorText(rejection), true);
  assert.equal(isClaudeContextLimitAssistantReply(rejection), true);
}
assert.equal(
  isClaudeContextLimitAssistantReply('API Error: The model has reached its context window limit.'),
  true
);
assert.equal(isClaudeContextLimitAssistantReply('API Error: 500 Internal Server Error'), false);
assert.equal(
  isClaudeContextLimitAssistantReply('The previous run said "Prompt is too long"; I fixed it.'),
  false
);

const sessionId = 'claude-prompt-too-long-recovery';
const manager = new ClaudeProcessManager(
  {} as ConstructorParameters<typeof ClaudeProcessManager>[0],
  () => 1
);
const managerPrivate = manager as unknown as {
  processes: Map<
    string,
    {
      cliProvider: 'claude';
      workingDirectory: string;
      pendingChatMedia: unknown[];
    }
  >;
  handleContextLimit: (sessionId: string, proc: unknown, errorText: string) => Promise<void>;
  saveAssistantMessage: (sessionId: string, content: string) => Promise<void>;
};
managerPrivate.processes.set(sessionId, {
  cliProvider: 'claude',
  workingDirectory: os.tmpdir(),
  pendingChatMedia: [],
});

const recovered: string[] = [];
managerPrivate.handleContextLimit = async (_sessionId, _proc, errorText) => {
  recovered.push(errorText);
};
for (const rejection of ['Prompt is too long', 'API Error: Prompt is too long']) {
  await managerPrivate.saveAssistantMessage(sessionId, rejection);
}
assert.deepEqual(recovered, ['Prompt is too long', 'API Error: Prompt is too long']);
console.log('Claude context-limit regression passed');
