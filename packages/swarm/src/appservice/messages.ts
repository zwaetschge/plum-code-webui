/**
 * Event-Inhalte bauen (§8.1). Drei Regeln halten die Leitung sauber:
 *  1. Auftrag = `m.text` mit `m.mentions.user_ids`.
 *  2. Information = `m.notice` ohne Erwähnung — Bots antworten nie darauf.
 *  3. Antworten stehen im Thread; Edits gibt es nur für Karten und Fortschritt.
 */
import { SWARM_OUT_FIELD, SWARM_TASK_FIELD, type TaskCardContent } from '../protocol/index.js';

export interface MessageOptions {
  mentions?: string[];
  /** Event-ID des Thread-Roots. */
  thread?: string | null;
  task?: TaskCardContent;
  /** Wird von der Outbox gesetzt, nicht vom Aufrufer (§10.2). */
  out?: { id: number; txn: string };
}

function relate(thread: string | null): Record<string, unknown> | undefined {
  if (!thread) return undefined;
  return {
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: thread,
      is_falling_back: true,
      'm.in_reply_to': { event_id: thread },
    },
  };
}

export function text(body: string, opts: MessageOptions = {}): Record<string, unknown> {
  const content: Record<string, unknown> = { msgtype: 'm.text', body };
  if (opts.mentions?.length) content['m.mentions'] = { user_ids: opts.mentions };
  const rel = relate(opts.thread ?? null);
  if (rel) Object.assign(content, rel);
  if (opts.task) content[SWARM_TASK_FIELD] = opts.task;
  if (opts.out) content[SWARM_OUT_FIELD] = opts.out;
  return content;
}

export function notice(body: string, opts: MessageOptions = {}): Record<string, unknown> {
  const content: Record<string, unknown> = { msgtype: 'm.notice', body };
  const rel = relate(opts.thread ?? null);
  if (rel) Object.assign(content, rel);
  if (opts.out) content[SWARM_OUT_FIELD] = opts.out;
  return content;
}

export function reaction(
  key: string,
  eventId: string,
  out?: { id: number; txn: string }
): Record<string, unknown> {
  const content: Record<string, unknown> = {
    'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key },
  };
  if (out) content[SWARM_OUT_FIELD] = out;
  return content;
}

/** Edit einer Karte: `m.replace` auf das Ziel-Event (§8.1, Regel 5). */
export function edit(
  targetEventId: string,
  body: string,
  msgtype: 'm.text' | 'm.notice' = 'm.notice'
): Record<string, unknown> {
  return {
    msgtype,
    body: `* ${body}`,
    'm.new_content': { msgtype, body },
    'm.relates_to': { rel_type: 'm.replace', event_id: targetEventId },
  };
}

export function stateEvent(
  content: Record<string, unknown>,
  out?: { id: number; txn: string }
): Record<string, unknown> {
  return out ? { ...content, [SWARM_OUT_FIELD]: out } : content;
}

/**
 * Auslesen, was ein fremdes Event meint. Bewusst streng: `ch.zwaetschge.swarm.*`
 * zählt nur, wenn der Absender der Hub oder eines seiner Puppets ist (§7.2) —
 * Power-Levels schützen Event-Typen, nicht Felder im Inhalt.
 */
export function swarmField(
  content: Record<string, unknown>,
  sender: string,
  trustedSenders: (mxid: string) => boolean
): TaskCardContent | null {
  const raw = content[SWARM_TASK_FIELD];
  if (!raw || typeof raw !== 'object') return null;
  if (!trustedSenders(sender)) return null;
  return raw as TaskCardContent;
}

export function outMarker(content: Record<string, unknown>): { id: number; txn: string } | null {
  const raw = content[SWARM_OUT_FIELD];
  if (!raw || typeof raw !== 'object') return null;
  const { id, txn } = raw as { id?: unknown; txn?: unknown };
  return typeof id === 'number' && typeof txn === 'string' ? { id, txn } : null;
}
