import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { get, run, transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';

export async function requestChatToolApproval(
  userId: string,
  turnId: string,
  callId: string,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  onReady: () => Promise<void>
) {
  signal.throwIfAborted();
  await run(
    `INSERT INTO assistant_api_tool_approvals(turn_id,call_id,user_id,function_name,arguments_hash,created_at)
    SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM assistant_api_turns t JOIN assistant_resources r ON r.id=t.chat_id WHERE t.id=? AND r.user_id=? AND t.status='running') ON CONFLICT(turn_id,call_id) DO NOTHING`,
    turnId,
    callId,
    userId,
    name,
    createHash('sha256').update(JSON.stringify(args)).digest('hex'),
    new Date().toISOString(),
    turnId,
    userId
  );
  await onReady();
  while (!signal.aborted) {
    const approval = await get(
      `SELECT a.decision,t.status,t.expires_at FROM assistant_api_tool_approvals a JOIN assistant_api_turns t ON t.id=a.turn_id WHERE a.user_id=? AND a.turn_id=? AND a.call_id=?`,
      userId,
      turnId,
      callId
    );
    if (!approval || approval.status !== 'running' || Date.parse(approval.expires_at) <= Date.now())
      return false;
    if (approval.decision !== 'pending') return approval.decision === 'allow';
    await setTimeout(500, undefined, { signal });
  }
  signal.throwIfAborted();
  return false;
}

export async function decideChatToolApproval(
  userId: string,
  chatId: string,
  turnId: string,
  callId: string,
  decision: 'allow' | 'deny'
) {
  return transaction(async (tx) => {
    const approval = await tx.get(
      `SELECT a.decision,t.status,t.expires_at FROM assistant_api_tool_approvals a JOIN assistant_api_turns t ON t.id=a.turn_id JOIN assistant_resources r ON r.id=t.chat_id WHERE a.user_id=? AND r.user_id=? AND t.chat_id=? AND a.turn_id=? AND a.call_id=? FOR UPDATE OF a`,
      userId,
      userId,
      chatId,
      turnId,
      callId
    );
    if (!approval) throw new AppError('Werkzeugentscheidung nicht gefunden', 404, 'NOT_FOUND');
    if (approval.decision !== 'pending') {
      if (approval.decision === decision) return { decision };
      throw new AppError('Werkzeugentscheidung wurde bereits getroffen', 409, 'APPROVAL_CONFLICT');
    }
    if (approval.status !== 'running' || Date.parse(approval.expires_at) <= Date.now())
      throw new AppError('Antwortlauf ist nicht mehr aktiv', 409, 'APPROVAL_EXPIRED');
    await tx.run(
      'UPDATE assistant_api_tool_approvals SET decision=?,decided_at=? WHERE turn_id=? AND call_id=? AND user_id=?',
      decision,
      new Date().toISOString(),
      turnId,
      callId,
      userId
    );
    return { decision };
  });
}
