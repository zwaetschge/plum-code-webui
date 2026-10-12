/**
 * Vorlesen mit Vocarium (matrix/SCHNITTSTELLEN-app.md, „App 2.2“).
 *
 * Die App schickt als Vale ein Event `ch.zwaetschge.swarm.vorlesen` in die Lobby: `{ v, anfrage, text }` oder
 * `{ v, anfrage, abbrechen: true }`. Der Hub macht aus dem Markdown sprechbaren Text, teilt ihn an Satzgrenzen
 * (ein kurzes erstes Stück, damit es schnell losgeht) und lässt Vocarium jedes Stück sprechen: über
 * schwarm-plum-relay `/tts`, OpenAI-kompatibel, WAV. Jedes Stück lädt er hoch und meldet es als
 * `ch.zwaetschge.swarm.vorlesen.teil` `{ v, anfrage, nr, von, mxc, mimetype, groesse, dauer_ms }`, Fehler mit
 * `fehler`, Abbruch mit `abgebrochen`. Es läuft immer nur ein Auftrag; eine neue Anfrage bricht den laufenden ab.
 * Vocarium braucht etwa 1,4 s pro Sekunde Sprache, darum spielt die App Stück 1, während die nächsten entstehen.
 * Die Stimme richtet sich nach dem Absender der Nachricht (`sprecher`, stimmen.ts), ausser die App nennt eine
 * (`stimme`, etwa für „Probe hören“). Die Texte bleiben höchstens 7 Tage in `swarm.vorlesen`. Nach einem Tag redigiert der Hub die Stück-Events: Dann
 * verweist nichts mehr auf die WAVs, und die Medien-Retention von Synapse (30 Tage, ADR-002 §4.37) räumt sie weg.
 */
import { sql, type Db } from './db/index.js'
import { enqueue } from './outbox.js'
import { roomsByKind } from './agents/store.js'
import { STIMME_OK, istOmnivoice, sichereStimme, stimmeFuer } from './stimmen.js'
import type { Ctx } from './context.js'

export const VORLESEN_EVENT = 'ch.zwaetschge.swarm.vorlesen'
export const VORLESEN_TEIL = 'ch.zwaetschge.swarm.vorlesen.teil'
const URL = process.env.TTS_URL || 'http://schwarm-plum-relay:8080/tts'
const MAX_TEXT = 20_000
/**
 * Die Stücke wachsen (App 2.9): Das erste ist kurz, damit es schnell losgeht; jedes weitere ist höchstens etwa
 * 1,8-mal so lang wie das vorige. So entsteht das nächste Stück, während das vorige noch spielt (Vocarium
 * rechnet bei den Omnivoices gut halb so lange, wie die Sprache dauert).
 */
const TREPPE = [90, 160, 280]
const ERSTES = TREPPE[0]!
const WEITERE = 400
const MAX_TEILE = 60
const AUFRAEUMEN_MS = Number(process.env.VORLESEN_AUFRAEUMEN_MS || 3_600_000)

/** Markdown in Text, den eine Stimme sinnvoll vorlesen kann. */
export function sprechbar(md: string): string {
  let t = md.replace(/\r\n?/g, '\n')
  t = t.replace(/```[\s\S]*?(?:```|$)/g, '\n\nCodeblock ausgelassen.\n\n')
  t = t.replace(/`([^`\n]+)`/g, '$1')
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  t = t.replace(/<https?:\/\/[^>\s]+>/g, 'Link').replace(/https?:\/\/\S+/g, 'Link')
  t = t.split('\n').map((z) => {
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(z)) return ''
    if (/^\s*\|.*\|\s*$/.test(z)) {
      return `${z.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim()).filter(Boolean).join(', ')}.`
    }
    return z
  }).join('\n')
  const satzEnde = (s: string) => (/[.!?:;]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)
  t = t.replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, (_m, h: string) => satzEnde(h))
  t = t.replace(/^\s*>\s?/gm, '')
  t = t.replace(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/gm, (_m, l: string) => satzEnde(l))
  t = t.replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
  t = t.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/gm, '$1$2')
  t = t.replace(/[*_#|>~`]/g, ' ')
  t = t.replace(/\p{Extended_Pictographic}|️|‍/gu, '')
  return t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** An Satzgrenzen teilen: das erste Stück höchstens `erstes` Zeichen, die weiteren höchstens `weitere`. */
export function stuecke(text: string, erstes = ERSTES, weitere = WEITERE): string[] {
  const saetze = text.split(/(?<=[.!?:;])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
  const teile: string[] = []
  let aktuell = ''
  const grenze = () => (teile.length === 0 ? erstes : Math.min(weitere, TREPPE[teile.length] ?? weitere))
  const schieben = () => {
    if (aktuell) teile.push(aktuell)
    aktuell = ''
  }
  for (let s of saetze) {
    if (aktuell && aktuell.length + 1 + s.length > grenze()) schieben()
    while (s.length > grenze()) {
      schieben()
      const g = grenze()
      let schnitt = s.lastIndexOf(', ', g)
      if (schnitt < g * 0.5) schnitt = s.lastIndexOf(' ', g)
      if (schnitt <= 0) schnitt = g
      teile.push(s.slice(0, schnitt + (s[schnitt] === ',' ? 1 : 0)).trim())
      s = s.slice(schnitt + 1).trim()
    }
    if (s) aktuell = aktuell ? `${aktuell} ${s}` : s
  }
  schieben()
  return teile.length > MAX_TEILE ? [...teile.slice(0, MAX_TEILE - 1), 'Der Rest ist zu lang zum Vorlesen.'] : teile
}

/** Dauer einer WAV-Datei aus dem Kopf (Byterate und Grösse des data-Blocks). */
export function wavDauerMs(b: Uint8Array): number {
  if (b.length < 44) return 0
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const kennung = (pos: number) => String.fromCharCode(b[pos]!, b[pos + 1]!, b[pos + 2]!, b[pos + 3]!)
  if (kennung(0) !== 'RIFF' || kennung(8) !== 'WAVE') return 0
  let pos = 12
  let byterate = 0
  let daten = 0
  while (pos + 8 <= b.length) {
    const groesse = v.getUint32(pos + 4, true)
    if (kennung(pos) === 'fmt ' && pos + 20 <= b.length) byterate = v.getUint32(pos + 16, true)
    if (kennung(pos) === 'data') {
      daten = Math.min(groesse, b.length - pos - 8)
      break
    }
    pos += 8 + groesse + (groesse % 2)
  }
  return byterate ? Math.round((daten / byterate) * 1000) : 0
}

/** Der laufende Aufruf an Vocarium; ein Abbruch aus der Inbox beendet ihn sofort. */
let laufenderAufruf: AbortController | null = null

async function sprechen(text: string, stimme: string): Promise<Uint8Array> {
  laufenderAufruf = new AbortController()
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', input: text, voice: stimme, response_format: 'wav' }),
    signal: AbortSignal.any([laufenderAufruf.signal, AbortSignal.timeout(120_000)]),
  })
  if (!res.ok) {
    const detail = await res.json().then((j) => String((j as { detail?: unknown } | null)?.detail ?? '')).catch(() => '')
    throw new Error(`Vocarium ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`)
  }
  const b = new Uint8Array(await res.arrayBuffer())
  if (b.length < 44) throw new Error('Vocarium lieferte kein Audio')
  return b
}

async function melden(ctx: Ctx, raumId: string, inhalt: Record<string, unknown>, db: Db = sql): Promise<void> {
  await enqueue(db, [{ kind: 'message', roomId: raumId, payload: { type: VORLESEN_TEIL, content: { v: 1, ...inhalt } } }], ctx.hub)
}

/** Inbox (inbox.ts): Anfrage oder Abbruch. Nur von Vale und nur in der Lobby; alles andere fällt still weg. */
export async function vorlesenAnfrage(ctx: Ctx, tx: Db, row: { sender: string; room_id: string; content: Record<string, unknown> | null }): Promise<void> {
  if (row.sender !== ctx.owner) return
  const [lobby] = await roomsByKind('lobby', tx)
  if (!lobby?.roomId || lobby.roomId !== row.room_id) return
  const c = row.content ?? {}
  const anfrage = String(c.anfrage ?? '')
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(anfrage)) return
  const abbrechen = async (bedingung: 'diese' | 'andere') => {
    const weg = bedingung === 'diese'
      ? await tx`UPDATE swarm.vorlesen SET zustand = 'abgebrochen', fertig_am = now() WHERE id = ${anfrage} AND zustand IN ('offen', 'laeuft') RETURNING id, raum_id`
      : await tx`UPDATE swarm.vorlesen SET zustand = 'abgebrochen', fertig_am = now() WHERE id <> ${anfrage} AND zustand IN ('offen', 'laeuft') RETURNING id, raum_id`
    for (const w of weg) await melden(ctx, String(w.raum_id), { anfrage: String(w.id), abgebrochen: true }, tx)
    if (weg.length) laufenderAufruf?.abort()
  }
  if (c.abbrechen === true) return abbrechen('diese')
  const text = typeof c.text === 'string' ? c.text.slice(0, MAX_TEXT) : ''
  if (!text.trim()) return
  await abbrechen('andere')
  const sprecher = typeof c.sprecher === 'string' && /^@[^:\s]{1,120}:[^\s]{1,120}$/.test(c.sprecher) ? c.sprecher : null
  // Nur Omnivoices sprechen (Vale, 2026-09-27): Einen anderen Wunsch — auch einen gespeicherten — ersetzt
  // der Hub durch die Stimme des Absenders, und die ist ihrerseits auf Omnivoices geprüft.
  const wunsch = typeof c.stimme === 'string' && STIMME_OK.test(c.stimme) ? c.stimme : null
  const stimme = wunsch && istOmnivoice(wunsch) ? wunsch : sichereStimme(await stimmeFuer(ctx, sprecher, tx))
  await tx`INSERT INTO swarm.vorlesen (id, raum_id, text, stimme) VALUES (${anfrage}, ${lobby.roomId}, ${text}, ${stimme}) ON CONFLICT (id) DO NOTHING`
  // Nach dem Commit der Inbox anfangen. Bis er durch ist, fasst der Hub ein paar Mal nach; was dann noch liegt,
  // fängt der Takt in weiter.ts auf.
  setTimeout(() => vorlesenAnstossen(ctx, 12), 100).unref?.()
}

let laeuft = false
let aufgeraeumt = false

/**
 * Offene Aufträge abarbeiten, im Hintergrund; der Aufrufer wartet nicht (ein Auftrag dauert Minuten). Fand der
 * Lauf nichts und ist `nachfassen` > 0, versucht er es 250 ms später noch einmal.
 */
export function vorlesenAnstossen(ctx: Ctx, nachfassen = 0): void {
  if (laeuft) return
  laeuft = true
  void abarbeiten(ctx)
    .catch((err) => { ctx.log.warn({ err }, 'Vorlesen gescheitert'); return 0 })
    .then((n) => {
      laeuft = false
      if (!n && nachfassen > 0) setTimeout(() => vorlesenAnstossen(ctx, nachfassen - 1), 250).unref?.()
    })
}

async function abarbeiten(ctx: Ctx): Promise<number> {
  let erledigt = 0
  if (!aufgeraeumt) {
    // Nach einem Neustart: Was lief, ist verloren, die App soll es erfahren.
    for (const w of await sql`UPDATE swarm.vorlesen SET zustand = 'fehler', fehler = 'Hub neu gestartet', fertig_am = now() WHERE zustand = 'laeuft' RETURNING id, raum_id`) {
      await melden(ctx, String(w.raum_id), { anfrage: String(w.id), fehler: 'Der Hub ist neu gestartet, bitte noch einmal vorlesen lassen.' })
    }
    aufgeraeumt = true
  }
  for (;;) {
    const [job] = await sql`
      UPDATE swarm.vorlesen SET zustand = 'laeuft'
       WHERE id = (SELECT id FROM swarm.vorlesen WHERE zustand = 'offen' ORDER BY erstellt LIMIT 1)
       RETURNING id, raum_id, text, stimme`
    if (!job) return erledigt
    erledigt++
    const id = String(job.id)
    const raum = String(job.raum_id)
    const teile = stuecke(sprechbar(String(job.text)))
    const nochDran = async () => (await sql`SELECT zustand FROM swarm.vorlesen WHERE id = ${id}`)[0]?.zustand === 'laeuft'
    if (!teile.length) {
      await sql`UPDATE swarm.vorlesen SET zustand = 'fehler', fehler = 'nichts zum Vorlesen', fertig_am = now() WHERE id = ${id}`
      await melden(ctx, raum, { anfrage: id, nr: 0, von: 0, fehler: 'Nichts zum Vorlesen (nur Code oder Zeichen).' })
      continue
    }
    await sql`UPDATE swarm.vorlesen SET teile = ${teile.length} WHERE id = ${id}`
    let nr = 0
    try {
      for (const stueck of teile) {
        nr++
        if (!(await nochDran())) break
        const wav = await sprechen(stueck, sichereStimme(typeof job.stimme === 'string' ? job.stimme : null))
        if (!(await nochDran())) break
        const hoch = await ctx.matrix.uploadMedia(`vorlesen-${id.slice(0, 8)}-${nr}.wav`, 'audio/wav', wav)
        if (!hoch.ok) throw new Error(`Hochladen: ${hoch.message}`)
        await melden(ctx, raum, { anfrage: id, nr, von: teile.length, mxc: hoch.mxc, mimetype: 'audio/wav', groesse: wav.length, dauer_ms: wavDauerMs(wav) })
      }
      await sql`UPDATE swarm.vorlesen SET zustand = 'fertig', fertig_am = now() WHERE id = ${id} AND zustand = 'laeuft'`
    } catch (err) {
      const meldung = (err as Error).message.slice(0, 200)
      const [z] = await sql`UPDATE swarm.vorlesen SET zustand = 'fehler', fehler = ${meldung}, fertig_am = now() WHERE id = ${id} AND zustand = 'laeuft' RETURNING id`
      if (z) await melden(ctx, raum, { anfrage: id, nr, von: teile.length, fehler: meldung })
    }
  }
}

let letzteAufraeumung = 0

/** Stück-Events nach einem Tag redigieren (die WAVs verfallen dann bei Synapse), Texte nach 7 Tagen löschen. */
export async function vorlesenAufraeumen(ctx: Ctx, jetzt = Date.now()): Promise<number> {
  if (jetzt - letzteAufraeumung < AUFRAEUMEN_MS) return 0
  letzteAufraeumung = jetzt
  const alt = await sql`
    SELECT o.room_id, o.sent_event_id FROM swarm.outbox o
     WHERE o.payload->>'type' = ${VORLESEN_TEIL} AND o.sent_event_id IS NOT NULL AND o.sent_at < now() - interval '1 day'
       AND NOT EXISTS (SELECT 1 FROM swarm.outbox r WHERE r.kind = 'redact' AND r.payload->>'eventId' = o.sent_event_id)
     ORDER BY o.id LIMIT 200`
  if (alt.length) {
    await enqueue(sql, alt.map((z) => ({
      kind: 'redact' as const, roomId: String(z.room_id),
      payload: { type: 'm.room.redaction', content: {}, eventId: String(z.sent_event_id), reason: 'Vorlesen: nach einem Tag entfernt' },
    })), ctx.hub)
  }
  await sql`DELETE FROM swarm.vorlesen WHERE erstellt < now() - interval '7 days'`
  return alt.length
}

/** Takt (weiter.ts): liegen gebliebene Aufträge anstossen und stündlich aufräumen. */
export async function vorlesenTakt(ctx: Ctx): Promise<number> {
  vorlesenAnstossen(ctx)
  return vorlesenAufraeumen(ctx)
}
