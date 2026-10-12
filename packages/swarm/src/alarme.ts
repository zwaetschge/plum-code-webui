/**
 * Alarm-Lebenslauf (ADR-003 R4): was die Alerts des Rats konnten, jetzt am Hub.
 *
 * Eine Meldung mit Fingerabdruck ist ein Alarm, und pro Quelle und Fingerabdruck ist höchstens
 * einer offen:
 *  - **neu:** Der Hub legt eine Notice in `#schwarm-alarme` an, bei `crit` zusätzlich ntfy.
 *  - **wieder:** Der Hub zählt nur mit. Ein Wächter, der jede Minute prüft, flutet sonst den Raum.
 *  - **schlimmer** (warn → crit): Antwort im Thread der Notice, bei `crit` ntfy.
 *  - **behoben** (`resolved` von der Quelle): Der Alarm wird geschlossen, mit ✅ im Thread.
 *  - **info** mit Fingerabdruck ist ein stiller Hinweis: gezählt und in `!alarme`, aber ohne Notice.
 *    Die Container-Prüfung des Rats fand bei über hundert Containern Dutzende solcher Hinweise; als
 *    Notices machten sie `#schwarm-alarme` unlesbar. Steigt ein Hinweis auf warn oder crit, kommt
 *    er als gewöhnlicher Alarm.
 *
 * Vale reagiert auf die Notice: ✅ quittiert, 🔕 schaltet den Fingerabdruck 24 h stumm, 🔔 hebt das
 * auf. Quittiert heisst: zu, und still, bis die Quelle `resolved` schickt; nur wenn es schlimmer
 * wird, kommt er neu. Sonst käme ein Dauerzustand mit jeder Auffrischung der Wache zurück. Stumm
 * heisst gezählt, aber nicht gemeldet, auch nicht bei Verschärfung. Bots zählen nicht, ihre
 * Reaktionen landen im Audit.
 *
 * Der Hub meldet hier auch selbst, als Quelle `hub`: Ein Worker, der schon einmal verbunden war,
 * ist seit 15 min weg. Der Rat prüfte dafür die Anmeldung seiner Mitglieder („agent-auth“):
 * Wer erst im Bedarfsfall ausfällt, ist genau dann weg, wenn man ihn braucht.
 */
import { sql, type Db } from './db/index.js'
import { audit } from './db/audit.js'
import { roomsByKind } from './agents/store.js'
import { notice } from './appservice/messages.js'
import { ensurePuppet, istPuppet } from './appservice/puppets.js'
import { enqueue } from './outbox.js'
import { notify } from './notify.js'
import { redact } from './redact.js'
import type { Ctx } from './context.js'
import { verbundeneWorker } from './worker/server.js'
import { stufeNachLernen } from './lernen.js'

export type Stufe = 'info' | 'warn' | 'crit'

export const FINGERABDRUCK = /^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,127}$/
export const STUMM_STUNDEN = 24
const RANG: Record<Stufe, number> = { info: 0, warn: 1, crit: 2 }
const ZEICHEN: Record<Stufe, string> = { info: 'ℹ️', warn: '⚠️', crit: '🚨' }
/** So lange darf ein Worker weg sein, bevor der Hub meldet (Neustarts und Updates dauern kürzer). */
const WORKER_WEG_MS = Number(process.env.WORKER_WEG_MINUTEN || 15) * 60_000

export interface AlarmMeldung {
  quelle: string
  /** Anzeigename und MXID der Quelle; ohne Agent spricht der Hub selbst. */
  agent: { displayName: string | null; mxid: string } | null
  fingerabdruck: string
  level: Stufe
  titel: string
  text: string
  link?: string
  behoben: boolean
}

export interface AlarmErgebnis {
  status: number
  body: Record<string, unknown>
}

const uhrzeit = (d: Date) => d.toLocaleTimeString('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' })

async function eventDerNotice(db: Db, outboxId: number | null): Promise<string | null> {
  if (!outboxId) return null
  const [z] = await db`SELECT sent_event_id FROM swarm.outbox WHERE id = ${outboxId}`
  return (z?.sent_event_id as string | null) ?? null
}

async function istStumm(db: Db, quelle: string, fingerabdruck: string): Promise<Date | null> {
  const [z] = await db`
    SELECT bis FROM swarm.alarm_stumm
     WHERE quelle = ${quelle} AND fingerabdruck = ${fingerabdruck} AND bis > now()`
  return z ? new Date(String(z.bis)) : null
}

/** Antwort im Thread der Alarm-Notice; ist die Notice noch nicht raus, als eigene Zeile danach. */
async function imThread(
  ctx: Ctx, db: Db, raum: string, alarm: Record<string, unknown>, text: string, als?: string,
): Promise<void> {
  const outboxId = alarm.outbox_id == null ? null : Number(alarm.outbox_id)
  const thread = await eventDerNotice(db, outboxId)
  await enqueue(db, [{
    kind: 'message',
    roomId: raum,
    ...(als ? { asUser: als } : {}),
    ...(!thread && outboxId ? { dependsOn: outboxId } : {}),
    payload: { type: 'm.room.message', content: notice(text, thread ? { thread } : {}) },
  }], ctx.hub)
}

function alarmNotice(
  roomId: string, als: string | undefined, level: Stufe, absender: string, titel: string, text: string, link: string, fingerabdruck: string,
) {
  return {
    kind: 'message' as const,
    roomId,
    ...(als ? { asUser: als } : {}),
    payload: {
      type: 'm.room.message',
      content: notice(
        `${ZEICHEN[level]} ${absender}${titel}` +
          (text ? `\n${text}` : '') +
          (link ? `\n${link}` : '') +
          `\n${fingerabdruck} · ✅ quittieren · 🔕 ${STUMM_STUNDEN} h stumm`,
      ),
    },
  }
}

/** Eine Meldung mit Fingerabdruck durch den Lebenslauf schicken (aus /hooks/notify und vom Hub selbst). */
export async function alarmMelden(ctx: Ctx, meldung: AlarmMeldung): Promise<AlarmErgebnis> {
  // Lernende Alarme (matrix/PLAN-weiter.md, Punkt 15): Ein „stiller“ Fingerabdruck meldet warn nur noch als info.
  const m = await stufeNachLernen(meldung)
  const [raum] = await roomsByKind('alerts')
  if (!raum?.roomId) return { status: 503, body: { error: '#schwarm-alarme fehlt' } }
  const titel = redact(m.titel)
  const text = redact(m.text).trim()
  const link = m.link ? redact(m.link) : ''
  const name = m.agent?.displayName ?? m.quelle
  // Als Puppet der Quelle, sonst als Hub mit Absender im Text (wie bei /hooks/notify).
  const alsPuppet = !!m.agent && istPuppet(m.agent.mxid) && (await ensurePuppet(ctx, m.agent.mxid, raum.roomId))
  const als = alsPuppet ? m.agent!.mxid : undefined
  const absender = alsPuppet ? '' : `${name}: `

  type Push = { title: string; text: string; priority: number; tags: string[] }
  const { ergebnis, ntfy } = await sql.begin(async (tx): Promise<{ ergebnis: AlarmErgebnis; ntfy: Push | null }> => {
    let ntfy: Push | null = null
    const fertig = (status: number, body: Record<string, unknown>) => ({ ergebnis: { status, body }, ntfy })
    // Zwei Meldungen desselben Alarms gleichzeitig dürfen nicht zwei Notices anlegen.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`alarm|${m.quelle}|${m.fingerabdruck}`}))`
    const [offen] = await tx`
      SELECT id, level, anzahl, outbox_id FROM swarm.alarme
       WHERE quelle = ${m.quelle} AND fingerabdruck = ${m.fingerabdruck} AND zustand = 'offen'`
    const stumm = await istStumm(tx, m.quelle, m.fingerabdruck)

    if (m.behoben) {
      if (!offen) {
        // Von Vale quittiert und jetzt wirklich vorbei: Der nächste Auftritt ist wieder ein neuer Alarm.
        const [quittiert] = await tx`
          UPDATE swarm.alarme SET zustand = 'behoben', beendet_am = now()
           WHERE id = (SELECT id FROM swarm.alarme WHERE quelle = ${m.quelle} AND fingerabdruck = ${m.fingerabdruck}
                        ORDER BY id DESC LIMIT 1)
             AND zustand = 'geschlossen'
          RETURNING id`
        return fertig(200, { ok: true, alarm: quittiert ? Number(quittiert.id) : null })
      }
      await tx`
        UPDATE swarm.alarme SET zustand = 'behoben', beendet_am = now(), beendet_von = ${m.quelle}, zuletzt = now()
         WHERE id = ${offen.id}`
      // Ein stiller Hinweis (nie gepostet) geht auch still zu. Eine gepostete Notice bekommt ihr ✅
      // im Thread auch während der Stille, wie `clear()` im Rat: Entwarnung ist keine Störung, und
      // App und Element sehen sonst nie, dass es vorbei ist. ntfy dagegen nur ohne Stille.
      if (offen.outbox_id) {
        await imThread(ctx, tx, raum.roomId!, offen, `✅ ${absender}behoben: ${titel}${text ? `\n${text}` : ''}`, als)
        if (!stumm && offen.level === 'crit') ntfy = { title: `${name}: behoben`, text: titel, priority: 3, tags: ['white_check_mark'] }
      }
      await audit(m.quelle, 'alarm.behoben', null, { alarm: Number(offen.id), fingerabdruck: m.fingerabdruck })
      return fertig(200, { ok: true, alarm: Number(offen.id), zustand: 'behoben' })
    }

    if (offen) {
      const alt = offen.level as Stufe
      const schlimmer = RANG[m.level] > RANG[alt]
      await tx`
        UPDATE swarm.alarme
           SET anzahl = anzahl + 1, zuletzt = now(), titel = ${titel}, text = ${text},
               level = ${schlimmer ? m.level : alt}
         WHERE id = ${offen.id}`
      if (schlimmer) {
        if (!stumm && !offen.outbox_id) {
          // Aus einem stillen Hinweis wird ein Alarm: jetzt mit eigener Notice.
          const [neueNotice] = await enqueue(tx, [alarmNotice(raum.roomId!, als, m.level, absender, titel, text, link, m.fingerabdruck)], ctx.hub)
          await tx`UPDATE swarm.alarme SET outbox_id = ${neueNotice ?? null} WHERE id = ${offen.id}`
          if (m.level === 'crit') ntfy = { title: `${name}: ${titel}`, text: [text, link].filter(Boolean).join('\n'), priority: 5, tags: ['rotating_light'] }
        } else if (!stumm) {
          await imThread(ctx, tx, raum.roomId!, offen,
            `⬆️ ${ZEICHEN[m.level]} ${absender}jetzt ${m.level}: ${titel}${text ? `\n${text}` : ''}${link ? `\n${link}` : ''}`, als)
          if (m.level === 'crit') ntfy = { title: `${name}: ${titel}`, text: [text, link].filter(Boolean).join('\n'), priority: 5, tags: ['rotating_light'] }
        }
        await audit(m.quelle, 'alarm.schlimmer', null, { alarm: Number(offen.id), von: alt, zu: m.level, stumm: !!stumm })
      }
      return fertig(200, { ok: true, alarm: Number(offen.id), wiederholt: true, anzahl: Number(offen.anzahl) + 1 })
    }

    // Von Vale mit ✅ quittiert, von der Quelle nie als behoben gemeldet: Der Zustand besteht fort.
    // Wiederholungen (auch die Auffrischung der Wache) zählen still; nur schlimmer ist neu.
    const [zuletzt] = await tx`
      SELECT id, level, zustand FROM swarm.alarme WHERE quelle = ${m.quelle} AND fingerabdruck = ${m.fingerabdruck}
       ORDER BY id DESC LIMIT 1`
    if (zuletzt?.zustand === 'geschlossen' && RANG[m.level] <= RANG[zuletzt.level as Stufe]) {
      await tx`UPDATE swarm.alarme SET anzahl = anzahl + 1, zuletzt = now() WHERE id = ${zuletzt.id}`
      return fertig(200, { ok: true, alarm: Number(zuletzt.id), quittiert: true })
    }
    const [neu] = await tx`
      INSERT INTO swarm.alarme (quelle, fingerabdruck, level, titel, text)
      VALUES (${m.quelle}, ${m.fingerabdruck}, ${m.level}, ${titel}, ${text})
      RETURNING id`
    const id = Number(neu!.id)
    if (stumm) {
      await audit(m.quelle, 'alarm.stumm_gezaehlt', null, { alarm: id, fingerabdruck: m.fingerabdruck })
      return fertig(202, { ok: true, alarm: id, stumm: true })
    }
    if (m.level === 'info') return fertig(202, { ok: true, alarm: id, still: true })
    const [outboxId] = await enqueue(tx, [alarmNotice(raum.roomId!, als, m.level, absender, titel, text, link, m.fingerabdruck)], ctx.hub)
    await tx`UPDATE swarm.alarme SET outbox_id = ${outboxId ?? null} WHERE id = ${id}`
    await audit(m.quelle, 'alarm.neu', null, { alarm: id, level: m.level, fingerabdruck: m.fingerabdruck })
    if (m.level === 'crit') ntfy = { title: `${name}: ${titel}`, text: [text, link].filter(Boolean).join('\n'), priority: 5, tags: ['rotating_light'] }
    return fertig(202, { ok: true, alarm: id })
  })
  if (ntfy) await notify(ntfy, ctx.log)
  return ergebnis
}

/**
 * Reaktion auf eine Alarm-Notice. `true` heisst: Das Ziel war ein Alarm, die Reaktion ist
 * erledigt, egal von wem. Wirken kann nur Vale.
 */
export async function alarmReaktion(
  ctx: Ctx,
  tx: Db,
  row: { sender: string; room_id: string },
  zielEvent: string,
  zeichen: string | undefined,
): Promise<boolean> {
  const [raum] = await roomsByKind('alerts', tx)
  if (!raum?.roomId || row.room_id !== raum.roomId) return false
  const [alarm] = await tx`
    SELECT a.id, a.quelle, a.fingerabdruck, a.zustand, a.titel, a.outbox_id
      FROM swarm.outbox o JOIN swarm.alarme a ON a.outbox_id = o.id
     WHERE o.sent_event_id = ${zielEvent}
     LIMIT 1`
  if (!alarm) return false
  if (row.sender !== ctx.owner) {
    await audit(row.sender, 'alarm.fremde_reaktion', null, { alarm: Number(alarm.id), zeichen: zeichen ?? null })
    return true
  }
  const kennung = { alarm: Number(alarm.id), fingerabdruck: String(alarm.fingerabdruck) }
  const k = (zeichen ?? '').replace(/️/g, '')
  if (k === '✅' || k === '✔') {
    if (alarm.zustand !== 'offen') return true
    await tx`
      UPDATE swarm.alarme SET zustand = 'geschlossen', beendet_am = now(), beendet_von = ${row.sender}
       WHERE id = ${alarm.id} AND zustand = 'offen'`
    await imThread(ctx, tx, raum.roomId, alarm, '✅ quittiert von Vale · meldet sich erst wieder, wenn er behoben war oder schlimmer wird')
    await audit(row.sender, 'alarm.geschlossen', null, kennung)
  } else if (k === '🔕' || k === '🔇') {
    const bis = new Date(Date.now() + STUMM_STUNDEN * 3_600_000)
    await tx`
      INSERT INTO swarm.alarm_stumm (quelle, fingerabdruck, bis, von)
      VALUES (${alarm.quelle}, ${alarm.fingerabdruck}, ${bis}, ${row.sender})
      ON CONFLICT (quelle, fingerabdruck) DO UPDATE SET bis = EXCLUDED.bis, von = EXCLUDED.von`
    await imThread(ctx, tx, raum.roomId, alarm, `🔕 stumm bis ${uhrzeit(bis)} (${STUMM_STUNDEN} h) · 🔔 hebt das auf`)
    await audit(row.sender, 'alarm.stumm', null, { ...kennung, bis: bis.toISOString() })
  } else if (k === '🔔') {
    const weg = await tx`
      DELETE FROM swarm.alarm_stumm WHERE quelle = ${alarm.quelle} AND fingerabdruck = ${alarm.fingerabdruck} RETURNING bis`
    if (weg.length) {
      await imThread(ctx, tx, raum.roomId, alarm, '🔔 wieder laut')
      await audit(row.sender, 'alarm.laut', null, kennung)
    }
  }
  return true
}

/** Offene Alarme für `!alarme`, die schlimmsten zuerst. */
export async function alarmListe(): Promise<string> {
  const zeilen = await sql`
    SELECT a.id, a.quelle, a.fingerabdruck, a.level, a.titel, a.anzahl, a.erstmals,
           (SELECT s.bis FROM swarm.alarm_stumm s
             WHERE s.quelle = a.quelle AND s.fingerabdruck = a.fingerabdruck AND s.bis > now()) AS stumm_bis
      FROM swarm.alarme a
     WHERE a.zustand = 'offen'
     ORDER BY CASE a.level WHEN 'crit' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, a.erstmals
     LIMIT 30`
  if (!zeilen.length) return 'Keine offenen Alarme.'
  const liste = zeilen.map((z) => {
    const stumm = z.stumm_bis ? ` · 🔕 bis ${uhrzeit(new Date(String(z.stumm_bis)))}` : ''
    const mal = Number(z.anzahl) > 1 ? ` · ${z.anzahl}×` : ''
    return `${ZEICHEN[z.level as Stufe]} ${z.quelle}: ${z.titel} · seit ${uhrzeit(new Date(String(z.erstmals)))}${mal}${stumm}\n   ${z.fingerabdruck}`
  })
  return [`Offene Alarme (${zeilen.length}, ℹ️ = stiller Hinweis ohne Notice):`, ...liste,
    'Quittieren mit ✅ auf der Notice in #schwarm-alarme, stumm mit 🔕.'].join('\n')
}

/** Seit wann der Hub einen Worker vermisst. Nach einem Neustart des Hubs beginnt die Frist neu. */
const vermisst = new Map<string, number>()

/**
 * Worker, die schon einmal verbunden waren und seit 15 min fehlen, als Alarm des Hubs; wieder
 * da heisst behoben. Massgeblich ist die offene Verbindung, nicht `status` in der Tabelle, denn
 * der bleibt nach einem Neustart des Hubs stehen. Nie verbundene (Anmeldung fehlt noch) meldet
 * der Hub nicht, eingefrorene auch nicht, die sind gewollt still.
 */
export async function pruefeWorker(ctx: Ctx, jetzt = Date.now()): Promise<{ weg: number; zurueck: number }> {
  const agenten = await sql`SELECT id, display_name, frozen, last_seen FROM swarm.agents WHERE mode = 'worker'`
  const offen = new Set((await sql`
    SELECT fingerabdruck FROM swarm.alarme WHERE quelle = 'hub' AND zustand = 'offen'
       AND fingerabdruck LIKE 'worker-weg:%'`).map((z) => String(z.fingerabdruck)))
  const verbunden = verbundeneWorker()
  let weg = 0
  let zurueck = 0
  for (const a of agenten) {
    const id = String(a.id)
    const fp = `worker-weg:${id}`
    const name = (a.display_name as string | null) ?? id
    if (verbunden.has(id)) {
      vermisst.delete(id)
      if (offen.has(fp)) {
        await alarmMelden(ctx, {
          quelle: 'hub', agent: null, fingerabdruck: fp, level: 'info', behoben: true,
          titel: `${name} ist wieder verbunden`, text: '',
        })
        zurueck++
      }
      continue
    }
    if (!a.last_seen || a.frozen) {
      vermisst.delete(id)
      continue
    }
    const seit = vermisst.get(id) ?? jetzt
    vermisst.set(id, seit)
    if (jetzt - seit < WORKER_WEG_MS || offen.has(fp)) continue
    await alarmMelden(ctx, {
      quelle: 'hub', agent: null, fingerabdruck: fp, level: 'warn', behoben: false,
      titel: `${name} ist nicht verbunden`,
      text: `Zuletzt gesehen ${uhrzeit(new Date(String(a.last_seen)))}. Aufträge an ${id} warten, bis der Worker zurück ist.`,
    })
    weg++
  }
  return { weg, zurueck }
}
