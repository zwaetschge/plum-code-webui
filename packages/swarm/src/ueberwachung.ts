/**
 * Überwachen (§10.5, §11.8, N1): Was `/health` nur anzeigt, muss von selbst
 * melden — sonst steht es zwar da, aber niemand schaut.
 *
 * Drei Prüfungen:
 *  - **Inbox hängt** (älteste unerledigte Zeile > 10 min): N1 verspricht, dass
 *    jede Lücke in ≤ 10 min auffällt. Ein Git-Event, das der Verarbeiter nicht
 *    schafft, ist genau so eine Lücke.
 *  - **Outbox-Rückstand** > `OUTBOX_ALARM` (50): Der Hub schreibt, aber Synapse
 *    nimmt nicht an.
 *  - **Audit-Kette gebrochen** (§11.8): einmal täglich, denn nachrechnen kostet
 *    einen vollen Scan.
 *
 * Jede Meldung kommt höchstens einmal pro Stunde (bzw. Tag), damit ein Dauerzustand
 * nicht im Viertelstundentakt ntfy flutet. Dead Letter, Ping-Ausfälle,
 * Kanarienvogel und Circuit-Breaker melden die betroffenen Stellen selbst.
 */
import { sql } from './db/index.js'
import { getFlag, setFlag, verifyAudit } from './db/audit.js'
import { roomsByKind } from './agents/store.js'
import { backlog, enqueue } from './outbox.js'
import { notify } from './notify.js'
import { inboxLag } from './appservice/transactions.js'
import { env } from './env.js'
import type { Ctx } from './context.js'

export const UEBERWACHUNG_TAKT_MS = 5 * 60_000

async function einmalPro(name: string, jetzt: string): Promise<boolean> {
  const flag = await getFlag<{ stunde?: string }>(name)
  if (flag?.stunde === jetzt) return false
  await setFlag(name, { stunde: jetzt }, 'hub')
  return true
}

async function inLogRaum(ctx: Ctx, text: string): Promise<void> {
  const [logRoom] = await roomsByKind('log')
  if (!logRoom?.roomId) return
  await enqueue(sql, [{
    kind: 'message',
    roomId: logRoom.roomId,
    payload: { type: 'm.room.message', content: { msgtype: 'm.notice', body: text } },
  }], ctx.hub)
}

export interface UeberwachungLauf {
  inbox: boolean
  outbox: boolean
  audit: boolean | null
}

/**
 * @param stunde  Schlüssel für die once-per-hour-Drosselung; in Prüfungen frei wählbar.
 * @param auditPfad  Audit-Kette nachrechnen (Standard: nur zwischen 03:00 und 04:00).
 */
export async function runUeberwachung(
  ctx: Ctx,
  opts: { stunde?: string; auditPfad?: boolean } = {},
): Promise<UeberwachungLauf> {
  const jetzt = new Date()
  const stunde = opts.stunde ?? `${jetzt.getUTCFullYear()}-${jetzt.getUTCMonth()}-${jetzt.getUTCDate()}T${jetzt.getUTCHours()}`
  const ergebnis: UeberwachungLauf = { inbox: false, outbox: false, audit: null }

  // 1) Inbox: N1 — eine Lücke darf nicht länger als 10 min unbemerkt bleiben.
  const inbox = await inboxLag()
  if ((inbox.oldestMinutes ?? 0) > env.inboxAlarmMinutes) {
    if (await einmalPro('alarm:inbox', stunde)) {
      const text =
        `⚠️ Inbox hängt: ${inbox.pending} unerledigte Events, das älteste seit ${inbox.oldestMinutes} min` +
        (inbox.dead ? `, ${inbox.dead} Dead Letter` : '') + '. N1 verletzt — bitte ansehen.'
      ctx.log.error({ ...inbox }, 'Inbox hängt')
      await inLogRaum(ctx, text)
      await notify({ title: 'Schwarm: Inbox hängt', text, priority: 5, tags: ['rotating_light'] }, ctx.log)
      ergebnis.inbox = true
    }
  }

  // 2) Outbox-Rückstand: Der Hub schreibt, Synapse nimmt nicht an.
  const out = await backlog()
  if (out.pending > env.outboxAlarm) {
    if (await einmalPro('alarm:outbox', stunde)) {
      const text = `⚠️ Outbox-Rückstand ${out.pending} (Schwelle ${env.outboxAlarm})` +
        (out.oldestMinutes !== null ? `, älteste Zeile ${out.oldestMinutes} min` : '') +
        (out.dead ? `, ${out.dead} Dead Letter` : '') + '.'
      ctx.log.warn({ ...out }, 'Outbox-Rückstand')
      await inLogRaum(ctx, text)
      await notify({ title: 'Schwarm: Outbox-Rückstand', text, priority: 4, tags: ['warning'] }, ctx.log)
      ergebnis.outbox = true
    }
  }

  // 3) Audit-Kette (§11.8): einmal am Tag, nach dem nächtlichen Abgleich.
  const auditLauf = opts.auditPfad ?? (jetzt.getUTCHours() === 3)
  if (auditLauf) {
    const tag = `${stunde.slice(0, 10)}`
    if (await einmalPro('alarm:audit', tag)) {
      const prüfung = await verifyAudit()
      ergebnis.audit = prüfung.ok
      if (!prüfung.ok) {
        const text = `🚨 Audit-Kette gebrochen bei Zeile ${prüfung.brokenAt} von ${prüfung.rows} — ` +
          'jemand hat swarm.audit verändert oder ein Lauf ist halb durchgekommen. !audit rechnet nach.'
        ctx.log.error({ ...prüfung }, 'Audit-Kette gebrochen')
        await inLogRaum(ctx, text)
        await notify({ title: 'Schwarm: Audit-Kette gebrochen', text, priority: 5, tags: ['rotating_light'] }, ctx.log)
      }
    }
  }

  return ergebnis
}
