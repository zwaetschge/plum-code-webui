import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { updateSessionChatQuery } from '../src/lib/sessionChatSync.js';
import type {
  BufferedMessage,
  Message,
  ServerToClientEvents,
  Session,
} from '@plum-code-webui/shared';

// Real handlers and Zustand streaming buffer, with no network or credentials.
const callbacks = new Map<number, () => void>();
let nextTimer = 0;
const storage = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
};
const windowStub = Object.assign(new EventTarget(), {
  localStorage,
  setTimeout: (callback: () => void) => {
    callbacks.set(++nextTimer, callback);
    return nextTimer;
  },
  clearTimeout: (id: number) => {
    callbacks.delete(id);
  },
});
Object.assign(globalThis, {
  window: windowStub,
  document: Object.assign(new EventTarget(), { visibilityState: 'hidden' }),
  localStorage,
  requestAnimationFrame: windowStub.setTimeout,
  cancelAnimationFrame: windowStub.clearTimeout,
});
function flush() {
  while (callbacks.size) {
    const batch = [...callbacks];
    callbacks.clear();
    for (const [, callback] of batch) callback();
  }
}

const { socketService } = await import('../src/services/socket.js');
const { useSessionStore } = await import('../src/stores/sessionStore.js');
const handlers = new Map<string, (...args: any[]) => void>();
const sent: Array<{ event: string; data: any }> = [];
const fakeSocket = {
  connected: true,
  on: (event: string, callback: (...args: any[]) => void) => {
    handlers.set(event, callback);
  },
  emit: (event: string, data: any) => {
    sent.push({ event, data });
  },
};
// Register connect's production handlers without creating a Socket.IO transport.
const internals = socketService as unknown as {
  socket: typeof fakeSocket;
  registerHandlers(): void;
};
internals.socket = fakeSocket;
internals.registerHandlers();
function receive<E extends keyof ServerToClientEvents>(
  event: E,
  data: Parameters<ServerToClientEvents[E]>[0]
) {
  const handler = handlers.get(event);
  assert.ok(handler, `missing ${event} handler`);
  handler(data);
}
const sessionId = 'sync-regression';
const row = (id: string, chatId: string | null, eventSequence = 1): Message => ({
  id,
  sessionId,
  chatId,
  role: 'assistant',
  content: id,
  eventSequence,
  createdAt: '2026-09-06T12:00:00.000Z',
});
const output = (content: string, chatId: string | null = null) => ({
  sessionId,
  chatId,
  content,
  isComplete: false,
});
const replayOutput = (
  content: string,
  sequence: number,
  chatId: string | null = null
): BufferedMessage => ({
  type: 'output',
  data: output(content, chatId),
  timestamp: 1000 + sequence,
  sequence,
});
const store = useSessionStore.getState();
store.setSessions([{ id: sessionId, status: 'idle' } as Session]);
socketService.setSessionChat(sessionId, null);
store.replaceStreamingContent(sessionId, 'prefix already visible');
receive('session:output', output(' queued live suffix'));
const transitions: string[] = [];
const unsubscribe = useSessionStore.subscribe((state, previous) => {
  if (state.streamingContent[sessionId] !== previous.streamingContent[sessionId]) {
    transitions.push(state.streamingContent[sessionId]);
  }
});
receive('session:reconnected', {
  sessionId,
  activeChatId: null,
  isRunning: true,
  bufferedMessages: [replayOutput(' replayed prefix', 1)],
  highWatermark: 1,
  streamingSnapshot: output('complete current response'),
});
assert.deepEqual(transitions, ['complete current response'], 'replace visible text in one commit');
unsubscribe();
flush();
assert.equal(
  useSessionStore.getState().streamingContent[sessionId],
  'complete current response',
  'queued live/replay chunks cannot duplicate the prefix'
);
assert.equal(
  useSessionStore.getState().sessions[0].status,
  'idle',
  'process existence cannot mark idle provider running'
);
assert.notEqual(useSessionStore.getState().thinking[sessionId], true);
receive('session:output', output(' + next delta'));
flush();
assert.equal(
  useSessionStore.getState().streamingContent[sessionId],
  'complete current response + next delta'
);
store.setThinking(sessionId, true);
store.setActivity(sessionId, { type: 'thinking' });
receive('session:reconnected', {
  sessionId,
  activeChatId: null,
  isRunning: true,
  isBusy: false,
  bufferedMessages: [],
  streamingSnapshot: null,
});
flush();
assert.equal(
  useSessionStore.getState().streamingContent[sessionId],
  '',
  'null clears obsolete unfinished content'
);
assert.equal(
  useSessionStore.getState().thinking[sessionId],
  false,
  'authoritative busy=false clears stale thinking'
);
assert.equal(useSessionStore.getState().activity[sessionId].type, 'idle');

store.setMessages(sessionId, [row('old-main-message', null)]);
store.setThinking(sessionId, true);
receive('session:output', output('stale main chunk'));
let observedThread: string | null | undefined;
const chatEvents: string[] = [];
const stopListening = socketService.onChatSync((data) => {
  observedThread = socketService.getSessionChat(data.sessionId);
  chatEvents.push(data.chats?.[0]?.title ?? 'reconnect');
});
receive('session:chats', {
  sessionId,
  activeChatId: 'chat-b',
  chats: [{ id: 'chat-b', title: 'Design', createdAt: null, updatedAt: null }],
});
assert.equal(observedThread, 'chat-b', 'thread filter updates before page listeners');
assert.deepEqual(useSessionStore.getState().messages[sessionId], []);
assert.equal(useSessionStore.getState().thinking[sessionId], false);
receive('session:message', row('wrong-thread', null, 101));
receive('session:output', output('wrong-thread delta'));
receive('session:message', row('right-thread', 'chat-b', 101));
receive('session:output', output('right-thread delta', 'chat-b'));
flush();
assert.deepEqual(
  useSessionStore.getState().messages[sessionId].map((message) => message.id),
  ['right-thread']
);
assert.equal(useSessionStore.getState().streamingContent[sessionId], 'right-thread delta');
assert.equal(
  socketService.getSessionCursor(sessionId),
  1,
  'message 101 cannot skip an unpublished earlier event'
);
receive('session:cursor', { sessionId, sequence: 99, timestamp: 1099 });
assert.equal(socketService.getSessionCursor(sessionId), 99);
receive('session:cursor', { sessionId, sequence: 101, timestamp: 1101 });
assert.equal(socketService.getSessionCursor(sessionId), 101);
receive('session:chats', {
  sessionId,
  activeChatId: 'chat-b',
  chats: [{ id: 'chat-b', title: 'Renamed', createdAt: null, updatedAt: null }],
});
assert.equal(
  useSessionStore.getState().streamingContent[sessionId],
  'right-thread delta',
  'renaming another thread cannot erase current response'
);
assert.deepEqual(chatEvents, ['Design', 'Renamed']);
receive('session:reconnected', {
  sessionId,
  activeChatId: 'main',
  isRunning: true,
  bufferedMessages: [replayOutput('foreign replay', 102, 'chat-b')],
  highWatermark: 101,
  streamingSnapshot: output('main response after offline switch'),
});
flush();
assert.equal(
  socketService.getSessionChat(sessionId),
  null,
  'offline switch to implicit main is restored'
);
assert.equal(
  useSessionStore.getState().streamingContent[sessionId],
  'main response after offline switch'
);
assert.equal(
  socketService.getSessionCursor(sessionId),
  101,
  'replay cannot exceed contiguous watermark'
);
stopListening();

receive('session:reconnected', {
  sessionId,
  activeChatId: null,
  isRunning: true,
  bufferedMessages: [],
  needsFullResync: true,
  streamingSnapshot: output('resync prefix'),
});
receive('session:output', output(' + received during REST'));
socketService.recordSessionSnapshot(sessionId, 150, null, true);
flush();
assert.equal(
  useSessionStore.getState().streamingContent[sessionId],
  'resync prefix + received during REST',
  'REST completion preserves subsequent live deltas'
);
assert.equal(socketService.getSessionCursor(sessionId), 150);

let permissionCursor: number | undefined;
const stopPermissionWatch = useSessionStore.subscribe((state, previous) => {
  if (state.pendingPermissions[sessionId] !== previous.pendingPermissions[sessionId]) {
    permissionCursor = socketService.getSessionCursor(sessionId);
  }
});
receive('session:reconnected', {
  sessionId,
  activeChatId: null,
  isRunning: true,
  highWatermark: 151,
  bufferedMessages: [
    {
      type: 'permission_request',
      timestamp: 1151,
      sequence: 151,
      data: {
        sessionId,
        requestId: 'approval-1',
        toolName: 'Read',
        toolInput: {},
        createdAt: 1151,
      },
    },
  ],
});
assert.equal(useSessionStore.getState().pendingPermissions[sessionId]?.requestId, 'approval-1');
assert.equal(permissionCursor, 150, 'permission is visible before replay cursor advances');
assert.equal(socketService.getSessionCursor(sessionId), 151);
stopPermissionWatch();

fakeSocket.connected = false;
socketService.reconnectToSession(sessionId);
assert.equal(
  sent.filter((packet) => packet.event === 'session:reconnect').length,
  0,
  'offline requests do not queue an obsolete cursor'
);
Object.assign(internals, { flushOutbox: async () => {}, refreshPendingApprovals: async () => {} });
fakeSocket.connected = true;
handlers.get('connect')!();
const requests = sent.filter((packet) => packet.event === 'session:reconnect');
assert.equal(
  requests.length,
  1,
  'transport reconnect restores subscribed sessions without a visibility event'
);
assert.equal(requests[0].data.lastSequence, 151);
flush();
// Actual query-cache race: the older HTTP response resolves after a socket
// switch. Cancellation must keep both the active thread and renamed title.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
const queryKey = ['session-chats', sessionId];
const oldPayload = {
  activeChatId: 'main',
  chats: [{ id: 'main', title: 'Old title', createdAt: null, updatedAt: null }],
};
let finishOldRequest!: (value: typeof oldPayload) => void;
const oldRequest = queryClient
  .fetchQuery({
    queryKey,
    queryFn: () =>
      new Promise<typeof oldPayload>((resolve) => {
        finishOldRequest = resolve;
      }),
  })
  .catch(() => undefined);
const newPayload = {
  sessionId,
  activeChatId: 'chat-b',
  chats: [{ id: 'chat-b', title: 'Newest title', createdAt: null, updatedAt: null }],
};
updateSessionChatQuery(queryClient, newPayload);
finishOldRequest(oldPayload);
await oldRequest;
assert.deepEqual(
  queryClient.getQueryData(queryKey),
  {
    activeChatId: newPayload.activeChatId,
    chats: newPayload.chats,
  },
  'late pre-switch REST response cannot overwrite socket thread/list'
);
updateSessionChatQuery(queryClient, { sessionId, activeChatId: 'main' });
assert.deepEqual(
  queryClient.getQueryData(queryKey),
  {
    activeChatId: 'main',
    chats: newPayload.chats,
  },
  'reconnect changes active id immediately while keeping titles until refreshed'
);
assert.equal(queryClient.getQueryState(queryKey)?.isInvalidated, true);
queryClient.clear();

const legacySession = 'old-client-with-sequence-gap';
storage.set(`plum.chat.cursor.v1:${legacySession}`, '102');
socketService.reconnectToSession(legacySession, 5000);
assert.equal(
  sent.at(-1)?.data.lastSequence,
  undefined,
  'old persisted cursor cannot skip a missing earlier event after upgrade'
);
assert.equal(sent.at(-1)?.data.lastTimestamp, undefined);
socketService.recordSessionSnapshot(legacySession, 99, null, false);
socketService.reconnectToSession(legacySession, 5000);
assert.equal(
  sent.at(-1)?.data.lastSequence,
  undefined,
  'around/older snapshots cannot verify the upgraded protocol'
);
socketService.recordSessionSnapshot(legacySession, 99, null, true);
socketService.reconnectToSession(legacySession, 5000);
assert.equal(
  sent.at(-1)?.data.lastSequence,
  99,
  'successful safe REST99 replaces the legacy unsafe102 instead of taking max'
);
receive('session:message', {
  ...row('previously-missing-100', null, 100),
  sessionId: legacySession,
});
receive('session:cursor', { sessionId: legacySession, sequence: 100, timestamp: 5100 });
assert.equal(useSessionStore.getState().messages[legacySession]?.[0]?.id, 'previously-missing-100');
assert.equal(socketService.getSessionCursor(legacySession), 100);
flush();
console.log('Chat sync regression tests passed.');
