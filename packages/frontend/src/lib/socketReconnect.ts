/**
 * When the web client has to reconnect its socket by hand.
 *
 * socket.io retries a lost connection on its own. It does not retry after the
 * server ended the socket ("io server disconnect") or refused the handshake:
 * the socket then stays down until someone calls `connect()`. A Plum restart
 * used to end every socket that way, and the open chat showed the restart
 * notice and nothing after it while the resumed run kept working.
 */

export const MANUAL_RECONNECT_MAX_DELAY_MS = 15_000;

/** How often a refused login is asked again before the page leaves it alone. */
export const LOGIN_REFUSAL_RETRIES = 5;

/** 1 s, 2 s, 4 s, 8 s, then every 15 s. */
export function manualReconnectDelay(attempt: number): number {
  const step = Number.isFinite(attempt) ? Math.min(Math.max(Math.trunc(attempt), 0), 10) : 0;
  return Math.min(1000 * 2 ** step, MANUAL_RECONNECT_MAX_DELAY_MS);
}

/** The handshake answers that question the login itself. */
export function isLoginRefusal(message: string): boolean {
  return /Invalid token|Authentication required|Account unavailable/i.test(message);
}

/**
 * A lost socket the page must bring back itself: socket.io has stopped trying
 * (`active` is false) and it was not this page that closed it.
 */
export function needsManualReconnect(state: { active: boolean; reason?: string }): boolean {
  return !state.active && state.reason !== 'io client disconnect';
}
