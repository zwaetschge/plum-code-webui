import { EventEmitter } from 'node:events';

/**
 * In-process signals for clients that stay connected (desktop companion,
 * browser extension): `usage` (userId) once a turn's usage is booked,
 * `notification` (userId, payload) once a notification row exists, and
 * `assistant:ui-result` (userId, UiResultEvent) when a Dynamic UI live widget
 * of a model-chat turn changes (forwarded to the `user:<id>` socket room).
 * Listeners must not throw; emitters never wait for them.
 */
export const liveEvents = new EventEmitter();
liveEvents.setMaxListeners(20);
