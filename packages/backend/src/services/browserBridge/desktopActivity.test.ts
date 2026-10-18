import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { BrowserBridge, desktopActivitySchema } from './bridge.js';

test('desktop state is bounded, plain data; invalid updates keep last known activity', () => {
  const bridge = new BrowserBridge();
  const internals = bridge as unknown as {
    handleFrame: (conn: Record<string, unknown>, frame: Record<string, unknown>) => void;
  };
  const conn: Record<string, unknown> = { client: { kind: 'desktop' }, desktopActivity: null };
  internals.handleFrame(conn, {
    type: 'state',
    desktopActivity: { sessionId: 'ours', status: 'Arbeitet', chat: 'Öffne Firefox' },
  });
  assert.equal((conn.desktopActivity as { chat: string }).chat, 'Öffne Firefox');
  const saved = conn.desktopActivity;
  internals.handleFrame(conn, {
    type: 'state',
    desktopActivity: { history: Array(13).fill('too much') },
  });
  assert.equal(conn.desktopActivity, saved);
  assert.equal(desktopActivitySchema.safeParse({ chat: 'x'.repeat(4001) }).success, false);
  const readable = desktopActivitySchema.parse({
    layout: {
      chatScreen: 'secondary',
      chatPlacement: 'full',
      chatVisible: true,
      chatZoom: 200,
      chatInsetTop: 80,
    },
  });
  assert.equal(readable.layout?.chatZoom, 200);
  assert.equal(readable.layout?.chatInsetTop, 80);
  assert.equal(
    desktopActivitySchema.safeParse({ layout: { ...readable.layout, chatZoom: 500 } }).success,
    false
  );
  assert.equal(
    desktopActivitySchema.safeParse({
      layout: { chatScreen: 'DP-2', chatPlacement: 'full-desktop', chatVisible: true },
    }).success,
    false
  );
});

test('desktop control and activity are restricted to the owning user and selected connection', () => {
  const bridge = new BrowserBridge();
  const sent: Record<string, unknown>[] = [];
  const now = new Date();
  const make = (id: string, userId: string, kind = 'desktop') => ({
    id,
    userId,
    client: { kind, label: id },
    activeAt: now,
    connectedAt: now,
    lastSeenAt: now,
    ws: {
      readyState: WebSocket.OPEN,
      send: (raw: string) => sent.push({ id, frame: JSON.parse(raw) }),
    },
    desktopActivity: { sessionId: userId },
  });
  const internals = bridge as unknown as { connections: Map<string, unknown> };
  for (const conn of [
    make('a1', 'alice'),
    make('a2', 'alice'),
    make('b1', 'bob'),
    make('browser', 'alice', 'browser'),
  ])
    internals.connections.set(conn.id, conn);
  assert.equal(bridge.sendDesktop('alice', { type: 'control', action: 'stop' }, 'a2'), 1);
  assert.deepEqual(
    sent.map((item) => item.id),
    ['a2']
  );
  assert.equal(bridge.sendDesktop('alice', { type: 'control', action: 'stop' }, 'b1'), 0);
  assert.ok(bridge.listConnections('alice').every((conn) => conn.id !== 'b1'));
});
