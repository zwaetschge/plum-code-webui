/**
 * Gastrolle (matrix/PLAN-weiter.md, Punkt 16): Eine zweite Person darf ausgewählte Agenten beauftragen.
 *
 * In `agents.swarm.yaml` unter `gaeste:` (MXID → Rechte):
 *
 *   gaeste:
 *     "@vanessa:zwaetschge-webui.ch":
 *       name: Vanessa
 *       agenten: [brian, plum]
 *       befehle: [auftrag, stand, board, agenten, budget, hilfe]
 *       budget_usd_tag: 2.0
 *
 * Ein Gast wird in die Lobby eingeladen und bekommt dort ein State-Event `ch.zwaetschge.swarm.rollen`
 * (state_key = MXID) für die App. Er darf nur seine Befehle, nur an seine Agenten, bis zu seinem Tagesbudget.
 * Freigaben, Alarme, `!stop`, `!aktion` und alles Weitere bleiben bei Vale; Aufträge an T2-Agenten brauchen
 * Vales ✅. Antworten im Thread gehen nur an Aufträge, die der Gast selbst gegeben hat.
 */
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { z } from 'zod'
import { env } from './env.js'
import type { Db } from './db/index.js'
import { auditMerken, getFlag, setFlag } from './db/audit.js'
import { agentById, agentByMxid, roomsByKind } from './agents/store.js'
import { reply } from './reply.js'
import { lobbyZustand } from './raumhinweis.js'
import { createTaskFlow } from './tasks/create.js'
import * as store from './tasks/store.js'
import type { Ctx } from './context.js'

export const ROLLEN_EVENT = 'ch.zwaetschge.swarm.rollen'
const ZONE = 'Europe/Zurich'
const LESEN = new Set(['stand', 'board', 'agenten', 'budget', 'hilfe', 'abo', 'profil', 'erinnern'])

const GastYaml = z.object({
  name: z.string().max(60).optional(),
  agenten: z.array(z.string()).default([]),
  befehle: z.array(z.string()).default(['auftrag', 'stand', 'hilfe']),
  budget_usd_tag: z.number().nonnegative().default(1),
})

export interface Gast { mxid: string; name: string; agenten: string[]; befehle: string[]; budgetUsdTag: number }

let zwischen: { at: number; gaeste: Map<string, Gast> } | null = null

export async function gaesteLaden(datei = env.agentsFile): Promise<Map<string, Gast>> {
  if (zwischen && Date.now() - zwischen.at < 60_000) return zwischen.gaeste
  const gaeste = new Map<string, Gast>()
  try {
    const doc = parse(await readFile(datei, 'utf8')) as { gaeste?: Record<string, unknown> } | null
    for (const [mxid, roh] of Object.entries(doc?.gaeste ?? {})) {
      const g = GastYaml.safeParse(roh ?? {})
      if (!g.success || !/^@[a-z0-9._=/-]+:[a-z0-9.-]+$/i.test(mxid) || mxid === env.ownerMxid) continue
      gaeste.set(mxid, {
        mxid, name: g.data.name ?? mxid, agenten: g.data.agenten, budgetUsdTag: g.data.budget_usd_tag,
        // `!stop`, `!aktion`, `!weiter` und Freigaben gibt es für Gäste nie, egal was in der Datei steht.
        befehle: g.data.befehle.filter((b) => !['stop', 'weiter', 'aktion', 'rat', 'pruefen', 'selbsttest', 'routine', 'alarm', 'geraet', 'patch', 'entsperren', 'tokens', 'absprachen', 'ablauf'].includes(b)),
      })
    }
  } catch { /* keine Datei: keine Gäste */ }
  zwischen = { at: Date.now(), gaeste }
  return gaeste
}

async function heuteAusgegeben(mxid: string, db: Db): Promise<number> {
  const [z] = await db`
    SELECT COALESCE(sum(cost_usd), 0)::float AS usd FROM swarm.tasks
     WHERE from_agent = ${mxid} AND (created_at AT TIME ZONE ${ZONE})::date = (now() AT TIME ZONE ${ZONE})::date`
  return Number(z?.usd ?? 0)
}

async function gastAuftrag(ctx: Ctx, tx: Db, g: Gast, row: { room_id: string; event_id: string }, agentArg: string, ziel: string, thread: string | null): Promise<string | null> {
  const [agentId, einheit] = agentArg.split('/', 2)
  if (!agentId || !g.agenten.includes(agentId)) return `🚫 Als Gast kannst du ${g.agenten.map((a) => `@${a}`).join(', ') || 'keine Agenten'} beauftragen.`
  if (!ziel) return `Ohne Ziel kein Auftrag: \`!auftrag @${agentId} <ziel>\``
  const ausgegeben = await heuteAusgegeben(g.mxid, tx)
  const rest = g.budgetUsdTag - ausgegeben
  if (rest <= 0.01) return `🚫 Dein Tagesbudget von ${g.budgetUsdTag.toFixed(2)} USD ist aufgebraucht (${ausgegeben.toFixed(2)} USD heute).`
  const agent = await agentById(agentId, tx)
  const r = await createTaskFlow(ctx, {
    goal: einheit ? `@${einheit}: ${ziel}` : ziel,
    assignee: agentId,
    from: g.mxid,
    originRoom: row.room_id,
    originThread: thread,
    idempotencyKey: row.event_id,
    budgetUsd: Math.min(0.5, Math.round(rest * 100) / 100),
    // T2-Agenten (Code, Host) nur mit Vales ✅ in #schwarm-freigaben.
    ...(agent?.trust === 'T2' ? { freigabePflicht: true } : {}),
  }, tx)
  auditMerken(g.mxid, 'gast.auftrag', r.ok ? r.taskId : null, { agent: agentId, ok: r.ok })
  if (!r.ok) return `🚫 Abgelehnt (${r.code}): ${r.reason}`
  return agent?.trust === 'T2' ? `📥 ${r.taskId} an ${agentId}; er startet, sobald Vale freigibt.` : null
}

/**
 * Nachricht eines Gasts behandeln (aus inbox.ts, vor dem Zweig für Bots). true, wenn der Absender ein Gast ist;
 * die Nachricht ist dann erledigt, ob erlaubt oder nicht.
 */
export async function gastNachricht(
  ctx: Ctx,
  tx: Db,
  row: { sender: string; room_id: string; event_id: string; content: Record<string, unknown> },
  body: string,
  thread: string | null,
  weiter: {
    befehl: (input: { body: string; roomId: string; eventId: string; thread: string | null }) => Promise<void>
    anWorker: (agent: string, taskId: string, text: string, eventId: string) => string
    taskVonEvent: (eventId: string) => Promise<string | null>
  },
): Promise<boolean> {
  const g = (await gaesteLaden()).get(row.sender)
  if (!g) return false
  const antwort = (t: string) => reply(ctx, tx, row.room_id, thread, t)
  if (body.startsWith('!')) {
    const [kopf = '', ...rest] = body.slice(1).trim().split(/\s+/)
    const name = kopf.toLowerCase() === 'a' ? 'auftrag' : kopf.toLowerCase()
    if (!g.befehle.includes(name)) {
      auditMerken(g.mxid, 'gast.befehl_verweigert', null, { befehl: name })
      await antwort(`🚫 Als Gast geht !${name} nicht. Erlaubt: ${g.befehle.map((b) => `!${b}`).join(', ')}`)
      return true
    }
    if (name === 'auftrag') {
      const agentArg = (rest[0] ?? '').replace(/^@/, '').split(':')[0]!.replace(/^_sw_/, '')
      const fehler = await gastAuftrag(ctx, tx, g, row, agentArg, rest.slice(1).join(' ').trim(), thread)
      if (fehler) await antwort(fehler)
      return true
    }
    if (name === 'hilfe') {
      await antwort([`Hallo ${g.name}. Als Gast kannst du:`, ...g.befehle.map((b) => `• !${b}`), `Agenten: ${g.agenten.map((a) => `@${a}`).join(', ')} · Tagesbudget ${g.budgetUsdTag.toFixed(2)} USD`].join('\n'))
      return true
    }
    if (LESEN.has(name)) await weiter.befehl({ body, roomId: row.room_id, eventId: row.event_id, thread })
    return true
  }
  // Erwähnung eines erlaubten Agenten = Auftrag (Regel 1), wie bei Vale.
  const mentions = (row.content['m.mentions'] as { user_ids?: string[] } | undefined)?.user_ids ?? []
  for (const mxid of mentions) {
    const agent = await agentByMxid(mxid)
    if (!agent) continue
    const ziel = body.replace(/<[^>]+>/g, ' ').replace(/@[_a-z0-9-]+:[a-z0-9.-]+/gi, ' ').replace(/\s+/g, ' ').trim()
    const fehler = await gastAuftrag(ctx, tx, g, row, agent.id, ziel, thread)
    if (fehler) await antwort(fehler)
    return true
  }
  // Antwort im Thread eines eigenen Worker-Auftrags: an den Worker weiterreichen.
  if (thread) {
    const taskId = await weiter.taskVonEvent(thread)
    const task = taskId ? await store.getTask(taskId, tx) : null
    if (task && task.fromAgent === g.mxid && ['working', 'input-required'].includes(task.state)) {
      const agent = await agentById(task.assignee, tx)
      if (agent?.mode === 'worker') weiter.anWorker(agent.id, task.id, body, row.event_id)
    }
  }
  return true
}

/** Takt (weiter.ts): Gäste in die Lobby einladen und ihre Rollen als State-Event veröffentlichen. */
export async function gaesteTakt(ctx: Ctx): Promise<number> {
  const gaeste = await gaesteLaden()
  if (!gaeste.size) return 0
  const [lobby] = await roomsByKind('lobby')
  if (!lobby?.roomId) return 0
  let geaendert = 0
  for (const g of gaeste.values()) {
    const inhalt = { v: 1, rolle: 'gast', name: g.name, agenten: g.agenten, befehle: g.befehle, budget_usd_tag_cent: Math.round(g.budgetUsdTag * 100) }
    const flag = await getFlag<{ inhalt?: string; eingeladen?: boolean }>(`gast:${g.mxid}`)
    const vergleich = JSON.stringify(inhalt)
    if (flag?.inhalt === vergleich && flag.eingeladen) continue
    // Einmal einladen; ist der Gast schon drin, schlägt die Einladung harmlos fehl.
    if (!flag?.eingeladen) await ctx.matrix.invite(lobby.roomId, g.mxid).catch(() => false)
    const eingeladen = true
    await lobbyZustand(ctx, ROLLEN_EVENT, g.mxid, inhalt)
    await setFlag(`gast:${g.mxid}`, { inhalt: vergleich, eingeladen }, 'hub')
    geaendert++
  }
  return geaendert
}
