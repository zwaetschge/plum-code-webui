import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-chat-media-'));
const dataDirectory = path.join(root, 'data');
const workspace = path.join(root, 'workspace');
const outside = path.join(root, 'outside');
await Promise.all([
  fs.mkdir(dataDirectory, { recursive: true }),
  fs.mkdir(workspace, { recursive: true }),
  fs.mkdir(outside, { recursive: true }),
]);

process.env.NODE_ENV = 'test';
process.env.WEBUI_DATA_DIR = dataDirectory;
process.env.WEBUI_SUPPRESS_BOOTSTRAP_CREDENTIAL_LOG = '1';
process.env.SESSION_SECRET = 'chat-media-session-secret-000000000000000000';
process.env.JWT_SECRET = 'chat-media-jwt-secret-000000000000000000000';
process.env.ENCRYPTION_KEY = 'chat-media-encryption-key-0000000000000000';

const { useTestSchema, createTestSchema, dropTestSchema } = await import('../src/db/testing.js');
useTestSchema();
const {
  MAX_CHAT_MEDIA_BYTES,
  chatMediaStorageDirectory,
  detectChatMediaMime,
  loadMessageMedia,
  persistMessageMedia,
  resolveOwnedChatMedia,
} = await import('../src/services/chatMedia.js');

await createTestSchema();
const { all: pgAll, get: pgGet, run: pgRun } = await import('../src/db/pg.js');

function pngBytes(label = 'one'): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label),
  ]);
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
const gif = Buffer.from('GIF89aimage', 'ascii');
const webp = Buffer.concat([Buffer.from('RIFF0000WEBP', 'ascii'), Buffer.from('image')]);

assert.equal(detectChatMediaMime(pngBytes()), 'image/png');
assert.equal(detectChatMediaMime(jpeg), 'image/jpeg');
assert.equal(detectChatMediaMime(gif), 'image/gif');
assert.equal(detectChatMediaMime(webp), 'image/webp');
assert.equal(detectChatMediaMime(Buffer.from('<svg><script/></svg>')), null);

// The block that used to stand here migrated `message_media.source` in place,
// re-creating the table to widen a CHECK constraint. That migration ran once on
// every existing SQLite database and its result is part of the Postgres
// baseline, so there is nothing left for it to do and nothing to assert.
// What it was guarding — that a widened constraint does not drop existing rows —
// is now the schema's problem rather than a step's.

await pgRun(`
  INSERT INTO users (id, email, name, provider, provider_id, role, status)
  VALUES
    ('user-a', 'a@example.test', 'A', 'test', 'a', 'admin', 'active'),
    ('user-b', 'b@example.test', 'B', 'test', 'b', 'user', 'active');
  INSERT INTO sessions (id, user_id, name, working_directory, cli_provider)
  VALUES
    ('session-a', 'user-a', 'A', '${workspace.replaceAll("'", "''")}', 'codex'),
    ('session-b', 'user-b', 'B', '${workspace.replaceAll("'", "''")}', 'codex');
  INSERT INTO messages (id, session_id, role, content)
  VALUES
    ('message-a1', 'session-a', 'assistant', 'first'),
    ('message-a2', 'session-a', 'assistant', 'second'),
    ('message-a3', 'session-a', 'user', 'files'),
    ('message-b1', 'session-b', 'assistant', 'foreign');
`);

try {
  const first = await persistMessageMedia({
    messageId: 'message-a1',
    sessionId: 'session-a',
    userId: 'user-a',
    media: [
      {
        kind: 'buffer',
        buffer: pngBytes(),
        filename: '../../qr-code.svg',
        mimeType: 'image/png',
        altText: '  Tuya\nQR code  ',
        source: 'provider',
        sourceId: 'provider-turn-1-image-1',
      },
      {
        kind: 'buffer',
        buffer: pngBytes(),
        filename: 'duplicate.png',
        source: 'provider',
      },
    ],
  });
  assert.equal(first.length, 1, 'the same image must appear once within a message');
  assert.deepEqual(first[0], {
    id: first[0]?.id,
    filename: 'qr-code.png',
    mimeType: 'image/png',
    byteSize: pngBytes().length,
    altText: 'Tuya QR code',
    source: 'provider',
  });
  assert.doesNotMatch(JSON.stringify(first), /storage|workspace|chat-media|filePath/);

  const second = await persistMessageMedia({
    messageId: 'message-a2',
    sessionId: 'session-a',
    userId: 'user-a',
    media: [
      {
        kind: 'buffer',
        buffer: pngBytes(),
        filename: 'same-content.png',
        source: 'comfyui',
      },
    ],
  });
  assert.equal(second.length, 1);

  const storedRows = (await pgAll(
    `SELECT message_id AS messageId, storage_key AS storageKey, sha256
       FROM message_media ORDER BY message_id`
  )) as Array<{ messageId: string; storageKey: string; sha256: string }>;
  assert.equal(storedRows.length, 2);
  assert.equal(
    storedRows[0]?.storageKey,
    storedRows[1]?.storageKey,
    'same-user hash dedupe must reuse one physical blob'
  );
  const storedFiles = await fs.readdir(
    path.join(chatMediaStorageDirectory(), (await fs.readdir(chatMediaStorageDirectory()))[0]!)
  );
  assert.equal(storedFiles.filter((name) => !name.startsWith('.')).length, 1);

  const grouped = await loadMessageMedia(['message-a1', 'message-a2']);
  assert.equal(grouped.get('message-a1')?.length, 1);
  assert.equal(grouped.get('message-a2')?.length, 1);
  assert.equal(grouped.get('message-a1')?.[0]?.altText, 'Tuya QR code');

  const owned = await resolveOwnedChatMedia({
    mediaId: first[0]!.id,
    sessionId: 'session-a',
    userId: 'user-a',
  });
  assert.ok(owned);
  assert.equal((await fs.readFile(owned.filePath)).equals(pngBytes()), true);
  assert.equal(
    await resolveOwnedChatMedia({
      mediaId: first[0]!.id,
      sessionId: 'session-a',
      userId: 'user-b',
    }),
    null,
    'foreign users must not resolve media'
  );
  assert.equal(
    await resolveOwnedChatMedia({
      mediaId: first[0]!.id,
      sessionId: 'session-b',
      userId: 'user-a',
    }),
    null,
    'media ids cannot be rebound to another session'
  );

  const workspaceFile = path.join(workspace, 'workspace-image.png');
  await fs.writeFile(workspaceFile, pngBytes('workspace'));
  const workspaceMedia = await persistMessageMedia({
    messageId: 'message-a2',
    sessionId: 'session-a',
    userId: 'user-a',
    media: [
      {
        kind: 'file',
        filePath: workspaceFile,
        allowedRoots: [workspace],
        source: 'workspace',
        sourceId: 'workspace-image-1',
      },
    ],
  });
  assert.equal(workspaceMedia[0]?.source, 'workspace');

  const userUploads = await persistMessageMedia({
    messageId: 'message-a3',
    sessionId: 'session-a',
    userId: 'user-a',
    media: [
      {
        kind: 'buffer',
        buffer: pngBytes('user-image'),
        filename: 'phone screenshot.png',
        mimeType: 'image/png',
        source: 'user',
        sourceId: 'upload:message-a3:file:0',
      },
      {
        kind: 'buffer',
        buffer: Buffer.from('%PDF-1.7\nfixture'),
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        source: 'user',
        sourceId: 'upload:message-a3:file:1',
      },
      {
        kind: 'buffer',
        buffer: Buffer.from('hello attachment'),
        filename: 'notes.txt',
        mimeType: 'text/plain',
        source: 'user',
        sourceId: 'upload:message-a3:inline:0',
      },
    ],
  });
  assert.equal(userUploads.length, 3);
  assert.deepEqual(
    userUploads.map(({ filename, mimeType, source }) => ({ filename, mimeType, source })),
    [
      { filename: 'phone screenshot.png', mimeType: 'image/png', source: 'user' },
      { filename: 'report.pdf', mimeType: 'application/pdf', source: 'user' },
      { filename: 'notes.txt', mimeType: 'text/plain', source: 'user' },
    ]
  );
  assert.doesNotMatch(JSON.stringify(userUploads), /storageKey|filePath|workspace|chat-media/);

  const outsideFile = path.join(outside, 'outside.png');
  const escapingSymlink = path.join(workspace, 'escape.png');
  await fs.writeFile(outsideFile, pngBytes('outside'));
  await fs.symlink(outsideFile, escapingSymlink);
  await assert.rejects(
    persistMessageMedia({
      messageId: 'message-a2',
      sessionId: 'session-a',
      userId: 'user-a',
      media: [
        {
          kind: 'file',
          filePath: escapingSymlink,
          allowedRoots: [workspace],
          source: 'workspace',
        },
      ],
    }),
    /outside allowed roots/
  );

  const oversized = Buffer.alloc(MAX_CHAT_MEDIA_BYTES + 1);
  pngBytes().copy(oversized, 0, 0, 8);
  await assert.rejects(
    persistMessageMedia({
      messageId: 'message-a2',
      sessionId: 'session-a',
      userId: 'user-a',
      media: [{ kind: 'buffer', buffer: oversized, source: 'provider' }],
    }),
    /exceeds 25 MB/
  );
  await assert.rejects(
    persistMessageMedia({
      messageId: 'message-a2',
      sessionId: 'session-a',
      userId: 'user-a',
      media: [
        {
          kind: 'buffer',
          buffer: jpeg,
          mimeType: 'image/png',
          source: 'provider',
        },
      ],
    }),
    /type mismatch/
  );
  await assert.rejects(
    persistMessageMedia({
      messageId: 'message-a2',
      sessionId: 'session-a',
      userId: 'user-b',
      media: [{ kind: 'buffer', buffer: pngBytes('wrong-owner'), source: 'provider' }],
    }),
    /does not belong/
  );

  // The trigger, not the route: a direct writer must not be able to bind media
  // to a session and user the message does not belong to.
  await assert.rejects(
    () =>
      pgRun(
        `INSERT INTO message_media (
           id, message_id, session_id, user_id, storage_key, filename,
           mime_type, byte_size, sha256, source
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'invalid-owner',
        'message-a1',
        'session-b',
        'user-b',
        '00000000-0000-4000-8000-000000000000.png',
        'bad.png',
        'image/png',
        1,
        '0'.repeat(64),
        'provider'
      ),
    /ownership mismatch/
  );

  const sessionsRouter = (await import('../src/routes/sessions.js')).default;
  type RouterLayer = {
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (...args: unknown[]) => unknown }>;
    };
  };
  const layers = (sessionsRouter as unknown as { stack: RouterLayer[] }).stack;
  const mediaRoute = layers.find(
    (layer) => layer.route?.path === '/:id/media/:mediaId' && layer.route.methods.get
  )?.route;
  assert.ok(mediaRoute, 'missing durable chat media route');
  assert.equal(mediaRoute.stack[0]?.handle.name, 'requireAuth');

  // Called directly rather than through the router, so the rejection has to be
  // caught here: Express 5 forwards it to the error middleware, but only when it
  // is the one doing the calling. `next` is still honoured, so both paths are
  // accepted.
  const foreignRouteError = await new Promise<{ statusCode?: number; code?: string }>(
    (resolve, reject) => {
      const handler = mediaRoute.stack.at(-1)!.handle;
      const result = handler(
        {
          params: { id: 'session-a', mediaId: first[0]!.id },
          userId: 'user-b',
        },
        {},
        resolve
      );
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).then(() => undefined, resolve).catch(reject);
      }
    }
  );
  assert.equal(foreignRouteError.statusCode, 404);
  assert.equal(foreignRouteError.code, 'NOT_FOUND');

  const messagesRoute = layers.find(
    (layer) => layer.route?.path === '/:id/messages' && layer.route.methods.get
  )?.route;
  assert.ok(messagesRoute, 'missing messages route');
  let messagesResponse: unknown;
  // The handler is async now, so its json() call lands a microtask later.
  await messagesRoute.stack.at(-1)!.handle(
    { params: { id: 'session-a' }, query: { limit: '500' }, userId: 'user-a' },
    {
      json: (body: unknown) => {
        messagesResponse = body;
      },
    },
    (error: unknown) => {
      throw error;
    }
  );
  const responseRows = (messagesResponse as { data: Array<Record<string, unknown>> }).data;
  const reloaded = responseRows.find((message) => message.id === 'message-a1');
  assert.deepEqual(reloaded?.media, first);
  assert.doesNotMatch(JSON.stringify(reloaded), /storageKey|filePath|chat-media/);
  const reloadedUserMessage = responseRows.find((message) => message.id === 'message-a3');
  assert.deepEqual(reloadedUserMessage?.media, userUploads);
  assert.doesNotMatch(
    JSON.stringify(reloadedUserMessage),
    /storageKey|filePath|workspace|chat-media/
  );

  await pgRun('DELETE FROM messages WHERE id = ?', 'message-a1');
  assert.equal(
    (
      (await pgGet(
        'SELECT COUNT(*) AS count FROM message_media WHERE message_id = ?',
        'message-a1'
      )) as { count: number }
    ).count,
    0,
    'message deletion must cascade to media metadata'
  );

  console.log('chat media regression tests passed');
} finally {
  await dropTestSchema();
  await fs.rm(root, { recursive: true, force: true });
}
