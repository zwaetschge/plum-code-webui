import {
  get as pgGet,
  run as pgRun,
  transaction as pgTransaction,
  type TransactionScope,
} from '../db/pg.js';
import type { MessageHistorySnapshot, SessionReadState } from '@plum-code-webui/shared';

interface SessionSyncRow {
  activeChatId: string | null;
  eventSequence: number;
  snapshotRevision: number;
}

const EVENT_SEQUENCE_BLOCK_SIZE = 256;
const sequenceBlocks = new Map<
  string,
  { next: number; end: number; lastIssued: number; initialBase: number }
>();
const sequenceReservations = new Map<string, Promise<void>>();
const pendingSequences = new Map<string, Set<number>>();

function trackPendingSequence(sessionId: string, sequence: number): number {
  const pending = pendingSequences.get(sessionId) ?? new Set<number>();
  pending.add(sequence);
  pendingSequences.set(sessionId, pending);
  return sequence;
}

/** Close a sequence after its live event was emitted, or its write failed. */
export function settleSessionEventSequence(sessionId: string, sequence: number): void {
  const pending = pendingSequences.get(sessionId);
  pending?.delete(sequence);
  if (pending?.size === 0) pendingSequences.delete(sessionId);
}

/**
 * Capture before the first snapshot read. A reserved sequence whose message
 * is still being saved must not let a REST response skip that future event.
 */
export function captureSessionSnapshotWatermark(sessionId: string): number | undefined {
  let watermark = sequenceBlocks.get(sessionId)?.lastIssued;
  if (watermark === undefined) return undefined;
  for (const sequence of pendingSequences.get(sessionId) ?? []) {
    watermark = Math.min(watermark, sequence - 1);
  }
  return watermark;
}

export async function nextSessionEventSequence(sessionId: string): Promise<number> {
  const inFlight = sequenceReservations.get(sessionId);
  if (inFlight) {
    await inFlight;
    return nextSessionEventSequence(sessionId);
  }
  const existing = sequenceBlocks.get(sessionId);
  if (existing && existing.next <= existing.end) {
    const sequence = existing.next++;
    existing.lastIssued = sequence;
    return trackPendingSequence(sessionId, sequence);
  }

  const reservation = pgTransaction(async (tx) => {
    const updated = (await tx.get(
      `UPDATE sessions
            SET event_sequence = event_sequence + ?
          WHERE id = ?
          RETURNING event_sequence AS sequence`,
      EVENT_SEQUENCE_BLOCK_SIZE,
      sessionId
    )) as unknown as { sequence: number } | undefined;
    if (!updated) throw new Error('Session not found');
    const base = updated.sequence - EVENT_SEQUENCE_BLOCK_SIZE;
    // Install before COMMIT makes the reservation visible to other readers.
    // Allocation still waits on sequenceReservations until COMMIT completes.
    sequenceBlocks.set(sessionId, {
      next: base + 1,
      end: updated.sequence,
      lastIssued: base,
      initialBase: existing?.initialBase ?? base,
    });
  }).catch((error) => {
    if (existing) sequenceBlocks.set(sessionId, existing);
    else sequenceBlocks.delete(sessionId);
    throw error;
  });
  sequenceReservations.set(sessionId, reservation);
  try {
    await reservation;
  } finally {
    if (sequenceReservations.get(sessionId) === reservation) sequenceReservations.delete(sessionId);
  }
  return nextSessionEventSequence(sessionId);
}

/**
 * The persisted value is the end of the currently reserved block. While this
 * process is alive, report only the contiguous published sequences. After restart a
 * reserved-but-unused gap is intentionally visible and forces a safe REST
 * resync instead of risking an undetected missing event.
 */
export function getSessionEventHighWatermark(
  sessionId: string,
  persistedHighWatermark: number
): number {
  return captureSessionSnapshotWatermark(sessionId) ?? persistedHighWatermark;
}

export function resetSessionSequenceAllocatorForTests(): void {
  sequenceBlocks.clear();
  sequenceReservations.clear();
  pendingSequences.clear();
}

export async function getSessionSyncState(
  sessionId: string,
  userId?: string,
  query: Pick<TransactionScope, 'get'> = { get: pgGet }
): Promise<{ highWatermark: number; snapshotRevision: number; activeChatId: string | null }> {
  const row = (await query.get(
    `SELECT active_chat_id AS activeChatId,
              event_sequence AS eventSequence,
              snapshot_revision AS snapshotRevision
         FROM sessions
        WHERE id = ?${userId ? ' AND user_id = ?' : ''}`,
    ...(userId ? [sessionId, userId] : [sessionId])
  )) as unknown as SessionSyncRow | undefined;
  if (!row) throw new Error('Session not found');
  return {
    highWatermark: getSessionEventHighWatermark(sessionId, row.eventSequence),
    snapshotRevision: row.snapshotRevision,
    activeChatId: row.activeChatId,
  };
}

/**
 * Resolve a send target once, before any attachment reads or message writes.
 * Explicit targets must belong to the session; legacy callers may omit chatId
 * and inherit the active thread. The process layer separately verifies that a
 * new provider turn is bound to this chat, while durable retries may still
 * retrieve an already-finished ACK after another device switches threads.
 */
export async function resolveSessionSendChatId(
  sessionId: string,
  userId: string,
  requestedChatId?: string | null
): Promise<string | null> {
  const session = (await pgGet(
    `SELECT active_chat_id AS activeChatId FROM sessions WHERE id = ? AND user_id = ?`,
    sessionId,
    userId
  )) as unknown as { activeChatId: string | null } | undefined;
  if (!session) throw new Error('Session not found');

  if (requestedChatId === undefined) return session.activeChatId;
  if (
    requestedChatId !== null &&
    !(await pgGet(
      `SELECT 1 FROM session_chats WHERE id = ? AND session_id = ?`,
      requestedChatId,
      sessionId
    ))
  ) {
    throw new Error('Chat not found in this session');
  }
  return requestedChatId;
}

export async function getMessageHistorySnapshot(
  sessionId: string,
  userId: string,
  chatId?: string | null,
  options: { query?: Pick<TransactionScope, 'get'>; snapshotStartWatermark?: number | null } = {}
): Promise<MessageHistorySnapshot> {
  const query = options.query ?? { get: pgGet };
  const capturedWatermark =
    options.snapshotStartWatermark === null
      ? null
      : (options.snapshotStartWatermark ?? captureSessionSnapshotWatermark(sessionId) ?? null);
  const state = await getSessionSyncState(sessionId, userId, query);
  const effectiveChatId = chatId === undefined ? state.activeChatId : chatId;
  if (
    effectiveChatId !== null &&
    !(await query.get(
      `SELECT 1 FROM session_chats WHERE id = ? AND session_id = ?`,
      effectiveChatId,
      sessionId
    ))
  ) {
    throw new Error('Chat not found');
  }
  const newest = (await query.get(
    `SELECT id
         FROM messages
        WHERE session_id = ? AND chat_id IS ?
        ORDER BY seq DESC
        LIMIT 1`,
    sessionId,
    effectiveChatId
  )) as unknown as { id: string } | undefined;
  return {
    chatId: effectiveChatId,
    revision: state.snapshotRevision,
    highWatermark: Math.min(
      state.highWatermark,
      // No allocator existed when this read began. Exclude any newly started
      // block rather than acknowledging events produced during the snapshot.
      capturedWatermark ?? sequenceBlocks.get(sessionId)?.initialBase ?? state.highWatermark
    ),
    newestMessageId: newest?.id ?? null,
  };
}

export async function getSessionReadState(
  userId: string,
  sessionId: string,
  chatId?: string | null,
  query: Pick<TransactionScope, 'get'> = { get: pgGet }
): Promise<SessionReadState> {
  const state = await getSessionSyncState(sessionId, userId, query);
  const effectiveChatId = chatId === undefined ? state.activeChatId : chatId;
  if (
    effectiveChatId !== null &&
    !(await query.get(
      `SELECT 1 FROM session_chats WHERE id = ? AND session_id = ?`,
      effectiveChatId,
      sessionId
    ))
  ) {
    throw new Error('Chat not found');
  }
  const chatKey = effectiveChatId ?? '';
  const read = (await query.get(
    `SELECT last_read_message_id AS lastReadMessageId, updated_at AS updatedAt
         FROM session_reads
        WHERE user_id = ? AND session_id = ? AND chat_key = ?`,
    userId,
    sessionId,
    chatKey
  )) as unknown as { lastReadMessageId: string | null; updatedAt: string } | undefined;
  const marker = read?.lastReadMessageId
    ? ((await query.get(
        `SELECT seq FROM messages WHERE id = ? AND session_id = ?`,
        read.lastReadMessageId,
        sessionId
      )) as unknown as { seq: number } | undefined)
    : undefined;
  const unread = (await query.get(
    `SELECT COUNT(*) AS count
         FROM messages
        WHERE session_id = ? AND chat_id IS ? AND role = 'assistant'
          AND seq > ?`,
    sessionId,
    effectiveChatId,
    marker?.seq ?? 0
  )) as unknown as { count: number };
  return {
    sessionId,
    chatId: effectiveChatId,
    lastReadMessageId: read?.lastReadMessageId ?? null,
    unreadCount: unread.count,
    updatedAt: read?.updatedAt ?? null,
  };
}

export async function setSessionReadState(
  userId: string,
  sessionId: string,
  input: { chatId?: string | null; lastReadMessageId?: string | null }
): Promise<SessionReadState> {
  const state = await getSessionSyncState(sessionId, userId);
  const effectiveChatId = input.chatId === undefined ? state.activeChatId : input.chatId;
  if (
    effectiveChatId !== null &&
    !(await pgGet(
      `SELECT 1 FROM session_chats WHERE id = ? AND session_id = ?`,
      effectiveChatId,
      sessionId
    ))
  ) {
    throw new Error('Chat not found');
  }
  let messageId = input.lastReadMessageId ?? null;
  if (messageId) {
    const message = await pgGet(
      `SELECT id FROM messages WHERE id = ? AND session_id = ? AND chat_id IS ?`,
      messageId,
      sessionId,
      effectiveChatId
    );
    if (!message) throw new Error('Read marker message does not belong to this chat');
  } else if (input.lastReadMessageId === undefined) {
    const newest = (await pgGet(
      `SELECT id FROM messages
          WHERE session_id = ? AND chat_id IS ?
          ORDER BY seq DESC LIMIT 1`,
      sessionId,
      effectiveChatId
    )) as unknown as { id: string } | undefined;
    messageId = newest?.id ?? null;
  }
  await pgRun(
    `INSERT INTO session_reads (
       user_id, session_id, chat_key, last_read_message_id, updated_at
     ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, session_id, chat_key) DO UPDATE SET
       last_read_message_id = excluded.last_read_message_id,
       updated_at = CURRENT_TIMESTAMP`,
    userId,
    sessionId,
    effectiveChatId ?? '',
    messageId
  );
  return getSessionReadState(userId, sessionId, effectiveChatId);
}
