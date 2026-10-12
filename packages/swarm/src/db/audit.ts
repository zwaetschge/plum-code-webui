/**
 * Audit mit Hash-Kette (§11.8) und die Betriebs-Flags (§9.7).
 *
 * Die Kette bindet Zeit, Akteur, Aktion, Ziel und Detail an den Vorgänger.
 * `!audit` rechnet sie nach; ein Eingriff in die Tabelle fällt dabei auf, weil
 * ab der geänderten Zeile jeder Hash nicht mehr passt.
 */
import { createHash } from 'node:crypto'
import { jsonParam, sql, type Db, type Sql } from '../db/index.js'

/**
 * Kanonisches JSON: jsonb sortiert Schlüssel beim Speichern um, also darf der
 * Hash nicht von der Reihenfolge abhängen, in der der Hub sie gerade schrieb.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const eintrag = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    return `{${eintrag.join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function chainHash(
  prev: string | null,
  at: string,
  actor: string,
  action: string,
  target: string | null,
  detail: unknown,
): string {
  return createHash('sha256')
    .update([prev ?? '', at, actor, action, target ?? '', canonical(detail ?? {})].join('|'))
    .digest('hex')
}

/** Ein Beleg, der noch in die Kette muss. */
interface Beleg { at: Date; actor: string; action: string; target: string | null; detail: Record<string, unknown> }
const sammlung: Beleg[] = []

/**
 * Beleg **vormerken** statt sofort schreiben (ADR-002 §4.35).
 *
 * Zustandswechsel laufen in der Transaktion ihres Aufrufers. Würde die Kette dort
 * geschrieben, hielte sie das Schloss auf der letzten Zeile bis zum Commit — und
 * ruft derselbe Ablauf zwischendurch `audit()` auf (etwa `freigabe.erteilt`),
 * wartet der auf genau dieses Schloss: Die Transaktion wartet auf sich selbst,
 * ohne dass Postgres einen Zyklus sähe. Also vormerken und aus einem eigenen Takt
 * heraus schreiben; die Kette bleibt damit Einzel-Schreiber und verzweigt nicht.
 *
 * Ehrliche Lücke: Reißt der Prozess ab, fehlen die Belege der letzten
 * `AUDIT_TAKT_MS`. Die Zustände selbst stehen in `swarm.tasks`; die Kette bleibt
 * intakt (§6.6 prüft Verkettung, nicht Vollständigkeit).
 */
export function auditMerken(
  actor: string,
  action: string,
  target: string | null,
  detail: Record<string, unknown> = {},
): void {
  sammlung.push({ at: new Date(), actor, action, target, detail })
}

/** Vorgemerkte Belege in Reihenfolge in die Kette schreiben. */
export async function auditAbarbeiten(db: Sql = sql, hoechstens = 200): Promise<number> {
  const charge = sammlung.splice(0, hoechstens)
  for (const b of charge) await audit(b.actor, b.action, b.target, b.detail, db, b.at)
  return charge.length
}

/** Wie viele Belege noch warten — für /health und die Überwachung. */
export function auditRueckstand(): number {
  return sammlung.length
}

/**
 * Eine Zeile in die Kette. `db` darf der Pool **oder** eine laufende Transaktion
 * sein — wer beides in einem Ablauf mischt, wartet sonst auf ein Schloss, das er
 * selbst hält (§4.35).
 */
export async function audit(
  actor: string,
  action: string,
  target: string | null,
  detail: Record<string, unknown> = {},
  db: Db = sql,
  at: Date = new Date(),
): Promise<void> {
  const schreiben = async (tx: Db): Promise<void> => {
    // Die letzte Zeile sperren, damit zwei gleichzeitige Läufe dieselbe Kette
    // nicht verzweigen. Die Zeit setzt der Hub, nicht `now()`: Der Hash muss
    // beim Nachrechnen dieselbe Zeit sehen.
    const [prev] = await tx`SELECT hash FROM swarm.audit ORDER BY id DESC LIMIT 1 FOR UPDATE`
    const hash = chainHash((prev?.hash as string | undefined) ?? null, at.toISOString(), actor, action, target, detail)
    await tx`
      INSERT INTO swarm.audit (at, actor, action, target, detail, prev_hash, hash)
      VALUES (${at}, ${actor}, ${action}, ${target}, ${jsonParam(tx, detail)},
              ${prev?.hash ?? null}, ${hash})`
  }
  if (typeof (db as Sql).begin === 'function') await (db as Sql).begin(schreiben)
  else await schreiben(db)
}

export async function verifyAudit(db: Db = sql): Promise<{ ok: boolean; rows: number; brokenAt: number | null }> {
  const rows = await db`
    SELECT id, at, actor, action, target, detail, prev_hash, hash
    FROM swarm.audit ORDER BY id`
  let vorher: string | null = null
  for (const r of rows as Record<string, unknown>[]) {
    const erwartet = chainHash(
      vorher,
      new Date(r.at as string).toISOString(),
      r.actor as string,
      r.action as string,
      (r.target as string | null) ?? null,
      r.detail,
    )
    if (r.prev_hash !== vorher || r.hash !== erwartet) {
      return { ok: false, rows: rows.length, brokenAt: Number(r.id) }
    }
    vorher = r.hash as string
  }
  return { ok: true, rows: rows.length, brokenAt: null }
}

// ─── Flags: Kill-Switch und Einfrierungen ───────────────────────────────────

export async function getFlag<T = Record<string, unknown>>(name: string, db: Db = sql): Promise<T | null> {
  const [row] = await db`SELECT value FROM swarm.flags WHERE name = ${name}`
  return row ? (row.value as T) : null
}

export async function setFlag(
  name: string,
  value: Record<string, unknown>,
  setBy: string,
  db: Db = sql,
): Promise<void> {
  await db`
    INSERT INTO swarm.flags (name, value, set_by, set_at)
    VALUES (${name}, ${jsonParam(db, value)}, ${setBy}, now())
    ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, set_by = EXCLUDED.set_by, set_at = now()`
}

export async function clearFlag(name: string, db: Db = sql): Promise<void> {
  await db`DELETE FROM swarm.flags WHERE name = ${name}`
}

export const FROZEN_FLAG = 'frozen'

/** Der Kill-Switch überlebt den Neustart, weil er in Postgres steht (§9.7). */
export async function isSwarmFrozen(db: Db = sql): Promise<boolean> {
  return (await getFlag(FROZEN_FLAG, db)) !== null
}
