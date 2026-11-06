/**
 * Swarm-MCP (§14.3): die Werkzeugkiste der L2-Agenten. Transport ist Streamable
 * HTTP unter `/mcp`, jeder Agent hat ein eigenes Bearer-Token mit Zweck `mcp`,
 * geprüft bei jedem Aufruf ohne Cache (§11.3). Sampling ist aus (O12).
 *
 * Grenzen stehen hier, nicht beim Agenten: `task_*` geht nur für Aufträge, an
 * denen der Aufrufer beteiligt ist; `post` nur in den Thread des eigenen
 * Auftrags; `handoff` läuft durch die Policy (§12.1) und braucht für T2 eine
 * Freigabe (§7.3). Alles Schreibende geht durch die Redaktion (§11.5) und ins
 * Audit (§11.8).
 */
import type { TaskState } from '../protocol/index.js'
import { sql } from '../db/index.js'
import { audit, isSwarmFrozen } from '../db/audit.js'
import { agentById, listAgents, roomsByKind } from '../agents/store.js'
import { enqueue } from '../outbox.js'
import { notice } from '../appservice/messages.js'
import { redact } from '../redact.js'
import { notify } from '../notify.js'
import { puppetMxid } from '../env.js'
import type { Ctx } from '../context.js'
import { argumente, faehigkeitenLaden, zielPruefen } from '../betrieb/faehigkeiten.js'
import { createHash } from 'node:crypto'
import { createTaskFlow } from '../tasks/create.js'
import { zustandUndMeldung } from '../tasks/transition.js'
import * as store from '../tasks/store.js'
import { ZUSATZ } from './zusatz.js'

/** Fehler, den der Agent als Werkzeugergebnis sieht (nicht als Protokollfehler). */
export class WerkzeugFehler extends Error {}

export interface Aufruf {
  ctx: Ctx
  /** Agent-ID aus dem Token, z. B. `brian`. */
  agent: string
  tokenId: number
  /** Plum-Sitzung aus dem Kopf `x-plum-session` (nur beim Agenten plum, matrix/PLAN-weiter.md Punkt 12). */
  sitzung?: string
}

export interface Werkzeug {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  nurLesen?: boolean
  handler(a: Aufruf, args: Record<string, unknown>): Promise<unknown>
}

const str = (beschreibung: string) => ({ type: 'string', description: beschreibung })

/** So lange wartet `council_capability` bei grünen Fähigkeiten auf den Worker `betrieb` (ADR-003 R2). */
const BETRIEB_WARTEN_MS = Number(process.env.BETRIEB_WARTEN_MS ?? 45_000)

/** Stand eines Betriebsauftrags für den Antragsteller: Zustand, Ausgabe, Fehler — geschwärzt. */
function betriebsStand(t: store.TaskRow) {
  return {
    ok: t.state === 'completed',
    ausgefuehrt: ['completed', 'failed'].includes(t.state),
    task: t.id,
    state: t.state,
    ...(t.result ? { output: redact(t.result).slice(0, 12_000) } : {}),
    ...(t.failReason ? { fehler: redact(t.failReason).slice(0, 500) } : {}),
  }
}
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

/** Die Schwarm-Verfassung, wie `swarm_whoami` sie liefert (§11.6). */
export const VERFASSUNG = [
  'Schwarm-Verfassung (§8.1, §11.6):',
  '1. Ein Thread = ein Auftrag = ein Verantwortlicher. Antworten gehören in den Thread.',
  '2. Bots reden nie direkt miteinander. Brauchst du einen anderen Agenten: handoff.',
  '3. Ergebnisse sind neue Nachrichten, keine Edits. Edits nur für Fortschritt.',
  '4. Keine Geheimnisse in den Schwarm — alles Geschriebene läuft durch die Redaktion.',
  '5. Riskantes braucht Freigabe: Übergaben an T2, gelbe und rote Aktionen.',
  '6. Stopp: Vale reagiert mit 🛑 oder schreibt !stop. Danach ist Schluss.',
].join('\n')

async function auftragOderNichts(taskId: unknown, agent: string): Promise<store.TaskRow> {
  if (typeof taskId !== 'string' || !taskId) throw new WerkzeugFehler('task fehlt')
  const task = await store.getTask(taskId)
  if (!task) throw new WerkzeugFehler(`Auftrag ${taskId} existiert nicht`)
  if (!(await beteiligt(task, agent))) {
    throw new WerkzeugFehler(`${taskId} gehört nicht zu dir — der Hub gibt keine fremden Aufträge heraus (§14.3)`)
  }
  return task
}

async function beteiligt(task: store.TaskRow, agent: string): Promise<boolean> {
  if (task.assignee === agent) return true
  const agentRow = await agentById(agent)
  const mxid = agentRow?.mxid ?? ''
  if (task.fromAgent === agent || task.fromAgent === mxid) return true
  const kette = (task as unknown as { chain?: string[] }).chain ?? []
  return kette.includes(agent) || kette.includes(mxid)
}

async function nichtEingefroren(): Promise<void> {
  if (await isSwarmFrozen()) {
    throw new WerkzeugFehler('Der Schwarm ist eingefroren (!stop). Schreibende Werkzeuge gehen nicht.')
  }
}

/**
 * Schreiben darf nur der Zuständige (§14.3, ADR-002 §4.15). `beteiligt` reicht zum Lesen: Sonst
 * könnte der Auftraggeber den Unterauftrag eines Workers mit einem erfundenen Ergebnis abschliessen.
 */
async function eigenerAuftrag(taskId: unknown, agent: string): Promise<store.TaskRow> {
  const task = await auftragOderNichts(taskId, agent)
  if (task.assignee !== agent) {
    throw new WerkzeugFehler(`${task.id} ist ${task.assignee ?? 'niemandem'} zugeteilt — schreiben darf nur der Zuständige (§14.3)`)
  }
  return task
}

/** Schwärzt und meldet: Audit und ntfy, wenn ein Agent ein Geheimnis in den Schwarm schreiben wollte (§11.9 Test 5). */
async function geschwaerzt(a: Aufruf, taskId: string | null, werkzeug: string, roh: string): Promise<string> {
  const sauber = redact(roh)
  if (sauber !== roh) {
    await audit(a.agent, 'mcp.geheimnis', taskId, { werkzeug })
    await notify({ title: `Schwarm: Geheimnis in ${werkzeug} von ${a.agent}`, text: `${taskId ?? '—'} — geschwärzt, bitte prüfen`,
      priority: 4, tags: ['warning'] }, a.ctx.log)
  }
  return sauber
}

function kartenAnsicht(t: store.TaskRow) {
  return {
    id: t.id,
    state: t.state,
    assignee: t.assignee,
    from: t.fromAgent,
    hop: t.hop,
    depth: t.depth,
    goal: t.goal,
    deliverable: t.deliverable,
    constraints: t.constraints,
    budget: { usd: t.budgetUsd === null ? null : Number(t.budgetUsd), minutes: t.budgetMinutes },
    deadline: t.deadline,
    priority: t.priority,
    attempts: t.attempts,
    parent: t.parent,
    root: t.root,
    result: t.result ? redact(t.result) : null,
    fail_reason: t.failReason ? redact(t.failReason) : null,
    thread: t.roomId && t.threadRoot ? `${t.roomId}/${t.threadRoot}` : null,
  }
}

export const WERKZEUGE: Werkzeug[] = [
  {
    name: 'council_capability',
    description:
      'Betrieb im Schwarm (ADR-003): Infrastruktur-Aktion beantragen. Grün (docker.list, docker.inspect, docker.logs, ' +
      'unraid.array_status, unraid.share_usage) läuft sofort über den Worker betrieb; gelb (docker.restart, docker.pull, ' +
      'pihole.blocklist_add) wartet auf Vales ✅ in #schwarm-freigaben. Mit list: Fähigkeiten. Mit action: Stand eines ' +
      'Betriebsauftrags (T-…). Nach !stop gesperrt (§12.5).',
    inputSchema: schema({
      capability: str('Name der Fähigkeit, z. B. docker.logs'),
      target: str('Ziel: Container-Name, Filter oder Domain'),
      args: { type: 'object', additionalProperties: true, description: 'Argumente, z. B. {"tail": 200} bei docker.logs' },
      reason: str('Warum — steht in der Freigabe, mindestens 3 Zeichen'),
      action: str('Stattdessen: Stand eines Betriebsauftrags (T-…) nachschlagen'),
      list: { type: 'boolean', description: 'Stattdessen: Fähigkeiten auflisten' },
    }),
    async handler(a, args) {
      await nichtEingefroren()
      const liste = await faehigkeitenLaden()
      if (args.list === true) {
        return { faehigkeiten: liste.filter((f) => f.risk !== 'red').map((f) => ({ name: f.name, risk: f.risk, description: f.beschreibung })) }
      }
      if (typeof args.action === 'string' && args.action) {
        const t = await auftragOderNichts(args.action, a.agent)
        return betriebsStand(t)
      }

      const capability = String(args.capability ?? '')
      const f = liste.find((x) => x.name === capability)
      if (!f || f.risk === 'red') {
        await audit(a.agent, 'mcp.capability_verweigert', null, { capability })
        throw new WerkzeugFehler(`${capability || '(leer)'} führt der Betrieb nicht aus (ADR-003). Erlaubt: ` +
          `${liste.filter((x) => x.risk !== 'red').map((x) => x.name).join(', ')}.`)
      }
      const geprueft = zielPruefen(f, args.target)
      if ('fehler' in geprueft) {
        await audit(a.agent, 'mcp.capability_verweigert', null, { capability, grund: geprueft.fehler })
        throw new WerkzeugFehler(geprueft.fehler)
      }
      const reason = (await geschwaerzt(a, null, 'council_capability', String(args.reason ?? ''))).trim().slice(0, 300)
      if (reason.length < 3) throw new WerkzeugFehler('reason ist zu kurz — der Auftrag braucht einen Grund')

      const spec = { capability, target: geprueft.ziel, args: argumente(f, args.args) }
      const schluessel = `betrieb-${a.tokenId}-${createHash('sha256').update(`${JSON.stringify(spec)}|${reason}`).digest('hex').slice(0, 24)}`
      const agent = await agentById(a.agent)
      const [lobby] = await roomsByKind('lobby')
      const ergebnis = await createTaskFlow(a.ctx, {
        goal: `${capability}${spec.target !== '-' ? ` ${spec.target}` : ''} — ${reason}`,
        deliverable: 'Ausgabe der Aktion',
        budgetMinutes: 5,
        assignee: 'betrieb',
        from: agent?.mxid ?? a.agent,
        originRoom: lobby?.roomId ?? '',
        idempotencyKey: schluessel,
        freigabePflicht: f.risk === 'yellow',
        betriebSpec: JSON.stringify(spec),
      })
      if (!ergebnis.ok && ergebnis.code === 'duplicate') {
        // Derselbe Antrag noch einmal: den laufenden Auftrag nennen statt einen zweiten anzulegen.
        const [da] = await sql`SELECT id FROM swarm.tasks WHERE idempotency_key = ${schluessel}`
        const id = da?.id ?? /T-\d+/.exec(ergebnis.reason)?.[0]
        const t = id ? await store.getTask(String(id)) : null
        if (t) {
          await audit(a.agent, 'mcp.betrieb', t.id, { capability, risk: f.risk, state: 'duplikat' })
          return { ...betriebsStand(t), hinweis: `Derselbe Antrag läuft schon als ${t.id}.` }
        }
      }
      if (!ergebnis.ok) throw new WerkzeugFehler(`Betrieb lehnte ab (${ergebnis.code}): ${ergebnis.reason}`)
      await audit(a.agent, 'mcp.betrieb', ergebnis.taskId, { capability, risk: f.risk, state: ergebnis.state })

      if (f.risk === 'green') {
        const bis = Date.now() + BETRIEB_WARTEN_MS
        while (Date.now() < bis) {
          const t = await store.getTask(ergebnis.taskId)
          if (t && ['completed', 'failed', 'canceled', 'rejected'].includes(t.state)) return betriebsStand(t)
          await new Promise((r) => setTimeout(r, 500))
        }
      }
      return {
        ok: true,
        ausgefuehrt: false,
        task: ergebnis.taskId,
        risk: f.risk,
        state: ergebnis.state,
        hinweis: f.risk === 'yellow'
          ? `${capability} ist gelb und wartet auf Vales ✅ in #schwarm-freigaben. Stand mit action: ${ergebnis.taskId}.`
          : `${capability} läuft beim Betrieb. Stand mit action: ${ergebnis.taskId}.`,
      }
    },
  },
  {
    name: 'swarm_whoami',
    description: 'Eigene Agent Card und die Schwarm-Verfassung.',
    inputSchema: schema({}),
    nurLesen: true,
    async handler(a) {
      const agent = await agentById(a.agent)
      if (!agent) throw new WerkzeugFehler(`Agent ${a.agent} ist nicht eingetragen`)
      return { agent: agent.card, mxid: agent.mxid, status: agent.status, trust: agent.trust, verfassung: VERFASSUNG }
    },
  },
  {
    name: 'swarm_agents',
    description: 'Agent Cards der anderen: wer kann was, wer ist online. Nur lesend.',
    inputSchema: schema({}),
    nurLesen: true,
    async handler() {
      const agenten = await listAgents()
      return {
        agenten: agenten.map((x) => ({
          id: x.id,
          name: x.displayName,
          level: x.level,
          trust: x.trust,
          mode: x.mode,
          status: x.status,
          frozen: x.frozen,
          skills: x.skills,
          accepts: x.accepts,
          limits: { parallel: x.parallel, budget_usd_day: x.budgetUsdDay === null ? null : Number(x.budgetUsdDay) },
        })),
      }
    },
  },
  {
    name: 'task_list',
    description: 'Eigene Aufträge und die, an denen du beteiligt bist. Optional nach Zustand filtern.',
    inputSchema: schema({ state: { ...str('Nur dieser Zustand, z. B. working'), enum: ['submitted', 'working', 'input-required', 'auth-required', 'completed', 'failed', 'canceled', 'rejected'] } }),
    nurLesen: true,
    async handler(a, args) {
      const rows = (await sql`
        SELECT id, state, goal, assignee, hop, deadline, updated_at FROM swarm.tasks
        WHERE assignee = ${a.agent} OR from_agent = ${a.agent}
           OR from_agent = (SELECT mxid FROM swarm.agents WHERE id = ${a.agent})
           OR root IN (SELECT root FROM swarm.tasks WHERE assignee = ${a.agent})
        ORDER BY created_at DESC LIMIT 50`) as Record<string, unknown>[]
      const zustand = typeof args.state === 'string' ? args.state : null
      return {
        auftraege: rows
          .filter((r) => !zustand || r.state === zustand)
          .map((r) => ({
            id: r.id, state: r.state, goal: r.goal, assignee: r.assignee, hop: r.hop,
            deadline: r.deadline, aktualisiert: r.updated_at,
          })),
      }
    },
  },
  {
    name: 'task_get',
    description: 'Einen Auftrag mit Karte und Ergebnis lesen.',
    inputSchema: schema({ task: str('Auftragskennung, z. B. T-0007') }, ['task']),
    nurLesen: true,
    async handler(a, args) {
      return kartenAnsicht(await auftragOderNichts(args.task, a.agent))
    },
  },
  {
    name: 'task_claim',
    description: 'Auftrag annehmen → working. Nur eigene Aufträge, einer parallel (§12.1).',
    inputSchema: schema({ task: str('Auftragskennung') }, ['task']),
    async handler(a, args) {
      await nichtEingefroren()
      const task = await auftragOderNichts(args.task, a.agent)
      if (task.assignee !== a.agent) throw new WerkzeugFehler(`${task.id} ist einem anderen Agenten zugeteilt`)
      if (task.state !== 'submitted') throw new WerkzeugFehler(`${task.id} ist schon ${task.state}`)
      const offen = await store.runningCount(a.agent)
      const agent = await agentById(a.agent)
      if (offen > (agent?.parallel ?? 1)) {
        throw new WerkzeugFehler(`Du arbeitest schon an ${offen} Aufträgen — Limit ${agent?.parallel ?? 1}`)
      }
      if (!(await zustandUndMeldung(a.ctx, sql, task.id, 'working', { actor: a.agent }))) {
        throw new WerkzeugFehler(`${task.id} konnte nicht auf working gehen — der Zustand passt nicht`)
      }
      await audit(a.agent, 'mcp.task_claim', task.id, {})
      return { ok: true, task: task.id, state: 'working' }
    },
  },
  {
    name: 'task_update',
    description: 'Fortschritt melden. Gedrosselt: höchstens alle 15 s, höchstens 20 Meldungen pro Auftrag (§10.7).',
    inputSchema: schema({ task: str('Auftragskennung'), progress: str('Was gerade passiert, eine Zeile') }, ['task', 'progress']),
    async handler(a, args) {
      const task = await eigenerAuftrag(args.task, a.agent)
      const meldung = (await geschwaerzt(a, task.id, 'task_update', String(args.progress ?? ''))).slice(0, 800)
      if (!meldung) throw new WerkzeugFehler('progress ist leer')
      const { getFlag, setFlag } = await import('../db/audit.js')
      const flag = await getFlag<{ at?: number; count?: number }>(`progress:${task.id}`)
      const jetzt = Date.now()
      const count = flag?.count ?? 0
      if (flag?.at && jetzt - flag.at < 15_000) {
        return { ok: false, gedrosselt: true, sekunden: Math.ceil((15_000 - (jetzt - (flag.at ?? 0))) / 1000) }
      }
      if (count >= 20) {
        return { ok: false, limit: true, hinweis: '20 Fortschrittsmeldungen erreicht — das Ergebnis zählt, nicht der Zwischenstand.' }
      }
      if (task.roomId && task.threadRoot) {
        await enqueue(sql, [{
          kind: 'message',
          roomId: task.roomId,
          taskId: task.id,
          payload: {
            type: 'm.room.message',
            role: 'rueckmeldung',
            // Notice: Hermes ignoriert sie, der Thread bleibt ruhig (§10.7).
            content: notice(`⏳ ${task.id}: ${meldung}`, { thread: task.threadRoot }),
          },
        }], a.ctx.hub)
      }
      await setFlag(`progress:${task.id}`, { at: jetzt, count: count + 1 }, a.agent)
      return { ok: true, meldungen: count + 1 }
    },
  },
  {
    name: 'task_complete',
    description: 'Auftrag abschliessen. Wird abgelehnt, solange ein Unterauftrag offen ist (§10.3).',
    inputSchema: schema({ task: str('Auftragskennung'), result: str('Das Ergebnis — alles, was der Auftraggeber braucht') }, ['task', 'result']),
    async handler(a, args) {
      await nichtEingefroren()
      const task = await eigenerAuftrag(args.task, a.agent)
      const offen = await store.openSubtasks(task.id)
      if (offen.length) {
        throw new WerkzeugFehler(`${task.id} wartet noch auf ${offen.join(', ')} — erst die Unteraufträge abschliessen (§10.3)`)
      }
      const ergebnis = (await geschwaerzt(a, task.id, 'task_complete', String(args.result ?? ''))).trim()
      if (!ergebnis) throw new WerkzeugFehler('result ist leer — ein Abschluss ohne Ergebnis ist ein Fehler')
      if (!(await zustandUndMeldung(a.ctx, sql, task.id, 'completed', { result: ergebnis, actor: a.agent }))) {
        throw new WerkzeugFehler(`${task.id} ist ${task.state} — aus diesem Zustand geht kein Abschluss mehr`)
      }
      await audit(a.agent, 'mcp.task_complete', task.id, { zeichen: ergebnis.length })
      return { ok: true, task: task.id, state: 'completed' }
    },
  },
  {
    name: 'task_fail',
    description: 'Auftrag scheitern lassen. reason:"rejected" lehnt ihn ab, statt ihn zu versuchen.',
    inputSchema: schema({ task: str('Auftragskennung'), reason: str('Warum es nicht geht') }, ['task', 'reason']),
    async handler(a, args) {
      await nichtEingefroren()
      const task = await eigenerAuftrag(args.task, a.agent)
      const grund = (await geschwaerzt(a, task.id, 'task_fail', String(args.reason ?? ''))).slice(0, 500)
      const to: TaskState = /reject/i.test(grund) ? 'rejected' : 'failed'
      if (!(await zustandUndMeldung(a.ctx, sql, task.id, to, { failReason: grund, actor: a.agent }))) {
        throw new WerkzeugFehler(`${task.id} ist ${task.state} — ein Endzustand bleibt`)
      }
      await audit(a.agent, 'mcp.task_fail', task.id, { to, grund })
      return { ok: true, task: task.id, state: to }
    },
  },
  {
    name: 'handoff',
    description:
      'Unterauftrag an einen anderen Agenten. Antwortet sofort; das Ergebnis kommt als Rückmeldung in deinen Thread (§9.3). Übergaben an T2 brauchen eine Freigabe.',
    inputSchema: schema({
      task: str('Dein Auftrag, von dem aus du übergibst'),
      to: str('Agent-ID des Ziels, z. B. codex-host'),
      goal: str('Was das Ziel erreichen soll'),
      deliverable: str('Was am Ende vorliegen muss'),
      constraints: { type: 'array', items: { type: 'string' }, description: 'Grenzen, z. B. „nur lesen"' },
      material: str('Kontext, den das Ziel braucht — keine Geheimnisse'),
      idempotency_key: str('Eigener Schlüssel gegen doppelte Übergaben'),
    }, ['task', 'to', 'goal']),
    async handler(a, args) {
      await nichtEingefroren()
      const task = await eigenerAuftrag(args.task, a.agent)
      const ziel = await agentById(String(args.to))
      if (!ziel) throw new WerkzeugFehler(`Agent „${String(args.to)}" ist nicht eingetragen`)
      const agent = await agentById(a.agent)
      await geschwaerzt(a, task.id, 'handoff', [args.goal, args.deliverable, ...((args.constraints as unknown[]) ?? []), args.material]
        .filter(Boolean).map(String).join('\n'))
      const ergebnis = await createTaskFlow(a.ctx, {
        goal: redact(String(args.goal)).slice(0, 2000),
        ...(args.deliverable ? { deliverable: redact(String(args.deliverable)).slice(0, 2000) } : {}),
        ...(args.constraints ? { constraints: (args.constraints as string[]).map((c) => redact(String(c))) } : {}),
        ...(args.material ? { context: redact(String(args.material)).slice(0, 4000) } : {}),
        assignee: ziel.id,
        from: agent?.mxid ?? a.agent,
        originRoom: task.roomId ?? '',
        originThread: task.threadRoot,
        parentTaskId: task.id,
        isHandoff: true,
        idempotencyKey: String(args.idempotency_key ?? `mcp:${a.tokenId}:${task.id}:${ziel.id}:${redact(String(args.goal)).slice(0, 80)}`),
      })
      if (!ergebnis.ok) throw new WerkzeugFehler(`Übergabe abgelehnt (${ergebnis.code}): ${ergebnis.reason}`)
      await audit(a.agent, 'mcp.handoff', ergebnis.taskId, { von: task.id, nach: ziel.id, state: ergebnis.state })
      return {
        ok: true,
        task: ergebnis.taskId,
        state: ergebnis.state,
        hinweis: ergebnis.state === 'auth-required'
          ? `${ergebnis.taskId} wartet auf Vales Freigabe in #schwarm-freigaben (${ziel.id} ist ${ziel.trust}). Das Ergebnis kommt in deinen Thread.`
          : `${ergebnis.taskId} ist an ${ziel.id}. Das Ergebnis kommt als Rückmeldung in deinen Thread.`,
      }
    },
  },
  {
    name: 'task_create',
    description:
      'Auftrag anlegen (§14.3): an dich selbst als Merkposten oder an einen anderen Agenten. Antwortet sofort mit der Auftrags-ID; das Ziel bekommt die Karte in seinen Arbeitsraum. Ohne `task` geht die Quittung in die Lobby, mit `task` wird es eine Übergabe und die Rückmeldung kommt in deinen Thread. Übergaben an T2 brauchen eine Freigabe.',
    inputSchema: schema({
      goal: str('Was erreicht werden soll'),
      deliverable: str('Was am Ende vorliegen muss'),
      assignee: str('Agent-ID des Ziels; ohne Angabe bleibt der Auftrag bei dir'),
      constraints: { type: 'array', items: { type: 'string' }, description: 'Grenzen, z. B. „nur lesen“' },
      material: str('Kontext für das Ziel — keine Geheimnisse'),
      budget_usd: { type: 'number', description: 'Kostenlimit in USD' },
      budget_minutes: { type: 'number', description: 'Minutenbudget' },
      task: str('Auftrag, aus dessen Thread du anlegst (optional)'),
      idempotency_key: str('Eigener Schlüssel gegen doppelte Aufträge'),
    }, ['goal']),
    async handler(a, args) {
      await nichtEingefroren()
      const zielId = args.assignee ? String(args.assignee) : a.agent
      const ziel = await agentById(zielId)
      if (!ziel) throw new WerkzeugFehler(`Agent „${zielId}" ist nicht eingetragen`)
      const agent = await agentById(a.agent)
      const eltern = args.task ? await eigenerAuftrag(String(args.task), a.agent) : null
      // Arbeit an einen **anderen** Agenten ist inhaltlich eine Übergabe, auch ohne
      // Eltern-Auftrag — sonst wäre `task_create` der Weg vorbei an der Freigabe für
      // T2 (§7.3, policy.ts:106). Nur der Merkposten an sich selbst bleibt frei.
      const fremd = ziel.id !== a.agent
      await geschwaerzt(a, eltern?.id ?? null, 'task_create',
        [args.goal, args.deliverable, ...((args.constraints as unknown[]) ?? []), args.material]
          .filter(Boolean).map(String).join('\n'))
      const [lobby] = await roomsByKind('lobby')
      const ergebnis = await createTaskFlow(a.ctx, {
        goal: redact(String(args.goal)).slice(0, 2000),
        ...(args.deliverable ? { deliverable: redact(String(args.deliverable)).slice(0, 2000) } : {}),
        ...(args.constraints ? { constraints: (args.constraints as string[]).map((c) => redact(String(c))) } : {}),
        ...(args.material ? { context: redact(String(args.material)).slice(0, 4000) } : {}),
        ...(args.budget_usd !== undefined ? { budgetUsd: Number(args.budget_usd) } : {}),
        ...(args.budget_minutes !== undefined ? { budgetMinutes: Number(args.budget_minutes) } : {}),
        assignee: ziel.id,
        from: agent?.mxid ?? a.agent,
        originRoom: eltern?.roomId ?? lobby?.roomId ?? '',
        originThread: eltern?.threadRoot ?? null,
        parentTaskId: eltern?.id ?? null,
        isHandoff: Boolean(eltern) || fremd,
        idempotencyKey: String(args.idempotency_key ?? `mcp:${a.tokenId}:create:${ziel.id}:${redact(String(args.goal)).slice(0, 80)}`),
      })
      if (!ergebnis.ok) throw new WerkzeugFehler(`Auftrag abgelehnt (${ergebnis.code}): ${ergebnis.reason}`)
      await audit(a.agent, 'mcp.task_create', ergebnis.taskId, {
        assignee: ziel.id, state: ergebnis.state, selbst: !fremd, parent: eltern?.id ?? null,
      })
      return {
        ok: true,
        task: ergebnis.taskId,
        state: ergebnis.state,
        assignee: ziel.id,
        hinweis: ergebnis.state === 'auth-required'
          ? `${ergebnis.taskId} wartet auf Vales Freigabe in #schwarm-freigaben (${ziel.id} ist ${ziel.trust}).`
          : `${ergebnis.taskId} liegt bei ${ziel.id}${ziel.id === a.agent ? ' — also bei dir' : ''}.`,
      }
    },
  },
  {
    name: 'ask_human',
    description: 'Rückfrage an Vale → input-required. Erinnerung nach 12 h (§10.4).',
    inputSchema: schema({ task: str('Auftragskennung'), question: str('Die Frage, mit den Optionen, die du brauchst') }, ['task', 'question']),
    async handler(a, args) {
      await nichtEingefroren()
      const task = await eigenerAuftrag(args.task, a.agent)
      const frage = (await geschwaerzt(a, task.id, 'ask_human', String(args.question ?? ''))).slice(0, 1500)
      if (!frage) throw new WerkzeugFehler('question ist leer')
      if (!['submitted', 'working'].includes(task.state)) {
        throw new WerkzeugFehler(`${task.id} ist ${task.state} — daraus wird keine Rückfrage`)
      }
      await sql.begin(async (tx) => {
        await store.setState(task.id, 'input-required', {}, tx)
        const ausgabe = []
        if (task.roomId && task.threadRoot) {
          ausgabe.push({
            kind: 'message' as const,
            roomId: task.roomId,
            taskId: task.id,
            payload: {
              type: 'm.room.message',
              role: 'rueckmeldung' as const,
              content: notice(`❓ ${task.id}: ${frage}`, { thread: task.threadRoot, mentions: [] }),
            },
          })
        }
        const { roomsByKind } = await import('../agents/store.js')
        const [lobby] = await roomsByKind('lobby', tx)
        if (lobby?.roomId) {
          ausgabe.push({
            kind: 'message' as const,
            roomId: lobby.roomId,
            taskId: task.id,
            payload: {
              type: 'm.room.message',
              role: 'rueckmeldung' as const,
              content: notice(`❓ ${a.agent} fragt zu ${task.id}:\n${frage}`),
            },
          })
        }
        if (ausgabe.length) await enqueue(tx, ausgabe, a.ctx.hub)
      })
      await audit(a.agent, 'mcp.ask_human', task.id, {})
      return { ok: true, task: task.id, state: 'input-required' }
    },
  },
  {
    name: 'post',
    description:
      'Notice in den Thread des eigenen Auftrags, für Worker und Gateways. Native Bots antworten selbst im Thread. ' +
      'Gedrosselt wie task_update, läuft durch die Redaktion (§11.5).',
    inputSchema: schema({ task: str('Auftragskennung'), text: str('Was du sagen willst') }, ['task', 'text']),
    async handler(a, args) {
      await nichtEingefroren()
      const agent = await agentById(a.agent)
      // Ein `post` als @schwarm im Thread eines nativen Bots würde ihn selbst auslösen: Hermes folgt dem
      // Thread, @schwarm ist erlaubt, und `!yolo` am Anfang führt er ohne Rückfrage aus (§4.4 Befund 1).
      if (!agent || agent.mode === 'native') {
        throw new WerkzeugFehler('post gibt es für native Agenten nicht — antworte direkt im Thread (§14.3)')
      }
      const task = await eigenerAuftrag(args.task, a.agent)
      let inhalt = (await geschwaerzt(a, task.id, 'post', String(args.text ?? ''))).slice(0, 4000)
      if (!inhalt.trim()) throw new WerkzeugFehler('text ist leer')
      // Nie ein Befehl: führendes / oder ! entschärfen (§11.4).
      if (/^\s*[/!]/.test(inhalt)) inhalt = `› ${inhalt.trimStart()}`
      if (!task.roomId || !task.threadRoot) throw new WerkzeugFehler(`${task.id} hat noch keinen Thread`)
      const { getFlag, setFlag } = await import('../db/audit.js')
      const flag = await getFlag<{ at?: number; count?: number }>(`post:${task.id}`)
      const jetzt = Date.now()
      const count = flag?.count ?? 0
      if (flag?.at && jetzt - flag.at < 15_000) {
        return { ok: false, gedrosselt: true, sekunden: Math.ceil((15_000 - (jetzt - (flag.at ?? 0))) / 1000) }
      }
      if (count >= 20) {
        return { ok: false, limit: true, hinweis: '20 Nachrichten erreicht — das Ergebnis gehört in task_complete.' }
      }
      await enqueue(sql, [{
        kind: 'message',
        roomId: task.roomId,
        taskId: task.id,
        asUser: puppetMxid(a.agent),
        payload: {
          type: 'm.room.message',
          role: 'rueckmeldung',
          // Notice: Hermes antwortet nicht darauf (§10.7).
          content: notice(inhalt, { thread: task.threadRoot }),
        },
      }], a.ctx.hub)
      await setFlag(`post:${task.id}`, { at: jetzt, count: count + 1 }, a.agent)
      await audit(a.agent, 'mcp.post', task.id, { zeichen: inhalt.length })
      return { ok: true, nachrichten: count + 1 }
    },
  },
  {
    name: 'read_thread',
    description: 'Verlauf des eigenen Auftrags lesen — bereinigt: Geheimnisse redigiert (§11.5).',
    inputSchema: schema({ task: str('Auftragskennung'), limit: { type: 'number', description: 'Höchstens so viele Nachrichten (Vorgabe 50)' } }, ['task']),
    nurLesen: true,
    async handler(a, args) {
      const task = await auftragOderNichts(args.task, a.agent)
      if (!task.roomId || !task.threadRoot) return { nachrichten: [] }
      const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200)
      const alle = await a.ctx.matrix.threadMessages(task.roomId, task.threadRoot)
      return {
        nachrichten: alle.slice(-limit).map((m) => ({
          sender: m.sender,
          zeit: new Date(m.ts).toISOString(),
          text: redact(m.body),
        })),
      }
    },
  },
]

// Werkzeuge aus matrix/PLAN-weiter.md (Absprachen, Gedächtnis …) stehen in einer eigenen Datei.
WERKZEUGE.push(...ZUSATZ)

export function werkzeug(name: string): Werkzeug | undefined {
  return WERKZEUGE.find((w) => w.name === name)
}
