import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/pages/SessionPage.tsx', import.meta.url), 'utf8');
const socketSource = fs.readFileSync(new URL('../src/services/socket.ts', import.meta.url), 'utf8');
const mergeSource = fs.readFileSync(new URL('../src/lib/messageHistory.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /MESSAGE_HISTORY_PAGE_SIZE = 500/,
  'chat history should use a bounded initial page'
);
assert.match(
  source,
  /before: historyPagination\.oldestId,[\s\S]*?chatId: historyChatId \?\? ''/,
  'older history should use the backend cursor instead of refetching the same tail page'
);
assert.match(
  source,
  /firstItemIndex=\{historyFirstItemIndex\}/,
  'prepending history should preserve the visible Virtuoso position'
);
assert.match(
  source,
  /startReached=\{\(\) => void loadOlderMessages\(\)\}/,
  'scrolling to the top should request the next history page'
);
assert.match(
  source,
  /SESSION_DETAIL_FALLBACK_INTERVAL_MS = 15_000/,
  'session detail polling should be a slow recovery path'
);
assert.match(
  source,
  /refetchIntervalInBackground: false/,
  'hidden tabs must not poll expensive runtime telemetry'
);
assert.match(
  source,
  /Refresh failed — showing cached data\./,
  'refresh failures should preserve and label cached content'
);
assert.match(
  source,
  /sessionQueryError instanceof ApiError && sessionQueryError\.status === 404/,
  'only a confirmed 404 should become a not-found state'
);
assert.match(
  source,
  /activateSearchTargetChat\(targetChatId\)[\s\S]*?around: target\.messageId[\s\S]*?chatId: targetChatId \?\? ''/,
  'a search jump must activate the destination chat before loading its history window'
);
assert.match(
  source,
  /chats\/\$\{encodeURIComponent\(targetId\)\}\/activate/,
  'the main and materialized chat ids should share the explicit activation path'
);
assert.match(
  source,
  /mergeMessageHistorySnapshot\(snapshotMessages, liveMessages\)/,
  'REST history must reconcile with socket messages received during the request'
);
assert.match(
  mergeSource,
  /indexById[\s\S]*?indexByClientId[\s\S]*?incoming\.highWatermark < socketHighWatermark/,
  'snapshot reconciliation should use canonical ids, client ids, and the sequence high-watermark'
);
assert.match(
  socketSource,
  /session:reconnect', \{ sessionId, lastTimestamp, lastSequence \}/,
  'reconnects should include the persisted monotone cursor'
);
assert.match(
  socketSource,
  /if \(data\.needsFullResync\)[\s\S]*?plum:session-full-resync[\s\S]*?else \{[\s\S]*?replayBufferedMessages/,
  'a full resync must not advance through a truncated replay before REST succeeds'
);
assert.match(
  socketSource,
  /fullResyncPendingSessions\.add\(data\.sessionId\)[\s\S]*?fullResyncPendingSessions\.has\(sessionId\)[\s\S]*?fullResyncPendingSessions\.delete\(sessionId\)/,
  'live cursors must stay frozen until a verified REST snapshot closes full resync'
);
assert.match(
  socketSource,
  /this\.socket\.on\('session:cursor',[\s\S]{0,700}?updateLastSequence\(data\.sessionId, data\.sequence\)/,
  'a cursor emitted after its live event should commit the applied sequence'
);
assert.match(
  socketSource,
  /replayBufferedMessages\(data\.sessionId, data\.bufferedMessages\)[\s\S]*?updateLastSequence\(data\.sessionId, data\.highWatermark\)/,
  'the complete replay must apply before committing the contiguous server watermark'
);
assert.match(
  source,
  /historyPagination\.hasMoreAfter[\s\S]*?returnToLatestConversation/,
  'an around window must expose a path back to the latest conversation'
);
assert.match(
  source,
  /previousChatId[\s\S]*?loadThenCommit[\s\S]*?catch \(error\)[\s\S]*?restoreId[\s\S]*?messageBelongsToChat\(message, restoredChatId\)/,
  'a failed cross-chat search jump must reactivate and restore the prior conversation'
);
assert.match(
  source,
  /chatId: activeHistoryChatId \?\? ''[\s\S]*?chatId: historyChatId \?\? ''[\s\S]*?chatId: targetChatId \?\? ''/,
  'initial, paged, and around REST history requests must pin their chat'
);
assert.match(
  socketSource,
  /const payload: SessionSendPayload = \{[\s\S]*?chatId: this\.activeChatBySession\.get\(sessionId\)/,
  'live and persisted sends must carry the composing chat id'
);
assert.doesNotMatch(
  source,
  /setSessionPresence\(id, 'active', latestMessageId\)/,
  'read state must not be written once through presence and again through REST'
);

console.log('Message history regression tests passed.');
