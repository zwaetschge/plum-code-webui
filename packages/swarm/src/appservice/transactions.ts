/**
 * Eingang (§10.1): erst speichern, dann bestätigen. Synapse stellt streng der
 * Reihe nach zu — ein Fehler hier blockiert alle Transaktionen dahinter, deshalb
 * wird nie wegen eines einzelnen Events abgelehnt. 503 gibt es nur, wenn
 * Postgres nicht erreichbar ist; dann soll Synapse es ja erneut versuchen.
 */
import { jsonParam, sql } from '../db/index.js'

export interface InboundEvent {
  event_id?: string
  room_id?: string
  sender?: string
  type?: string
  content?: unknown
  origin_server_ts?: number
  unsigned?: unknown
}

export interface StoreResult {
  duplicate: boolean
  stored: number
  skipped: number
}

export async function storeTransaction(txnId: string, events: InboundEvent[]): Promise<StoreResult> {
  return sql.begin(async (tx) => {
    const neu = await tx`
      INSERT INTO swarm.transactions (txn_id) VALUES (${txnId})
      ON CONFLICT (txn_id) DO NOTHING
      RETURNING txn_id`
    if (neu.length === 0) {
      // Dieselbe Transaktion zum zweiten Mal: sofort 200, ohne Nebenwirkung.
      return { duplicate: true, stored: 0, skipped: events.length }
    }
    let stored = 0
    let skipped = 0
    for (const e of events) {
      if (!e.event_id || !e.room_id || !e.type) {
        // Ohne Event-ID ist keine Entdopplung möglich — weg damit, aber kein 4xx.
        skipped++
        continue
      }
      const content =
        e.content && typeof e.content === 'object' && !Array.isArray(e.content)
          ? (e.content as Record<string, unknown>)
          : {}
      await tx`
        INSERT INTO swarm.inbox (event_id, room_id, sender, type, content)
        VALUES (${e.event_id}, ${e.room_id}, ${e.sender ?? ''}, ${e.type}, ${jsonParam(tx, content)})
        ON CONFLICT (event_id) DO NOTHING`
      stored++
    }
    return { duplicate: false, stored, skipped }
  })
}

/** Älteste unerledigte Zeile — für /health (§10.5). */
export async function inboxLag(): Promise<{ pending: number; dead: number; oldestMinutes: number | null }> {
  const [row] = await sql`
    SELECT count(*) FILTER (WHERE attempts < 3)::int AS pending,
           count(*) FILTER (WHERE attempts >= 3)::int AS dead,
           max(EXTRACT(epoch FROM (now() - received_at)) / 60) FILTER (WHERE attempts < 3)::float AS oldest
    FROM swarm.inbox WHERE processed_at IS NULL`
  return {
    pending: Number(row?.pending ?? 0),
    dead: Number(row?.dead ?? 0),
    oldestMinutes: row?.oldest === null || row?.oldest === undefined ? null : Math.round(Number(row.oldest)),
  }
}

export async function lastTransactionAge(): Promise<number | null> {
  const [row] = await sql`
    SELECT EXTRACT(epoch FROM (now() - max(received_at)))::float AS seconds FROM swarm.transactions`
  const s = row?.seconds
  return s === null || s === undefined ? null : Math.round(Number(s))
}
