/**
 * Der Rat im Schwarm (ADR-003 R3): `!rat` beruft echte Schwarm-Agenten ein, statt eine Frage an
 * den alten Rat weiterzureichen. Die Zustandsmaschine stammt aus
 * `packages/core/src/orchestrator/index.ts` (`advance`, `synthesize`):
 *
 *  - **debatte** (Standard): Runde 1 unabhängig; Runde 2 prüft jedes Mitglied die anderen; dann Synthese.
 *  - **broadcast:** eine Runde, dann Synthese.
 *  - **vote:** alle stimmen ab, der Hub zählt aus, dann Synthese.
 *  - **lead <rolle>:** die Rolle arbeitet, die anderen prüfen ihr Ergebnis, dann Synthese.
 *  - **staffel:** eines nach dem anderen prüft das vorige Ergebnis, dann Synthese.
 *  - **still <rolle>:** nur diese Rolle, ohne Synthese.
 *
 * Jeder Beitrag ist ein gewöhnlicher Auftrag an ein Mitglied (Budget, Watchdog, Kill-Switch gelten).
 * Der Lauf hängt an einem Auftrag an den Agenten `rat`: Dessen Karte in #ag-rat ist der Thread, in
 * den der Hub jeden Beitrag spiegelt, als Puppet des Mitglieds. Die Synthese schreibt ein Moderator
 * (ebenfalls ein Mitglied), der Beschluss geht zusätzlich nach #schwarm-log. Ein Beitrag reicht
 * nicht für eine Synthese; dann gilt er selbst als Ergebnis.
 */
import { sql, type Db } from '../db/index.js'
import { audit, getFlag, isSwarmFrozen } from '../db/audit.js'
import { agentById, roomsByKind, type AgentRow } from '../agents/store.js'
import { notice } from '../appservice/messages.js'
import { ensurePuppet, istPuppet } from '../appservice/puppets.js'
import { enqueue } from '../outbox.js'
import { redact } from '../redact.js'
import type { Ctx } from '../context.js'
import { createTaskFlow } from '../tasks/create.js'
import { zustandUndMeldung } from '../tasks/transition.js'
import * as store from '../tasks/store.js'
import { verbundeneWorker } from '../worker/server.js'
import {
  type Beitrag, type RatPrompt, empfehlungAus, konfidenzAus, konsensAus, kritik, pruefung, rundeEins, stimme,
  synthese, votumAus,
} from './prompts.js'

export const RAT_MODI = ['broadcast', 'debatte', 'vote', 'lead', 'staffel', 'still'] as const
export type RatModus = (typeof RAT_MODI)[number]

const liste = (wert: string | undefined, standard: string) =>
  (wert || standard).split(',').map((s) => s.trim()).filter(Boolean)
/** Mitglieder in dieser Reihenfolge (Staffel, Moderator-Wahl). Brian und Plum zählen, wenn erreichbar. */
export const MITGLIEDER = liste(process.env.RAT_MITGLIEDER, 'claude-code,codex-host,brian,plum')
const MODERATOREN = liste(process.env.RAT_MODERATOR, 'claude-code,codex-host,brian,plum')
const RUNDE_MS = Number(process.env.RAT_RUNDE_MINUTEN || 30) * 60_000
const BEITRAG_MAX = 3500
const ALIAS: Record<string, string> = { claude: 'claude-code', codex: 'codex-host', hermes: 'brian' }

export interface RatNativBefehl {
  modus: RatModus
  rollen: string[]
  frage: string
}

function rolleAus(teil: string | undefined, mitglieder: string[]): string | null {
  const k = (teil ?? '').toLowerCase().replace(/^@/, '').replace(/^_sw_/, '').split(':')[0]!
  const id = ALIAS[k] ?? k
  return mitglieder.includes(id) ? id : null
}

/**
 * `!rat debatte Soll der Backup-Job auf 03:00?` → Modus und Rollen. `lead` und `still` nennen die
 * Rolle ausdrücklich (`claude`, `codex`, `brian`, `plum` oder die Agenten-ID). Ohne Modus: Debatte.
 */
export function parseRatNativ(eingabe: string, mitglieder: string[] = MITGLIEDER): RatNativBefehl | null {
  const rest = eingabe.trim()
  if (!rest) return null
  const [kopf, ...tail] = rest.split(/\s+/)
  const modus = (kopf ?? '').toLowerCase()
  if (!(RAT_MODI as readonly string[]).includes(modus)) return { modus: 'debatte', rollen: [...mitglieder], frage: rest }
  const brauchtRolle = modus === 'lead' || modus === 'still'
  const rolle = brauchtRolle ? rolleAus(tail[0], mitglieder) : null
  if (brauchtRolle && !rolle) return null
  const frage = (brauchtRolle ? tail.slice(1) : tail).join(' ').trim()
  if (!frage) return null
  const rollen = modus === 'still' ? [rolle!] : rolle ? [rolle, ...mitglieder.filter((m) => m !== rolle)] : [...mitglieder]
  return { modus: modus as RatModus, rollen, frage }
}

/** Kann das Mitglied jetzt einen Auftrag annehmen? Worker brauchen eine offene Verbindung. */
async function kannArbeiten(id: string): Promise<AgentRow | null> {
  const a = await agentById(id)
  if (!a || a.frozen || !a.roomId) return null
  if (await getFlag(`raum:${a.roomId}`)) return null
  if (a.mode === 'worker') return verbundeneWorker().has(id) ? a : null
  if (a.mode === 'native') return a.status !== 'offline' ? a : null
  return null
}

const name = (a: AgentRow | null, id: string) => a?.displayName ?? id

export type RatNativStart =
  | { ok: true; task: string; mitglieder: string[]; fehlen: string[]; moderator: string | null; wartet: boolean }
  | { ok: false; code: string; reason: string }

/** `!rat …` → Auftrag an `rat` (Thread in #ag-rat) und ein Lauf; die Runden startet der Takt. */
export async function ratStarten(
  ctx: Ctx,
  o: { cmd: RatNativBefehl; originRoom: string; originThread: string | null; eventId: string },
): Promise<RatNativStart> {
  const rat = await agentById('rat')
  if (!rat?.roomId) return { ok: false, code: 'kein-agent', reason: 'Agent `rat` mit Raum #ag-rat fehlt in agents.swarm.yaml.' }
  const da: string[] = []
  const fehlen: string[] = []
  for (const id of o.cmd.rollen) ((await kannArbeiten(id)) ? da : fehlen).push(id)
  if ((o.cmd.modus === 'lead' || o.cmd.modus === 'still') && !da.includes(o.cmd.rollen[0]!)) {
    const a = await agentById(o.cmd.rollen[0]!)
    return { ok: false, code: 'rolle-fehlt', reason: `${name(a, o.cmd.rollen[0]!)} ist gerade nicht erreichbar.` }
  }
  if (!da.length) return { ok: false, code: 'keine-mitglieder', reason: `Kein Ratsmitglied erreichbar (${o.cmd.rollen.join(', ')}).` }
  let moderator: string | null = null
  if (o.cmd.modus !== 'still') for (const id of MODERATOREN) if (await kannArbeiten(id)) { moderator = id; break }

  const erstellt = await createTaskFlow(ctx, {
    goal: `Rat (${o.cmd.modus}): ${o.cmd.frage}`.slice(0, 900),
    deliverable: 'Beschluss des Rats, im Thread in #ag-rat',
    constraints: ['Nur beraten: nichts ändern, nichts ausführen'],
    assignee: 'rat',
    from: ctx.owner,
    originRoom: o.originRoom,
    originThread: o.originThread,
    idempotencyKey: o.eventId,
    budgetUsd: null,
    budgetMinutes: null,
    trustRequired: 'T1',
  })
  if (!erstellt.ok) return { ok: false, code: erstellt.code, reason: erstellt.reason }
  await sql`
    INSERT INTO swarm.rat_laeufe (task_id, frage, modus, mitglieder, moderator)
    VALUES (${erstellt.taskId}, ${o.cmd.frage}, ${o.cmd.modus}, ${da}, ${moderator})
    ON CONFLICT (task_id) DO NOTHING`
  await sql`UPDATE swarm.tasks SET state = 'working' WHERE id = ${erstellt.taskId} AND state = 'submitted'`
  await audit(ctx.owner, 'rat.start', erstellt.taskId, { modus: o.cmd.modus, mitglieder: da, fehlen, moderator, nativ: true })
  return { ok: true, task: erstellt.taskId, mitglieder: da, fehlen, moderator, wartet: erstellt.queued }
}

interface Lauf {
  task_id: string
  frage: string
  modus: RatModus
  mitglieder: string[]
  moderator: string | null
  runde: number
  zustand: 'laeuft' | 'synthese' | 'fertig' | 'abgebrochen'
  runde_seit: Date
}

interface BeitragZeile {
  runde: number
  agent: string
  task_id: string
  art: string
  gespiegelt: boolean
  task: store.TaskRow | null
}

const ENDE = ['completed', 'failed', 'canceled', 'rejected']

async function beitraege(lauf: string, db: Db = sql): Promise<BeitragZeile[]> {
  const zeilen = await db`
    SELECT runde, agent, task_id, art, gespiegelt FROM swarm.rat_beitraege WHERE lauf = ${lauf} ORDER BY runde, agent`
  const aus: BeitragZeile[] = []
  for (const z of zeilen) {
    aus.push({
      runde: Number(z.runde), agent: String(z.agent), task_id: String(z.task_id), art: String(z.art),
      gespiegelt: Boolean(z.gespiegelt), task: await store.getTask(String(z.task_id), db),
    })
  }
  return aus
}

async function alsBeitrag(z: BeitragZeile): Promise<Beitrag> {
  const text = redact(z.task?.result ?? '').trim().slice(0, BEITRAG_MAX)
  return { agent: z.agent, name: name(await agentById(z.agent), z.agent), runde: z.runde, text, konfidenz: konfidenzAus(text) }
}

/** Nachricht in den Thread des Laufs: als Puppet des Mitglieds, sonst als Hub mit Namen davor. */
async function posten(ctx: Ctx, db: Db, eltern: store.TaskRow, text: string, agentId?: string): Promise<void> {
  if (!eltern.roomId || !eltern.threadRoot) return
  const a = agentId ? await agentById(agentId, db) : null
  const alsPuppet = !!a && istPuppet(a.mxid) && (await ensurePuppet(ctx, a.mxid, eltern.roomId))
  await enqueue(db, [{
    kind: 'message',
    roomId: eltern.roomId,
    taskId: eltern.id,
    ...(alsPuppet ? { asUser: a!.mxid } : {}),
    payload: { type: 'm.room.message', content: notice(`${!alsPuppet && a ? `${name(a, a.id)}: ` : ''}${text}`, { thread: eltern.threadRoot }) },
  }], ctx.hub)
}

async function beitragAnlegen(
  ctx: Ctx, lauf: Lauf, eltern: store.TaskRow, runde: number, agent: string, art: string, p: RatPrompt,
): Promise<boolean> {
  const r = await createTaskFlow(ctx, {
    goal: p.ziel,
    ...(p.material ? { context: p.material } : {}),
    deliverable: art === 'synthese' ? 'Synthese mit KONSENS-Zeile' : 'Beitrag zum Rat, mit KONFIDENZ-Zeile',
    constraints: ['Nur beraten: nichts ändern, nichts ausführen, keine Aufträge weitergeben'],
    assignee: agent,
    from: ctx.owner,
    originRoom: eltern.roomId!,
    originThread: eltern.threadRoot,
    idempotencyKey: `rat-${lauf.task_id}-${runde}-${agent}`,
    budgetMinutes: 15,
    trustRequired: 'T1',
  })
  if (!r.ok) {
    await posten(ctx, sql, eltern, `⚠️ ${agent} bekommt Runde ${runde === 99 ? 'Synthese' : runde} nicht (${r.code}): ${r.reason}`)
    return false
  }
  await sql`
    INSERT INTO swarm.rat_beitraege (lauf, runde, agent, task_id, art)
    VALUES (${lauf.task_id}, ${runde}, ${agent}, ${r.taskId}, ${art})
    ON CONFLICT (lauf, runde, agent) DO NOTHING`
  return true
}

async function rundeSetzen(lauf: Lauf, runde: number, zustand: Lauf['zustand'] = 'laeuft'): Promise<void> {
  await sql`UPDATE swarm.rat_laeufe SET runde = ${runde}, zustand = ${zustand}, runde_seit = now() WHERE task_id = ${lauf.task_id}`
  lauf.runde = runde
  lauf.zustand = zustand
}

/** Runde 1 je nach Modus (Rat: `starters`). */
async function ersteRunde(ctx: Ctx, lauf: Lauf, eltern: store.TaskRow): Promise<void> {
  const start = lauf.modus === 'staffel' || lauf.modus === 'lead' || lauf.modus === 'still' ? lauf.mitglieder.slice(0, 1) : lauf.mitglieder
  await rundeSetzen(lauf, 1)
  let n = 0
  for (const agent of start) {
    const p = lauf.modus === 'vote' ? stimme(agent, lauf.frage, lauf.task_id) : rundeEins(agent, lauf.frage, lauf.task_id)
    if (await beitragAnlegen(ctx, lauf, eltern, 1, agent, lauf.modus === 'vote' ? 'stimme' : 'vorschlag', p)) n++
  }
  if (!n) await abbrechen(ctx, lauf, 'kein Mitglied hat den Auftrag bekommen')
}

async function abbrechen(ctx: Ctx, lauf: Lauf, grund: string): Promise<void> {
  const offen = await sql`
    SELECT b.task_id FROM swarm.rat_beitraege b JOIN swarm.tasks t ON t.id = b.task_id
     WHERE b.lauf = ${lauf.task_id} AND t.state NOT IN ('completed','failed','canceled','rejected')`
  await sql.begin(async (tx) => {
    for (const z of offen) await zustandUndMeldung(ctx, tx, String(z.task_id), 'canceled', { failReason: `Rat ${lauf.task_id}: ${grund}` })
    const eltern = await store.getTask(lauf.task_id, tx)
    if (eltern && !ENDE.includes(eltern.state)) await zustandUndMeldung(ctx, tx, lauf.task_id, 'canceled', { failReason: `Rat: ${grund}` })
    await tx`UPDATE swarm.rat_laeufe SET zustand = 'abgebrochen' WHERE task_id = ${lauf.task_id}`
    if (eltern) await posten(ctx, tx, eltern, `🛑 Rat ${lauf.task_id} ohne Ergebnis: ${grund}`)
  })
  await audit('hub', 'rat.abgebrochen', lauf.task_id, { grund })
  lauf.zustand = 'abgebrochen'
}

async function abschliessen(ctx: Ctx, lauf: Lauf, ergebnis: string, konsens: number | null, synthetisiert: boolean): Promise<void> {
  const [log] = await roomsByKind('log')
  await sql.begin(async (tx) => {
    const eltern = await store.getTask(lauf.task_id, tx)
    if (eltern && !ENDE.includes(eltern.state)) {
      await zustandUndMeldung(ctx, tx, lauf.task_id, 'completed', { result: ergebnis.slice(0, 12_000) || 'Der Rat hat keinen Text hinterlassen.' })
    }
    await tx`UPDATE swarm.rat_laeufe SET zustand = 'fertig', konsens = ${konsens} WHERE task_id = ${lauf.task_id}`
    if (eltern) {
      await posten(ctx, tx, eltern, `⚖️ Rat ${lauf.task_id} ist fertig` + (konsens !== null ? ` · Konsens ${konsens.toFixed(2)}` : '') +
        (synthetisiert ? ' · Beschluss in #schwarm-log' : ''))
    }
    // Beschlüsse landen zusätzlich im Protokollraum, dort werden sie nie gelöscht (wie im Rat).
    if (synthetisiert && log?.roomId) {
      await enqueue(tx, [{
        kind: 'message',
        roomId: log.roomId,
        taskId: lauf.task_id,
        payload: {
          type: 'm.room.message',
          content: notice(`📜 Beschluss ${lauf.task_id} (${lauf.modus}${konsens !== null ? `, Konsens ${konsens.toFixed(2)}` : ''}): ` +
            `${redact(lauf.frage).slice(0, 300)}\n${redact(empfehlungAus(ergebnis))}`),
        },
      }], ctx.hub)
    }
  })
  await audit('hub', 'rat.fertig', lauf.task_id, { konsens, synthese: synthetisiert })
  lauf.zustand = 'fertig'
}

/** Synthese durch den Moderator; mit nur einem Beitrag oder ohne Moderator ist der Beitrag das Ergebnis. */
async function synthetisieren(ctx: Ctx, lauf: Lauf, eltern: store.TaskRow, alle: Beitrag[]): Promise<void> {
  const moderator = lauf.moderator && (await kannArbeiten(lauf.moderator)) ? lauf.moderator : null
  if (alle.length < 2 || !moderator) {
    if (alle.length >= 2) await posten(ctx, sql, eltern, `Kein Moderator erreichbar: ${lauf.task_id} bleibt ohne Synthese.`)
    const letzter = alle.at(-1)
    await abschliessen(ctx, lauf, letzter ? `${letzter.name}: ${letzter.text}` : '', null, false)
    return
  }
  if (lauf.modus === 'vote') {
    const zaehlung = { ja: 0, nein: 0, enthaltung: 0 }
    for (const b of alle) {
      const v = votumAus(b.text)
      if (v) zaehlung[v]++
    }
    await posten(ctx, sql, eltern, `🗳 Auszählung: ja ${zaehlung.ja} · nein ${zaehlung.nein} · Enthaltung ${zaehlung.enthaltung}`)
  }
  await rundeSetzen(lauf, lauf.runde, 'synthese')
  if (!(await beitragAnlegen(ctx, lauf, eltern, 99, moderator, 'synthese', synthese(lauf.modus, lauf.frage, alle, lauf.task_id)))) {
    const letzter = alle.at(-1)!
    await abschliessen(ctx, lauf, `${letzter.name}: ${letzter.text}`, null, false)
  }
}

/** Nächster Schritt, wenn die laufende Runde durch ist (Rat: `advance`). */
async function weiter(ctx: Ctx, lauf: Lauf, eltern: store.TaskRow, alleZeilen: BeitragZeile[]): Promise<void> {
  const fertig = alleZeilen.filter((z) => z.task?.state === 'completed' && (z.task.result ?? '').trim())
  const alle = await Promise.all(fertig.filter((z) => z.runde !== 99).map(alsBeitrag))
  const dieseRunde = alle.filter((b) => b.runde === lauf.runde)

  if (lauf.zustand === 'synthese') {
    const s = fertig.find((z) => z.runde === 99)
    if (s) {
      const text = redact(s.task!.result ?? '').trim()
      await abschliessen(ctx, lauf, text, konsensAus(text), true)
    } else {
      const letzter = alle.at(-1)
      if (!letzter) return abbrechen(ctx, lauf, 'keine verwertbare Antwort')
      await posten(ctx, sql, eltern, 'Die Synthese kam nicht zustande; das letzte Ergebnis gilt.')
      await abschliessen(ctx, lauf, `${letzter.name}: ${letzter.text}`, null, false)
    }
    return
  }
  if (!dieseRunde.length) {
    if (lauf.runde === 1 || !alle.length) return abbrechen(ctx, lauf, 'keine verwertbare Antwort')
    return synthetisieren(ctx, lauf, eltern, alle)
  }

  switch (lauf.modus) {
    case 'still':
      return abschliessen(ctx, lauf, dieseRunde[0]!.text, null, false)
    case 'broadcast':
    case 'vote':
      return synthetisieren(ctx, lauf, eltern, alle)
    case 'debatte': {
      if (lauf.runde === 1 && dieseRunde.length > 1) {
        await rundeSetzen(lauf, 2)
        let n = 0
        for (const b of dieseRunde) {
          if (!(await kannArbeiten(b.agent))) continue
          const andere = dieseRunde.filter((o) => o.agent !== b.agent)
          if (await beitragAnlegen(ctx, lauf, eltern, 2, b.agent, 'kritik', kritik(b.agent, lauf.frage, andere, lauf.task_id))) n++
        }
        if (n) return
      }
      return synthetisieren(ctx, lauf, eltern, alle)
    }
    case 'lead': {
      if (lauf.runde === 1) {
        const arbeit = dieseRunde[0]!
        const pruefer: string[] = []
        for (const a of lauf.mitglieder) if (a !== arbeit.agent && (await kannArbeiten(a))) pruefer.push(a)
        if (pruefer.length) {
          await rundeSetzen(lauf, 2)
          let n = 0
          for (const p of pruefer) {
            if (await beitragAnlegen(ctx, lauf, eltern, 2, p, 'pruefung', pruefung(p, lauf.frage, arbeit, lauf.task_id, 2))) n++
          }
          if (n) return
        }
      }
      return synthetisieren(ctx, lauf, eltern, alle)
    }
    case 'staffel': {
      const schon = new Set(alleZeilen.map((z) => z.agent))
      for (const kandidat of lauf.mitglieder) {
        if (schon.has(kandidat) || !(await kannArbeiten(kandidat))) continue
        const vorher = dieseRunde.at(-1)!
        const runde = lauf.runde + 1
        await rundeSetzen(lauf, runde)
        if (await beitragAnlegen(ctx, lauf, eltern, runde, kandidat, 'pruefung', pruefung(kandidat, lauf.frage, vorher, lauf.task_id, runde))) return
      }
      return synthetisieren(ctx, lauf, eltern, alle)
    }
  }
}

/** Takt (15 s): Beiträge spiegeln, Runden weiterschalten, Läufe schliessen. */
export async function ratTakt(ctx: Ctx): Promise<{ gespiegelt: number; weiter: number; fertig: number }> {
  const stand = { gespiegelt: 0, weiter: 0, fertig: 0 }
  if (await isSwarmFrozen()) return stand
  const laeufe = (await sql`
    SELECT task_id, frage, modus, mitglieder, moderator, runde, zustand, runde_seit FROM swarm.rat_laeufe
     WHERE zustand IN ('laeuft','synthese') ORDER BY erstellt LIMIT 20`) as unknown as Lauf[]
  for (const lauf of laeufe) {
    try {
      const eltern = await store.getTask(lauf.task_id)
      if (!eltern) continue
      // Von aussen beendet (etwa `!stop T-…`): offene Beiträge mitnehmen.
      if (ENDE.includes(eltern.state)) {
        await abbrechen(ctx, lauf, `Auftrag ${eltern.state}`)
        continue
      }
      // Runde 0: warten, bis die Karte in #ag-rat steht, denn sie ist der Thread.
      if (lauf.runde === 0) {
        if (eltern.threadRoot) {
          await ersteRunde(ctx, lauf, eltern)
          stand.weiter++
        }
        continue
      }
      const zeilen = await beitraege(lauf.task_id)
      for (const z of zeilen) {
        if (z.gespiegelt || !z.task || !ENDE.includes(z.task.state)) continue
        const ok = z.task.state === 'completed' && (z.task.result ?? '').trim()
        const kopf = z.runde === 99 ? '⚖️ Synthese' : `🗣 Runde ${z.runde}`
        const text = ok
          ? `${kopf}\n${redact(z.task.result!).trim().slice(0, BEITRAG_MAX)}`
          : `${kopf}: ohne Beitrag (${z.task.state}${z.task.failReason ? `, ${redact(z.task.failReason).slice(0, 200)}` : ''})`
        await posten(ctx, sql, eltern, text, z.agent)
        await sql`UPDATE swarm.rat_beitraege SET gespiegelt = true WHERE lauf = ${lauf.task_id} AND runde = ${z.runde} AND agent = ${z.agent}`
        stand.gespiegelt++
      }
      const aktuell = zeilen.filter((z) => (lauf.zustand === 'synthese' ? z.runde === 99 : z.runde === lauf.runde))
      const durch = aktuell.length > 0 && aktuell.every((z) => z.task && ENDE.includes(z.task.state))
      const zuLange = Date.now() - new Date(lauf.runde_seit).getTime() > RUNDE_MS
      if (!durch && !zuLange) continue
      if (!durch) {
        // Wer die Runde nicht schafft, fällt heraus; der Rat geht mit dem weiter, was da ist.
        await sql.begin(async (tx) => {
          for (const z of aktuell) {
            if (z.task && !ENDE.includes(z.task.state)) {
              await zustandUndMeldung(ctx, tx, z.task_id, 'canceled', { failReason: `Rat ${lauf.task_id}: Runde dauerte zu lange` })
            }
          }
        })
        continue // im nächsten Takt sind alle beendet und gespiegelt
      }
      await weiter(ctx, lauf, eltern, zeilen)
      if ((lauf.zustand as string) === 'fertig') stand.fertig++
      else stand.weiter++
    } catch (err) {
      ctx.log.warn({ err, lauf: lauf.task_id }, 'Rat-Takt fehlgeschlagen')
    }
  }
  return stand
}
