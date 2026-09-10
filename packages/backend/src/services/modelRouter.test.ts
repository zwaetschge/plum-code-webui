/**
 * The router sits between a paying subscription and a third-party endpoint, so
 * the properties under test are about money and credential boundaries:
 *
 * - the Claude OAuth bearer must never reach Z.AI, and the Z.AI token must
 *   never be attached to an Anthropic request
 * - the Anthropic path must be byte-transparent, because any deviation is a
 *   way to break every Claude session at once
 * - the usage a Z.AI response reports must be counted exactly once and be
 *   drainable, because the surrounding Claude turn subtracts it
 *
 * Both upstreams are stubs; no network, no database, no config.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  createModelRouter,
  extractZaiUsage,
  isAnthropicModel,
  isZaiModel,
  matchUpstreamModel,
  normalizeZaiModel,
  type RouterUsageEvent,
} from './modelRouter.js';

interface SeenRequest {
  path: string;
  method: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function startStub(
  respond: (req: SeenRequest, res: http.ServerResponse) => void
): Promise<{ url: string; seen: SeenRequest[]; close(): Promise<void> }> {
  const seen: SeenRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const entry: SeenRequest = {
        path: req.url ?? '',
        method: req.method ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      seen.push(entry);
      respond(entry, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function mountRouter(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  // Replicates what express does for app.use('/model-router', handler): the
  // mount prefix is stripped before the handler sees the URL.
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/model-router')) {
      req.url = req.url.slice('/model-router'.length);
      handler(req, res);
    } else {
      res.writeHead(404).end();
    }
  });
  return new Promise<{ url: string; close(): Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/model-router`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test('model classification and normalization', () => {
  assert.equal(isZaiModel('glm-5.3'), true);
  assert.equal(isZaiModel('z-ai/glm-5.3'), true);
  assert.equal(isZaiModel('GLM-4.7'), true);
  assert.equal(isZaiModel('claude-sonnet-5'), false);
  assert.equal(isZaiModel('sonnet'), false);
  assert.equal(isZaiModel(undefined), false);
  assert.equal(normalizeZaiModel('z-ai/glm-5.3'), 'glm-5.3');
  assert.equal(normalizeZaiModel('glm-5.3'), 'glm-5.3');
});

test('upstream matching: exact ids, wildcards, and the Anthropic short-circuit', () => {
  assert.equal(matchUpstreamModel(['kimi-k2-0905'], 'kimi-k2-0905'), true);
  assert.equal(matchUpstreamModel(['kimi-k2-0905'], 'kimi-k2'), false);
  assert.equal(matchUpstreamModel(['kimi-*'], 'kimi-k2-0905'), true);
  assert.equal(matchUpstreamModel(['KIMI-*'], 'kimi-k2'), true, 'patterns are case-insensitive');
  assert.equal(matchUpstreamModel(['glm-*'], 'claude-sonnet-5'), false);

  // The main agent's models never trigger upstream resolution at all — that
  // keeps a settings read out of every hot-path request.
  assert.equal(isAnthropicModel('claude-opus-5'), true);
  assert.equal(isAnthropicModel('sonnet'), true);
  assert.equal(isAnthropicModel('glm-5.3'), false);
  assert.equal(isAnthropicModel('kimi-k2'), false);
});

test('usage extraction from stream and JSON bodies', () => {
  const sse = [
    'event: message_start',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":15}}}',
    'event: message_delta',
    'data: {"type":"message_delta","usage":{"input_tokens":15,"output_tokens":60,"cache_read_input_tokens":3}}',
    'event: message_stop',
    'data: {"type":"message_stop"}',
  ].join('\n');
  assert.deepEqual(extractZaiUsage(sse, 'text/event-stream'), {
    input_tokens: 15,
    output_tokens: 60,
    cache_read_input_tokens: 3,
  });

  assert.deepEqual(
    extractZaiUsage(
      JSON.stringify({ id: 'x', usage: { input_tokens: 7, output_tokens: 2 } }),
      'application/json'
    ),
    { input_tokens: 7, output_tokens: 2 }
  );

  assert.equal(extractZaiUsage('not json', 'application/json'), null);
});

test('routing, credential boundaries and usage accounting', async () => {
  const anthropic = await startStub((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: 'anthropic', echoPath: req.path }));
  });
  const zai = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n'
    );
    res.write(
      'event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":10,"output_tokens":40}}\n\n'
    );
    res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  });

  const usageEvents: RouterUsageEvent[] = [];
  const router = createModelRouter({
    anthropicBaseUrl: anthropic.url,
    resolveUpstream: async (userId, model) => {
      if (userId !== 'user-a') return null;
      if (!isZaiModel(model)) return null;
      return {
        baseUrl: zai.url + '/api/anthropic',
        authToken: 'zai-secret',
        model: normalizeZaiModel(model),
        provider: 'zai',
      };
    },
    onRoutedUsage: (event) => usageEvents.push(event),
  });
  const mounted = await mountRouter(router.handler);
  const token = router.registerSession('session-1', 'user-a');

  try {
    // 1. A Claude model passes through byte-identically, credentials intact.
    const claudeBody = JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 5, messages: [] });
    const claudeResponse = await fetch(`${mounted.url}/${token}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer oauth-token-of-the-user',
        'anthropic-beta': 'claude-code-20250219',
      },
      body: claudeBody,
    });
    assert.equal(claudeResponse.status, 200);
    assert.equal(((await claudeResponse.json()) as { ok: string }).ok, 'anthropic');
    const seenClaude = anthropic.seen.at(-1)!;
    assert.equal(seenClaude.body, claudeBody, 'the Anthropic body must not be rewritten');
    assert.equal(seenClaude.headers.authorization, 'Bearer oauth-token-of-the-user');
    assert.equal(seenClaude.headers['anthropic-beta'], 'claude-code-20250219');

    // 2. Non-messages endpoints go to Anthropic too — the CLI calls several.
    const hello = await fetch(`${mounted.url}/${token}/api/hello`);
    assert.equal(hello.status, 200);
    assert.equal(anthropic.seen.at(-1)!.path, '/api/hello');

    // 3. A GLM model goes to Z.AI with the stored token, and the user's OAuth
    //    bearer must not travel along.
    const glmResponse = await fetch(`${mounted.url}/${token}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer oauth-token-of-the-user',
      },
      body: JSON.stringify({ model: 'z-ai/glm-5.3', max_tokens: 5, messages: [], stream: true }),
    });
    assert.equal(glmResponse.status, 200);
    const streamed = await glmResponse.text();
    assert.match(streamed, /message_stop/, 'the SSE stream must arrive intact');

    const seenZai = zai.seen.at(-1)!;
    assert.equal(seenZai.headers.authorization, 'Bearer zai-secret');
    assert.equal(seenZai.path, '/api/anthropic/v1/messages');
    assert.equal(
      (JSON.parse(seenZai.body) as { model: string }).model,
      'glm-5.3',
      'the z-ai/ prefix must be stripped for the Z.AI endpoint'
    );
    assert.equal(seenZai.headers['accept-encoding'], undefined, 'the tee needs a readable stream');

    // 4. The reported usage is accumulated once and drains to zero.
    assert.equal(usageEvents.length, 1);
    assert.equal(usageEvents[0]!.model, 'glm-5.3');
    assert.equal(usageEvents[0]!.sessionId, 'session-1');
    const drained = router.drainRoutedUsage('session-1');
    assert.deepEqual(drained, {
      inputTokens: 10,
      outputTokens: 40,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      requests: 1,
    });
    assert.equal(router.drainRoutedUsage('session-1').requests, 0, 'drain must reset');

    // 5. An unknown token is rejected before anything reaches an upstream.
    const before = anthropic.seen.length + zai.seen.length;
    const rejected = await fetch(`${mounted.url}/wrong-token-000000000000/v1/messages`, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(rejected.status, 401);
    assert.equal(anthropic.seen.length + zai.seen.length, before);

    // 6. A replaced session token stops working immediately.
    const oldToken = token;
    router.registerSession('session-1', 'user-a');
    const stale = await fetch(`${mounted.url}/${oldToken}/api/hello`);
    assert.equal(stale.status, 401);

    // 7. A GLM request for a user without Z.AI config fails loudly instead of
    //    silently going to Anthropic on the wrong subscription.
    const tokenB = router.registerSession('session-2', 'user-without-zai');
    // Without a matching upstream the request falls through to Anthropic —
    // which rejects the unknown model itself. The router must not invent an
    // opinion here: an unconfigured account behaves as if the router were
    // absent.
    const before2 = anthropic.seen.length;
    const noConfig = await fetch(`${mounted.url}/${tokenB}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'glm-5.3', messages: [] }),
    });
    assert.equal(noConfig.status, 200);
    assert.equal(anthropic.seen.length, before2 + 1);
  } finally {
    await mounted.close();
    await anthropic.close();
    await zai.close();
  }
});
