/**
 * Ablage (§10.7, §14.3): Lange Ergebnisse und Material zwischen Agenten.
 *
 * Der Text bleibt in `swarm.artifacts` (Prüfung, Redaktion, Audit) und geht
 * zusätzlich als Datei in den Thread, damit Menschen in Element ihn sehen.
 * Grenze 5 MB — Synapse erlaubt 50, aber der Schwarm soll keine Datenhalde
 * werden. Nachrichten über 4000 Zeichen werden gekürzt und verweisen auf die
 * Datei; so bleibt der Thread lesbar und das Ergebnis vollständig.
 */
import { createHash } from 'node:crypto'
import { sql, type Db } from './db/index.js'
import { type NewOutbox } from './outbox.js'
import { redact } from './redact.js'
import type { Ctx } from './context.js'

export const MAX_BYTES = 5 * 1024 * 1024
/** Ab hier wird eine Nachricht gekürzt und der Rest als Datei angehängt (§10.7). */
export const NACHRICHT_MAX = 4000

export interface AblegenResultat {
  ok: boolean
  id?: number
  name?: string
  size?: number
  sha256?: string
  mxc?: string | null
  fehler?: string
}

export function dateiName(taskId: string, zweck: string): string {
  const stempel = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return `${taskId}-${zweck}-${stempel}.md`
}

/** Text in die Datenbank legen und, wenn möglich, nach Matrix hochladen. */
export async function ablegen(
  ctx: Ctx,
  o: { taskId: string | null; name: string; text: string; createdBy: string; mime?: string; asUser?: string },
  db: Db = sql,
): Promise<AblegenResultat> {
  const mime = o.mime ?? 'text/markdown'
  const daten = Buffer.from(o.text, 'utf8')
  if (daten.length > MAX_BYTES) {
    return { ok: false, fehler: `${(daten.length / 1024 / 1024).toFixed(1)} MB sind mehr als die 5 MB Grenze (§10.7)` }
  }
  const sha = createHash('sha256').update(daten).digest('hex')
  const [row] = await db`
    INSERT INTO swarm.artifacts (task_id, name, mime, size, sha256, data, created_by)
    VALUES (${o.taskId}, ${o.name}, ${mime}, ${daten.length}, ${sha}, ${daten}, ${o.createdBy})
    RETURNING id`
  const id = Number(row!.id)

  // Matrix ist eine Kopie: Scheitert der Upload, bleibt die Datei in der Datenbank.
  let mxc: string | null = null
  const hoch = await ctx.matrix.uploadMedia(o.name, mime, new Uint8Array(daten), o.asUser)
  if (hoch.ok) {
    mxc = hoch.mxc
    await db`UPDATE swarm.artifacts SET mxc = ${mxc} WHERE id = ${id}`
  } else {
    ctx.log.warn({ name: o.name, fehler: hoch.message }, 'Medien-Upload fehlgeschlagen — Datei liegt nur in der Datenbank')
  }
  return { ok: true, id, name: o.name, size: daten.length, sha256: sha, mxc }
}

/** Eine Datei als `m.file` in einen Thread stellen. */
export function anhangAusgabe(o: {
  roomId: string
  taskId: string | null
  thread: string | null
  name: string
  mime: string
  size: number
  mxc: string
  asUser?: string
  /**
   * Wen die Datei etwas angeht. Hermes verwirft in Räumen mit `require_mention`
   * alles ohne `m.mentions`, solange es den Thread nicht selbst kennt — ein
   * Anhang ohne Erwähnung kann also unbemerkt untergehen (ADR-002 §4.34).
   */
  mentions?: string[]
}): NewOutbox {
  return {
    kind: 'message',
    roomId: o.roomId,
    taskId: o.taskId,
    ...(o.asUser ? { asUser: o.asUser } : {}),
    payload: {
      type: 'm.room.message',
      role: 'rueckmeldung',
      content: {
        msgtype: 'm.file',
        body: o.name,
        filename: o.name,
        url: o.mxc,
        info: { mimetype: o.mime, size: o.size },
        ...(o.mentions?.length ? { 'm.mentions': { user_ids: o.mentions } } : {}),
        ...(o.thread
          ? {
              'm.relates_to': {
                rel_type: 'm.thread',
                event_id: o.thread,
                is_falling_back: true,
                'm.in_reply_to': { event_id: o.thread },
              },
            }
          : {}),
      },
    },
  }
}

/**
 * Kürzen und, wenn nötig, den vollen Text anhängen. Liefert den Nachrichtentext
 * und eine fertige Outbox-Zeile für den Anhang (oder null).
 */
export async function kuerzenUndAnhaengen(
  ctx: Ctx,
  o: { taskId: string; roomId: string; thread: string | null; text: string; zweck: string; createdBy: string; asUser?: string; mentions?: string[] },
  db: Db = sql,
): Promise<{ text: string; anhang: NewOutbox | null }> {
  if (o.text.length <= NACHRICHT_MAX) return { text: o.text, anhang: null }
  const gespeichert = await ablegen(
    ctx,
    {
      taskId: o.taskId,
      name: dateiName(o.taskId, o.zweck),
      text: o.text,
      createdBy: o.createdBy,
      ...(o.asUser ? { asUser: o.asUser } : {}),
    },
    db,
  )
  if (!gespeichert.ok || !gespeichert.mxc) {
    // Ohne Matrix-Kopie bleibt der Text gekürzt — aber die Datenbank hat alles.
    return {
      text: `${o.text.slice(0, NACHRICHT_MAX)}\n… (gekürzt, ${o.text.length} Zeichen; vollständig in swarm.artifacts${gespeichert.ok ? `, ID ${gespeichert.id}` : ''})`,
      anhang: null,
    }
  }
  return {
    text: `${o.text.slice(0, NACHRICHT_MAX)}\n… (gekürzt, ${o.text.length} Zeichen — vollständig in der Datei)`,
    anhang: anhangAusgabe({
      roomId: o.roomId,
      taskId: o.taskId,
      thread: o.thread,
      name: gespeichert.name!,
      mime: 'text/markdown',
      size: gespeichert.size!,
      mxc: gespeichert.mxc,
      ...(o.asUser ? { asUser: o.asUser } : {}),
      ...(o.mentions?.length ? { mentions: o.mentions } : {}),
    }),
  }
}

/** `artifact_get`: eine Datei eines Auftrags holen, redigiert. */
export async function holen(
  taskId: string,
  name?: string,
  db: Db = sql,
): Promise<{ name: string; mime: string; size: number; text: string } | null> {
  const [row] = name
    ? await db`
        SELECT name, mime, size, convert_from(data, 'UTF8') AS text FROM swarm.artifacts
        WHERE task_id = ${taskId} AND name = ${name} ORDER BY id DESC LIMIT 1`
    : await db`
        SELECT name, mime, size, convert_from(data, 'UTF8') AS text FROM swarm.artifacts
        WHERE task_id = ${taskId} ORDER BY id DESC LIMIT 1`
  if (!row) return null
  return {
    name: row.name as string,
    mime: row.mime as string,
    size: Number(row.size),
    text: redact(String(row.text ?? '')),
  }
}

export async function liste(taskId: string, db: Db = sql): Promise<{ name: string; size: number; mxc: string | null }[]> {
  const rows = await db`
    SELECT name, size, mxc FROM swarm.artifacts WHERE task_id = ${taskId} ORDER BY id`
  return rows.map((r) => ({ name: r.name as string, size: Number(r.size), mxc: (r.mxc as string | null) ?? null }))
}
