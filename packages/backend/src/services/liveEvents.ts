import { EventEmitter } from 'node:events';

/**
 * In-process signals for clients that stay connected (desktop companion,
 * browser extension): `usage` (userId) once a turn's usage is booked, and
 * `notification` (userId, payload) once a notification row exists. Listeners
 * must not throw; emitters never wait for them.
 */
export const liveEvents = new EventEmitter();
liveEvents.setMaxListeners(20);
