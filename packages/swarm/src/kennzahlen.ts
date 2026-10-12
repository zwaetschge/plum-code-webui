/**
 * Verlauf und Kennzahlen (matrix/PLAN-weiter.md, Punkt 20).
 *
 *  - Stündlich (bei Änderung) ein State-Event `ch.zwaetschge.swarm.kennzahlen` in der Lobby, state_key `woche`
 *    (7 Tage) und `monat` (30 Tage): Aufträge je Tag, je Agent (Quote, Median-Dauer, Kosten, 👍/👎, Pause),
 *    Freigaben mit Antwortzeit, Alarme mit Quittierzeit. Ganze Zahlen (Cent, Prozent), weil Synapse kanonisches
 *    JSON verlangt.
 *  - Montags ab 08:10 ein Wochenbericht nach #schwarm-log. `!kennzahlen` zeigt ihn jederzeit.
 */
import { sql, type Db } from './db/index.js'
import { getFlag, setFlag } from './db/audit.js'
import { listAgents } from './agents/store.js'
import { hinweis, lobbyZustand } from './raumhinweis.js'
import { profile } from './profil.js'
import type { Ctx } from './context.js'

export const KENNZAHLEN_EVENT = 'ch.zwaetschge.swarm.kennzahlen'
const ZONE = 'Europe/Zurich'
const cent = (usd: number) => Math.round(usd * 100)

export async function kennzahlen(tage: 7 | 30, db: Db = sql): Promise<Record<string, unknown>> {
  const zeitraum = tage === 7 ? 'woche' : 'monat'
  const tagesZeilen = await db`
    SELECT (created_at AT TIME ZONE ${ZONE})::date::text AS tag, count(*)::int AS auftraege,
           count(*) FILTER (WHERE state = 'completed')::int AS ok,
           count(*) FILTER (WHERE state = 'failed')::int AS fehler,
           count(*) FILTER (WHERE state IN ('canceled', 'rejected'))::int AS abbruch,
           COALESCE(sum(cost_usd), 0)::float AS kosten
      FROM swarm.tasks WHERE created_at > now() - make_interval(days => ${tage}) AND goal NOT LIKE 'Selbsttest:%'
     GROUP BY 1 ORDER BY 1`
  const alarmTage = await db`
    SELECT (erstmals AT TIME ZONE ${ZONE})::date::text AS tag, count(*)::int AS n
      FROM swarm.alarme WHERE erstmals > now() - make_interval(days => ${tage}) AND level <> 'info' GROUP BY 1`
  const alarmNach = new Map(alarmTage.map((a) => [String(a.tag), Number(a.n)]))
  const agenten = await listAgents(db)
  const budget = new Map(agenten.map((a) => [a.id, a.budgetUsdDay === null ? null : Number(a.budgetUsdDay)]))
  const prof = await profile(tage, db)
  const [frei] = await db`
    SELECT count(*)::int AS anzahl,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e.at - a.at))) AS median
      FROM swarm.audit a JOIN LATERAL (
        SELECT at FROM swarm.audit e WHERE e.target = a.target AND e.action IN ('freigabe.erteilt', 'freigabe.abgelehnt') AND e.at >= a.at
         ORDER BY e.at LIMIT 1) e ON true
     WHERE a.action = 'freigabe.anfrage' AND a.at > now() - make_interval(days => ${tage})`
  const [alarme] = await db`
    SELECT count(*)::int AS anzahl,
           count(*) FILTER (WHERE zustand = 'geschlossen')::int AS quittiert,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (beendet_am - erstmals)))
             FILTER (WHERE zustand = 'geschlossen') AS median
      FROM swarm.alarme WHERE erstmals > now() - make_interval(days => ${tage}) AND level <> 'info'`
  const bis = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE }).format(new Date())
  const von = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE }).format(new Date(Date.now() - tage * 86_400_000))
  return {
    v: 1, zeitraum, von, bis, erstellt: Date.now(),
    tage: tagesZeilen.map((t) => ({
      tag: String(t.tag), auftraege: Number(t.auftraege), ok: Number(t.ok), fehler: Number(t.fehler), abbruch: Number(t.abbruch),
      kosten_cent: cent(Number(t.kosten)), alarme: alarmNach.get(String(t.tag)) ?? 0,
    })),
    agenten: prof.map((p) => ({
      agent: p.agent, auftraege: p.auftraege, ok: p.ok, quote_pct: p.quote === null ? null : Math.round(p.quote * 100),
      dauer_median_s: p.dauerMedianS, kosten_cent: cent(p.kostenUsd),
      budget_tag_cent: budget.get(p.agent) === null || budget.get(p.agent) === undefined ? null : cent(budget.get(p.agent)!),
      plus: p.plus, minus: p.minus, pause_bis: p.pauseBis,
    })),
    freigaben: { anzahl: Number(frei?.anzahl ?? 0), median_s: frei?.median === null || frei?.median === undefined ? null : Math.round(Number(frei.median)) },
    alarme: {
      anzahl: Number(alarme?.anzahl ?? 0), quittiert: Number(alarme?.quittiert ?? 0),
      median_quittung_s: alarme?.median === null || alarme?.median === undefined ? null : Math.round(Number(alarme.median)),
    },
  }
}

const dauer = (s: number | null) => (s === null ? '–' : s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`)

export function berichtText(k: Record<string, unknown>): string {
  const tage = k.tage as { auftraege: number; ok: number; fehler: number; abbruch: number; kosten_cent: number }[]
  const summe = tage.reduce((a, t) => ({ n: a.n + t.auftraege, ok: a.ok + t.ok, f: a.f + t.fehler, ab: a.ab + t.abbruch, c: a.c + t.kosten_cent }), { n: 0, ok: 0, f: 0, ab: 0, c: 0 })
  const agenten = k.agenten as { agent: string; auftraege: number; quote_pct: number | null; dauer_median_s: number | null; kosten_cent: number; plus: number; minus: number }[]
  const frei = k.freigaben as { anzahl: number; median_s: number | null }
  const al = k.alarme as { anzahl: number; quittiert: number; median_quittung_s: number | null }
  return [
    `📈 Wochenbericht ${k.von} bis ${k.bis}`,
    `Aufträge: ${summe.n} (${summe.ok} ✅, ${summe.f} ❌, ${summe.ab} 🛑) · Kosten ${(summe.c / 100).toFixed(2)} USD`,
    ...agenten.slice(0, 8).map((a) => `• ${a.agent}: ${a.auftraege} · ${a.quote_pct === null ? '–' : `${a.quote_pct} %`} · Median ${dauer(a.dauer_median_s)} · ` +
      `${(a.kosten_cent / 100).toFixed(2)} USD${a.plus || a.minus ? ` · 👍 ${a.plus} 👎 ${a.minus}` : ''}`),
    `Freigaben: ${frei.anzahl}${frei.median_s !== null ? `, du hast im Median nach ${dauer(frei.median_s)} entschieden` : ''}`,
    `Alarme: ${al.anzahl}, davon ${al.quittiert} quittiert${al.median_quittung_s !== null ? ` (Median ${dauer(al.median_quittung_s)})` : ''}`,
  ].join('\n')
}

const letzte = new Map<string, string>()

/** Takt (weiter.ts): stündlich die Events, montags ab 08:10 der Bericht. */
export async function kennzahlenTakt(ctx: Ctx, jetzt = new Date()): Promise<number> {
  let n = 0
  const stunde = Math.floor(jetzt.getTime() / 3_600_000)
  for (const tage of [7, 30] as const) {
    const schluessel = tage === 7 ? 'woche' : 'monat'
    if (letzte.get(`${schluessel}:stunde`) === String(stunde)) continue
    const k = await kennzahlen(tage)
    const vergleich = JSON.stringify({ ...k, erstellt: 0 })
    letzte.set(`${schluessel}:stunde`, String(stunde))
    if (letzte.get(schluessel) === vergleich) continue
    if (await lobbyZustand(ctx, KENNZAHLEN_EVENT, schluessel, k)) {
      letzte.set(schluessel, vergleich)
      n++
    }
  }
  const t = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(jetzt).map((p) => [p.type, p.value]))
  const heute = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE }).format(jetzt)
  const montags = t.weekday === 'Mon' && Number(t.hour) * 60 + Number(t.minute) >= 8 * 60 + 10
  if (montags || process.env.KENNZAHLEN_JETZT === '1') {
    const flag = await getFlag<{ tag?: string }>('wochenbericht')
    if (flag?.tag !== heute) {
      await setFlag('wochenbericht', { tag: heute }, 'hub')
      await hinweis(ctx, 'log', berichtText(await kennzahlen(7)))
      n++
    }
  }
  return n
}
