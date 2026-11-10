import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHAT_DRAFT_PREFIX,
  CHAT_OUTBOX_STORAGE_KEY,
  SESSION_KEY_PREFIXES,
  allSessionKeys,
  clearAllSessionStorage,
  keysForSession,
  outboxWithoutSession,
  removeSessionStorage,
  sessionKeyOwner,
  staleSessionKeys,
  sweepSessionStorage,
  type KeyValueStorage,
} from '../src/lib/sessionStorageKeys.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function memoryStorage(initial: Record<string, string>): KeyValueStorage & {
  snapshot: () => Record<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    snapshot: () => Object.fromEntries([...values].sort(([a], [b]) => a.localeCompare(b))),
  };
}

const draftKey = (userId: string, sessionId: string, chatId: string | null) =>
  `${CHAT_DRAFT_PREFIX}${JSON.stringify([userId, sessionId, chatId])}`;

const outbox = (...sessionIds: string[]) =>
  JSON.stringify(
    sessionIds.map((sessionId, index) => ({
      version: 1,
      clientMessageId: `m${index}`,
      sessionId,
      message: 'hi',
    }))
  );

function fixture() {
  return {
    'sessionMode:alive': 'planning',
    'sessionMode:gone': 'danger',
    'activeFollowupMode:gone': 'steer',
    'plum.chat.cursor.v2:gone': '42',
    'plum.chat.cursor-verified.v2:gone': '1',
    'webpreview_active_file_v1:gone': 'index.html',
    'webpreview_active_file_v1:global': 'index.html',
    'webpreview_active_file_v1:/srv/site': 'index.html',
    [draftKey('me', 'gone', null)]: 'mine',
    [draftKey('me', 'alive', 'c1')]: 'keep',
    [draftKey('other', 'gone', null)]: 'theirs',
    [`${CHAT_DRAFT_PREFIX}not-json`]: 'x',
    theme: 'dark',
    'plum-dui:turn:node': '{}',
    [CHAT_OUTBOX_STORAGE_KEY]: outbox('gone', 'alive'),
  };
}

// The registry must name every per-session key the app actually writes.
{
  const sources = [
    'src/pages/SessionPage.tsx',
    'src/services/socket.ts',
    'src/components/preview/WebPreview.tsx',
    'src/hooks/useChatDraft.ts',
  ]
    .map((file) => readFileSync(join(root, file), 'utf8'))
    .join('\n');
  for (const prefix of SESSION_KEY_PREFIXES) {
    const bare = prefix.replace(/:$/, '');
    assert.ok(sources.includes(bare), `prefix ${prefix} is no longer written anywhere`);
  }
  assert.ok(sources.includes(CHAT_DRAFT_PREFIX), 'draft prefix drifted');
  assert.ok(sources.includes(`'${CHAT_OUTBOX_STORAGE_KEY}'`), 'outbox key drifted');
  for (const match of sources.matchAll(/`([A-Za-z][\w.-]*:)\$\{(?:id|sessionId|session\.id)\}`/g)) {
    assert.ok(
      (SESSION_KEY_PREFIXES as readonly string[]).includes(match[1]!),
      `per-session key ${match[1]} is not registered`
    );
  }
}

// Ownership parsing.
assert.deepEqual(sessionKeyOwner('sessionMode:abc_DEF-1'), { sessionId: 'abc_DEF-1' });
assert.deepEqual(sessionKeyOwner(draftKey('u', 's', null)), { sessionId: 's', userId: 'u' });
assert.equal(sessionKeyOwner('webpreview_active_file_v1:global'), null);
assert.equal(sessionKeyOwner('webpreview_active_file_v1:/srv/site'), null);
assert.equal(sessionKeyOwner(`${CHAT_DRAFT_PREFIX}not-json`), null);
assert.equal(sessionKeyOwner(`${CHAT_DRAFT_PREFIX}["u",""]`), null);
assert.equal(sessionKeyOwner('theme'), null);
assert.equal(sessionKeyOwner('plum-dui:turn:node'), null);

// Key selection.
const keys = Object.keys(fixture());
assert.deepEqual(
  keysForSession(keys, 'gone').sort(),
  [
    'activeFollowupMode:gone',
    'plum.chat.cursor-verified.v2:gone',
    'plum.chat.cursor.v2:gone',
    draftKey('me', 'gone', null),
    draftKey('other', 'gone', null),
    'sessionMode:gone',
    'webpreview_active_file_v1:gone',
  ].sort()
);
assert.equal(allSessionKeys(keys).length, 9);
assert.deepEqual(
  staleSessionKeys(keys, new Set(['alive']), 'me').sort(),
  [
    'activeFollowupMode:gone',
    'plum.chat.cursor-verified.v2:gone',
    'plum.chat.cursor.v2:gone',
    draftKey('me', 'gone', null),
    'sessionMode:gone',
    'webpreview_active_file_v1:gone',
  ].sort(),
  'sweep keeps other accounts’ drafts and non-session keys'
);

// Outbox filtering.
assert.equal(outboxWithoutSession(null, 'gone'), null);
assert.equal(outboxWithoutSession('not json', 'gone'), null);
assert.equal(
  outboxWithoutSession(outbox('alive'), 'gone'),
  null,
  'unchanged outbox is not rewritten'
);
assert.deepEqual(JSON.parse(outboxWithoutSession(outbox('gone', 'alive'), 'gone')!), [
  { version: 1, clientMessageId: 'm1', sessionId: 'alive', message: 'hi' },
]);

// Delete one session.
{
  const storage = memoryStorage(fixture());
  assert.equal(removeSessionStorage(storage, 'gone'), 7);
  const after = storage.snapshot();
  assert.equal(after['sessionMode:alive'], 'planning');
  assert.equal(after[draftKey('me', 'alive', 'c1')], 'keep');
  assert.equal(after['webpreview_active_file_v1:global'], 'index.html');
  assert.equal(after.theme, 'dark');
  assert.ok(!Object.keys(after).some((key) => sessionKeyOwner(key)?.sessionId === 'gone'));
  assert.deepEqual(
    JSON.parse(after[CHAT_OUTBOX_STORAGE_KEY]!).map(
      (entry: { sessionId: string }) => entry.sessionId
    ),
    ['alive']
  );
}

// Sweep after a complete session list.
{
  const storage = memoryStorage(fixture());
  assert.equal(sweepSessionStorage(storage, new Set(['alive']), 'me'), 6);
  const after = storage.snapshot();
  assert.equal(after[draftKey('other', 'gone', null)], 'theirs');
  assert.equal(
    after[CHAT_OUTBOX_STORAGE_KEY],
    outbox('gone', 'alive'),
    'sweep never drops unsent messages'
  );
  assert.equal(after['sessionMode:alive'], 'planning');
}

// Logout.
{
  const storage = memoryStorage(fixture());
  assert.equal(clearAllSessionStorage(storage), 9);
  assert.deepEqual(
    Object.keys(storage.snapshot()).sort(),
    [
      `${CHAT_DRAFT_PREFIX}not-json`,
      'plum-dui:turn:node',
      'theme',
      'webpreview_active_file_v1:/srv/site',
      'webpreview_active_file_v1:global',
    ].sort()
  );
}

console.log('session storage keys tests passed');
