import type { Server as HttpServer } from 'http';
import type { Server as SocketServer } from 'socket.io';

/**
 * Ends every live socket in a way its client recovers from on its own.
 *
 * `io.disconnectSockets(true)` sends a DISCONNECT packet first. A socket.io
 * client reads that as "the server does not want me" and stays away until the
 * page calls `connect()` again. After a restart the open chat then showed the
 * restart notice and nothing after it, while the resumed run kept working
 * unseen. Closing only the transport reads as a lost connection, which the
 * client retries until the next instance answers.
 */
export function dropRealtimeClients(io: SocketServer): number {
  // Every namespace (the chat and realtime voice); one connection may carry
  // several sockets, and closing it twice is harmless.
  const connections = new Set(
    [...io._nsps.values()].flatMap((namespace) =>
      [...namespace.sockets.values()].map((socket) => socket.conn)
    )
  );
  for (const connection of connections) connection.close();
  return connections.size;
}

/**
 * Takes this instance off the network for a restart.
 *
 * The listener goes first: a dropped client retries within a second and must
 * find nobody home, not this instance on its way out — it would sync against
 * runs that are being stopped and lose the connection a second time.
 * The returned promise resolves once the last connection is gone; call
 * `closeAllConnections()` on the server before awaiting it to cut the rest.
 */
export function stopServingRealtime(httpServer: HttpServer, io: SocketServer): Promise<void> {
  const closed = new Promise<void>((resolve) => httpServer.close(() => resolve()));
  dropRealtimeClients(io);
  return closed;
}
