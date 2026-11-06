import { randomUUID } from 'node:crypto';
import { transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';

/** Copy a frozen conversation prefix. Never mutate the source or resume its native provider ID. */
export async function branchConversation(
  userId: string,
  sessionId: string,
  input: {
    messageId: string;
    includeMessage: boolean;
    title: string;
  }
) {
  return transaction(async (tx) => {
    const session = await tx.get(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ? FOR UPDATE',
      sessionId,
      userId
    );
    if (!session) throw new AppError('Gespräch nicht gefunden', 404, 'NOT_FOUND');
    const target = await tx.get(
      'SELECT id,chat_id,seq FROM messages WHERE session_id = ? AND id = ?',
      sessionId,
      input.messageId
    );
    if (!target) throw new AppError('Nachricht nicht gefunden', 404, 'NOT_FOUND');
    const rows = await tx.all(
      `SELECT * FROM messages WHERE session_id = ? AND chat_id IS ? AND seq ${input.includeMessage ? '<=' : '<'} ? ORDER BY seq`,
      sessionId,
      target.chat_id,
      target.seq
    );
    const chatId = randomUUID(),
      ids: string[] = [];
    await tx.run(
      'INSERT INTO session_chats (id,session_id,title) VALUES (?, ?, ?)',
      chatId,
      sessionId,
      input.title
    );
    for (const message of rows) {
      const id = randomUUID();
      ids.push(id);
      await tx.run(
        'INSERT INTO messages (id,session_id,chat_id,role,content,created_at) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        sessionId,
        chatId,
        message.role,
        message.content,
        message.created_at
      );
      const media = await tx.all(
        'SELECT * FROM message_media WHERE message_id = ? AND session_id = ? AND user_id = ?',
        message.id,
        sessionId,
        userId
      );
      for (const attachment of media)
        await tx.run(
          `INSERT INTO message_media
        (id,message_id,session_id,user_id,storage_key,filename,mime_type,byte_size,sha256,alt_text,source,source_id,created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          randomUUID(),
          id,
          sessionId,
          userId,
          attachment.storage_key,
          attachment.filename,
          attachment.mime_type,
          attachment.byte_size,
          attachment.sha256,
          attachment.alt_text,
          attachment.source,
          attachment.created_at
        );
    }
    await tx.run(
      'INSERT INTO assistant_branches (chat_id,session_id,source_chat_id,source_message_id,seed_message_ids,created_at) VALUES (?, ?, ?, ?, ?, ?)',
      chatId,
      sessionId,
      target.chat_id,
      target.id,
      JSON.stringify(ids),
      new Date().toISOString()
    );
    return { chatId, copiedMessages: ids.length, sourceMessageId: target.id };
  });
}
