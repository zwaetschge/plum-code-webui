import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'tool-assets-fixture-key-00000000000000';
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { run, get } = await import('../src/db/pg.js');
const { createResource, BODY_SCHEMAS, findResource } =
  await import('../src/services/assistant/resources.js');
const { handoffChatToolResult, artifactToolFile } =
  await import('../src/services/assistant/chatToolAssets.js');
const { apiChatImage, apiImagePayloads } = await import('../src/services/assistant/apiFiles.js');
const { purgeTemporaryApiChat } = await import('../src/services/assistant/apiChats.js');
if (!(await testing.databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await testing.createTestSchema();
try {
  const user = 'tool-owner',
    other = 'tool-other';
  for (const id of [user, other])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      id,
      id + '@example.invalid',
      id
    );
  const make = async (temporary = false) => {
    const chat = await createResource(
      user,
      'api-chat',
      'Tool chat',
      BODY_SCHEMAS['api-chat'].parse({
        providerId: 'fixture',
        model: 'fixture',
        temporary,
        ...(temporary ? { expiresAt: new Date(Date.now() + 86400000).toISOString() } : {}),
      })
    );
    const turnId = randomUUID(),
      now = new Date().toISOString();
    await run(
      "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,status,model,profile_json,created_at,updated_at,expires_at) VALUES(?,?,1,'fixture','Make a file','running','fixture','{}',?,?,?)",
      turnId,
      chat.id,
      now,
      now,
      now
    );
    return { chat, turnId };
  };
  const { chat, turnId } = await make();
  const bytes = Buffer.from('column,value\nä,2\n');
  const raw = {
    content: [
      {
        type: 'resource',
        resource: {
          uri: 'mcp://export/result.csv',
          mimeType: 'text/csv',
          blob: bytes.toString('base64'),
        },
      },
      { type: 'resource_link', uri: 'file:///etc/passwd', name: 'Do not follow' },
    ],
  };
  const output = await handoffChatToolResult(user, chat.id, turnId, raw);
  assert.equal(output.files.length, 1);
  const file = output.files[0]!;
  assert(
    !JSON.stringify(output.result).includes(bytes.toString('base64')),
    'model receives metadata, not base64'
  );
  assert.deepEqual((await apiChatImage(user, chat.id, file.id)).bytes, bytes);
  assert.deepEqual((await artifactToolFile(user, file.artifactId!, file.id)).bytes, bytes);
  assert.equal((await findResource(user, file.artifactId!)).body.originResourceId, chat.id);
  await assert.rejects(apiChatImage(other, chat.id, file.id));
  await assert.rejects(artifactToolFile(other, file.artifactId!, file.id));
  await assert.rejects(apiImagePayloads(user, chat.id, [file.id]), /Bildanhänge/);
  const duplicate = await handoffChatToolResult(user, chat.id, turnId, raw);
  assert.equal(duplicate.files[0]?.id, file.id);
  assert.equal(duplicate.files[0]?.artifactId, file.artifactId);
  const temporary = await make(true);
  const ephemeral = await handoffChatToolResult(user, temporary.chat.id, temporary.turnId, raw);
  assert.equal(ephemeral.files[0]?.artifactId, null, 'temporary chats create no permanent result');
  await purgeTemporaryApiChat(user, temporary.chat.id, true);
  assert(
    await get('SELECT id FROM assistant_assets WHERE id=?', file.id),
    'temporary cleanup preserves an original retained by a permanent artifact'
  );
  const onlyTemporary = await make(true);
  const unique = await handoffChatToolResult(user, onlyTemporary.chat.id, onlyTemporary.turnId, {
    content: [
      {
        type: 'resource',
        resource: {
          uri: 'mcp://unique/note.txt',
          text: 'Ephemeral unique text',
          mimeType: 'text/plain',
        },
      },
    ],
  });
  await purgeTemporaryApiChat(user, onlyTemporary.chat.id, true);
  assert(
    !(await get('SELECT id FROM assistant_assets WHERE id=?', unique.files[0]!.id)),
    'unreferenced temporary file is purged'
  );
  await run("UPDATE assistant_api_turns SET status='cancelled' WHERE id=?", turnId);
  await assert.rejects(handoffChatToolResult(user, chat.id, turnId, raw), /nicht mehr aktiv/);
  console.log(
    'PASS embedded MCP file, exact bytes/download/results, owner binding, deduplication, no URI fetch, cancellation and temporary cleanup; no model calls'
  );
} finally {
  await testing.dropTestSchema();
}
