/** Antworten an dich — immer als Notice, immer im Thread des Auslösers (§8.1). */
import { enqueue } from './outbox.js'
import { notice } from './appservice/messages.js'
import type { Db } from './db/index.js'
import type { Ctx } from './context.js'

export async function reply(
  ctx: Ctx,
  tx: Db,
  roomId: string,
  thread: string | null,
  body: string,
): Promise<void> {
  await enqueue(
    tx,
    [{ kind: 'message', roomId, payload: { type: 'm.room.message', content: notice(body, { thread }) } }],
    ctx.hub,
  )
}
