import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'web-search-fixture-session-secret-00000000';
process.env.JWT_SECRET = 'web-search-fixture-jwt-secret-0000000000000';
process.env.ENCRYPTION_KEY = 'web-search-fixture-encryption-key-00000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run } = await import('../src/db/pg.js');
const { safeEncrypt } = await import('../src/utils/encryption.js');
const { writeModelProvidersForUser } = await import('../src/utils/modelProviderKeys.js');
const { chatToolset } = await import('../src/services/assistant/chatTools.js');
const { WebSourceRegistry } = await import('../src/services/assistant/chatWebSources.js');
const { CHAT_OPTIONS, chatOptions } = await import('../src/services/assistant/chatOptions.js');
const { createApiChat, startApiTurn, apiChatTurns, systemContext } =
  await import('../src/services/assistant/apiChats.js');
const { exportChat, importChats } = await import('../src/services/assistant/chatPortability.js');
const { updatePersonalization } = await import('../src/services/assistant/personalization.js');

type Page = { status?: number; html?: string; hang?: boolean };
/** Public pages behind the stubbed resolver; keys are host + path. */
const pages = new Map<string, Page>();
const page = (title: string, body: string): Page => ({
  html: `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${body}</p></article></body></html>`,
});
pages.set('www.alpha.fixture.invalid/a', page('Alpha Artikel', 'Alpha Haupttext. '.repeat(400)));
pages.set('beta.fixture.invalid/b', { status: 500 });
pages.set('gamma.fixture.invalid/c', { hang: true });
pages.set('delta.fixture.invalid/d', page('Delta', 'Delta Text.'));
pages.set('epsilon.fixture.invalid/e', page('Epsilon', 'Epsilon Text.'));
pages.set('zeta.fixture.invalid/f', page('Zeta', 'Zeta Text.'));
pages.set('eta.fixture.invalid/g', page('Eta', 'Eta Text.'));
pages.set('theta.fixture.invalid/h', page('Theta', 'Theta Text.'));
// Over 50000 UTF-16 units once emoji count twice: must not be rejected as unreadable.
pages.set('emoji.fixture.invalid/e', page('Emoji', '🎵 lang '.repeat(9000)));
pages.set('turn.fixture.invalid/1', page('Turn Eins', 'Erster Beleg.'));
pages.set('turn.fixture.invalid/2', page('Turn Zwei', 'Zweiter Beleg.'));
pages.set('turn.fixture.invalid/3', page('Turn Drei', 'Dritter Beleg.'));
pages.set(
  'www.bing.com/search',
  page(
    'Bing',
    '<ol><li class="b_algo"><h2><a href="https://bing-result.fixture.invalid/r">Bing Treffer</a></h2><p>Treffer aus der Ersatzsuche</p></li></ol>'
  )
);
pages.set('bing-result.fixture.invalid/r', page('Bing Treffer', 'Ersatztext.'));
const fetched: string[] = [];
const aborted: string[] = [];
dns.promises.lookup = (async () => [
  { address: '8.8.8.8', family: 4 },
]) as unknown as typeof dns.promises.lookup;
https.request = ((options: RequestOptions, callback: (reply: IncomingMessage) => void) => {
  const host = String((options.headers as Record<string, string>).Host);
  const key = host + String(options.path).split('?')[0];
  fetched.push(key);
  const request = new EventEmitter() as ClientRequest;
  const signal = options.signal as AbortSignal | undefined;
  request.end = (() => {
    const item = pages.get(key) ?? { status: 404 };
    if (item.hang) {
      signal?.addEventListener('abort', () => {
        aborted.push(key);
        request.emit('error', new Error('aborted'));
      });
      return request;
    }
    process.nextTick(() => {
      const response = new PassThrough() as unknown as IncomingMessage;
      response.statusCode = item.status ?? 200;
      response.headers = { 'content-type': 'text/html; charset=utf-8' };
      callback(response);
      (response as unknown as PassThrough).end(Buffer.from(item.html ?? ''));
    });
    return request;
  }) as ClientRequest['end'];
  return request;
}) as unknown as typeof https.request;

/** SearXNG JSON API stub; records the filters it received. */
const searx: Array<URLSearchParams> = [];
const hit = (url: string, title: string, content: string, publishedDate: string | null = null) => ({
  url,
  title,
  content,
  publishedDate,
});
const results: Record<string, unknown[]> = {
  erste: [
    hit(
      'https://www.alpha.fixture.invalid/a',
      'Alpha',
      '<b>Alpha</b> &amp; mehr ' + 'x'.repeat(1000),
      '2026-10-27T08:00:00'
    ),
    hit('https://beta.fixture.invalid/b', 'Beta', 'Beta Auszug'),
    hit('https://gamma.fixture.invalid/c', 'Gamma', 'Gamma Auszug', 'kein Datum'),
    hit('https://delta.fixture.invalid/d', 'Delta', 'Delta Auszug'),
    hit('http://insecure.fixture.invalid/x', 'Unsicher', 'nur http'),
    hit('https://127.0.0.1/admin', 'Privat', 'privat'),
  ],
  zweite: [
    hit('https://epsilon.fixture.invalid/e', 'Epsilon', 'Epsilon Auszug'),
    hit('https://beta.fixture.invalid/b#abschnitt', 'Beta erneut', 'Beta Auszug'),
    hit('https://www.alpha.fixture.invalid/a', 'Alpha erneut', 'Alpha Auszug'),
    hit('https://zeta.fixture.invalid/f', 'Zeta', 'Zeta Auszug'),
  ],
  eng: [hit('https://theta.fixture.invalid/h', 'Theta', 'Theta Auszug')],
  turn: [
    hit('https://turn.fixture.invalid/1', 'Turn Eins', 'Eins'),
    hit('https://turn.fixture.invalid/2', 'Turn Zwei', 'Zwei'),
  ],
  'turn zwei': [
    hit('https://turn.fixture.invalid/2', 'Turn Zwei', 'Zwei'),
    hit('https://turn.fixture.invalid/3', 'Turn Drei', 'Drei'),
  ],
};
const searxServer = http.createServer((req, res) => {
  const params = new URL(String(req.url), 'http://searx.local').searchParams;
  searx.push(params);
  res.setHeader('content-type', 'application/json');
  // "eng" finds nothing with a time range, like news engines that fail on one.
  const empty = params.get('q') === 'eng' && params.has('time_range');
  res.end(JSON.stringify({ results: empty ? [] : (results[params.get('q') ?? ''] ?? []) }));
});
await new Promise<void>((resolve) => searxServer.listen(0, '127.0.0.1', resolve));
const searxUrl = `http://127.0.0.1:${(searxServer.address() as AddressInfo).port}`;
process.env.PLUM_SEARXNG_URL = searxUrl;

/** Model stub: searches twice, fetches once, then answers with a citation. */
const originalFetch = globalThis.fetch;
const modelRequests: Array<Record<string, any>> = [];
let releaseAnswer: () => void = () => {};
const answerGate = new Promise<void>((resolve) => (releaseAnswer = resolve));
const sse = (items: unknown[]) =>
  new Response(
    items
      .map((item) => 'data: ' + (typeof item === 'string' ? item : JSON.stringify(item)) + '\n\n')
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  );
const toolCall = (name: string, args: unknown) =>
  sse([
    {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_' + randomUUID().slice(0, 8),
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    },
    '[DONE]',
  ]);
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === '127.0.0.1') return originalFetch(input, init);
  assert.equal(url.hostname, 'model.fixture.invalid', 'test never accesses the real network');
  const body = JSON.parse(String(init?.body));
  modelRequests.push(body);
  const toolResults = body.messages.filter((m: any) => m.role === 'tool').length;
  const offersWeb = body.tools?.some((t: any) => t.function.name === 'web_search');
  if (offersWeb && toolResults === 0) return toolCall('web_search', { query: 'turn' });
  if (offersWeb && toolResults === 1)
    return toolCall('web_search', { query: 'turn zwei', recency: 'month', topic: 'news' });
  if (offersWeb && toolResults === 2)
    return toolCall('web_fetch', { url: 'https://turn.fixture.invalid/1' });
  if (offersWeb) await answerGate;
  return sse([
    {
      model: body.model,
      choices: [
        {
          index: 0,
          delta: { content: 'Belegt [1](https://turn.fixture.invalid/1).' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    },
    '[DONE]',
  ]);
};

if (!(await databaseReachable())) throw new Error('isolated test database unavailable');
try {
  await createTestSchema();
  for (const name of ['alice', 'bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id,role) VALUES(?,?,'test',?,'user')",
      `web-${name}`,
      `${name}@web.invalid`,
      name
    );
  const now = new Date().toISOString();
  for (const user of ['web-alice', 'web-bob'])
    await writeModelProvidersForUser(user, [
      {
        id: 'openai',
        name: 'openai',
        enabled: true,
        baseUrl: 'https://model.fixture.invalid/v1',
        apiKey: safeEncrypt('fixture-key')!,
        models: ['gpt-5.5'],
        createdAt: now,
        updatedAt: now,
      },
    ]);

  // --- Tool path: refs, filters, auto-read ---------------------------------
  const controller = new AbortController();
  const registry = new WebSourceRegistry();
  const tools = await chatToolset(
    'web-alice',
    CHAT_OPTIONS.parse({ webSearch: true }),
    controller.signal,
    { webSources: registry }
  );
  try {
    const started = Date.now();
    const first = JSON.parse(
      await tools.call('web_search', { query: 'erste', recency: 'week', topic: 'news' })
    );
    const elapsed = Date.now() - started;
    assert.equal(searx.at(-1)?.get('time_range'), 'week');
    assert.equal(searx.at(-1)?.get('categories'), 'news');
    assert.equal(searx.at(-1)?.get('format'), 'json');
    assert.deepEqual(
      first.results.map((r: any) => [r.ref, r.url]),
      [
        [1, 'https://www.alpha.fixture.invalid/a'],
        [2, 'https://beta.fixture.invalid/b'],
        [3, 'https://gamma.fixture.invalid/c'],
        [4, 'https://delta.fixture.invalid/d'],
      ],
      'non-HTTPS and private result links never pass the public-URL boundary'
    );
    assert.equal(first.results[0].domain, 'alpha.fixture.invalid');
    assert.equal(first.results[0].publishedAt, '2026-10-27T08:00:00');
    assert.equal(first.results[2].publishedAt, null);
    assert(!first.results[0].excerpt.includes('<'));
    assert.deepEqual(
      first.pages.map((p: any) => [p.ref, p.url, p.title]),
      [[1, 'https://www.alpha.fixture.invalid/a', 'Alpha Artikel']],
      'failing (HTTP 500) and hanging pages are omitted'
    );
    assert(first.pages[0].text.length <= 4000 && first.pages[0].text.includes('Alpha Haupttext'));
    assert(elapsed < 9000, `auto-read is bounded (took ${elapsed} ms)`);
    assert(aborted.includes('gamma.fixture.invalid/c'), 'the slow page request is cancelled');
    assert(!fetched.includes('delta.fixture.invalid/d'), 'only the top three results are read');
    console.log(
      `PASS: web_search maps recency/topic to SearXNG, numbers up to 8 public results and reads the top 3 in parallel within ${elapsed} ms, omitting failed and slow pages`
    );

    const second = JSON.parse(await tools.call('web_search', { query: 'zweite', recency: 'hour' }));
    assert.equal(searx.at(-1)?.get('time_range'), null, 'unsupported recency searches unfiltered');
    assert.equal(searx.at(-1)?.get('categories'), null);
    assert.deepEqual(
      second.results.map((r: any) => [r.ref, r.url]),
      [
        [5, 'https://epsilon.fixture.invalid/e'],
        [2, 'https://beta.fixture.invalid/b'],
        [1, 'https://www.alpha.fixture.invalid/a'],
        [6, 'https://zeta.fixture.invalid/f'],
      ],
      'a known URL keeps its ref across searches'
    );
    assert.equal(
      fetched.filter((key) => key === 'www.alpha.fixture.invalid/a').length,
      1,
      'pages already read in this turn are not fetched again'
    );
    assert.deepEqual(
      second.pages.map((p: any) => p.ref),
      [5, 6]
    );
    // Beta answers HTTP 500: the fetch fails and the source stays unread.
    await assert.rejects(tools.call('web_fetch', { url: 'https://beta.fixture.invalid/b#teil' }));
    const fetchedRead = JSON.parse(
      await tools.call('web_fetch', { url: 'https://delta.fixture.invalid/d' })
    );
    assert.equal(fetchedRead.ref, 4, 'web_fetch returns the same ref for a searched URL');
    const fetchedNew = JSON.parse(
      await tools.call('web_fetch', { url: 'https://eta.fixture.invalid/g' })
    );
    assert.equal(fetchedNew.ref, 7, 'a new URL gets the next ref');
    assert.equal(fetchedNew.url, 'https://eta.fixture.invalid/g');
    const sources = registry.sources;
    assert.deepEqual(
      sources.map((s) => [s.ref, s.read]),
      [
        [1, true],
        [2, false],
        [3, false],
        [4, true],
        [5, true],
        [6, true],
        [7, true],
      ]
    );
    assert(sources.every((s) => s.excerpt.length <= 300 && !/[<>]/.test(s.excerpt)));
    assert.equal(sources[0]?.excerpt.startsWith('Alpha & mehr'), true);
    assert.equal(sources[6]?.title, 'Eta');
    assert.equal(sources[6]?.excerpt.startsWith('Eta'), true);
    console.log(
      'PASS: turn-wide refs stay stable across two searches and fetches; webSources carry domain, plain ≤300-char excerpt, date and read state'
    );

    const calls = searx.length;
    const relaxed = JSON.parse(
      await tools.call('web_search', { query: 'eng', recency: 'day', topic: 'news' })
    );
    assert.deepEqual(
      searx.slice(calls).map((p) => [p.get('time_range'), p.get('categories')]),
      [
        ['day', 'news'],
        [null, 'news'],
      ],
      'an empty filtered search drops recency first and keeps the topic'
    );
    assert.deepEqual(
      relaxed.results.map((r: any) => r.ref),
      [8]
    );
    assert.match(relaxed.note, /less filtered/);
    assert.equal(first.note, undefined);
    console.log('PASS: empty filtered SearXNG searches relax recency, then topic, and say so');

    searxServer.close();
    await new Promise((r) => setTimeout(r, 50));
    const fallback = JSON.parse(
      await tools.call('web_search', { query: 'ersatz', recency: 'day', topic: 'news' })
    );
    assert.deepEqual(
      fallback.results.map((r: any) => [r.ref, r.url, r.publishedAt]),
      [[9, 'https://bing-result.fixture.invalid/r', null]]
    );
    assert.equal(fallback.pages[0]?.title, 'Bing Treffer');
    console.log('PASS: Bing fallback answers when SearXNG is down and ignores date/topic filters');
    const emoji = JSON.parse(
      await tools.call('web_fetch', { url: 'https://emoji.fixture.invalid/e' })
    );
    assert.equal(emoji.ref, 10);
    assert(emoji.text.startsWith('Emoji') && emoji.text.includes('🎵'));
    console.log('PASS: long pages with emoji stay readable (UTF-16 length no longer rejects them)');
  } finally {
    tools.close();
  }
  await new Promise<void>((resolve) => searxServer.listen(0, '127.0.0.1', resolve));
  process.env.PLUM_SEARXNG_URL = `http://127.0.0.1:${(searxServer.address() as AddressInfo).port}`;

  // --- Default, toggle and personalization ---------------------------------
  assert.equal(CHAT_OPTIONS.parse({}).webSearch, true);
  assert.equal(chatOptions({}).webSearch, true);
  assert.equal(chatOptions({ chatOptions: { webSearch: false } }).webSearch, false);
  assert.equal(chatOptions({ workflow: 'research' }).webSearch, false);
  assert.equal(
    chatOptions({ workflow: 'research', chatOptions: { webSearch: true } }).webSearch,
    true
  );
  const newChat = (user: string, extra = {}) =>
    createApiChat(user, {
      commandId: randomUUID(),
      title: 'Websuche',
      providerId: 'openai',
      model: 'gpt-5.5',
      sourceIds: [],
      ...extra,
    });
  const chat = await newChat('web-alice');
  assert.equal((chat.body.chatOptions as Record<string, unknown>).webSearch, true);
  const off = await newChat('web-alice', { chatOptions: { webSearch: false } });
  assert.equal((off.body.chatOptions as Record<string, unknown>).webSearch, false);
  const offPrompt = (await systemContext('web-alice', off, '')).system;
  assert(!offPrompt.includes('Web search:'));
  const prompt = (await systemContext('web-alice', chat, '')).system;
  assert.match(
    prompt,
    /Current date and time: \w+day, \d{1,2} \w+ 20\d\d, \d\d:\d\d \(.*Europe\/Zurich\)/
  );
  assert(prompt.includes('Use web_search whenever the answer depends on current'));
  assert(prompt.includes('put [n](URL) directly after the sentence it supports'));
  assert(prompt.includes('Do not end with a separate source list'));
  assert(
    prompt.includes(
      'Cite document claims with [title](/api/assistant/sources/ID?revision=REVISION)'
    )
  );
  assert(!prompt.includes('actual returned HTTPS URL'));
  assert(
    prompt.indexOf('Current date and time') > prompt.indexOf('Web search:'),
    'the changing date comes last so the stable prompt prefix stays cacheable'
  );
  assert(
    (await systemContext('web-alice', chat, '', { voice: true })).system.includes(
      'name sources in words'
    )
  );
  await updatePersonalization('web-bob', {
    expectedRevision: 0,
    preferences: { webSearch: false },
  });
  const bobChat = await newChat('web-bob');
  const bobPrompt = (await systemContext('web-bob', bobChat, '')).system;
  assert(bobPrompt.includes('The user turned off automatic web search'));
  assert(!bobPrompt.includes('Use web_search whenever'));
  console.log(
    'PASS: new chats default to web search, explicit off stays off, research stays offline, prompt carries Zurich date/time, search policy and [n](URL) citations; the account preference limits search to explicit requests'
  );

  // --- Turn: live and persisted webSources ----------------------------------
  const started = await startApiTurn('web-alice', chat.id, {
    commandId: randomUUID(),
    expectedRevision: chat.revision,
    prompt: 'Was gibt es Neues?',
  });
  let live: Awaited<ReturnType<typeof apiChatTurns>>['turns'][number] | undefined;
  for (let i = 0; i < 400 && !live; i++) {
    const item = (await apiChatTurns('web-alice', chat.id)).turns.find((t) => t.id === started.id);
    if (item?.status === 'running' && item.webSources?.some((s) => s.read && s.ref === 1))
      live = item;
    else await new Promise((r) => setTimeout(r, 25));
  }
  assert(live, 'webSources reach clients while the turn is still running');
  assert.equal(live.status, 'running');
  releaseAnswer();
  let done: typeof live | undefined;
  for (let i = 0; i < 400; i++) {
    done = (await apiChatTurns('web-alice', chat.id)).turns.find((t) => t.id === started.id);
    if (done && done.status !== 'running' && done.status !== 'queued') break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(done?.status, 'completed', done?.error ?? '');
  assert.equal(done?.response, 'Belegt [1](https://turn.fixture.invalid/1).');
  assert.deepEqual(
    done?.webSources?.map((s) => [s.ref, s.url, s.domain, s.read]),
    [
      [1, 'https://turn.fixture.invalid/1', 'turn.fixture.invalid', true],
      [2, 'https://turn.fixture.invalid/2', 'turn.fixture.invalid', true],
      [3, 'https://turn.fixture.invalid/3', 'turn.fixture.invalid', true],
    ]
  );
  assert.equal(done?.toolEvents?.length, 3);
  const fetchResult = JSON.parse(String(done?.toolEvents?.[2]?.result));
  assert.equal(fetchResult.ref, 1, 'web_fetch reuses the number from the first search');
  assert.equal(searx.at(-1)?.get('time_range'), 'month');
  assert.equal(searx.at(-1)?.get('categories'), 'news');
  const system = String(modelRequests.find((r) => r.tools)?.messages?.[0]?.content ?? '');
  assert(system.includes('Current date and time') && system.includes('[n](URL)'));
  console.log(
    'PASS: a streamed turn publishes webSources while running and persists them with stable refs (search, search, fetch)'
  );

  const archive = await exportChat('web-alice', chat.id);
  const restored = await importChats(
    'web-alice',
    Buffer.from(
      JSON.stringify({
        ...archive,
        turns: archive.turns.map((t: any) => ({
          ...t,
          workbench: {
            ...t.workbench,
            webSources: [
              ...t.workbench.webSources,
              { ...t.workbench.webSources[0], ref: 9, url: 'javascript:alert(1)' },
              { ref: 'x' },
            ],
          },
        })),
      })
    ),
    'openai',
    'gpt-5.5'
  );
  const imported = (await apiChatTurns('web-alice', restored.chats[0].id)).turns[0];
  assert.deepEqual(
    imported?.webSources?.map((s) => s.ref),
    [1, 2, 3],
    'export/import keeps webSources and drops malformed or non-HTTPS entries'
  );
  console.log('PASS: chat export/import keeps validated webSources');
} finally {
  globalThis.fetch = originalFetch;
  searxServer.close();
  await dropTestSchema();
}
process.exit(0);
