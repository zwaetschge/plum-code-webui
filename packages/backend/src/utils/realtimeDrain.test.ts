import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { stopServingRealtime } from './realtimeDrain.js';

function instance(port = 0): Promise<{ httpServer: http.Server; io: Server; port: number }> {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  io.of('/realtime');
  return new Promise((resolve) =>
    httpServer.listen(port, '127.0.0.1', () =>
      resolve({ httpServer, io, port: (httpServer.address() as AddressInfo).port })
    )
  );
}

const until = async (condition: () => boolean, ms: number) => {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  return condition();
};

test('a client of the stopped instance finds the next one by itself', async () => {
  const first = await instance();
  const client = connect(`http://127.0.0.1:${first.port}`, {
    transports: ['websocket', 'polling'],
    reconnectionDelay: 50,
    reconnectionDelayMax: 150,
  });
  // A second namespace on a connection of its own, as realtime voice has.
  const voice = connect(`http://127.0.0.1:${first.port}/realtime`, {
    transports: ['websocket'],
    forceNew: true,
    reconnectionDelay: 50,
    reconnectionDelayMax: 150,
  });
  const voiceReasons: string[] = [];
  voice.on('disconnect', (reason) => voiceReasons.push(reason));
  const reasons: string[] = [];
  let connects = 0;
  client.on('connect', () => connects++);
  client.on('disconnect', (reason) => reasons.push(reason));
  try {
    assert.ok(await until(() => connects === 1 && voice.connected, 3000), 'the clients connect');

    // The restart: this instance stops, another one takes the same address.
    const closed = stopServingRealtime(first.httpServer, first.io);
    first.httpServer.closeAllConnections();
    await closed;
    assert.ok(await until(() => reasons.length === 1, 3000), 'the client notices');
    // "io server disconnect" is the one reason a client never retries after.
    assert.notEqual(reasons[0], 'io server disconnect');
    assert.equal(client.active, true, 'the client keeps trying');
    assert.ok(await until(() => voiceReasons.length === 1, 3000), 'the voice socket notices too');
    assert.notEqual(voiceReasons[0], 'io server disconnect');

    const second = await instance(first.port);
    try {
      // Nobody calls connect() here: the page does not either.
      assert.ok(await until(() => connects === 2, 5000), 'the client is back on the next instance');
    } finally {
      client.close();
      voice.close();
      await second.io.close();
    }
  } finally {
    client.close();
    voice.close();
    await first.io.close().catch(() => undefined);
  }
});
