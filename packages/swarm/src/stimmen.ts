/**
 * Stimmen je Agent beim Vorlesen (App 2.2; Vale: „man muss den agenten individuelle stimmen geben können“).
 *
 *  - Die Liste kommt aus Vocarium (`/api/voices`, über schwarm-plum-relay `/stimmen`), beim Start und dann
 *    stündlich. **Es zählen nur Omnivoices** (`engine`/`source` = `omnivoice`, Vale 2026-09-27): Die schnellen
 *    kikiri-Stimmen bleiben beim Vorlesen draussen. Der Hub veröffentlicht die Liste als State-Event
 *    `ch.zwaetschge.swarm.stimmen` (state_key "") mit der Stimme des Hubs und dem Standard.
 *  - Die Standards stehen in ops/matrix/modelle.yaml (`stimmen`, nur Omnivoices), Vales Wahl in
 *    `swarm.modelle.stimme`; die Zeile `hub` gilt für die Notices von @schwarm. `!stimme @agent <id>|standard`
 *    setzt. Eine Wahl, die keine Omnivoice (mehr) ist, nimmt der Hub zurück und spricht mit dem Standard.
 *  - Beim Vorlesen wählt der Hub die Stimme nach dem Absender der Nachricht (`sprecher`), ausser die App nennt
 *    ausdrücklich eine (`stimme`, etwa für „Probe hören“).
 */
import { sql, type Db } from './db/index.js'
import { auditMerken } from './db/audit.js'
import { agentById, listAgents } from './agents/store.js'
import { lobbyZustand } from './raumhinweis.js'
import { modellStandVeroeffentlichen, stimmenStandard } from './modelle.js'
import type { Ctx } from './context.js'

export const STIMMEN_EVENT = 'ch.zwaetschge.swarm.stimmen'
const URL = process.env.STIMMEN_URL || 'http://schwarm-plum-relay:8080/stimmen'
const TAKT_MS = Number(process.env.STIMMEN_TAKT_MS || 3_600_000)
export const STIMME_OK = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

/** Welche Stimmen sprechen dürfen: Vocarium liefert auch kikiri-Stimmen, erlaubt sind nur Omnivoices. */
export const OMNIVOICE = 'omnivoice'
/** Spricht sonst niemand (Liste leer und der Katalog verstellt), dann diese Stimme. */
const NOTFALL = process.env.TTS_OMNIVOICE || 'David-Nathan'
/** Wie oft der Hub Wahlen prüft, die keine Omnivoice sind, und sie auf den Standard zurücknimmt. */
const RAEUMEN_MS = Number(process.env.STIMMEN_RAEUMEN_MS || 300_000)
let naechstesRaeumen = 0

export interface Stimme { id: string; name: string; sprache: string; engine: string }
let liste: Stimme[] = []
let naechsterAbruf = 0

async function holen(): Promise<Stimme[] | null> {
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const d = (await res.json()) as { voices?: Array<Record<string, unknown>> }
    const alle = (d.voices ?? [])
      .filter((v) => typeof v.id === 'string' && STIMME_OK.test(v.id))
      .map((v) => ({
        id: String(v.id),
        name: String(v.name ?? v.id).slice(0, 60),
        sprache: String(v.language ?? '').slice(0, 20),
        engine: String(v.engine ?? v.source ?? '').slice(0, 20),
      }))
    const omni = alle.filter((v) => v.engine === OMNIVOICE)
    // Keine einzige Omnivoice: dann gilt der Abruf als misslungen und die alte Liste bleibt. Sonst könnte
    // ein leerer Katalog von Vocarium das Vorlesen auf eine Notfalldatei zurückwerfen.
    return omni.length ? omni : null
  } catch {
    return null
  }
}

async function hubStimme(db: Db): Promise<string> {
  const [z] = await db`SELECT stimme FROM swarm.modelle WHERE agent = 'hub'`
  return (z?.stimme as string | null | undefined) ?? stimmenStandard().hub ?? stimmenStandard().standard
}

let letzter = ''
async function veroeffentlichen(ctx: Ctx, db: Db): Promise<boolean> {
  const std = stimmenStandard()
  const inhalt = { v: 1, stimmen: liste, hub: await hubStimme(db), hub_standard: std.hub ?? std.standard, standard: std.standard }
  const vergleich = JSON.stringify(inhalt)
  if (vergleich === letzter) return false
  if (!(await lobbyZustand(ctx, STIMMEN_EVENT, '', inhalt, db))) return false
  letzter = vergleich
  return true
}

/** Takt (weiter.ts): die Liste beim Start und dann stündlich holen; scheitert es, nach einer Minute erneut. */
export async function stimmenTakt(ctx: Ctx, jetzt = Date.now()): Promise<number> {
  let getan = 0
  if (jetzt >= naechsterAbruf) {
    const neu = await holen()
    if (neu) liste = neu
    naechsterAbruf = jetzt + (neu ? TAKT_MS : 60_000)
  }
  if (jetzt >= naechstesRaeumen) {
    naechstesRaeumen = jetzt + RAEUMEN_MS
    getan += await alteWahlenRaumen(ctx, sql)
  }
  return getan + ((await veroeffentlichen(ctx, sql)) ? 1 : 0)
}

/**
 * Darf diese Stimme sprechen? Nur Omnivoices aus Vocarium. Ist die Liste gerade nicht da, gelten die Stimmen
 * aus dem Katalog (ops/matrix/modelle.yaml) — die sind ebenfalls Omnivoices.
 */
export function istOmnivoice(id: string | null | undefined): boolean {
  if (!id || !STIMME_OK.test(id)) return false
  if (liste.length) return liste.some((s) => s.id === id)
  const std = stimmenStandard()
  return id === std.standard || id === std.hub || Object.values(std.agenten).includes(id)
}

/**
 * Die Stimme, die auf jeden Fall spricht: die gewünschte, sonst `ersatz` (der Standard des Agenten), sonst
 * der Standard aus dem Katalog, sonst die erste Omnivoice der Liste. So fällt eine alte kikiri-Wahl auf die
 * Stimme des Agenten zurück und nicht auf die irgendeines anderen.
 */
export function sichereStimme(gewuenscht?: string | null, ersatz?: string | null): string {
  if (gewuenscht && istOmnivoice(gewuenscht)) return gewuenscht
  if (ersatz && istOmnivoice(ersatz)) return ersatz
  const std = stimmenStandard()
  if (istOmnivoice(std.standard)) return std.standard
  return liste[0]?.id ?? NOTFALL
}

/**
 * Wahlen zurücknehmen, die keine Omnivoice sind (etwa kikiri-Stimmen von vor dem 2026-09-27): NULL heisst
 * wieder „Standard aus dem Katalog“, und die App zeigt den neuen Standard. Mit einem Eintrag in der
 * Audit-Kette, damit sichtbar bleibt, was der Hub geändert hat.
 */
async function alteWahlenRaumen(ctx: Ctx, db: Db): Promise<number> {
  if (!liste.length) return 0
  let n = 0
  const zeilen = await db`SELECT agent, stimme FROM swarm.modelle WHERE stimme IS NOT NULL`
  for (const z of zeilen) {
    const agent = String(z.agent)
    const alt = String(z.stimme)
    if (istOmnivoice(alt)) continue
    await db`UPDATE swarm.modelle SET stimme = NULL WHERE agent = ${agent}`
    auditMerken('hub', 'stimme.zurueckgesetzt', agent, { stimme: alt, grund: 'keine-omnivoice' })
    if (agent === 'hub') await veroeffentlichen(ctx, db)
    else await modellStandVeroeffentlichen(ctx, agent, db)
    n++
  }
  return n
}

/** Welche Stimme spricht eine Nachricht von `sprecher`? Agent (Vales Wahl, sonst Katalog) → Hub → Standard. */
export async function stimmeFuer(ctx: Ctx, sprecher: string | null, db: Db = sql): Promise<string> {
  const std = stimmenStandard()
  if (!sprecher) return sichereStimme(std.standard)
  if (sprecher === ctx.hub) return sichereStimme(await hubStimme(db), std.hub ?? std.standard)
  const a = (await listAgents(db)).find((x) => x.mxid === sprecher)
  if (!a) return sichereStimme(std.standard)
  const [z] = await db`SELECT stimme FROM swarm.modelle WHERE agent = ${a.id}`
  const standard = std.agenten[a.id] ?? std.standard
  return sichereStimme(z?.stimme as string | null | undefined, standard)
}

const stimmeName = (id: string) => liste.find((s) => s.id === id)?.name ?? id

/** `!stimme` · `!stimme @agent <id>|standard` · `!stimme @hub <id>` für die Notices des Hubs */
export async function cmdStimme(
  ctx: Ctx,
  tx: Db,
  input: { body: string; sender?: string },
  antwort: (t: string) => Promise<void>,
): Promise<void> {
  const std = stimmenStandard()
  const teile = input.body.trim().replace(/^!stimmen?\s*/i, '').split(/\s+/).filter(Boolean)
  const eigene = new Map((await tx`SELECT agent, stimme FROM swarm.modelle WHERE stimme IS NOT NULL`).map((z) => [String(z.agent), String(z.stimme)]))
  const zeile = (agent: string) => {
    const s = eigene.get(agent) ?? (agent === 'hub' ? (std.hub ?? std.standard) : (std.agenten[agent] ?? std.standard))
    return `• ${agent}: ${stimmeName(s)}${eigene.has(agent) ? '' : ' (Standard)'}`
  }
  if (!teile.length) {
    const agenten = (await listAgents(tx)).map((a) => a.id)
    return antwort(['🗣️ Stimmen beim Vorlesen:', zeile('hub'), ...agenten.map(zeile),
      `${liste.length} Stimmen in Vocarium. Ändern: \`!stimme @agent <stimme>\`, zurück: \`!stimme @agent standard\`, für den Hub \`@hub\`.`].join('\n'))
  }
  const wer = teile[0]!.replace(/^@/, '').toLowerCase()
  const ziel = wer === 'hub' || wer === 'schwarm' ? 'hub' : wer
  if (ziel !== 'hub' && !(await agentById(ziel, tx))) return antwort(`🚫 Unbekannter Agent „${wer}“. \`!stimme\` zeigt alle.`)
  if (teile.length === 1) return antwort(zeile(ziel))
  const wahl = teile[1]!
  const von = input.sender ?? ctx.owner
  if (wahl === 'standard') {
    await tx`UPDATE swarm.modelle SET stimme = NULL, geaendert_von = ${von}, geaendert_am = now() WHERE agent = ${ziel}`
  } else {
    if (!liste.length) return antwort('🚫 Die Stimmenliste von Vocarium ist gerade nicht erreichbar, bitte später noch einmal.')
    if (!istOmnivoice(wahl)) {
      return antwort(
        `🚫 „${wahl}“ spricht nicht. Es sprechen nur Omnivoices aus Vocarium; die ${liste.length} Stimmen stehen ` +
        'in der App unter Schwarm → Agent → „Stimme wählen“. Andere legst du dort als Omnivoice an.',
      )
    }
    await tx`
      INSERT INTO swarm.modelle (agent, stimme, geaendert_von, geaendert_am) VALUES (${ziel}, ${wahl}, ${von}, now())
      ON CONFLICT (agent) DO UPDATE SET stimme = EXCLUDED.stimme, geaendert_von = EXCLUDED.geaendert_von, geaendert_am = now()`
  }
  auditMerken(von, 'stimme.gesetzt', ziel, { stimme: wahl === 'standard' ? null : wahl })
  if (ziel === 'hub') await veroeffentlichen(ctx, tx)
  else await modellStandVeroeffentlichen(ctx, ziel, tx)
  const neu = sichereStimme(wahl === 'standard' ? (ziel === 'hub' ? (std.hub ?? std.standard) : (std.agenten[ziel] ?? std.standard)) : wahl,
    ziel === 'hub' ? (std.hub ?? std.standard) : (std.agenten[ziel] ?? std.standard))
  return antwort(`✅ ${ziel === 'hub' ? 'Der Hub' : ziel} spricht jetzt mit ${stimmeName(neu)}${wahl === 'standard' ? ' (Standard)' : ''}.`)
}
