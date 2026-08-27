import { run as pgRun, transaction as pgTransaction } from '../db/pg.js';
import { createHash, randomUUID } from 'node:crypto';

import type { SessionSendAck } from '@plum-code-webui/shared';

export interface DeliveryPayload {
  sessionId: string;
  chatId?: string | null;
  message: string;
  activeFollowupMode?: 'queue' | 'steer';
  uploadIds?: string[];
  images?: Array<{ data: string; mimeType: string; filename?: string }>;
}

interface DeliveryRow {
  payloadHash: string;
  status: 'processing' | 'accepted' | 'rejected';
  ackJson: string | null;
  retryable: number;
}

interface RecoveredMessageRow {
  id: string;
  chatId: string | null;
  createdAt: string;
  eventSequence: number | null;
}

export type DeliveryClaim =
  | { kind: 'claimed'; payloadHash: string }
  | { kind: 'stored'; acknowledgement: SessionSendAck }
  | { kind: 'conflict'; acknowledgement: SessionSendAck };

/**
 * Hash the semantic payload without retaining attachment bodies in SQLite.
 * Sorting upload ids makes retries insensitive to JSON key/order differences;
 * inline attachments retain order because that order is visible in the prompt.
 */
export function hashDeliveryPayload(payload: DeliveryPayload): string {
  const attachmentDigests = (payload.images ?? []).map((attachment) => ({
    filename: attachment.filename ?? '',
    mimeType: attachment.mimeType,
    sha256: createHash('sha256').update(attachment.data).digest('hex'),
  }));
  return createHash('sha256')
    .update(
      JSON.stringify({
        sessionId: payload.sessionId,
        chatId: payload.chatId ?? null,
        message: payload.message,
        activeFollowupMode: payload.activeFollowupMode ?? 'queue',
        uploadIds: [...new Set(payload.uploadIds ?? [])].sort(),
        attachments: attachmentDigests,
      })
    )
    .digest('hex');
}

function parseStoredAcknowledgement(row: DeliveryRow): SessionSendAck | null {
  if (!row.ackJson) return null;
  try {
    return JSON.parse(row.ackJson) as SessionSendAck;
  } catch {
    return null;
  }
}

export function claimMessageDelivery(
  userId: string,
  sessionId: string,
  clientMessageId: string,
  payloadHash: string
): Promise<DeliveryClaim> {
  return pgTransaction(async (tx): Promise<DeliveryClaim> => {
    const existing = (await tx.get(
      `SELECT payload_hash AS payloadHash, status, ack_json AS ackJson, retryable
           FROM message_deliveries
          WHERE user_id = ? AND session_id = ? AND client_message_id = ?`,
      userId,
      sessionId,
      clientMessageId
    )) as unknown as DeliveryRow | undefined;

    if (!existing) {
      await tx.run(
        `INSERT INTO message_deliveries (
           id, user_id, session_id, client_message_id, payload_hash, status
         ) VALUES (?, ?, ?, ?, ?, 'processing')`,
        randomUUID(),
        userId,
        sessionId,
        clientMessageId,
        payloadHash
      );
      return { kind: 'claimed', payloadHash };
    }

    if (existing.payloadHash !== payloadHash) {
      return {
        kind: 'conflict',
        acknowledgement: {
          clientMessageId,
          status: 'rejected',
          error: 'clientMessageId was already used for a different payload',
          retryable: false,
        },
      };
    }

    const stored = parseStoredAcknowledgement(existing);
    if (stored && (existing.status === 'accepted' || existing.retryable === 0)) {
      return { kind: 'stored', acknowledgement: stored };
    }

    // The process may have died after persisting the user message but before
    // finalising message_deliveries. Recover from the unique message marker so
    // a restart retry never inserts or dispatches a second user turn.
    const recovered = (await tx.get(
      `SELECT id, chat_id AS chatId, created_at AS createdAt,
                event_sequence AS eventSequence
           FROM messages
          WHERE session_id = ? AND client_message_id = ?
          LIMIT 1`,
      sessionId,
      clientMessageId
    )) as unknown as RecoveredMessageRow | undefined;
    if (recovered) {
      const acknowledgement: SessionSendAck = {
        clientMessageId,
        chatId: recovered.chatId,
        status: 'accepted',
        acceptedAt: new Date(`${recovered.createdAt.replace(' ', 'T')}Z`).toISOString(),
        messageId: recovered.id,
        disposition: 'dispatched',
        ...(recovered.eventSequence === null ? {} : { highWatermark: recovered.eventSequence }),
      };
      await tx.run(
        `UPDATE message_deliveries
            SET status = 'accepted', message_id = ?, disposition = 'dispatched',
                ack_json = ?, accepted_at = ?, error = NULL, retryable = 0,
                updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND session_id = ? AND client_message_id = ?`,
        recovered.id,
        JSON.stringify(acknowledgement),
        acknowledgement.acceptedAt,
        userId,
        sessionId,
        clientMessageId
      );
      return { kind: 'stored', acknowledgement };
    }

    // A processing row left by a terminated backend, or a retryable rejection,
    // is safe to reclaim. A single backend process additionally serializes the
    // live attempt, so this branch is restart recovery rather than duplication.
    await tx.run(
      `UPDATE message_deliveries
          SET status = 'processing', ack_json = NULL, error = NULL,
              retryable = 0, attempts = attempts + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND session_id = ? AND client_message_id = ?`,
      userId,
      sessionId,
      clientMessageId
    );
    return { kind: 'claimed', payloadHash };
  });
}

export async function finishMessageDelivery(
  userId: string,
  sessionId: string,
  clientMessageId: string,
  acknowledgement: SessionSendAck
): Promise<void> {
  if (acknowledgement.status === 'accepted') {
    await pgRun(
      `UPDATE message_deliveries
          SET status = 'accepted', message_id = ?, disposition = ?, ack_json = ?,
              accepted_at = ?, error = NULL, retryable = 0,
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND session_id = ? AND client_message_id = ?`,
      acknowledgement.messageId ?? null,
      acknowledgement.disposition ?? null,
      JSON.stringify(acknowledgement),
      acknowledgement.acceptedAt,
      userId,
      sessionId,
      clientMessageId
    );
    return;
  }

  await pgRun(
    `UPDATE message_deliveries
        SET status = 'rejected', ack_json = ?, error = ?, retryable = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND session_id = ? AND client_message_id = ?`,
    JSON.stringify(acknowledgement),
    acknowledgement.error,
    acknowledgement.retryable ? 1 : 0,
    userId,
    sessionId,
    clientMessageId
  );
}
