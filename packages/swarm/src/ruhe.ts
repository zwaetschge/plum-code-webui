/**
 * Ruhezeiten (Verbesserung 3, 28.09., App 2.9): Nachts weckt der Hub die App nur noch für Dringendes.
 *
 *  - `!ruhe 22:00-07:00` schaltet sie ein (Zürcher Zeit), `!ruhe aus` und `!ruhe an` schalten, `!ruhe` zeigt den
 *    Stand. Die Antwort kommt im Thread des Befehls, weil die App dort wartet.
 *  - In der Ruhezeit wecken nur `🚨` (crit), `⬆️` (Alarm steigt), `🔐` (Freigabe mit Frist) und `⛔` (Not-Aus).
 *    Alles andere zählt der Hub mit und weckt die App am Ende der Ruhezeit genau einmal.
 *  - State-Event `ch.zwaetschge.swarm.ruhe` in der Lobby: Die App liest daraus dieselbe Zeit und meldet in der
 *    Ruhezeit auch ihre eigenen Benachrichtigungen (15-min-Check) nur still.
 */
import { getFlag, setFlag } from './db/audit.js'
import { lobbyZustand } from './raumhinweis.js'
import type { Ctx } from './context.js'
import type { CommandInput } from './commands/index.js'

export const RUHE_EVENT = 'ch.zwaetschge.swarm.ruhe'
const ZONE = 'Europe/Zurich'

export interface Ruhe {
  an: boolean
  von: string
  bis: string
}

const STANDARD: Ruhe = { an: false, von: '22:00', bis: '07:00' }
let stand: Ruhe | null = null
let verpasst = 0
let veroeffentlicht = false

export async function ruhe(): Promise<Ruhe> {
  if (!stand) stand = { ...STANDARD, ...((await getFlag<Partial<Ruhe>>('ruhezeiten')) ?? {}) }
  return stand
}

const minuten = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export function zuercherMinuten(jetzt: Date): number {
  const teile = new Intl.DateTimeFormat('de-CH', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(jetzt)
  const wert = (t: string) => Number(teile.find((p) => p.type === t)?.value ?? 0)
  return wert('hour') * 60 + wert('minute')
}

export function inRuhezeit(r: Ruhe, jetzt = new Date()): boolean {
  if (!r.an) return false
  const m = zuercherMinuten(jetzt)
  const v = minuten(r.von)
  const b = minuten(r.bis)
  if (v === b) return false
  return v < b ? m >= v && m < b : m >= v || m < b
}

/** Weckt auch in der Ruhezeit. */
export function dringend(art: string, body: string): boolean {
  const erste = body.trimStart()
  if (art === 'alerts') return /^(🚨|⬆️)/u.test(erste)
  return /^(🔐|⛔)/u.test(erste)
}

/** Vor dem Wecken (push.ts): true heisst, die Ruhezeit hält die Weckmeldung zurück. */
export async function ruheHaelt(art: string, body: string, jetzt = new Date()): Promise<boolean> {
  if (dringend(art, body) || !inRuhezeit(await ruhe(), jetzt)) return false
  verpasst++
  return true
}

/** Takt (weiter.ts): Event einmal nach dem Start; nach der Ruhezeit einmal wecken, wenn etwas liegen blieb. */
export async function ruheTakt(ctx: Ctx, wecken?: (grund: string) => void): Promise<boolean> {
  if (!veroeffentlicht) veroeffentlicht = await veroeffentlichen(ctx)
  if (!verpasst || inRuhezeit(await ruhe())) return false
  const n = verpasst
  verpasst = 0
  wecken?.(`nach der Ruhezeit (${n} zurückgehalten)`)
  return true
}

async function veroeffentlichen(ctx: Ctx): Promise<boolean> {
  const r = await ruhe()
  return lobbyZustand(ctx, RUHE_EVENT, '', { v: 1, an: r.an, von: r.von, bis: r.bis, zone: ZONE, dringend: ['🚨', '⬆️', '🔐', '⛔'] })
}

export function ruheText(r: Ruhe): string {
  return r.an
    ? `🌙 Ruhezeit ${r.von}–${r.bis} (Zürcher Zeit): Dann wecken nur 🚨, ⬆️, 🔐 und ⛔. Der Rest kommt gesammelt um ${r.bis}.`
    : `🔔 Keine Ruhezeit: Alles für dich weckt sofort. Einschalten mit \`!ruhe ${r.von}-${r.bis}\`.`
}

const ZEIT = /^(\d{1,2})(?::(\d{2}))?$/
function zeit(roh: string): string | null {
  const m = ZEIT.exec(roh.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** `!ruhe [an|aus|HH:MM-HH:MM]` */
export async function cmdRuhe(ctx: Ctx, input: CommandInput, antwort: (t: string) => Promise<void>): Promise<void> {
  const arg = input.body.trim().replace(/^!ruhe\s*/i, '').trim().toLowerCase()
  const alt = await ruhe()
  let neu: Ruhe
  if (!arg) return antwort(ruheText(alt))
  if (arg === 'aus') neu = { ...alt, an: false }
  else if (arg === 'an') neu = { ...alt, an: true }
  else {
    const [a, b] = arg.split(/\s*[-–]\s*/)
    const von = a ? zeit(a) : null
    const bis = b ? zeit(b) : null
    if (!von || !bis || von === bis) return antwort('Aufruf: `!ruhe 22:00-07:00`, `!ruhe an`, `!ruhe aus` oder `!ruhe`.')
    neu = { an: true, von, bis }
  }
  await setFlag('ruhezeiten', { ...neu }, 'vale')
  stand = neu
  await veroeffentlichen(ctx)
  return antwort(ruheText(neu))
}
