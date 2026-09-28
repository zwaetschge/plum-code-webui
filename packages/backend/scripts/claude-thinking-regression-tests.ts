import assert from 'node:assert/strict';
import { ClaudeProcessManager } from '../src/services/claude/ClaudeProcessManager.js';

const events: Array<{ name: string; payload: { isThinking?: boolean } }> = [];
const io = {
  to: () => ({
    emit: (name: string, payload: { isThinking?: boolean }) => events.push({ name, payload }),
  }),
};
const manager = new ClaudeProcessManager(io as never);
const proc = {
  isStreaming: false,
  streamingText: '',
  currentActivitySummary: '',
  currentToolName: null,
  currentToolId: null,
  currentToolInput: '',
  subagentRuns: new Map(),
};
const processManager = manager as unknown as {
  processes: Map<string, typeof proc>;
  processStreamMessage: (sessionId: string, message: unknown) => Promise<void>;
};
processManager.processes.set('thinking-test', proc);

await processManager.processStreamMessage('thinking-test', {
  type: 'stream_event',
  event: { type: 'message_start', message: { model: 'claude-opus-5-5' } },
});
await processManager.processStreamMessage('thinking-test', {
  type: 'stream_event',
  event: { type: 'content_block_start', content_block: { type: 'thinking', thinking: '' } },
});
await processManager.processStreamMessage('thinking-test', {
  type: 'stream_event',
  event: {
    type: 'content_block_delta',
    delta: { type: 'thinking_delta', thinking: '', estimated_tokens: 150 },
  },
});

assert.equal(proc.currentActivitySummary, 'Thinking');
assert.equal(proc.isStreaming, false);
assert.equal(events.at(-1)?.name, 'session:thinking');
assert.equal(events.at(-1)?.payload.isThinking, true);
assert.equal(
  events.some(({ name }) => name === 'session:output'),
  false
);

await processManager.processStreamMessage('thinking-test', {
  type: 'stream_event',
  event: { type: 'content_block_start', content_block: { type: 'text', text: '' } },
});
assert.equal(events.at(-1)?.payload.isThinking, true, 'empty text block must not end thinking');

await processManager.processStreamMessage('thinking-test', {
  type: 'stream_event',
  event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ready.' } },
});
assert.equal(proc.streamingText, 'Ready.');
assert.deepEqual(
  events.slice(-2).map(({ name }) => name),
  ['session:output', 'session:thinking']
);
assert.equal(events.at(-1)?.payload.isThinking, false);
console.log('PASS: Claude thinking stays visible until actual response text arrives');
