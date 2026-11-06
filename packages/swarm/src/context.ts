import type { FastifyBaseLogger } from 'fastify';
import type { MatrixClient } from './appservice/client.js';

/** Was jeder Baustein braucht: Leitung, Log, und die beiden Identitäten. */
export interface Ctx {
  matrix: MatrixClient;
  log: FastifyBaseLogger;
  /** Der eine Mensch — Befehle und Bedien-Reaktionen zählen nur von ihm (§8.6). */
  owner: string;
  /** `@schwarm:…`, der Absender des Appservice. */
  hub: string;
}
