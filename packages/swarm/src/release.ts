/**
 * Release-Notiz (matrix/PLAN-weiter.md, Punkt 1). Die Release-Strasse `matrix/ops/hub-release.mjs` legt
 * beim Bauen `/app/release.json` ins Image: Tag, Basis-Commit, mitgenommene Dateien aus dem Arbeitsbaum
 * (mit sha256), Testergebnis und Rückweg. Der Hub postet sie nach dem Start genau einmal nach
 * `#schwarm-log`; `!release` zeigt sie wieder.
 *
 * Ein Image ohne die Datei (gebaut mit `compose --build` oder aus einem alten Stand) sagt das auch, damit
 * klar ist, dass es an der Strasse vorbei kam.
 */
import { readFile } from 'node:fs/promises'
import { getFlag, setFlag } from './db/audit.js'
import { hinweis, lobbyZustand } from './raumhinweis.js'
import { alarmMelden } from './alarme.js'
import type { Ctx } from './context.js'

const DATEI = process.env.RELEASE_DATEI || '/app/release.json'

export interface ReleaseInfo {
  tag: string
  basis: string
  zeit: string
  von?: string
  zusatz?: { pfad: string; sha256: string }[]
  tests?: { suiten: number; gruen: number; pruefungen?: number; ausgelassen?: string[] }
  rueckweg?: string
  notiz?: string
}

let geladen: ReleaseInfo | null | undefined

export async function releaseInfo(): Promise<ReleaseInfo | null> {
  if (geladen !== undefined) return geladen
  try {
    const roh = JSON.parse(await readFile(DATEI, 'utf8')) as ReleaseInfo
    geladen = typeof roh?.tag === 'string' && typeof roh.basis === 'string' ? roh : null
  } catch {
    geladen = null
  }
  return geladen
}

export function releaseText(r: ReleaseInfo | null): string {
  if (!r) return 'Dieser Hub kam nicht über die Release-Strasse (kein /app/release.json). Stand und Rückweg: `node matrix/ops/hub-release.mjs stand`.'
  const zusatz = r.zusatz ?? []
  return [
    `🚀 Hub-Release ${r.tag}`,
    `Basis ${r.basis.slice(0, 7)}${zusatz.length ? ` + ${zusatz.length} Datei${zusatz.length === 1 ? '' : 'en'} aus dem Arbeitsbaum${r.von ? ` (${r.von})` : ''}` : ''}`,
    r.tests ? `Tests: ${r.tests.gruen}/${r.tests.suiten} Suiten grün${r.tests.pruefungen ? `, ${r.tests.pruefungen} Prüfungen` : ''}` +
      (r.tests.ausgelassen?.length ? ` · ausgelassen: ${r.tests.ausgelassen.join(', ')}` : '') : '',
    r.notiz ? r.notiz.slice(0, 1500) : '',
    r.rueckweg ? `Rückweg: ${r.rueckweg}` : '',
  ].filter(Boolean).join('\n')
}

/** Einmal pro Release nach `#schwarm-log` (Flag `release`). */
export async function releaseMelden(ctx: Ctx): Promise<boolean> {
  const r = await releaseInfo()
  if (!r) return false
  const flag = await getFlag<{ tag?: string }>('release')
  if (flag?.tag === r.tag) return false
  if (!(await hinweis(ctx, 'log', releaseText(r)))) return false
  await setFlag('release', { tag: r.tag, basis: r.basis, at: new Date().toISOString() }, 'hub')
  return true
}

export const RELEASE_EVENT = 'ch.zwaetschge.swarm.release'
const START = Date.now()
let zustandVeroeffentlicht = ''
let alarmGeprueft = false

/**
 * Der Release-Stand für die App (Verbesserung 2, 27.09.): State-Event `ch.zwaetschge.swarm.release` in der Lobby
 * mit Tag, Basis, Zusatzdateien, Tests und Startzeit. Ohne `/app/release.json` steht `strasse: false`, und der Hub
 * meldet einen Alarm (warn, Fingerabdruck `hub:ohne-release`). So fällt ein Bau an der Strasse vorbei auf, bevor
 * jemand einen Befehl vermisst; am 27.09. um 17:06 UTC fehlten so eine Stunde lang `!modell` und `/absprachen`.
 * Läuft der Hub wieder mit Release, schliesst er den Alarm selbst.
 */
export async function releaseZustand(ctx: Ctx): Promise<boolean> {
  const r = await releaseInfo()
  if (!alarmGeprueft) {
    alarmGeprueft = true
    await alarmMelden(ctx, {
      quelle: 'hub', agent: null, fingerabdruck: 'hub:ohne-release', level: 'warn', behoben: !!r,
      titel: r ? 'Hub läuft wieder mit Release' : 'Hub läuft ohne Release',
      text: r ? '' : 'Dieses Image kam nicht über die Release-Strasse (kein /app/release.json). Befehle und Teile, die nur im ' +
        'Arbeitsbaum lagen, können fehlen. Stand und Rückweg: node matrix/ops/hub-release.mjs stand',
    })
  }
  const inhalt: Record<string, unknown> = r
    ? {
        v: 1, strasse: true, tag: r.tag, basis: r.basis.slice(0, 12), zusatz: (r.zusatz ?? []).length, von: r.von ?? null,
        suiten: r.tests?.suiten ?? null, gruen: r.tests?.gruen ?? null, pruefungen: r.tests?.pruefungen ?? null, seit: START,
      }
    : { v: 1, strasse: false, seit: START }
  const vergleich = JSON.stringify(inhalt)
  if (vergleich === zustandVeroeffentlicht) return false
  if (!(await lobbyZustand(ctx, RELEASE_EVENT, '', inhalt))) return false
  zustandVeroeffentlicht = vergleich
  return true
}
