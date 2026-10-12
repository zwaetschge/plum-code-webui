/**
 * Wartung: Retention für die Hub-Tabellen (ADR-002 §4.25).
 *
 * Ohne Aufräumen wachsen `swarm.inbox`, `swarm.outbox` und `swarm.artifacts`
 * endlos — im Leerlauf waren es 411 Inbox-Zeilen am Tag, mit echtem Verkehr ein
 * Vielfaches, und Artefakte sind bis 5 MB gross (bytea, also in jedem Dump).
 *
 * Gelöscht wird nur, was erledigt ist:
 * - Inbox: Zeilen mit `processed_at` — aber erst nach dem Dedup-Fenster (§4.4),
 *   sonst würde eine wieder zugestellte alte Meldung erneut verarbeitet.
 * - Outbox: Zeilen mit `sent_event_id` (wirklich zugestellt). `dead`-Zeilen
 *   bleiben, bis ein Mensch sie ansieht.
 * - Artefakte: ältere Ablagen, deren Auftrag abgeschlossen ist. Zu einem offenen
 *   Auftrag gehört die Ablage immer — sonst verschwindet ein Ergebnis.
 *
 * `swarm.audit` wird **nie** angefasst: Das ist die unveränderliche Kette (§6.6).
 */

import { sql, type Db } from './db/index.js'
import { audit, getFlag, setFlag } from './db/audit.js'
import { MatrixClient } from './appservice/client.js'
import { env } from './env.js'

export interface AufraeumErgebnis {
  inbox: number
  outbox: number
  artefakte: number
  /** Freigewordene Artefakt-Bytes (MiB, eine Nachkommastelle). */
  mib: number
}

export const RETENTION_TAGE = Number(process.env.SCHWARM_RETENTION_TAGE || 30)

/** Was gelöscht würde, ohne zu löschen — für die Vorlauf-Prüfung und Tests. */
export async function retentionVorschau(tage = RETENTION_TAGE, db: Db = sql): Promise<AufraeumErgebnis> {
  const [inbox] = await db`SELECT count(*)::int AS n FROM swarm.inbox
    WHERE processed_at IS NOT NULL AND processed_at < now() - ${tage} * interval '1 day'`
  const [outbox] = await db`SELECT count(*)::int AS n FROM swarm.outbox
    WHERE sent_event_id IS NOT NULL AND coalesce(sent_at, created_at) < now() - ${tage} * interval '1 day'`
  const [art] = await db`SELECT count(*)::int AS n, coalesce(sum(size), 0)::bigint AS b
    FROM swarm.artifacts WHERE created_at < now() - ${tage} * interval '1 day'
    AND (task_id IS NULL OR task_id IN (
      SELECT id FROM swarm.tasks WHERE state IN ('completed', 'failed', 'canceled', 'rejected')))`
  return {
    inbox: Number(inbox?.n ?? 0),
    outbox: Number(outbox?.n ?? 0),
    artefakte: Number(art?.n ?? 0),
    mib: Math.round((Number(art?.b ?? 0) / 1024 / 1024) * 10) / 10,
  }
}

/**
 * Löscht erledigte Zeilen. Idempotent; ein zweiter Lauf findet nichts mehr.
 */
export async function aufraeumen(tage = RETENTION_TAGE, db: Db = sql): Promise<AufraeumErgebnis> {
  const vorher = await retentionVorschau(tage, db)
  const inbox = await db`DELETE FROM swarm.inbox
    WHERE processed_at IS NOT NULL AND processed_at < now() - ${tage} * interval '1 day'`
  const outbox = await db`DELETE FROM swarm.outbox
    WHERE sent_event_id IS NOT NULL AND coalesce(sent_at, created_at) < now() - ${tage} * interval '1 day'`
  const art = await db`DELETE FROM swarm.artifacts
    WHERE created_at < now() - ${tage} * interval '1 day'
    AND (task_id IS NULL OR task_id IN (
      SELECT id FROM swarm.tasks WHERE state IN ('completed', 'failed', 'canceled', 'rejected')))`
  const ergebnis: AufraeumErgebnis = {
    inbox: Number(inbox.count ?? vorher.inbox),
    outbox: Number(outbox.count ?? vorher.outbox),
    artefakte: Number(art.count ?? vorher.artefakte),
    mib: vorher.mib,
  }
  if (ergebnis.inbox || ergebnis.outbox || ergebnis.artefakte) {
    // audit() macht sein eigenes begin() — nie innerhalb einer fremden Transaktion.
    await audit('hub', 'wartung.aufraeumen', null, { tage, ...ergebnis })
  }
  return ergebnis
}

/** `mxc://server/id` zerlegen — ohne den Doppelstrich, der gern mitwandert. */
export function mxcTeile(mxc: string): { server: string; id: string } | null {
  if (!mxc.startsWith('mxc://')) return null
  const [server, id] = mxc.slice('mxc://'.length).split('/')
  return server && id ? { server, id } : null
}

export interface MedienErgebnis {
  /** Ereignisse redigiert, damit Synapse die Datei als unreferenziert sieht. */
  redigiert: number
  /** Dateien sofort über die Admin-API gelöscht (braucht SYNAPSE_ADMIN_TOKEN). */
  blobs: number
  /** Ohne Ereignis: die Datei kann nur `media_retention` im Synapse holen. */
  verwaist: number
  fehler: number
}

/**
 * Medien-Retention (ADR-002 §4.37): Die Datenbank aufzuräumen reicht nicht — die
 * Datei liegt weiterhin im Media-Store des Synapse (5,0 GB am 2026-09-27, ohne
 * `media_retention`). Zwei Schritte:
 *
 *  1. Das `m.file`-Ereignis **redigieren**. Danach gilt die Datei als
 *     unreferenziert, und `media_retention.local_media_lifetime` im Synapse holt
 *     sie sich (§4.37, Konfiguration in ops/matrix).
 *  2. Mit `SYNAPSE_ADMIN_TOKEN` die Datei **sofort** löschen
 *     (`DELETE /_synapse/admin/v1/media/<server>/<id>`); ohne Token bleibt sie
 *     liegen und wird als `verwaist` gezählt.
 *
 * Läuft vor `aufraeumen()`, weil danach die Zeilen (und ihre `mxc`) weg sind.
 */
export async function medienAufraeumen(
  tage = RETENTION_TAGE,
  db: Db = sql,
  matrix: MatrixClient = new MatrixClient(),
): Promise<MedienErgebnis> {
  const zeilen = await db`
    SELECT a.id::text AS id, a.mxc, o.room_id, o.sent_event_id, o.as_user
    FROM swarm.artifacts a
    LEFT JOIN LATERAL (
      SELECT room_id, sent_event_id, as_user FROM swarm.outbox
      WHERE outbox.task_id = a.task_id AND outbox.sent_event_id IS NOT NULL
        AND outbox.payload::text LIKE '%' || a.mxc || '%'
      ORDER BY id DESC LIMIT 1
    ) o ON true
    WHERE a.mxc IS NOT NULL
      AND a.created_at < now() - ${tage} * interval '1 day'
      AND (a.task_id IS NULL OR a.task_id IN (
        SELECT id FROM swarm.tasks WHERE state IN ('completed','failed','canceled','rejected')))`

  const ergebnis: MedienErgebnis = { redigiert: 0, blobs: 0, verwaist: 0, fehler: 0 }
  const admin = process.env.SYNAPSE_ADMIN_TOKEN || ''

  interface Zeile { id: string; mxc: string; room_id: string | null; sent_event_id: string | null; as_user: string | null }
  for (const z of zeilen as unknown as Zeile[]) {
    if (z.room_id && z.sent_event_id) {
      const r = await matrix.redact(z.room_id, z.sent_event_id, `Retention: Ablage älter als ${tage} Tage`, {
        ...(z.as_user ? { user: z.as_user } : {}),
        txnId: `retention-${z.id}`,
      })
      if (r.ok) ergebnis.redigiert++
      else ergebnis.fehler++
    } else {
      ergebnis.verwaist++
    }

    const teile = mxcTeile(String(z.mxc))
    if (admin && teile) {
      try {
        const res = await fetch(`${env.homeserverUrl.replace(/\/$/, '')}/_synapse/admin/v1/media/${teile.server}/${teile.id}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${admin}` },
          signal: AbortSignal.timeout(10_000),
        })
        if (res.ok) ergebnis.blobs++
        else ergebnis.fehler++
      } catch {
        ergebnis.fehler++
      }
    }
  }
  if (zeilen.length) {
    await audit('hub', 'wartung.medien', null, { tage, ...ergebnis })
  }
  return ergebnis
}

function heute(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Einmal täglich ab 03:50 (nach dem Abgleich 03:40, vor der Tagessicherung).
 * Liefert null, wenn heute schon gelaufen oder die Zeit noch nicht da ist.
 */
export async function wartungFaellig(
  jetzt = new Date(),
  stunde = 3,
  minute = 50,
  db: Db = sql,
): Promise<boolean> {
  const flag = await getFlag<{ tag?: string }>('wartung', db)
  if (flag?.tag === heute()) return false
  const zeit = jetzt.getUTCHours() * 60 + jetzt.getUTCMinutes()
  return zeit >= stunde * 60 + minute
}

export async function wartungLauf(db: Db = sql): Promise<AufraeumErgebnis & { medien: MedienErgebnis }> {
  // Reihenfolge: Erst die Ereignisse redigieren und Dateien löschen,
  // danach die Zeilen — sonst ist das `mxc` schon weg.
  const medien = await medienAufraeumen(RETENTION_TAGE, db).catch(() => ({ redigiert: 0, blobs: 0, verwaist: 0, fehler: 0 }))
  const ergebnis = await aufraeumen(RETENTION_TAGE, db)
  await setFlag('wartung', { tag: heute(), ...ergebnis, medien }, 'hub', db)
  return { ...ergebnis, medien }
}
