/**
 * Agentenprofil (matrix/PLAN-weiter.md, Punkt 14): Wie zuverlässig ist ein Agent?
 *
 *  - Je Agent über 30 Tage: Aufträge, Erfolgsquote (fertig gegen fehlgeschlagen), Median-Dauer, Kosten und
 *    Vales 👍/👎 auf Karten und Rückmeldungen (`swarm.bewertungen`). Selbsttests zählen nicht.
 *  - `!profil [@agent]` zeigt das; das MCP-Werkzeug `swarm_profil` gibt es den Agenten, damit etwa Brian bei
 *    Übergaben den zuverlässigeren wählt.
 *  - Drei Fehlschläge in Folge (ohne Selbsttests und Abbrüche): Der Agent pausiert 30 min, mit Hinweis in der
 *    Lobby. Neue Aufträge gehen in der Pause an die Rückfallebene (claude-code ↔ codex-host), sonst lehnt der
 *    Hub sie mit Begründung ab. `!weiter @agent` hebt die Pause auf.
 */
import { sql, type Db } from './db/index.js'
import { auditMerken, clearFlag, getFlag, setFlag } from './db/audit.js'
import { agentById, listAgents } from './agents/store.js'
import { hinweis, uhrzeit } from './raumhinweis.js'
import { reply } from './reply.js'
import { RUECKFALL } from './kontingente.js'
import type { Ctx } from './context.js'

const PAUSE_MIN = Number(process.env.PROFIL_PAUSE_MINUTEN || 30)
const FEHLER_IN_FOLGE = 3
const PLUS = ['👍', '👍️', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿']
const MINUS = ['👎', '👎️', '👎🏻', '👎🏼', '👎🏽', '👎🏾', '👎🏿']

export interface Profil {
  agent: string
  auftraege: number
  ok: number
  fehler: number
  abbruch: number
  quote: number | null
  dauerMedianS: number | null
  kostenUsd: number
  plus: number
  minus: number
  pauseBis: string | null
}

export async function profile(tage = 30, db: Db = sql): Promise<Profil[]> {
  const rows = await db`
    SELECT t.assignee AS agent,
           count(*)::int AS auftraege,
           count(*) FILTER (WHERE t.state = 'completed')::int AS ok,
           count(*) FILTER (WHERE t.state = 'failed')::int AS fehler,
           count(*) FILTER (WHERE t.state IN ('canceled', 'rejected'))::int AS abbruch,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.updated_at - t.created_at)))
             FILTER (WHERE t.state = 'completed') AS dauer,
           COALESCE(sum(t.cost_usd), 0)::float AS kosten
      FROM swarm.tasks t
     WHERE t.created_at > now() - make_interval(days => ${tage}) AND t.goal NOT LIKE 'Selbsttest:%'
     GROUP BY t.assignee`
  const bewertungen = await db`
    SELECT t.assignee AS agent, count(*) FILTER (WHERE b.wert > 0)::int AS plus, count(*) FILTER (WHERE b.wert < 0)::int AS minus
      FROM swarm.bewertungen b JOIN swarm.tasks t ON t.id = b.task_id
     WHERE b.at > now() - make_interval(days => ${tage})
     GROUP BY t.assignee`
  const stimmen = new Map(bewertungen.map((b) => [String(b.agent), { plus: Number(b.plus), minus: Number(b.minus) }]))
  const aus: Profil[] = []
  for (const r of rows) {
    const agent = String(r.agent)
    const ok = Number(r.ok)
    const fehler = Number(r.fehler)
    const pause = await getFlag<{ bis?: string }>(`pause:${agent}`, db)
    aus.push({
      agent,
      auftraege: Number(r.auftraege),
      ok,
      fehler,
      abbruch: Number(r.abbruch),
      quote: ok + fehler > 0 ? ok / (ok + fehler) : null,
      dauerMedianS: r.dauer === null ? null : Math.round(Number(r.dauer)),
      kostenUsd: Number(r.kosten),
      plus: stimmen.get(agent)?.plus ?? 0,
      minus: stimmen.get(agent)?.minus ?? 0,
      pauseBis: pause?.bis && new Date(pause.bis) > new Date() ? pause.bis : null,
    })
  }
  return aus.sort((a, b) => b.auftraege - a.auftraege)
}

const dauerText = (s: number | null): string =>
  s === null ? '–' : s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`

/** `!profil [@agent]` */
export async function profilText(agent?: string): Promise<string> {
  const alle = await profile()
  const liste = agent ? alle.filter((p) => p.agent === agent) : alle
  if (!liste.length) return agent ? `${agent} hatte in 30 Tagen keine Aufträge (ohne Selbsttests).` : 'Noch keine Aufträge in den letzten 30 Tagen.'
  return [
    'Profil (30 Tage, ohne Selbsttests):',
    ...liste.map((p) =>
      `${p.pauseBis ? '⏸️' : p.quote === null ? '⚪' : p.quote >= 0.9 ? '🟢' : p.quote >= 0.7 ? '🟡' : '🔴'} ${p.agent}: ` +
      `${p.auftraege} Aufträge, ${p.quote === null ? 'keine Quote' : `${Math.round(p.quote * 100)} % erfolgreich`} ` +
      `(${p.ok} ✅, ${p.fehler} ❌, ${p.abbruch} 🛑) · Median ${dauerText(p.dauerMedianS)} · ${p.kostenUsd.toFixed(2)} USD` +
      (p.plus || p.minus ? ` · 👍 ${p.plus} 👎 ${p.minus}` : '') +
      (p.pauseBis ? ` · pausiert bis ${uhrzeit(p.pauseBis)}` : '')),
  ].join('\n')
}

/**
 * 👍/👎 von Vale auf eine Nachricht, die zu einem Auftrag gehört (Karte, Rückmeldung, Ergebnis). true, wenn
 * die Reaktion damit erledigt ist.
 */
export async function bewertungReaktion(
  ctx: Ctx,
  tx: Db,
  row: { sender: string; event_id: string },
  ziel: string,
  key: string | undefined,
  taskVonEvent: (eventId: string) => Promise<string | null>,
): Promise<boolean> {
  if (!key) return false
  const wert = PLUS.includes(key) ? 1 : MINUS.includes(key) ? -1 : 0
  if (!wert) return false
  if (row.sender !== ctx.owner) return true // Bots bewerten nicht
  const taskId = await taskVonEvent(ziel)
  if (!taskId) return true
  await tx`
    INSERT INTO swarm.bewertungen (task_id, von, wert, event_id) VALUES (${taskId}, ${row.sender}, ${wert}, ${row.event_id})
    ON CONFLICT (task_id, von) DO UPDATE SET wert = EXCLUDED.wert, event_id = EXCLUDED.event_id, at = now()`
  auditMerken(row.sender, 'profil.bewertung', taskId, { wert })
  return true
}

/** Laufende Pause eines Agenten, oder null. */
export async function pauseVon(agent: string, db: Db = sql): Promise<{ bis: string; grund: string } | null> {
  const p = await getFlag<{ bis?: string; grund?: string }>(`pause:${agent}`, db)
  if (!p?.bis || new Date(p.bis) <= new Date()) return null
  return { bis: p.bis, grund: p.grund ?? '' }
}

export async function pauseAufheben(agent: string, db: Db = sql): Promise<boolean> {
  const p = await getFlag(`pause:${agent}`, db)
  if (!p) return false
  await clearFlag(`pause:${agent}`, db)
  return true
}

/**
 * Aus createTaskFlow: Ist der Agent pausiert, geht der Auftrag an die Rückfallebene (wenn es eine gibt und sie
 * nicht auch pausiert ist), sonst wird er abgelehnt. Selbsttests laufen immer, sie prüfen ja gerade.
 */
export async function pausePruefen<T extends { assignee: string; goal: string; originRoom: string; originThread?: string | null; isRueckmeldung?: boolean; betriebSpec?: string }>(
  ctx: Ctx, req: T, tx?: Db,
): Promise<{ req: T } | { abgelehnt: { code: string; reason: string } }> {
  if (req.isRueckmeldung || req.betriebSpec || /^selbsttest:/i.test(req.goal.trim())) return { req }
  const p = await pauseVon(req.assignee, tx)
  if (!p) return { req }
  const ziel = RUECKFALL[req.assignee]
  if (ziel && !(await pauseVon(ziel, tx)) && !(await agentById(ziel, tx))?.frozen) {
    if (req.originRoom) {
      await reply(ctx, tx ?? sql, req.originRoom, req.originThread ?? null,
        `↪️ ${req.assignee} pausiert bis ${uhrzeit(p.bis)} (${p.grund}). Der Auftrag geht an ${ziel}.`)
    }
    return { req: { ...req, assignee: ziel } }
  }
  return { abgelehnt: { code: 'pause', reason: `${req.assignee} pausiert bis ${uhrzeit(p.bis)} (${p.grund}). !weiter @${req.assignee} hebt das auf.` } }
}

/** Takt (weiter.ts): drei Fehlschläge in Folge → Pause. Einmal je Serie, erkannt am neuesten Fehlschlag. */
export async function profilTakt(ctx: Ctx): Promise<number> {
  let pausiert = 0
  for (const a of await listAgents()) {
    if (a.mode === 'notify') continue
    const letzte = await sql`
      SELECT id, state, fail_reason, updated_at FROM swarm.tasks
       WHERE assignee = ${a.id} AND state IN ('completed', 'failed') AND goal NOT LIKE 'Selbsttest:%'
       ORDER BY updated_at DESC LIMIT ${FEHLER_IN_FOLGE}`
    if (letzte.length < FEHLER_IN_FOLGE || !letzte.every((t) => t.state === 'failed')) continue
    const neuester = String(letzte[0]!.id)
    const flag = await getFlag<{ serie?: string }>(`pause-serie:${a.id}`)
    if (flag?.serie === neuester) continue
    const bis = new Date(Date.now() + PAUSE_MIN * 60_000).toISOString()
    const ids = letzte.map((t) => String(t.id)).reverse()
    await setFlag(`pause:${a.id}`, { bis, grund: `${FEHLER_IN_FOLGE} Fehlschläge in Folge`, tasks: ids }, 'hub')
    await setFlag(`pause-serie:${a.id}`, { serie: neuester }, 'hub')
    const ziel = RUECKFALL[a.id]
    await hinweis(ctx, 'lobby', `⏸️ ${a.displayName ?? a.id} pausiert bis ${uhrzeit(bis)}: ${FEHLER_IN_FOLGE} Fehlschläge in Folge ` +
      `(${ids.join(', ')}). ${ziel ? `Neue Aufträge gehen solange an ${ziel}. ` : 'Neue Aufträge lehnt der Hub solange ab. '}` +
      `Früher weiter: !weiter @${a.id}`)
    auditMerken('hub', 'profil.pause', null, { agent: a.id, tasks: ids })
    pausiert++
  }
  return pausiert
}

/** Für die Kennzahlen und das MCP-Werkzeug. */
export async function profilFuerAgenten(): Promise<Record<string, unknown>[]> {
  return (await profile()).map((p) => ({
    agent: p.agent, auftraege: p.auftraege, quote_pct: p.quote === null ? null : Math.round(p.quote * 100),
    dauer_median_s: p.dauerMedianS, kosten_cent: Math.round(p.kostenUsd * 100), plus: p.plus, minus: p.minus, pause_bis: p.pauseBis,
  }))
}
