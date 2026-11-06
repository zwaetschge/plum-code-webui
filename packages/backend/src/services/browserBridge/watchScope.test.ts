/**
 * A watch token is handed to a Wear OS app over Bluetooth and can be read off
 * the watch. It must never let that socket drive a browser or a desktop, nor
 * reach any RPC beyond usage, approvals, sessions and a short chat.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { BrowserBridge, BrowserBridgeError, resolveClientKind } from './bridge.js';
import { handleBridgeRpc, WATCH_RPC_METHODS, type BridgeRpcContext } from './rpc.js';
import type { ResolvedBrowserToken } from './tokens.js';

interface FakeSocket {
  readyState: number;
  sent: Record<string, unknown>[];
  closed: Array<{ code?: number; reason?: string }>;
  send: (raw: string, cb?: (error?: Error) => void) => void;
  close: (code?: number, reason?: string) => void;
}

function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    readyState: WebSocket.OPEN,
    sent: [],
    closed: [],
    send: (raw, cb) => {
      socket.sent.push(JSON.parse(raw));
      cb?.();
    },
    close: (code, reason) => {
      socket.closed.push({ code, reason });
    },
  };
  return socket;
}

type Internals = {
  connections: Map<string, unknown>;
  authenticate: (
    ws: FakeSocket,
    frame: Record<string, unknown>
  ) => Promise<{ client: { kind: string; name: string } } | null>;
  answerRpc: (conn: unknown, id: string, frame: Record<string, unknown>) => Promise<void>;
};

function bridgeWith(scope: ResolvedBrowserToken['scope']) {
  const bridge = new BrowserBridge(async () => ({
    tokenId: `token-${scope}`,
    userId: 'alice',
    name: 'Uhr Pixel Watch',
    scope,
  }));
  return { bridge, internals: bridge as unknown as Internals };
}

function connection(id: string, kind: string, socket = fakeSocket()) {
  const now = new Date();
  return {
    id,
    userId: 'alice',
    tokenId: `token-${id}`,
    tokenName: id,
    ws: socket,
    client: { kind, name: id, version: '', extensionVersion: '', platform: '', label: id },
    paused: false,
    mode: null,
    recording: false,
    tabGroups: false,
    connectedAt: now,
    lastSeenAt: now,
    activeAt: now,
    alive: true,
    pending: new Map(),
    chat: null,
    desktopActivity: null,
  };
}

test('a watch-scope token always connects as a watch', () => {
  for (const requested of ['browser', 'desktop', 'watch', undefined, 'admin']) {
    assert.equal(resolveClientKind('watch', requested), 'watch');
  }
  assert.equal(resolveClientKind('browser', 'desktop'), 'desktop');
  assert.equal(resolveClientKind('browser', 'watch'), 'watch');
  assert.equal(resolveClientKind('browser', undefined), 'browser');
  assert.equal(resolveClientKind('browser', 'admin'), 'browser');
});

test('the hello of a watch token cannot claim to be a desktop or a browser', async () => {
  for (const requested of ['desktop', 'browser']) {
    const { internals } = bridgeWith('watch');
    const socket = fakeSocket();
    const conn = await internals.authenticate(socket, {
      type: 'hello',
      token: 'plum_ff_secret',
      client: { kind: requested, name: '' },
    });
    assert.equal(conn?.client.kind, 'watch');
    assert.equal(conn?.client.name, 'Uhr');
    const welcome = socket.sent.find((frame) => frame.type === 'welcome');
    assert.equal(welcome?.kind, 'watch');
    assert.equal('latestVersion' in (welcome ?? {}), false);
    // No desktop rules or companion update for a watch.
    assert.deepEqual(
      socket.sent.map((frame) => frame.type),
      ['welcome']
    );
  }
});

test('a browser-scope token may announce a watch', async () => {
  const { internals } = bridgeWith('browser');
  const conn = await internals.authenticate(fakeSocket(), {
    type: 'hello',
    token: 'plum_ff_secret',
    client: { kind: 'watch', name: 'Uhr' },
  });
  assert.equal(conn?.client.kind, 'watch');
});

test('a watch is never a tool-call, pause or desktop target but gets account pushes', async () => {
  const { bridge, internals } = bridgeWith('watch');
  const watch = connection('watch1', 'watch');
  internals.connections.set(watch.id, watch);

  await assert.rejects(
    () => bridge.call('alice', { id: 's1', name: 'S' }, 'status', {}),
    (error: unknown) =>
      error instanceof BrowserBridgeError && error.code === 'BROWSER_NOT_CONNECTED'
  );
  await assert.rejects(
    () => bridge.call('alice', { id: 's1', name: 'S' }, 'status', {}, { connectionId: 'watch1' }),
    (error: unknown) =>
      error instanceof BrowserBridgeError && error.code === 'BROWSER_NOT_CONNECTED'
  );
  await assert.rejects(
    () =>
      bridge.call(
        'alice',
        { id: 's1', name: 'S' },
        'desktop_status',
        {},
        { connectionId: 'watch1', kind: 'desktop' }
      ),
    (error: unknown) =>
      error instanceof BrowserBridgeError && error.code === 'DESKTOP_NOT_CONNECTED'
  );
  assert.throws(
    () => bridge.selectBrowser('alice', 's1', 'watch1'),
    (error: unknown) => error instanceof BrowserBridgeError && error.code === 'BROWSER_NOT_FOUND'
  );
  assert.equal(bridge.setPaused('alice', true), 0);
  assert.equal(bridge.sendDesktop('alice', { type: 'update' }), 0);
  assert.equal(bridge.describeForSession('alice', 's1').connections.length, 0);
  assert.equal(watch.ws.sent.length, 0);

  assert.equal(bridge.sendAll('alice', { type: 'usage', rows: [], at: 'now' }), 1);
  assert.deepEqual(watch.ws.sent, [{ type: 'usage', rows: [], at: 'now' }]);
  // The settings list still shows it, so the user can see and unpair it.
  assert.deepEqual(
    bridge.listConnections('alice').map((conn) => conn.client.kind),
    ['watch']
  );
});

test('the bridge passes the connection kind to the RPC allowlist', async () => {
  const { internals } = bridgeWith('watch');
  const watch = connection('watch1', 'watch');
  await internals.answerRpc(watch, 'r1', { type: 'rpc', method: 'session.create', params: {} });
  assert.deepEqual(watch.ws.sent, [
    { type: 'rpcResult', id: 'r1', ok: false, error: 'Not allowed for watch' },
  ]);
});

function context(kind: BridgeRpcContext['kind'], calls: string[]): BridgeRpcContext {
  return {
    userId: 'alice',
    connectionId: 'c1',
    kind,
    pinSession: (id) => calls.push(`pin:${id}`),
    unpinSession: (id) => calls.push(`unpin:${id}`),
    sessionsOnThisBrowser: () => new Set(),
    chat: () =>
      ({
        unwatch: (id: string) => calls.push(`unwatch:${id}`),
        interrupt: (id: string) => calls.push(`interrupt:${id}`),
        send: (input: { sessionId: string; message: string }) => {
          calls.push(`send:${input.sessionId}:${input.message}`);
          return { accepted: true };
        },
      }) as unknown as ReturnType<BridgeRpcContext['chat']>,
  };
}

test('a watch reaches exactly the allowlisted RPC methods', async () => {
  assert.deepEqual([...WATCH_RPC_METHODS].sort(), [
    'approvals.list',
    'chat.close',
    'chat.interrupt',
    'chat.open',
    'chat.send',
    'permission.respond',
    'question.respond',
    'sessions.list',
    'usage.limits',
  ]);
  const calls: string[] = [];
  for (const method of [
    'providers.list',
    'session.setProvider',
    'session.setModel',
    'session.attach',
    'session.detach',
    'session.create',
    'settings.defaults',
    'permission.legacy',
    'transcribe',
    'no.such.method',
  ]) {
    await assert.rejects(
      () => handleBridgeRpc(context('watch', calls), method, { sessionId: 's1', name: 'x' }),
      /Not allowed for watch/,
      method
    );
  }
  assert.deepEqual(calls, []);

  const watch = context('watch', calls);
  assert.deepEqual(await handleBridgeRpc(watch, 'chat.close', { sessionId: 's1' }), { ok: true });
  assert.deepEqual(await handleBridgeRpc(watch, 'chat.interrupt', { sessionId: 's1' }), {
    ok: true,
  });
  assert.deepEqual(
    await handleBridgeRpc(watch, 'chat.send', {
      sessionId: 's1',
      message: 'Weiter',
      clientMessageId: 'm1',
    }),
    { accepted: true }
  );
  assert.deepEqual(calls, ['unwatch:s1', 'interrupt:s1', 'send:s1:Weiter']);
});

test('browsers and desktops keep the full RPC surface', async () => {
  for (const kind of ['browser', 'desktop'] as const) {
    const calls: string[] = [];
    assert.deepEqual(
      await handleBridgeRpc(context(kind, calls), 'session.detach', { sessionId: 's1' }),
      {
        ok: true,
      }
    );
    assert.deepEqual(calls, ['unpin:s1']);
    await assert.rejects(
      () => handleBridgeRpc(context(kind, calls), 'no.such.method', {}),
      /Unknown method no\.such\.method/
    );
  }
});
