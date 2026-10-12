/**
 * Plum-Sitzungen als Auftraggeber (matrix/PLAN-weiter.md, Punkt 12). Eine Plum-Sitzung gibt über das
 * Swarm-MCP (`auftrag_geben`, Kopf `x-plum-session`) einen Auftrag; `swarm.plum_auftraege` merkt sich die
 * Sitzung. Ist der Auftrag fertig (oder gescheitert), schickt der Hub der Plum-Brücke den Frame
 * `ergebnis {sitzung, task_id, state, agent, text}`, und die Brücke stellt ihn als Nachricht in die Sitzung.
 * Ist die Brücke nicht verbunden, wartet der Hub und versucht es im nächsten Takt wieder (höchstens 7 Tage).
 */
import { sql } from './db/index.js'
import { auditMerken } from './db/audit.js'
import { redact } from './redact.js'
import type { Ctx } from './context.js'

type Senden = (agent: string, frame: Record<string, unknown>) => boolean
let senden: Senden = () => false
export function plumSendenSetzen(f: Senden): void {
  senden = f
}

export async function plumRueckTakt(_ctx: Ctx): Promise<number> {
  const fertig = await sql`
    SELECT p.task_id, p.sitzung, t.state, t.assignee, t.result, t.fail_reason
      FROM swarm.plum_auftraege p JOIN swarm.tasks t ON t.id = p.task_id
     WHERE p.zugestellt IS NULL AND p.erstellt > now() - interval '7 days'
       AND t.state IN ('completed', 'failed', 'canceled', 'rejected')
     ORDER BY p.erstellt LIMIT 10`
  let n = 0
  for (const f of fertig) {
    const text = f.state === 'completed' ? redact(String(f.result ?? '')).slice(0, 12_000) : redact(String(f.fail_reason ?? f.state)).slice(0, 1000)
    const ok = senden('plum', { type: 'ergebnis', sitzung: String(f.sitzung), task_id: String(f.task_id), state: String(f.state), agent: String(f.assignee), text })
    if (!ok) break
    await sql`UPDATE swarm.plum_auftraege SET zugestellt = now() WHERE task_id = ${String(f.task_id)}`
    auditMerken('hub', 'plum.ergebnis', String(f.task_id), { state: String(f.state) })
    n++
  }
  return n
}
