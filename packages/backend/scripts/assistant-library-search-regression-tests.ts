import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, closePool } = await import('../src/db/pg.js');
const { createResource, BODY_SCHEMAS, archiveResource, reviseResource } =
  await import('../src/services/assistant/resources.js');
const { searchAssistantLibrary } = await import('../src/services/assistant/librarySearch.js');
if (!(await databaseReachable())) {
  await closePool();
  throw new Error('Isolated test database unavailable');
}
try {
  await createTestSchema();
  for (const user of ['search-alice', 'search-bob'])
    await run(
      'INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,?,?)',
      user,
      `${user}@fixture.invalid`,
      'test',
      user
    );
  const source = await createResource(
    'search-alice',
    'source',
    'Originalbericht',
    BODY_SCHEMAS.source.parse({ text: 'Befund: Äpfel und Birnen. Wert 100%_ korrekt.' })
  );
  const rich = await createResource(
    'search-alice',
    'artifact',
    'Formatierter Bericht',
    BODY_SCHEMAS.artifact.parse({
      type: 'document',
      format: 'json',
      content: JSON.stringify({
        type: 'plum-document',
        version: 1,
        blocks: [{ type: 'paragraph', runs: [{ text: 'Birnen exakt', bold: true }] }],
      }),
    })
  );
  await createResource(
    'search-bob',
    'source',
    'Fremde Birnen',
    BODY_SCHEMAS.source.parse({ text: 'Birnen fremd' })
  );
  const gone = await createResource(
    'search-alice',
    'source',
    'Archivierte Birnen',
    BODY_SCHEMAS.source.parse({ text: 'Birnen archiviert' })
  );
  await archiveResource('search-alice', gone.id, gone.revision);
  await createResource(
    'search-alice',
    'connection',
    'Birnen-Verbindung',
    BODY_SCHEMAS.connection.parse({ type: 'mail', description: 'Birnen credential metadata' })
  );
  const api = await createResource(
    'search-alice',
    'api-chat',
    'Eigenes Modellgespräch',
    BODY_SCHEMAS['api-chat'].parse({ providerId: 'fixture', model: 'fixture' })
  );
  const temporary = await createResource(
    'search-alice',
    'api-chat',
    'Temporäre Birnen',
    BODY_SCHEMAS['api-chat'].parse({
      providerId: 'fixture',
      model: 'fixture',
      temporary: true,
      expiresAt: '2099-10-10T10:00:00Z',
    })
  );
  for (const [id, chat] of [
    ['permanent-turn', api],
    ['temporary-turn', temporary],
  ] as const)
    await run(
      "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,created_at,updated_at,expires_at) VALUES(?,?,1,'fixture','Birnen Frage','Birnen Antwort','completed','fixture','{}',?,?,?)",
      id,
      chat.id,
      '2026-10-10T10:00:00Z',
      '2026-10-10T10:00:00Z',
      '2099-10-10T10:00:00Z'
    );
  for (const [id, user, surface, archived] of [
    ['code', 'search-alice', 'code', 0],
    ['chat', 'search-alice', 'chat', 0],
    ['temporary', 'search-alice', 'chat', 0],
    ['archived', 'search-alice', 'code', 1],
    ['foreign', 'search-bob', 'code', 0],
  ] as const) {
    await run(
      "INSERT INTO sessions(id,user_id,name,working_directory,surface,archived) VALUES(?,?,?,'/fixture',?,?)",
      id,
      user,
      `${id} Gespräch`,
      surface,
      archived
    );
    if (id === 'temporary')
      await run(
        'INSERT INTO assistant_session_bindings(session_id,temporary,temporary_expires_at) VALUES(?,1,?)',
        id,
        '2099-10-10T10:00:00Z'
      );
    await run(
      "INSERT INTO messages(id,session_id,role,content) VALUES(?,?,'assistant',?)",
      `${id}-message`,
      id,
      'Birnen und source data'
    );
  }
  await run("INSERT INTO session_chats(id,session_id,title) VALUES('chat-thread','chat','Zweig')");
  await run("UPDATE messages SET chat_id='chat-thread' WHERE id='chat-message'");
  const search = await searchAssistantLibrary('search-alice', { query: 'Birnen' });
  assert.deepEqual(
    new Set(search.hits.map((hit) => hit.id)),
    new Set([source.id, rich.id, 'permanent-turn', 'code-message', 'chat-message'])
  );
  assert.equal(search.hits.find((hit) => hit.id === rich.id)?.excerpt, 'Birnen exakt');
  assert.equal(
    search.hits.find((hit) => hit.id === 'chat-message')?.href,
    '/session/chat?message=chat-message&chat=chat-thread'
  );
  assert.equal(
    search.hits.find((hit) => hit.id === source.id)?.href,
    `/assistant/sources?resource=${source.id}&revision=1`
  );
  assert.equal(
    (await searchAssistantLibrary('search-alice', { query: 'Birnen', category: 'code' })).hits
      .length,
    1
  );
  assert.equal(
    (await searchAssistantLibrary('search-alice', { query: 'Birnen', category: 'chats' })).hits
      .length,
    2
  );
  assert.equal((await searchAssistantLibrary('search-alice', { query: '100%_' })).hits.length, 1);
  assert.equal(
    (await searchAssistantLibrary('search-alice', { query: '100%_ unknown' })).hits.length,
    0
  );
  assert.equal((await searchAssistantLibrary('search-bob', { query: 'Birnen' })).hits.length, 2);
  const current = await reviseResource('search-alice', source.id, 1, source.title, {
    ...source.body,
    text: 'Aktualisierter Bericht ohne Obst',
  });
  assert.equal(current.revision, 2);
  assert(
    !(await searchAssistantLibrary('search-alice', { query: 'Birnen' })).hits.some(
      (hit) => hit.id === source.id
    )
  );
  for (let i = 0; i < 35; i++)
    await createResource(
      'search-alice',
      'artifact',
      `Pagination ${i}`,
      BODY_SCHEMAS.artifact.parse({ content: `Pagingbegriff ${randomUUID()}` })
    );
  const first = await searchAssistantLibrary('search-alice', { query: 'Pagingbegriff' }),
    second = await searchAssistantLibrary('search-alice', { query: 'Pagingbegriff', offset: 30 });
  assert.equal(first.hits.length, 30);
  assert(first.hasMore);
  assert.equal(second.hits.length, 5);
  assert(!second.hasMore);
  assert.equal(new Set([...first.hits, ...second.hits].map((hit) => hit.id)).size, 35);
  for (const query of ['x', 'x'.repeat(201)])
    await assert.rejects(searchAssistantLibrary('search-alice', { query }), /Suchtext/);
  await assert.rejects(
    searchAssistantLibrary('search-alice', { query: 'Birnen', offset: 10001 }),
    /Suchtext/
  );
  console.log(
    'PASS: owned common library/API/CLI search, current source revision, readable formatted text, exact thread/message links, category and literal wildcard filters, bounded pagination; foreign, temporary, archived and connection metadata excluded'
  );
} finally {
  await dropTestSchema();
  await closePool();
}
