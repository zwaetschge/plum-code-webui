import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve('src/routes/sessions.ts'), 'utf8');
const messageRoute = source.match(
  /const messagesQuerySchema[\s\S]*?\/\/ Rewind session to a specific message/
)?.[0];

assert.ok(messageRoute, 'message history route should remain present');
assert.match(
  messageRoute,
  /limit: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(2000\)\.default\(500\)/,
  'history pages should remain bounded'
);
assert.match(
  messageRoute,
  /chat_id IS \?[^]*?INVALID_CURSOR/,
  'a history cursor must belong to the selected chat thread'
);
assert.match(
  messageRoute,
  /ORDER BY seq DESC LIMIT \?/,
  // `seq` is the BIGSERIAL that replaced SQLite's rowid as the insertion-order
  // key; the point of the assertion is unchanged.
  'the endpoint should fetch the newest bounded window efficiently'
);
assert.match(
  messageRoute,
  /hasMore[^]*?oldestId/,
  'the response should expose a backwards-pagination cursor'
);
assert.match(messageRoute, /around: z\.string[^]*?anchorIndex/, 'history supports jump windows');
assert.match(
  messageRoute,
  /after: z\.string[^]*?before, after, around[^]*?seq > \?[^]*?ORDER BY seq ASC LIMIT \?/,
  'history supports a bounded forward cursor that is exclusive with other cursor modes'
);
assert.match(
  messageRoute,
  /chatId: z\.string[^]*?session_chats[^]*?Chat not found in this session/,
  'jump windows can target an owned non-active thread'
);
assert.match(
  messageRoute,
  /snapshot: await getMessageHistorySnapshot[^]*?readState: await getSessionReadState/,
  'rows include an atomic snapshot and read-state contract'
);
assert.match(
  messageRoute,
  /chat_id AS chatId[^]*?hasMoreBefore[^]*?hasMoreAfter[^]*?newestId/,
  'history rows retain their explicit thread id and bidirectional pagination metadata'
);

const searchRoutes = source.match(
  /function buildFtsMatch[\s\S]*?router\.get\('\/messages\/search'[\s\S]*?\n}\);/
)?.[0];
assert.ok(searchRoutes, 'search routes should remain present');
assert.match(
  searchRoutes,
  /match\(\/\[\\p\{L\}\\p\{N\}_\]\+\/gu\)/,
  'FTS input is tokenized safely'
);
assert.match(searchRoutes, /Math\.min\([\s\S]*?100/, 'search result limits are clamped');
assert.match(
  searchRoutes,
  /jump:[\s\S]*?chatId:[\s\S]*?messageId:/,
  'search results expose jump metadata'
);
assert.match(
  searchRoutes,
  // ts_headline replaced FTS5's snippet(); both sides of the fallback stay
  // bounded, which is what keeps a 200k-character message out of a result list.
  /substr\([\s\S]*?ts_headline\([\s\S]*?2000[\s\S]*?substr\(content,[\s\S]*?1600\)/,
  'search returns bounded, match-centred previews rather than full messages'
);

console.log('Message pagination regression tests passed.');
