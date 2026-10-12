/**
 * Outbox (§10.2): Jede Ausgabe landet hier, in derselben DB-Transaktion wie die
 * Zustandsänderung, die sie auslöst. Gesendet wird mit fester Transaktions-ID —
 * `sha256(as_user | room | task | kind | seq)` — damit ein Absturz zwischen
 * Senden und Speichern keine doppelte Nachricht erzeugt.
 */
import { createHash } from 'node:crypto'
import { SWARM_OUT_FIELD } from './protocol/index.js'
import { jsonParam, sql, type Db, type Tx } from './db/index.js'
import * as taskStore from './tasks/store.js'
import { ensurePuppet } from './appservice/puppets.js'
import type { Ctx } from './context.js'

/** Für die Selbstreparatur bei M_FORBIDDEN; wird beim Start des Senders gesetzt. */
let repairCtx: Ctx | null = null
export function setRepairContext(ctx: Ctx): void {
  repairCtx = ctx
}

async function ensurePuppetSafe(ctx: Ctx | null, mxid: string, roomId: string): Promise<boolean> {
  return ctx ? ensurePuppet(ctx, mxid, roomId) : false
}
import { ABGEBROCHEN } from './tasks/transition.js'
import type { MatrixClient, SendResult } from './appservice/client.js'
import { nachDemSenden } from './push.js'

export type OutboxKind = 'message' | 'edit' | 'reaction' | 'state' | 'redact'

export interface OutboxPayload {
  /** Matrix-Event-Typ, z. B. `m.room.message`, `m.reaction`, `ch.zwaetschge.swarm.room`. */
  type: string
  content: Record<string, unknown>
  stateKey?: string
  /** Für `redact`: das zu schwärzende Event. */
  eventId?: string
  reason?: string
  /** Rolle für `swarm.matrix_map`, sobald die Event-ID bekannt ist. */
  role?: 'karte' | 'board' | 'freigabe' | 'rueckmeldung' | 'erinnerung' | 'abbruch' | 'quittung'
  /** Bremsleiter: '2' ist die Nachfass-Nachricht, die auf ihre Freigabe wartet (§12.5). */
  stufe?: string
}

export interface NewOutbox {
  kind: OutboxKind
  roomId: string
  asUser?: string
  taskId?: string | null
  payload: OutboxPayload
  dependsOn?: number | null
  notBefore?: Date | null
  held?: boolean
}

export interface OutboxRow extends NewOutbox {
  id: number
  txnId: string | null
  attempts: number
  dead: boolean
  sentEventId: string | null
  asUser: string
}

/** Die feste Transaktions-ID (§10.2). */
export function outboxTxnId(parts: {
  asUser: string
  roomId: string
  taskId: string | null
  kind: string
  seq: number | string
}): string {
  return createHash('sha256')
    .update([parts.asUser, parts.roomId, parts.taskId ?? '', parts.kind, String(parts.seq)].join('|'))
    .digest('hex')
}

/**
 * Einreihen. Läuft bewusst in der Transaktion des Aufrufers: Zustand und
 * Meldung zusammen, oder gar nicht. Jede Zeile trägt ihre eigene ID und
 * Transaktions-ID im Inhalt (`ch.zwaetschge.swarm.out`), damit der Hub sein
 * Event wiedererkennt, wenn es per Transaktion zurückkommt (§10.2).
 */
export async function enqueue(db: Db, rows: NewOutbox[], hubMxid: string): Promise<number[]> {
  const ids: number[] = []
  for (const r of rows) {
    const asUser = r.asUser ?? hubMxid
    const [seq] = await db`SELECT nextval('swarm.outbox_seq') AS id`
    const id = Number(seq!.id)
    const txnId = outboxTxnId({ asUser, roomId: r.roomId, taskId: r.taskId ?? null, kind: r.kind, seq: id })
    const payload: OutboxPayload = {
      ...r.payload,
      content: { ...r.payload.content, [SWARM_OUT_FIELD]: { id, txn: txnId } },
    }
    await db`
      INSERT INTO swarm.outbox (id, kind, room_id, as_user, task_id, txn_id, payload,
                                depends_on, not_before, held)
      VALUES (${id}, ${r.kind}, ${r.roomId}, ${asUser}, ${r.taskId ?? null}, ${txnId},
              ${jsonParam(db, payload)}, ${r.dependsOn ?? null},
              ${r.notBefore ?? new Date()}, ${r.held ?? false})`
    ids.push(id)
  }
  return ids
}

/** Hängt der Inhalt an einem anderen Event (Thread, Antwort, Ersetzung)? Dann ist er kein Thread-Anfang. */
export const imThread = (content: Record<string, unknown> | null | undefined): boolean => Boolean(content?.['m.relates_to'])

export async function markSent(id: number, eventId: string, db: Db = sql): Promise<void> {
  await db`
    UPDATE swarm.outbox SET sent_event_id = ${eventId}, sent_at = now() WHERE id = ${id}`
  const [row] = await db`SELECT task_id, payload FROM swarm.outbox WHERE id = ${id}`
  const role = (row?.payload as OutboxPayload | null)?.role
  const taskId = (row?.task_id as string | null) ?? null
  if (!taskId || !role) return
  await db`
    INSERT INTO swarm.matrix_map (event_id, task_id, role)
    VALUES (${eventId}, ${taskId}, ${role})
    ON CONFLICT (event_id) DO NOTHING`
  // Der Hub kennt die Event-ID, sobald Synapse antwortet — er wartet nicht auf
  // das Echo per Transaktion, damit ein 👀 auch dann schon zuordenbar ist.
  if (role === 'karte') {
    // Eine Karte im Thread (neuer Versuch nach abgelaufener Lease, §10.3) beginnt keinen neuen Thread:
    // Synapse lehnt Antworten auf ein Event mit Relation ab („Cannot start threads from an event with a relation“).
    if (!imThread((row?.payload as OutboxPayload | null)?.content)) await taskStore.setThreadRoot(taskId, eventId, db)
    // Die Zustellung startet die Uhr des Watchdogs (§10.4).
    await taskStore.markCardSent(taskId, db)
  }
  if (role === 'board') await taskStore.setBoardEvent(taskId, eventId, db)
}

/**
 * Ein Platz wird frei: die älteste wartende Karte desselben Agenten geht raus.
 * Ohne das würde `!auftrag` × 50 den Bot mit 50 Threads überfallen — die Policy
 * sagt „Warteschlange" (§12.1), also wartet die Karte in der Outbox (`held`).
 */
export async function releaseNextHeld(assignee: string, db: Db = sql): Promise<string | null> {
  const [row] = await db`
    UPDATE swarm.outbox SET held = false
    WHERE id = (
      SELECT o.id FROM swarm.outbox o
      JOIN swarm.tasks t ON t.id = o.task_id
      WHERE o.held AND o.sent_event_id IS NULL AND o.payload->>'role' = 'karte'
        AND t.assignee = ${assignee}
        AND t.state IN ('submitted','auth-required')
      ORDER BY o.id
      LIMIT 1)
    RETURNING task_id`
  return (row?.task_id as string | null) ?? null
}

/** Nachtrag nach einem Absturz: das eigene Event kommt per Transaktion zurück (§10.2). */
export async function adoptEvent(outboxId: number, eventId: string, db: Db = sql): Promise<boolean> {
  const rows = await db`
    UPDATE swarm.outbox SET sent_event_id = ${eventId}, sent_at = now()
    WHERE id = ${outboxId} AND sent_event_id IS NULL
    RETURNING id`
  return rows.length > 0
}

export async function failSend(id: number, err: string, retryAfterMs: number | null, dead: boolean, db: Db = sql): Promise<void> {
  if (dead) {
    await db`
      UPDATE swarm.outbox SET dead = true, attempts = attempts + 1, last_error = ${err} WHERE id = ${id}`
    return
  }
  // Backoff bis 10 min (§10.2). Bei 429 zählt `retry_after_ms`.
  if (retryAfterMs !== null) {
    const sekunden = Math.max(1, Math.round(retryAfterMs / 1000))
    await db`
      UPDATE swarm.outbox
      SET attempts = attempts + 1, last_error = ${err},
          not_before = now() + make_interval(secs => ${sekunden})
      WHERE id = ${id}`
    return
  }
  await db`
    UPDATE swarm.outbox
    SET attempts = attempts + 1,
        last_error = ${err},
        not_before = now() + LEAST(interval '10 minutes',
                                   interval '5 seconds' * power(2, attempts))
    WHERE id = ${id}`
}

const MAX_VERSUCHE = 8

interface OffeneZeile {
  id: number
  kind: OutboxKind
  room_id: string
  as_user: string
  task_id: string | null
  txn_id: string
  payload: OutboxPayload
  depends_on: number | null
  attempts: number
}

/**
 * Ein Durchlauf des Senders: pro Raum streng der Reihe nach, Räume parallel.
 * Edits und Reaktionen warten auf das Event, das sie beziehen (§10.2).
 */
export async function sendPending(
  client: MatrixClient,
  hubMxid: string,
  limit = 50,
): Promise<{ sent: number; retry: number; dead: number }> {
  const rows = await sql.begin(async (tx: Tx) => {
    const offen = (await tx`
      SELECT id, kind, room_id, as_user, task_id, txn_id, payload, depends_on, attempts
      FROM swarm.outbox
      WHERE sent_event_id IS NULL AND NOT dead AND NOT held AND not_before <= now()
        AND (depends_on IS NULL OR depends_on IN
             (SELECT id FROM swarm.outbox WHERE sent_event_id IS NOT NULL))
      ORDER BY room_id, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`) as unknown as OffeneZeile[]
    // txn_id fehlt nur, wenn der Hub zwischen INSERT und UPDATE abgestürzt ist.
    for (const r of offen) {
      if (!r.txn_id) {
        r.txn_id = outboxTxnId({
          asUser: r.as_user,
          roomId: r.room_id,
          taskId: r.task_id,
          kind: r.kind,
          seq: r.id,
        })
        await tx`UPDATE swarm.outbox SET txn_id = ${r.txn_id} WHERE id = ${r.id}`
      }
    }
    return offen
  })

  const nachRaum = new Map<string, OffeneZeile[]>()
  for (const r of rows) {
    const liste = nachRaum.get(r.room_id) ?? []
    liste.push(r)
    nachRaum.set(r.room_id, liste)
  }

  let sent = 0
  let retry = 0
  let dead = 0
  await Promise.all(
    [...nachRaum.values()].map(async (liste) => {
      for (const r of liste) {
        // Der Hub selbst spricht ohne user_id, Puppets maskiert er (§7.1).
        const as = { txnId: r.txn_id, user: r.as_user === hubMxid ? undefined : r.as_user }
        const ergebnis: SendResult = await senden(client, r, as)
        if (ergebnis.ok) {
          await markSent(r.id, ergebnis.eventId)
          sent++
          // Sofort-Benachrichtigungen (App 2.5): Wartet damit etwas auf Vale, weckt der Hub die App.
          if (repairCtx && r.kind === 'message') void nachDemSenden(repairCtx, r.room_id, r.payload).catch(() => {})
          continue
        }
        const versuche = r.attempts + 1
        // Einmal reparieren (Beitritt), sonst Dead Letter (§10.2).
        if (!ergebnis.retryable && versuche < 2 && ergebnis.errcode === 'M_FORBIDDEN') {
          // Ein Puppet, das nicht im Raum ist, braucht erst eine Einladung:
          // Beitritt allein läuft in „You are not invited to this room" (§7.1).
          const ok = as.user
            ? await ensurePuppetSafe(repairCtx, as.user, r.room_id)
            : await client.joinRoom(r.room_id)
          if (ok) {
            await failSend(r.id, `${ergebnis.errcode}: ${ergebnis.message} — Beitritt versucht`, null, false)
            retry++
            continue
          }
        }
        const aufgeben = !ergebnis.retryable || versuche >= MAX_VERSUCHE
        await failSend(
          r.id,
          `${ergebnis.errcode} (${ergebnis.status}): ${ergebnis.message}`,
          ergebnis.retryAfterMs ?? null,
          aufgeben,
        )
        if (aufgeben) dead++
        else retry++
      }
    }),
  )
  return { sent, retry, dead }
}

async function senden(
  client: MatrixClient,
  row: OffeneZeile,
  as: { txnId: string; user?: string },
): Promise<SendResult> {
  const { payload } = row
  switch (row.kind) {
    case 'state':
      return client.sendState(row.room_id, payload.type, payload.stateKey ?? '', payload.content, as)
    case 'redact':
      return client.redact(row.room_id, payload.eventId ?? '', payload.reason ?? '', as)
    case 'message':
    case 'edit':
    case 'reaction':
    default:
      return client.send(row.room_id, payload.type, payload.content, as)
  }
}

/** Rückstand für /health und ntfy (§10.5). */
export async function backlog(): Promise<{ pending: number; dead: number; oldestMinutes: number | null }> {
  const [row] = await sql`
    SELECT
      count(*) FILTER (WHERE NOT dead)::int AS pending,
      count(*) FILTER (WHERE dead AND last_error IS DISTINCT FROM ${ABGEBROCHEN})::int AS dead,
      max(EXTRACT(epoch FROM (now() - created_at)) / 60) FILTER (WHERE NOT dead)::float AS oldest
    FROM swarm.outbox WHERE sent_event_id IS NULL`
  return {
    pending: Number(row?.pending ?? 0),
    dead: Number(row?.dead ?? 0),
    oldestMinutes: row?.oldest === null || row?.oldest === undefined ? null : Math.round(Number(row.oldest)),
  }
}

/**
 * Rückmeldungen freigeben, sobald der Lauf im Thread beendet ist (§10.3).
 * Wartende **Karten** bleiben `held`: Sie gehören zur Warteschlange (§12.1) und
 * dürfen nicht freikommen, nur weil ein anderer Auftrag desselben Agenten endet.
 */
export async function releaseHeldRueckmeldungen(taskId: string, db: Db = sql): Promise<number> {
  const rows = await db`
    UPDATE swarm.outbox SET held = false
    WHERE task_id = ${taskId} AND held AND sent_event_id IS NULL
      AND payload->>'role' = 'rueckmeldung'
    RETURNING id`
  return rows.length
}

export async function releaseHeld(taskId: string, db: Db = sql): Promise<number> {
  const rows = await db`
    UPDATE swarm.outbox SET held = false WHERE task_id = ${taskId} AND held
    RETURNING id`
  return rows.length
}
