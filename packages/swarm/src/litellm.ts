/**
 * LiteLLM in der App (App 2.10; Vale 2026-09-28: „binde litellm auch direkt in die schwarm app ein“).
 *
 *  - Brian hat einen eigenen LiteLLM-Schlüssel (`schwarm-brian`, 40 USD je 30 Tage) für seine Ersatzkette
 *    (Mistral, DeepSeek), sein Bildverständnis und die Chat-Modelle in Allgemein. Der Hub liest mit demselben
 *    Schlüssel nur: welche Modelle er darf und wie viel davon verbraucht ist. Er liegt als Datei im
 *    Container (`/extern/litellm/brian-key`, nur lesbar), nie in Nachrichten oder Events.
 *  - Abruf über schwarm-plum-relay (`/litellm/modelle`, `/litellm/schluessel`, nur GET; Completions gehen dort
 *    nicht durch), alle 5 min, nach einem Fehler nach einer Minute.
 *  - State-Event `ch.zwaetschge.swarm.litellm` (state_key "") in der Lobby: erreichbar, Modelle mit Anbieter,
 *    Ausgaben und Budget in Cent, Zeitraum, nächster Neustart des Budgets. Nur ganze Zahlen (kanonisches JSON).
 *  - `!llm` zeigt denselben Stand in der Lobby.
 */
import { readFile } from 'node:fs/promises'
import { lobbyZustand } from './raumhinweis.js'
import type { Ctx } from './context.js'

export const LITELLM_EVENT = 'ch.zwaetschge.swarm.litellm'
const BASIS = (process.env.LITELLM_RELAY || 'http://schwarm-plum-relay:8080/litellm').replace(/\/$/, '')
const SCHLUESSEL_DATEI = process.env.LITELLM_KEY_DATEI || '/extern/litellm/brian-key'
const TAKT_MS = Number(process.env.LITELLM_TAKT_MS || 300_000)
const MODELL_OK = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,79}$/

/** Anbieter aus dem Präfix des LiteLLM-Namens (so benennt llm-hub seine Modelle). */
const ANBIETER: Record<string, string> = {
  ds: 'DeepSeek', gem: 'Gemini', local: 'Lokal', ali: 'Alibaba', kimi: 'Kimi', mistral: 'Mistral', or: 'OpenRouter', zai: 'Z.AI',
}
export const anbieterVon = (id: string): string => ANBIETER[id.split('/')[0] ?? ''] ?? (id.split('/')[0] || 'LiteLLM')

export interface LiteStand {
  erreichbar: boolean
  modelle: { id: string; anbieter: string }[]
  ausgabenCent: number | null
  budgetCent: number | null
  zeitraum: string | null
  zurueck: number | null
  stand: number
  fehler: string | null
}

let stand: LiteStand | null = null
let naechster = 0
let veroeffentlicht = ''

async function schluessel(): Promise<string | null> {
  try {
    const k = (await readFile(SCHLUESSEL_DATEI, 'utf8')).trim()
    return k.length >= 10 ? k : null
  } catch {
    return null
  }
}

async function holen(): Promise<LiteStand> {
  const jetzt = Date.now()
  const k = await schluessel()
  if (!k) return { erreichbar: false, modelle: [], ausgabenCent: null, budgetCent: null, zeitraum: null, zurueck: null, stand: jetzt, fehler: 'kein Schlüssel' }
  const kopf = { authorization: `Bearer ${k}` }
  try {
    const [m, s] = await Promise.all([
      fetch(`${BASIS}/modelle`, { headers: kopf, signal: AbortSignal.timeout(15_000) }),
      fetch(`${BASIS}/schluessel`, { headers: kopf, signal: AbortSignal.timeout(15_000) }),
    ])
    if (!m.ok) return { ...(stand ?? leer(jetzt)), erreichbar: false, stand: jetzt, fehler: `LiteLLM antwortet ${m.status}` }
    const md = (await m.json()) as { data?: { id?: unknown }[] }
    const modelle = (md.data ?? []).map((x) => String(x.id ?? '')).filter((id) => MODELL_OK.test(id))
      .sort().map((id) => ({ id, anbieter: anbieterVon(id) }))
    let info: Record<string, unknown> = {}
    if (s.ok) info = (((await s.json()) as { info?: Record<string, unknown> }).info) ?? {}
    const cent = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : null)
    const reset = typeof info.budget_reset_at === 'string' ? Date.parse(info.budget_reset_at) : NaN
    return {
      erreichbar: true, modelle,
      ausgabenCent: cent(info.spend), budgetCent: cent(info.max_budget),
      zeitraum: typeof info.budget_duration === 'string' ? info.budget_duration.slice(0, 10) : null,
      zurueck: Number.isFinite(reset) ? reset : null, stand: jetzt, fehler: null,
    }
  } catch (err) {
    return { ...(stand ?? leer(jetzt)), erreichbar: false, stand: jetzt, fehler: (err as Error).name === 'TimeoutError' ? 'Zeitüberschreitung' : 'nicht erreichbar' }
  }
}

const leer = (jetzt: number): LiteStand =>
  ({ erreichbar: false, modelle: [], ausgabenCent: null, budgetCent: null, zeitraum: null, zurueck: null, stand: jetzt, fehler: null })

export function liteStand(): LiteStand | null {
  return stand
}

/** Takt (weiter.ts): alle 5 min holen, das Event nur bei einer Änderung neu schreiben (plus einmal je Stunde). */
export async function litellmTakt(ctx: Ctx, jetzt = Date.now()): Promise<boolean> {
  if (jetzt < naechster) return false
  stand = await holen()
  naechster = jetzt + (stand.erreichbar ? TAKT_MS : 60_000)
  const inhalt = {
    v: 1, erreichbar: stand.erreichbar, modelle: stand.modelle,
    ...(stand.ausgabenCent !== null ? { ausgaben_cent: stand.ausgabenCent } : {}),
    ...(stand.budgetCent !== null ? { budget_cent: stand.budgetCent } : {}),
    ...(stand.zeitraum ? { zeitraum: stand.zeitraum } : {}),
    ...(stand.zurueck ? { zurueck: stand.zurueck } : {}),
    ...(stand.fehler ? { fehler: stand.fehler } : {}),
  }
  const schluesselText = JSON.stringify(inhalt) + Math.floor(jetzt / 3_600_000)
  if (schluesselText === veroeffentlicht) return false
  if (!(await lobbyZustand(ctx, LITELLM_EVENT, '', { ...inhalt, stand: Math.floor(stand.stand / 1000) * 1000 }))) return false
  veroeffentlicht = schluesselText
  return true
}

export function llmText(s: LiteStand | null): string {
  if (!s) return 'LiteLLM: noch kein Stand (der Hub fragt alle 5 min).'
  if (!s.erreichbar) return `⚠️ LiteLLM nicht erreichbar${s.fehler ? `: ${s.fehler}` : ''}.`
  const usd = (c: number | null) => (c === null ? '?' : (c / 100).toFixed(2))
  const gruppen = new Map<string, string[]>()
  for (const m of s.modelle) gruppen.set(m.anbieter, [...(gruppen.get(m.anbieter) ?? []), m.id])
  return [
    `🧠 LiteLLM (Schlüssel schwarm-brian): ${usd(s.ausgabenCent)} von ${usd(s.budgetCent)} USD${s.zeitraum ? ` je ${s.zeitraum}` : ''}` +
      (s.zurueck ? `, neu ab ${new Date(s.zurueck).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })}` : ''),
    ...[...gruppen].map(([a, ids]) => `· ${a}: ${ids.join(', ')}`),
  ].join('\n')
}
