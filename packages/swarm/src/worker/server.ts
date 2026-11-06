/**
 * Worker-Server (§14.4, ADR-002 §4.4): L3-Worker wie codex-bot holen ihre
 * Aufträge über eine WebSocket-Verbindung ab, statt in einem Matrix-Raum zu
 * lesen. Der Hub bleibt die einzige Quelle für Zustände (§5.5): Er vergibt `job`,
 * verlängert die Lease bei jedem `beat`, zeigt `delta` als Fortschritt im Thread
 * der Karte (als Puppet, höchstens alle 15 s ein Edit) und setzt bei `done` und
 * `error` den Endzustand — immer über `zustandUndMeldung`, also mit Board, Lobby
 * und Audit wie bei jedem anderen Agenten.
 *
 * Frames sind JSON-Objekte mit `type`:
 *   Worker → Hub: ready {worker, version, capabilities {parallel?, nachrichten?}, laufend?} · pull · beat {task_id}
 *                 · delta {task_id, text} · done {task_id, result, files, cost_usd}
 *                 · error {task_id, message, retryable} · frage {task_id, text}
 *                 · status {eintraege: [{name, zustand, text?, link?}]} · meldung {text}
 *   Hub → Worker: job {task, lease_seconds} · cancel {task_id, reason}
 *                 · nachricht {task_id, text, event_id}
 *
 * Anmeldung: Bearer-Token mit Zweck `worker`, der Agent des Tokens braucht
 * `mode: worker`. Pro Agent gilt eine Verbindung; eine neue ersetzt die alte.
 * Einen Auftrag vergibt der Hub nur nach `pull`. Gleichzeitig laufen so viele,
 * wie der Worker in `capabilities.parallel` angibt (1–8, Standard 1).
 *
 * Seit ADR-002 §4.36 (Plum-Sitzungen einzeln):
 * - `frage` wirkt wie `ask_human`: input-required, ❓ im Thread und in der Lobby.
 * - Schreibt Vale im Thread eines Worker-Auftrags, kommt der Text als `nachricht`
 *   beim Worker an (`anWorker`, aus inbox.ts).
 * - `ready.laufend` nennt Aufträge, die der Worker über eine Unterbrechung hinweg
 *   weiterführt; der Hub übernimmt sie wieder, statt auf die Lease zu warten.
 * - `status` meldet den Stand der Einheiten eines Workers (Plum: Sitzungen) für `!plum` und `!agenten`.
 * - `meldung` wird eine Notice im eigenen Raum des Workers, etwa „neue Plum-Sitzung“ (höchstens 20/min).
 * - Ein Auftrag, der auf Vale wartet (input-required), läuft beim Worker weiter und
 *   bekommt kein `cancel`.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import websocket, { type WebSocket } from '@fastify/websocket'
import { sql } from '../db/index.js'
import { audit, isSwarmFrozen } from '../db/audit.js'
import { verifyToken, type TokenIdentitaet } from '../tokens.js'
import { agentById, roomsByKind, setStatus, touchSeen } from '../agents/store.js'
import { edit, notice } from '../appservice/messages.js'
import { enqueue, type NewOutbox } from '../outbox.js'
import { notify } from '../notify.js'
import { hatGeheimnis, redact } from '../redact.js'
import { kuerzenUndAnhaengen } from '../artifacts.js'
import { zustandUndMeldung } from '../tasks/transition.js'
import * as store from '../tasks/store.js'
import { ensurePuppet } from '../appservice/puppets.js'
import type { Ctx } from '../context.js'
import { einheitenVeroeffentlichen } from '../einheiten.js'
import { anmeldungWiederGut, widerrufenMelden } from '../tokenpflege.js'
import { kontingentMelden, verbundeneQuelle } from '../kontingente.js'
import { planZuerst, zustellungSetzen } from '../plan.js'
import { patchAusgabe } from '../patches.js'
import { plumSendenSetzen } from '../plumrueck.js'
import { modellFuerJob } from '../modelle.js'

export const LEASE_SEKUNDEN = 60
export const PARALLEL_MAX = 8
const TAKT_MS = 2_000
const DELTA_MS = 15_000
const DELTA_MAX = 20
/** So lange wartet der Hub nach `cancel` auf das `error` des Workers. */
const ABBRUCH_FRIST_MS = 60_000
const _ERGEBNIS_MAX = 12_000
/** Dieselbe Rückfrage kommt in dieser Zeit nicht zweimal in den Thread. */
const FRAGE_WIEDERHOLUNG_MS = 10 * 60_000
const STATUS_MAX = 60
const MELDUNGEN_PRO_MINUTE = 20
/** Zustände, in denen ein Auftrag beim Worker weiterläuft. */
const LAUFEND = ['working', 'input-required']

interface Lauf {
  abgebrochenAm: number | null
  fortschritt: { outboxId: number | null; at: number; anzahl: number }
  frage: { text: string; at: number } | null
}

interface Sitzung {
  agent: string
  socket: WebSocket
  bereit: boolean
  /** Offene `pull`: So viele weitere Aufträge nimmt der Worker gerade an. */
  wartet: number
  /** Aufträge gleichzeitig (`ready.capabilities.parallel`, 1–PARALLEL_MAX). */
  parallel: number
  laeufe: Map<string, Lauf>
  /** Eine Vergabe gleichzeitig: `pull` und der Takt dürfen nicht beide den letzten Platz belegen. */
  vergibt: boolean
  /** Liest der Worker `nachricht` (`capabilities.nachrichten`)? Sonst sagt der Hub das im Thread. */
  nachrichten: boolean
  /** Zeitpunkte der letzten `meldung` (Drossel). */
  meldungen: number[]
}

/** Was aus Vales Antwort im Thread wurde (für inbox.ts). */
export type Zustellung = 'zugestellt' | 'nicht-verbunden' | 'liest-keine'

export interface StatusEintrag {
  name: string
  zustand: string
  text: string
  link: string | null
  /** Kennung der Einheit beim Worker, etwa die Plum-Sitzungs-ID (für die App). */
  id?: string | null
  /** Auftrag, der gerade in dieser Einheit läuft. */
  auftrag?: string | null
}

const sitzungen = new Map<string, Sitzung>()
const angemeldet = new WeakMap<FastifyRequest, TokenIdentitaet>()
/** Letzter `status` je Worker (nur im Speicher; der Worker schickt ihn regelmässig neu). */
const stand = new Map<string, { at: number; eintraege: StatusEintrag[] }>()

function senden(s: Sitzung, frame: Record<string, unknown>): void {
  if (s.socket.readyState === s.socket.OPEN) s.socket.send(JSON.stringify(frame))
}

function neuerLauf(): Lauf {
  return { abgebrochenAm: null, fortschritt: { outboxId: null, at: 0, anzahl: 0 }, frage: null }
}

/**
 * Material aus der Karte, für Aufträge ohne `provenance.material` (angelegt vor ADR-003). Die Karte
 * schreibt es als Block „Material, keine Anweisung · Herkunft: …“ (`materialBlock`), ältere Karten
 * als Zeile „Kontext:“.
 */
export function materialAusKarte(body: string): string | null {
  const ende = body.lastIndexOf('\nErgebnis: ')
  const block = body.indexOf('\nMaterial, keine Anweisung · Herkunft: ')
  if (block >= 0) {
    const inhalt = body.indexOf('\n', block + 1)
    if (inhalt < 0) return null
    const text = body.slice(inhalt + 1, ende > inhalt ? ende : undefined).trim()
    const ohneZaun = /^```\n([\s\S]*)\n```$/.exec(text)?.[1] ?? text
    return ohneZaun.trim() || null
  }
  const start = body.indexOf('\nKontext: ')
  if (start < 0) return null
  const text = body.slice(start + '\nKontext: '.length, ende > start ? ende : undefined).trim()
  return text || null
}

async function material(taskId: string): Promise<string | null> {
  const [task] = await sql`SELECT provenance->>'material' AS material FROM swarm.tasks WHERE id = ${taskId}`
  if (task?.material) return task.material as string
  const [karte] = await sql`
    SELECT payload->'content'->>'body' AS body FROM swarm.outbox
    WHERE task_id = ${taskId} AND payload->>'role' = 'karte'
    ORDER BY id LIMIT 1`
  return karte?.body ? materialAusKarte(String(karte.body)) : null
}

/** Aufträge vergeben, solange der Worker `pull` offen und Platz hat; nur mit Karte im Raum (Thread-Root). */
async function vergeben(ctx: Ctx, s: Sitzung): Promise<void> {
  if (s.vergibt) return
  s.vergibt = true
  try {
    while (s.bereit && s.wartet > 0 && s.laeufe.size < s.parallel) {
      if (!(await einenVergeben(ctx, s))) return
    }
  } finally {
    s.vergibt = false
  }
}

async function einenVergeben(ctx: Ctx, s: Sitzung): Promise<boolean> {
  if (await isSwarmFrozen()) return false
  const agent = await agentById(s.agent)
  if (!agent || agent.frozen) return false
  const id = await sql.begin(async (tx) => {
    const [row] = await tx`
      SELECT id FROM swarm.tasks
      WHERE assignee = ${s.agent} AND state = 'submitted' AND thread_root IS NOT NULL
      ORDER BY (priority = 'high') DESC, created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED`
    if (!row) return null
    if (!(await zustandUndMeldung(ctx, tx, row.id as string, 'working', {}))) return null
    await tx`
      UPDATE swarm.tasks SET lease_until = now() + make_interval(secs => ${LEASE_SEKUNDEN})
      WHERE id = ${row.id as string}`
    return row.id as string
  })
  if (!id) return false
  const task = await store.getTask(id)
  if (!task) return false
  s.laeufe.set(id, neuerLauf())
  s.wartet--
  senden(s, {
    type: 'job',
    lease_seconds: LEASE_SEKUNDEN,
    task: {
      id: task.id,
      goal: task.goal,
      deliverable: task.deliverable,
      constraints: task.constraints,
      material: await material(task.id),
      budget_usd: task.budgetUsd === null ? null : Number(task.budgetUsd),
      budget_minutes: task.budgetMinutes,
      deadline: task.deadline,
      // Plan zuerst (matrix/PLAN-weiter.md, Punkt 8): erst einen Plan als `frage`, dann auf Vales Ja warten.
      plan_zuerst: planZuerst(task, s.agent),
      // Modell aus dem Admin-Bereich (App 2.2); fehlt bei Agenten ohne einstellbares Modell.
      modell: (await modellFuerJob(s.agent)) ?? undefined,
    },
  })
  await audit(s.agent, 'worker.job', id, { attempts: task.attempts })
  return true
}

async function fortschritt(ctx: Ctx, s: Sitzung, taskId: string, text: string): Promise<void> {
  const jetzt = Date.now()
  const lauf = s.laeufe.get(taskId)
  if (!lauf || lauf.abgebrochenAm) return
  if (jetzt - lauf.fortschritt.at < DELTA_MS || lauf.fortschritt.anzahl >= DELTA_MAX) return
  const meldung = redact(text).trim().slice(-1500)
  if (!meldung) return
  const task = await store.getTask(taskId)
  const agent = await agentById(s.agent)
  if (!task?.roomId || !task.threadRoot || !agent) return
  if (!(await ensurePuppet(ctx, agent.mxid, task.roomId))) return
  lauf.fortschritt.at = jetzt
  lauf.fortschritt.anzahl++
  const body = `⏳ ${task.id} · ${agent.displayName ?? agent.id}\n${meldung}`
  if (lauf.fortschritt.outboxId !== null) {
    const [erste] = await sql`SELECT sent_event_id FROM swarm.outbox WHERE id = ${lauf.fortschritt.outboxId}`
    // Ist die erste Meldung noch nicht draussen, wartet der Edit bis zum nächsten delta.
    if (!erste?.sent_event_id) return
    await enqueue(sql, [{
      kind: 'edit', roomId: task.roomId, asUser: agent.mxid, taskId: task.id,
      payload: { type: 'm.room.message', content: edit(erste.sent_event_id as string, body) },
    }], ctx.hub)
    return
  }
  const [outboxId] = await enqueue(sql, [{
    kind: 'message', roomId: task.roomId, asUser: agent.mxid, taskId: task.id,
    payload: { type: 'm.room.message', content: notice(body, { thread: task.threadRoot }) },
  }], ctx.hub)
  lauf.fortschritt.outboxId = outboxId ?? null
}

async function fertig(ctx: Ctx, s: Sitzung, id: string, f: Record<string, unknown>): Promise<void> {
  const lauf = s.laeufe.get(id)
  s.laeufe.delete(id)
  if (!lauf) return
  const task = await store.getTask(id)
  if (!task || !LAUFEND.includes(task.state) || lauf.abgebrochenAm) {
    await audit(s.agent, 'worker.done_verworfen', id, { state: task?.state ?? null })
    return
  }
  const roh = String(f.result ?? '')
  const ergebnis = redact(roh).trim()
  if (hatGeheimnis(roh)) await geheimnisAlarm(ctx, s.agent, id)
  if (!ergebnis) {
    await zustandUndMeldung(ctx, sql, id, 'failed', { failReason: 'Worker lieferte kein Ergebnis', actor: s.agent })
    return
  }
  const dateien = (Array.isArray(f.files) ? f.files : []).map((d) => redact(String(d))).slice(0, 50)
  const kosten = typeof f.cost_usd === 'number' && Number.isFinite(f.cost_usd) && f.cost_usd >= 0 ? f.cost_usd : null
  const agent = await agentById(s.agent)
  const puppetDa = agent && task.roomId ? await ensurePuppet(ctx, agent.mxid, task.roomId) : false
  // Kommt das Puppet nicht in den Raum — etwa weil Synapse gerade ausfällt —
  // spricht der Hub selbst. Das Ergebnis darf nie still verschwinden (§10.6);
  // die Outbox wiederholt den Versand, bis er klappt.
  const absender = puppetDa && agent ? agent.mxid : null
  await sql.begin(async (tx) => {
    if (kosten !== null) await store.addCost(id, kosten, tx)
    if (agent && task.roomId && task.threadRoot) {
      // Über 4000 Zeichen: Der Anfang steht in der Nachricht, alles Weitere als
      // Markdown-Datei im Thread (§10.7) — abschneiden würde Ergebnis verlieren.
      const { text, anhang } = await kuerzenUndAnhaengen(ctx, {
        taskId: id, roomId: task.roomId, thread: task.threadRoot, text: ergebnis,
        zweck: 'ergebnis', createdBy: agent.id, ...(absender ? { asUser: absender } : {}),
      }, tx)
      const ausgabe: NewOutbox[] = [{
        kind: 'message' as const, roomId: task.roomId, taskId: id,
        ...(absender ? { asUser: absender } : {}),
        payload: {
          type: 'm.room.message',
          role: 'rueckmeldung' as const,
          content: notice(
            `✅ ${id} · ${agent.displayName ?? agent.id}\n\n${text}` +
              (dateien.length ? `\n\nDateien: ${dateien.join(', ')}` : '') +
              (absender ? '' : `\n\n_(vom Hub zugestellt: ${agent.mxid} war nicht im Raum erreichbar)_`),
            { thread: task.threadRoot },
          ),
        },
      }]
      if (anhang) ausgabe.push(anhang)
      // Patch eines Code-Workers als Datei für die Diff-Ansicht (matrix/PLAN-weiter.md, Punkt 13).
      ausgabe.push(...(await patchAusgabe(ctx, {
        taskId: id, roomId: task.roomId, thread: task.threadRoot, agentId: agent.id, ...(absender ? { asUser: absender } : {}), f,
      }, tx)))
      await enqueue(tx, ausgabe, ctx.hub)
    }
    await zustandUndMeldung(ctx, tx, id, 'completed', { result: ergebnis, actor: agent?.id ?? s.agent })
  })
  await audit(s.agent, 'worker.done', id, { zeichen: ergebnis.length, dateien: dateien.length, kosten })
}

async function fehler(ctx: Ctx, s: Sitzung, id: string, f: Record<string, unknown>): Promise<void> {
  const lauf = s.laeufe.get(id)
  s.laeufe.delete(id)
  if (!lauf) return
  const task = await store.getTask(id)
  // Nach einem Abbruch ist der Zustand schon gesetzt; das `error` quittiert nur.
  if (!task || !LAUFEND.includes(task.state) || lauf.abgebrochenAm) return
  const grund = redact(String(f.message ?? 'unbekannter Fehler')).slice(0, 500)
  // Aus input-required gibt es keinen Weg zurück nach submitted: Dann ist der Fehler endgültig.
  const nochmal = f.retryable === true && task.attempts + 1 < 2 && task.state === 'working'
  await zustandUndMeldung(
    ctx, sql, id, nochmal ? 'submitted' : 'failed',
    nochmal ? { retry: true, note: `Worker-Fehler: ${grund}` } : { failReason: grund },
  )
  await audit(s.agent, 'worker.error', id, { grund, nochmal })
}

/** Plan §11.9, Test 5: geschwärzt wird immer, ein Treffer ist ausserdem ein Alarm. */
async function geheimnisAlarm(ctx: Ctx, agent: string, taskId: string): Promise<void> {
  await audit(agent, 'worker.redaktion', taskId, {})
  const [alarme] = await roomsByKind('alerts')
  if (alarme?.roomId) {
    await enqueue(sql, [{
      kind: 'message', roomId: alarme.roomId, taskId,
      payload: {
        type: 'm.room.message',
        content: notice(`🚨 ${taskId}: Das Ergebnis von ${agent} enthielt etwas, das wie ein Geheimnis aussieht. Geschwärzt, bitte prüfen.`),
      },
    }], ctx.hub)
  }
  await notify({ title: `Schwarm: Geheimnis im Ergebnis von ${agent}`, text: `${taskId} — geschwärzt, bitte prüfen`, priority: 4, tags: ['warning'] }, ctx.log)
}

async function behandeln(ctx: Ctx, s: Sitzung, f: Record<string, unknown>): Promise<void> {
  const taskId = typeof f.task_id === 'string' ? f.task_id : null
  const eigen = taskId !== null && s.laeufe.has(taskId)
  switch (f.type) {
    case 'ready': {
      if (f.worker !== s.agent) {
        s.socket.close(4003, 'Worker passt nicht zum Token')
        return
      }
      // Gleichzeitig läuft das Kleinere aus Angebot des Workers und `limits.parallel` der Konfiguration.
      const faehig = (f.capabilities && typeof f.capabilities === 'object' ? f.capabilities : {}) as Record<string, unknown>
      const angebot = Number(faehig.parallel)
      const erlaubt = (await agentById(s.agent))?.parallel ?? 1
      s.parallel = Math.max(1, Math.min(Number.isInteger(angebot) && angebot >= 1 ? angebot : 1, erlaubt, PARALLEL_MAX))
      s.nachrichten = faehig.nachrichten === true
      s.bereit = true
      await setStatus(s.agent, 'online')
      await touchSeen(s.agent)
      const wieder = await wiederaufnehmen(s, f.laufend)
      await audit(s.agent, 'worker.ready', null, {
        version: String(f.version ?? '').slice(0, 40), parallel: s.parallel, wiederaufgenommen: wieder,
      })
      return
    }
    case 'pull':
      s.wartet = Math.max(0, Math.min(s.wartet + 1, s.parallel - s.laeufe.size))
      await vergeben(ctx, s)
      return
    case 'beat':
      if (!eigen) return
      // Auch während input-required: Die Einheit wartet auf Vale und darf nicht als verschwunden gelten.
      await sql`
        UPDATE swarm.tasks SET lease_until = now() + make_interval(secs => ${LEASE_SEKUNDEN})
        WHERE id = ${taskId} AND state IN ('working', 'input-required')`
      await touchSeen(s.agent)
      return
    case 'delta':
      if (!eigen) return
      await fortschritt(ctx, s, taskId, String(f.text ?? ''))
      return
    case 'done':
      if (!eigen) return
      await fertig(ctx, s, taskId, f)
      return
    case 'error':
      if (!eigen) return
      await fehler(ctx, s, taskId, f)
      return
    case 'frage':
      if (!eigen) return
      await rueckfrage(ctx, s, taskId, String(f.text ?? ''))
      return
    case 'status': {
      await touchSeen(s.agent)
      // Abo-Stand des Workers (matrix/PLAN-weiter.md, Punkt 7); ein Status nur mit Kontingent lässt die Einheiten stehen.
      if (f.kontingente !== undefined) kontingentMelden(s.agent, f.kontingente)
      if (!Array.isArray(f.eintraege)) return
      const eintraege = statusEintraege(f.eintraege)
      stand.set(s.agent, { at: Date.now(), eintraege })
      // Für die App (matrix/PLAN-weiter.md, Punkt 17): gedrosselt und nur bei Änderung.
      await einheitenVeroeffentlichen(ctx, s.agent, eintraege)
      return
    }
    case 'meldung':
      await meldungPosten(ctx, s, String(f.text ?? ''))
      return
    default:
      ctx.log.debug({ agent: s.agent, type: f.type }, 'Unbekannter Worker-Frame — ignoriert')
  }
}

/**
 * Aufträge aus `ready.laufend` wieder übernehmen: nur eigene, die noch laufen. Alles andere bekommt
 * ein `cancel`, damit der Worker nicht an etwas weiterarbeitet, das der Hub längst neu vergeben hat.
 */
async function wiederaufnehmen(s: Sitzung, roh: unknown): Promise<number> {
  const ids = (Array.isArray(roh) ? roh : []).map(String).filter((id) => /^T-\d+$/.test(id)).slice(0, PARALLEL_MAX)
  let n = 0
  for (const id of ids) {
    const task = await store.getTask(id)
    const meins = !!task && task.assignee === s.agent && LAUFEND.includes(task.state)
    if (!meins || s.laeufe.size >= s.parallel) {
      senden(s, { type: 'cancel', task_id: id, reason: task ? `nicht mehr bei ${s.agent} (${task.state})` : 'unbekannt' })
      continue
    }
    s.laeufe.set(id, neuerLauf())
    await sql`
      UPDATE swarm.tasks SET lease_until = now() + make_interval(secs => ${LEASE_SEKUNDEN})
      WHERE id = ${id} AND state IN ('working', 'input-required')`
    await audit(s.agent, 'worker.wiederaufnahme', id, {})
    n++
  }
  return n
}

/** `frage` des Workers: wie `ask_human` (MCP) — input-required, ❓ im Thread und in der Lobby. */
async function rueckfrage(ctx: Ctx, s: Sitzung, taskId: string, roh: string): Promise<void> {
  const lauf = s.laeufe.get(taskId)
  if (!lauf || lauf.abgebrochenAm) return
  const text = redact(roh).trim().slice(0, 1500)
  if (!text) return
  if (hatGeheimnis(roh)) await geheimnisAlarm(ctx, s.agent, taskId)
  if (lauf.frage && lauf.frage.text === text && Date.now() - lauf.frage.at < FRAGE_WIEDERHOLUNG_MS) return
  lauf.frage = { text, at: Date.now() }
  const task = await store.getTask(taskId)
  const agent = await agentById(s.agent)
  if (!task || !agent || !LAUFEND.includes(task.state)) return
  const puppetDa = task.roomId ? await ensurePuppet(ctx, agent.mxid, task.roomId) : false
  const name = agent.displayName ?? agent.id
  await sql.begin(async (tx) => {
    if (task.state === 'working') await store.setState(task.id, 'input-required', {}, tx)
    const ausgabe: NewOutbox[] = []
    if (task.roomId && task.threadRoot) {
      ausgabe.push({
        kind: 'message', roomId: task.roomId, taskId: task.id,
        ...(puppetDa ? { asUser: agent.mxid } : {}),
        payload: {
          type: 'm.room.message',
          role: 'rueckmeldung' as const,
          content: notice(`❓ ${task.id} · ${name}\n${text}\n\nAntwort hier im Thread, sie geht direkt an ${name}.`, {
            thread: task.threadRoot,
          }),
        },
      })
    }
    const [lobby] = await roomsByKind('lobby', tx)
    if (lobby?.roomId) {
      ausgabe.push({
        kind: 'message', roomId: lobby.roomId, taskId: task.id,
        payload: {
          type: 'm.room.message',
          role: 'rueckmeldung' as const,
          content: notice(`❓ ${name} fragt zu ${task.id}:\n${text}\n\nAntwort im Thread der Karte.`),
        },
      })
    }
    if (ausgabe.length) await enqueue(tx, ausgabe, ctx.hub)
  })
  await audit(s.agent, 'worker.frage', taskId, {})
}

/** `meldung` des Workers: eine Notice in seinem eigenen Raum, als sein Puppet, geschwärzt und gedrosselt. */
async function meldungPosten(ctx: Ctx, s: Sitzung, roh: string): Promise<void> {
  const jetzt = Date.now()
  s.meldungen = s.meldungen.filter((t) => jetzt - t < 60_000)
  if (s.meldungen.length >= MELDUNGEN_PRO_MINUTE) return
  const text = redact(roh).trim().slice(0, 1500)
  if (!text) return
  const agent = await agentById(s.agent)
  if (!agent?.roomId || !(await ensurePuppet(ctx, agent.mxid, agent.roomId))) return
  s.meldungen.push(jetzt)
  await enqueue(sql, [{
    kind: 'message', roomId: agent.roomId, asUser: agent.mxid,
    payload: { type: 'm.room.message', content: notice(text) },
  }], ctx.hub)
}

function statusEintraege(roh: unknown): StatusEintrag[] {
  return (Array.isArray(roh) ? roh : [])
    .slice(0, STATUS_MAX)
    .map((e) => {
      const r = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
      const link = typeof r.link === 'string' && /^https:\/\/\S+$/.test(r.link) ? r.link.slice(0, 300) : null
      return {
        name: redact(String(r.name ?? '')).replace(/\s+/g, ' ').trim().slice(0, 60),
        zustand: String(r.zustand ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        text: redact(String(r.text ?? '')).replace(/\s+/g, ' ').trim().slice(0, 200),
        link,
        id: typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(r.id) ? r.id : null,
        auftrag: typeof r.auftrag === 'string' && /^T-\d{1,8}$/.test(r.auftrag) ? r.auftrag : null,
      }
    })
    .filter((e) => e.name)
}

/**
 * Takt: laufende Aufträge, die nicht mehr laufen (🛑, `!stop`, Lease abgelaufen), bekommen ein
 * `cancel`; Worker mit offenem `pull` und freiem Platz den nächsten Auftrag. Ein Auftrag, der auf
 * Vale wartet (input-required), läuft weiter: Die Frage ist offen, nicht der Auftrag weg.
 */
async function takt(ctx: Ctx): Promise<void> {
  for (const s of sitzungen.values()) {
    for (const [id, lauf] of s.laeufe) {
      if (lauf.abgebrochenAm) {
        if (Date.now() - lauf.abgebrochenAm > ABBRUCH_FRIST_MS) s.laeufe.delete(id)
        continue
      }
      const task = await store.getTask(id)
      if (task && LAUFEND.includes(task.state)) continue
      lauf.abgebrochenAm = Date.now()
      senden(s, { type: 'cancel', task_id: id, reason: task ? task.state : 'unbekannt' })
    }
    await vergeben(ctx, s)
  }
}

/** Welche Worker gerade verbunden und bereit sind (für die Alarme des Hubs, ADR-003 R4). */
export function verbundeneWorker(): Set<string> {
  return new Set([...sitzungen.values()].filter((s) => s.bereit).map((s) => s.agent))
}

/**
 * Vales Antwort in einem Auftrags-Thread an den Worker, der den Auftrag gerade führt (aus inbox.ts).
 * Nur Worker mit `capabilities.nachrichten` bekommen sie; ältere ignorierten den Frame stumm.
 */
export function anWorker(agent: string, taskId: string, text: string, eventId: string): Zustellung {
  const s = sitzungen.get(agent)
  const lauf = s?.laeufe.get(taskId)
  if (!s?.bereit || !lauf || lauf.abgebrochenAm || s.socket.readyState !== s.socket.OPEN) return 'nicht-verbunden'
  if (!s.nachrichten) return 'liest-keine'
  lauf.frage = null
  senden(s, { type: 'nachricht', task_id: taskId, text: text.slice(0, 4000), event_id: eventId })
  return 'zugestellt'
}

/** Einen Frame an einen verbundenen Worker, der Nachrichten liest (etwa `ergebnis` an die Plum-Brücke). */
export function workerFrame(agent: string, frame: Record<string, unknown>): boolean {
  const s = sitzungen.get(agent)
  if (!s?.bereit || !s.nachrichten || s.socket.readyState !== s.socket.OPEN) return false
  senden(s, frame)
  return true
}

// Wege für plan.ts (✅/❌ auf Rückfragen), kontingente.ts (Umleitung nur an verbundene Worker) und
// plumrueck.ts (Ergebnisse zurück in die Plum-Sitzung).
zustellungSetzen(anWorker)
verbundeneQuelle(verbundeneWorker)
plumSendenSetzen(workerFrame)

/** Letzter `status` eines Workers, etwa die Plum-Sitzungen für `!plum`. */
export function workerStand(agent: string): { at: number; eintraege: StatusEintrag[] } | null {
  return stand.get(agent) ?? null
}

export async function workerRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } })

  app.get('/worker', {
    websocket: true,
    preValidation: async (req, reply) => {
      const auth = req.headers.authorization
      const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : ''
      const identitaet = token ? await verifyToken(token, 'worker') : null
      if (!identitaet) {
        // Ein widerrufenes Token meldet der Hub (matrix/PLAN-weiter.md, Punkt 5).
        if (token) void widerrufenMelden(ctx, token, 'worker').catch(() => {})
        return reply.code(401).send({ error: 'Kein gültiges Worker-Token (Zweck worker)' })
      }
      void anmeldungWiederGut(ctx, identitaet.agent, 'worker').catch(() => {})
      const agent = await agentById(identitaet.agent)
      if (!agent || agent.mode !== 'worker') return reply.code(403).send({ error: 'Agent ist kein Worker' })
      angemeldet.set(req, identitaet)
    },
  }, (socket, req) => {
    const identitaet = angemeldet.get(req)
    if (!identitaet) {
      socket.close(4001, 'nicht angemeldet')
      return
    }
    const alt = sitzungen.get(identitaet.agent)
    if (alt) alt.socket.close(4000, 'ersetzt durch eine neue Verbindung')
    const s: Sitzung = {
      agent: identitaet.agent, socket, bereit: false, wartet: 0, parallel: 1, laeufe: new Map(), vergibt: false, nachrichten: false,
      meldungen: [],
    }
    sitzungen.set(identitaet.agent, s)
    ctx.log.info({ agent: s.agent }, 'Worker verbunden')

    // Frames einer Verbindung nacheinander: `done` darf ein `beat` nicht überholen.
    let kette = Promise.resolve()
    socket.on('message', (daten: Buffer, binaer: boolean) => {
      if (binaer) return
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(daten.toString('utf8')) as Record<string, unknown>
      } catch {
        return
      }
      if (!frame || typeof frame !== 'object') return
      kette = kette
        .then(() => behandeln(ctx, s, frame))
        .catch((err) => ctx.log.error({ err, agent: s.agent, type: frame.type }, 'Worker-Frame fehlgeschlagen'))
    })
    socket.on('close', () => {
      if (sitzungen.get(s.agent) === s) {
        sitzungen.delete(s.agent)
        // Ein laufender Auftrag bleibt `working`; läuft die Lease ab, holt ihn
        // der Watchdog zurück (§10.4). Neue Aufträge lehnt die Policy ab.
        void setStatus(s.agent, 'offline').catch(() => {})
        // Die App soll sehen, dass der Stand der Einheiten nicht mehr frisch ist.
        const letzter = stand.get(s.agent)
        if (letzter) void einheitenVeroeffentlichen(ctx, s.agent, letzter.eintraege, false).catch(() => {})
      }
      ctx.log.info({ agent: s.agent, auftraege: [...s.laeufe.keys()] }, 'Worker getrennt')
    })
  })

  let aktiv = false
  const schleife = setInterval(() => {
    if (aktiv) return
    aktiv = true
    void takt(ctx)
      .catch((err) => ctx.log.error({ err }, 'Worker-Takt fehlgeschlagen'))
      .finally(() => { aktiv = false })
  }, TAKT_MS)
  app.addHook('onClose', async () => {
    clearInterval(schleife)
    for (const s of sitzungen.values()) s.socket.close(1001, 'Hub fährt herunter')
  })
}
