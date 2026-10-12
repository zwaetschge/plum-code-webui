/**
 * Eine Notice des Hubs in einen Schwarm-Raum nach Art (`log`, `lobby`, `alerts`). Für die Bausteine aus
 * matrix/PLAN-weiter.md, die nur etwas mitteilen und keinen Auftrag haben: Absprachen, Releases,
 * Routinen, Wochenberichte.
 */
import { roomsByKind } from './agents/store.js'
import { notice } from './appservice/messages.js'
import { sql, type Db } from './db/index.js'
import { enqueue } from './outbox.js'
import type { Ctx } from './context.js'

export type RaumArt = 'log' | 'lobby' | 'alerts'

/** false, wenn es den Raum (noch) nicht gibt; die Notice geht dann verloren, und das ist in Ordnung. */
export async function hinweis(ctx: Ctx, art: RaumArt, text: string, db: Db = sql, thread: string | null = null): Promise<boolean> {
  const [raum] = await roomsByKind(art, db)
  if (!raum?.roomId) return false
  await enqueue(db, [{
    kind: 'message',
    roomId: raum.roomId,
    payload: { type: 'm.room.message', content: notice(text, { thread }) },
  }], ctx.hub)
  return true
}

/** State-Event in der Lobby, Absender der Hub. Die App liest es wie die Agent Cards. */
export async function lobbyZustand(ctx: Ctx, typ: string, stateKey: string, inhalt: Record<string, unknown>, db: Db = sql): Promise<boolean> {
  const [lobby] = await roomsByKind('lobby', db)
  if (!lobby?.roomId) return false
  await enqueue(db, [{
    kind: 'state',
    roomId: lobby.roomId,
    payload: { type: typ, stateKey, content: inhalt },
  }], ctx.hub)
  return true
}

export const uhrzeit = (d: Date | string | number): string =>
  new Date(d).toLocaleTimeString('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' })

export const datumZeit = (d: Date | string | number): string =>
  new Date(d).toLocaleString('de-CH', {
    timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
