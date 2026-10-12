/**
 * Nächtlicher Abgleich (§10.4): Was im Raum passiert ist, muss in `swarm.inbox`
 * stehen. Fehlt etwas, wird es nachgespeist — der normale Verarbeiter holt es
 * dann nach, samt Zustand und Meldung. Jede Lücke ist ein Fehler und wird im
 * `#schwarm-log` genannt.
 *
 * Der Verlauf eines Raums enthält auch die Thread-Nachrichten, deshalb braucht
 * es keinen eigenen Abgleich der Relationen.
 */
import { isPuppet } from './protocol/index.js'
import { jsonParam, sql } from './db/index.js'
import { getFlag, setFlag } from './db/audit.js'
import { listRooms, roomsByKind } from './agents/store.js'
import { enqueue } from './outbox.js'
import { notice } from './appservice/messages.js'
import type { Ctx } from './context.js'
import * as store from './tasks/store.js'

export const ABGLEICH_FLAG = 'abgleich'

export interface AbgleichErgebnis {
  raeume: number
  events: number
  luecken: number
  stale: string[]
}

export async function reconcile(ctx: Ctx, stunden = 24): Promise<AbgleichErgebnis> {
  const cutoff = Date.now() - stunden * 3600_000
  const raeume = (await listRooms()).filter((r) => r.roomId)
  let events = 0
  let luecken = 0

  for (const raum of raeume) {
    const verlauf = await ctx.matrix.messagesSince(raum.roomId!, cutoff)
    for (const e of verlauf) {
      events++
      const eventId = e.event_id as string | undefined
      const sender = (e.sender as string | undefined) ?? ''
      const type = (e.type as string | undefined) ?? ''
      if (!eventId || !type) continue
      // Eigene Ausgaben kennt der Hub über die Outbox; sie sind keine Lücke.
      if (sender === ctx.hub || isPuppet(sender)) continue
      const inhalt =
        e.content && typeof e.content === 'object' && !Array.isArray(e.content)
          ? (e.content as Record<string, unknown>)
          : {}
      const neu = await sql`
        INSERT INTO swarm.inbox (event_id, room_id, sender, type, content)
        VALUES (${eventId}, ${raum.roomId!}, ${sender}, ${type}, ${jsonParam(sql, inhalt)})
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id`
      if (neu.length) luecken++
    }
  }

  // Aufträge ohne Aktivität seit mehr als 24 h (§10.4): gehören in die Übersicht.
  const stale = (await sql`
    SELECT id FROM swarm.tasks
    WHERE state IN ('submitted','working','input-required','auth-required')
      AND updated_at < now() - interval '24 hours'
    ORDER BY id LIMIT 20`).map((r) => r.id as string)

  if (luecken > 0 || stale.length > 0) {
    const [logRoom] = await roomsByKind('log')
    if (logRoom?.roomId) {
      await enqueue(
        sql,
        [{
          kind: 'message',
          roomId: logRoom.roomId,
          payload: {
            type: 'm.room.message',
            content: notice(
              `Abgleich ${stunden} h: ${raeume.length} Räume, ${events} Events, ` +
                `${luecken} Lücke(n) nachgespeist.` +
                (stale.length ? `\nOhne Aktivität seit 24 h: ${stale.join(', ')}` : ''),
            ),
          },
        }],
        ctx.hub,
      )
    }
  }

  await setFlag(ABGLEICH_FLAG, {
    at: new Date().toISOString(),
    raeume: raeume.length,
    events,
    luecken,
    stale: stale.length,
  }, 'hub')
  ctx.log.info({ raeume: raeume.length, events, luecken, stale: stale.length }, 'Nächtlicher Abgleich')
  return { raeume: raeume.length, events, luecken, stale }
}

export async function letzterAbgleich(): Promise<Record<string, unknown> | null> {
  return getFlag<Record<string, unknown>>(ABGLEICH_FLAG)
}

/** Offene Aufträge eines Agenten, für Kanarienvogel und Selbsttest. */
export async function offeneAuftraege(assignee?: string): Promise<{ id: string; state: string }[]> {
  const rows = assignee ? await store.listForAgent(assignee) : await store.listOpen()
  return rows
    .filter((t) => ['submitted', 'working', 'input-required', 'auth-required'].includes(t.state))
    .map((t) => ({ id: t.id, state: t.state }))
}
