/**
 * Plan zuerst (matrix/PLAN-weiter.md, Punkt 8). Grosse Code-Aufträge liefern erst einen Plan und warten auf
 * Vales Ja:
 *
 *  - Der Hub setzt im Frame `job` das Feld `plan_zuerst: true`, wenn der Auftrag mit `plan:` beginnt oder
 *    sein Budget mindestens PLAN_AB_USD (1 USD) bzw. PLAN_AB_MINUTEN (30 min) beträgt und der Agent ein
 *    Code-Worker ist. Mit „ohne plan“ im Ziel entfällt das.
 *  - Der Worker schickt den Plan als `frage` („📋 Plan …“, mit Schätzung und betroffenen Dateien). Der Hub
 *    postet ihn wie jede Rückfrage als ❓ im Thread der Karte und in der Lobby.
 *  - Vale antwortet im Thread oder reagiert mit ✅ bzw. ❌ auf die ❓-Notice. Die Reaktion wird zur
 *    Nachricht „ja“ bzw. „nein“ an den Worker (Frame `nachricht`).
 */
import { sql, type Db } from './db/index.js'
import { auditMerken } from './db/audit.js'
import { agentById } from './agents/store.js'
import * as store from './tasks/store.js'
import { zustandUndMeldung } from './tasks/transition.js'
import { reply } from './reply.js'
import type { Ctx } from './context.js'

const PLAN_AB_USD = Number(process.env.PLAN_AB_USD || 1)
const PLAN_AB_MINUTEN = Number(process.env.PLAN_AB_MINUTEN || 30)
const PLAN_AGENTEN = new Set((process.env.PLAN_AGENTEN || 'claude-code,codex-host').split(',').map((s) => s.trim()))

export function planZuerst(task: { goal: string; budgetUsd: number | null; budgetMinutes: number | null }, agent: string): boolean {
  if (!PLAN_AGENTEN.has(agent)) return false
  const ziel = task.goal.trim()
  if (/^selbsttest:/i.test(ziel) || /(^|\s)ohne plan(\s|[.,:;!]|$)/i.test(ziel)) return false
  if (/^plan:/i.test(ziel)) return true
  return Number(task.budgetUsd ?? 0) >= PLAN_AB_USD || Number(task.budgetMinutes ?? 0) >= PLAN_AB_MINUTEN
}

/** Antwort-Weg zum Worker, von worker/server.ts gesetzt (vermeidet einen Import im Kreis). */
type Zustellen = (agent: string, taskId: string, text: string, eventId: string) => 'zugestellt' | 'nicht-verbunden' | 'liest-keine'
let zustellen: Zustellen = () => 'nicht-verbunden'
export function zustellungSetzen(f: Zustellen): void {
  zustellen = f
}

/**
 * ✅/❌ von Vale auf einer ❓-Notice (Rückfrage eines Workers): wird „ja“/„nein“ an den Worker. true, wenn
 * die Reaktion damit erledigt ist.
 */
export async function frageReaktion(
  ctx: Ctx,
  tx: Db,
  row: { sender: string; room_id: string; event_id: string },
  ziel: string,
  key: string | undefined,
  taskVonEvent: (eventId: string) => Promise<string | null>,
): Promise<boolean> {
  if (row.sender !== ctx.owner || (key !== '✅' && key !== '❌')) return false
  const [aus] = await tx`SELECT payload FROM swarm.outbox WHERE sent_event_id = ${ziel} LIMIT 1`
  const body = String((aus?.payload as { content?: { body?: string } } | undefined)?.content?.body ?? '')
  if (!body.startsWith('❓')) return false
  const taskId = await taskVonEvent(ziel)
  if (!taskId) return false
  const task = await store.getTask(taskId, tx)
  if (!task || !['working', 'input-required'].includes(task.state)) return true
  const agent = await agentById(task.assignee, tx)
  if (agent?.mode !== 'worker') return false
  const antwort = key === '✅' ? 'ja' : 'nein'
  const z = zustellen(agent.id, task.id, antwort, row.event_id)
  if (z !== 'zugestellt') {
    await reply(ctx, tx, row.room_id, task.threadRoot, z === 'liest-keine'
      ? `📭 ${agent.displayName ?? agent.id} liest keine Antworten. ${antwort === 'nein' ? `Abbrechen mit !stop ${task.id}.` : ''}`
      : `📭 Nicht zugestellt: ${agent.displayName ?? agent.id} führt ${task.id} gerade nicht.`)
    return true
  }
  if (task.state === 'input-required') await zustandUndMeldung(ctx, tx, task.id, 'working', {})
  auditMerken(row.sender, 'plan.antwort', task.id, { antwort, per: 'reaktion' })
  return true
}

/** Für Tests und `!stand`: Kennt der Hub eine Plan-Rückfrage zu diesem Auftrag? */
export async function offenePlanFrage(taskId: string, db: Db = sql): Promise<boolean> {
  const [z] = await db`
    SELECT 1 FROM swarm.outbox
     WHERE task_id = ${taskId} AND payload->'content'->>'body' LIKE '❓%📋 Plan%' LIMIT 1`
  return Boolean(z)
}
