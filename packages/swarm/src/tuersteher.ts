/**
 * Der Türsteher im Schwarm (matrix/PLAN-weiter.md, Punkt 4). Der Türsteher (`traefik-tuersteher`) sperrt
 * Scanner-Adressen über eine Traefik-Datei und schreibt seinen Stand nach /mnt/cache/appdata/tuersteher.
 * Der Hub liest den Ordner nur (Mount `/extern/tuersteher:ro`):
 *
 *   !sperren                 → aktive Sperren mit Grund und Ende, neue in 7 Tagen
 *   !entsperren <ip> [grund] → Betrieb trägt die Adresse in erlaubt.txt ein (tuersteher.entsperren);
 *                              der Türsteher hebt die Sperre in Sekunden auf und sperrt sie nie wieder
 *
 * Für die App ein State-Event `ch.zwaetschge.swarm.tuersteher` (state_key "") in der Lobby, für die
 * Tagesübersicht die Wochenzahl. Adressen stehen nur in Vales privaten Räumen.
 */
import { isIP } from 'node:net'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTaskFlow } from './tasks/create.js'
import { audit } from './db/audit.js'
import { lobbyZustand, datumZeit } from './raumhinweis.js'
import type { Ctx } from './context.js'
import { oeffentlicheIp } from './netz.js'

const ORDNER = process.env.TUERSTEHER_DIR || '/extern/tuersteher'
export const TUERSTEHER_EVENT = 'ch.zwaetschge.swarm.tuersteher'
const WOCHE_MS = 7 * 24 * 3600_000
/** Älter als das, und der Türsteher gilt als stehengeblieben (er schreibt alle paar Sekunden). */
const VERALTET_MS = 15 * 60_000
const TAKT_MS = Number(process.env.TUERSTEHER_TAKT_MS || 10 * 60_000)

export interface Sperre {
  ip: string
  seit: string
  bis: string
  grund: string
  rueckfall: boolean
}

export interface TuersteherStand {
  aktualisiert: string | null
  veraltet: boolean
  gesperrt: number
  vertraut: number
  neuInSiebenTagen: number
  sperren: Sperre[]
}

async function jsonLesen(name: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(join(ORDNER, name), 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function tuersteherStand(jetzt = Date.now()): Promise<TuersteherStand | null> {
  const stand = await jsonLesen('stand.json')
  const zustand = await jsonLesen('zustand.json')
  if (!stand && !zustand) return null
  const sperren: Sperre[] = []
  let neu = 0
  for (const eintrag of (zustand?.sperren as unknown[] | undefined) ?? []) {
    if (!Array.isArray(eintrag) || typeof eintrag[0] !== 'string' || !isIP(eintrag[0])) continue
    const s = (eintrag[1] ?? {}) as { seit?: number; bis?: number; grund?: string; frueher?: number[] }
    const seit = Number(s.seit)
    const bis = Number(s.bis)
    if (Number.isFinite(seit) && jetzt - seit < WOCHE_MS) neu++
    if (!Number.isFinite(bis) || bis <= jetzt) continue
    sperren.push({
      ip: eintrag[0],
      seit: new Date(seit).toISOString(),
      bis: new Date(bis).toISOString(),
      grund: String(s.grund ?? '').slice(0, 120),
      rueckfall: Array.isArray(s.frueher) && s.frueher.length > 0,
    })
  }
  sperren.sort((a, b) => b.seit.localeCompare(a.seit))
  const aktualisiert = typeof stand?.aktualisiert === 'string' ? stand.aktualisiert : null
  return {
    aktualisiert,
    veraltet: !aktualisiert || jetzt - new Date(aktualisiert).getTime() > VERALTET_MS,
    gesperrt: typeof stand?.gesperrt === 'number' ? stand.gesperrt : sperren.length,
    vertraut: typeof stand?.vertraut === 'number' ? stand.vertraut : 0,
    neuInSiebenTagen: neu,
    sperren,
  }
}

/** `!sperren` */
export async function sperrenText(max = 20): Promise<string> {
  const s = await tuersteherStand()
  if (!s) return 'Der Türsteher-Stand ist für den Hub nicht lesbar (Mount /extern/tuersteher fehlt?).'
  const kopf = `🚪 Türsteher: ${s.gesperrt} Adressen gesperrt, ${s.neuInSiebenTagen} neu in 7 Tagen, ${s.vertraut} vertraut` +
    (s.veraltet ? `\n⚠️ Stand von ${s.aktualisiert ? datumZeit(s.aktualisiert) : '—'}: Läuft traefik-tuersteher noch?` : '')
  if (!s.sperren.length) return kopf
  return [
    kopf,
    ...s.sperren.slice(0, max).map((x) => `• ${x.ip} — ${x.grund || 'ohne Grund'}${x.rueckfall ? ' (Rückfall)' : ''} · bis ${datumZeit(x.bis)}`),
    s.sperren.length > max ? `… und ${s.sperren.length - max} weitere` : '',
    'Aufheben: !entsperren <ip> [grund] — die Adresse kommt in erlaubt.txt und wird nie wieder gesperrt.',
  ].filter(Boolean).join('\n')
}

/** `!entsperren <ip> [grund]`: Vales Befehl ist die Freigabe, der Betrieb schreibt (wie `!aktion`). */
export async function cmdEntsperren(
  ctx: Ctx,
  input: { body: string; roomId: string; eventId: string; thread: string | null },
  antwort: (t: string) => Promise<void>,
): Promise<void> {
  const [roh, ...rest] = input.body.trim().replace(/^!entsperren\s*/i, '').split(/\s+/)
  const ip = oeffentlicheIp(roh ?? '')
  if (!ip) return antwort('Aufruf: `!entsperren <öffentliche IP> [grund]`. Private Netze sperrt der Türsteher nie.')
  const grund = rest.join(' ').trim().slice(0, 200) || 'von Vale'
  const spec = { capability: 'tuersteher.entsperren', target: ip, args: { grund } }
  const r = await createTaskFlow(ctx, {
    goal: `tuersteher.entsperren ${ip} — ${grund}`,
    deliverable: 'Eintrag in erlaubt.txt',
    budgetMinutes: 5,
    assignee: 'betrieb',
    from: ctx.owner,
    originRoom: input.roomId,
    originThread: input.thread,
    idempotencyKey: input.eventId,
    betriebSpec: JSON.stringify(spec),
  })
  if (!r.ok) return antwort(`🚫 Betrieb lehnte ab (${r.code}): ${r.reason}`)
  await audit(ctx.owner, 'tuersteher.entsperren', r.taskId, { ip })
  return antwort(`🔓 ${r.taskId}: ${ip} kommt in erlaubt.txt. Der Türsteher hebt die Sperre in Sekunden auf.`)
}

let letzterInhalt = ''
let letzteZeit = 0

/** State-Event für die App, höchstens alle 10 min und nur bei Änderung (aus dem Takt in `weiter.ts`). */
export async function tuersteherVeroeffentlichen(ctx: Ctx, jetzt = Date.now()): Promise<boolean> {
  if (jetzt - letzteZeit < TAKT_MS) return false
  const s = await tuersteherStand(jetzt)
  if (!s) return false
  const inhalt = {
    v: 1,
    aktualisiert: s.aktualisiert,
    veraltet: s.veraltet,
    gesperrt: s.gesperrt,
    neu_7_tage: s.neuInSiebenTagen,
    vertraut: s.vertraut,
    sperren: s.sperren.slice(0, 30),
  }
  const vergleich = JSON.stringify({ ...inhalt, aktualisiert: null })
  letzteZeit = jetzt
  if (vergleich === letzterInhalt) return false
  if (!(await lobbyZustand(ctx, TUERSTEHER_EVENT, '', inhalt))) return false
  letzterInhalt = vergleich
  return true
}

/** Eine Zeile für die Tagesübersicht, oder null ohne lesbaren Stand. */
export async function tuersteherZeile(): Promise<string | null> {
  const s = await tuersteherStand()
  if (!s) return null
  return `🚪 Türsteher: ${s.gesperrt} gesperrt, ${s.neuInSiebenTagen} neu in 7 Tagen${s.veraltet ? ' · ⚠️ Stand veraltet' : ''}`
}
