/**
 * Selbsttest auf Abruf (ADR-002 §4.35):
 *
 *   node dist/cli/selbsttest.js --agent brian [--warten 180] [--json]
 *   ops/matrix/selbsttest.sh brian
 *   ops/matrix/selbsttest.sh betrieb --ziel "docker.logs council-matrix" \
 *     --spec '{"capability":"docker.logs","target":"council-matrix","args":{}}'
 *
 * `--ziel`/`--ablieferung`/`--spec` machen daraus eine gezielte Live-Sonde statt
 * des Selbsttests — etwa für lange Ergebnisse, die als Datei ankommen müssen.
 *
 * Dasselbe, was der Kanarienvogel täglich um 07:25 macht — aber für **einen**
 * Agenten, jetzt, und mit Warten auf das Ergebnis. Der Auftrag ist absichtlich
 * lächerlich klein („antworte nur mit OK", Budget 0.05 USD / 5 min), damit der
 * Beweis nichts kostet. Er läuft über denselben Weg wie ein echter Auftrag:
 * Karte in den Arbeitsraum, 👀, Antwort im Thread, ✅, Board und Lobby.
 *
 * Exit 0 = der Agent hat geantwortet und abgeschlossen, 1 = nicht, 2 = Aufbau
 * fehlgeschlagen.
 */
import { env, HUB_MXID } from '../env.js'
import { auditAbarbeiten } from '../db/audit.js'
import { sql } from '../db/index.js'
import { MatrixClient } from '../appservice/client.js'
import { agentById, roomsByKind } from '../agents/store.js'
import { createTaskFlow } from '../tasks/create.js'
import { selbsttestAuftrag } from '../schedule.js'
import type { Ctx } from '../context.js'

const millis = (a: unknown, b: unknown): string => {
  if (!a || !b) return '—'
  const d = (new Date(b as string).getTime() - new Date(a as string).getTime()) / 1000
  return Number.isFinite(d) ? (d < 60 ? `${d.toFixed(1)} s` : `${Math.round(d / 60)} min`) : '—'
}
const opt = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? String(argv[i + 1]) : undefined
}
const zeit = (v: unknown): string => (v ? new Date(v as string).toISOString().replace('T', ' ').slice(11, 19) : '—')

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--agent')
  const agentId = i >= 0 ? String(argv[i + 1] ?? '') : 'brian'
  const w = argv.indexOf('--warten')
  const warten = w >= 0 ? Number(argv[w + 1]) : 180
  const alsJson = argv.includes('--json')
  const sagen = alsJson ? () => {} : (...t: unknown[]) => console.log(...t)

  // --eltern <T-…>: Der Auftrag wird zum Kind eines laufenden Auftrags — damit
  // läuft die Rückmeldung (§9.3, Schritt 6) an den Zuständigen des Eltern-Auftrags,
  // inklusive Anhang, wenn das Ergebnis lang ist. --ohne-freigabe kennzeichnet es
  // nicht als Übergabe; das ist ein Sonden-Modus, denn an T2 ginge es sonst in
  // auth-required und bräuchte Vales ✅ (30-Minuten-Fenster).
  const elternId = opt(argv, '--eltern')
  const ohneFreigabe = argv.includes('--ohne-freigabe')

  // Stiller Logger: Die CLI sagt selbst, was wichtig ist.
  const still = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {} }
  const ctx: Ctx = {
    matrix: new MatrixClient(),
    log: still as unknown as Ctx['log'],
    owner: env.ownerMxid,
    hub: HUB_MXID,
  }

  const agent = await agentById(agentId)
  if (!agent) { console.error(`Agent „${agentId}" ist nicht eingetragen.`); process.exit(2) }
  if (!agent.roomId) { console.error(`${agentId} hat keinen Arbeitsraum (§6.1).`); process.exit(2) }
  if (agent.frozen) { console.error(`${agentId} ist eingefroren.`); process.exit(2) }
  const [lobby] = await roomsByKind('lobby')
  if (!lobby?.roomId) { console.error('Keine Lobby gefunden — wohin mit der Quittung?'); process.exit(2) }

  let von = ctx.owner
  let raum = lobby.roomId
  let thread: string | null = null
  if (elternId) {
    const [eltern] = await sql`SELECT id, assignee, room_id, thread_root, state FROM swarm.tasks WHERE id = ${elternId}`
    if (!eltern) { console.error(`Eltern-Auftrag ${elternId} nicht gefunden.`); process.exit(2) }
    if (!['submitted', 'working', 'input-required'].includes(String(eltern.state))) {
      console.error(`Eltern-Auftrag ${elternId} ist ${eltern.state} — dorthin geht keine Rückmeldung.`)
      process.exit(2)
    }
    const elternAgent = await agentById(String(eltern.assignee))
    von = elternAgent?.mxid ?? ctx.owner
    raum = String(eltern.room_id ?? lobby.roomId)
    thread = (eltern.thread_root as string | null) ?? null
    sagen(`Eltern-Auftrag ${elternId} (${eltern.assignee}) — Rückmeldung geht in seinen Thread${ohneFreigabe ? ' · Sonden-Modus ohne Freigabe' : ''}`)
  }

  // Eigenes Ziel statt Selbsttest — für gezielte Live-Sonden (lange Ergebnisse,
  // Fähigkeiten des Betriebs, Ketten). Ohne Angabe bleibt es der Kanari-Text.
  const ziel = opt(argv, '--ziel')
  const ablieferung = opt(argv, '--ablieferung')
  const spec = opt(argv, '--spec')
  const basis = selbsttestAuftrag(agentId)
  const auftrag = {
    goal: ziel ?? basis.goal,
    deliverable: ablieferung ?? basis.deliverable,
    ...(spec ? { betriebSpec: spec } : basis.betriebSpec ? { betriebSpec: basis.betriebSpec } : {}),
  }
  const schluessel = `selbsttest-${Date.now().toString(36)}-${agentId}`
  sagen(`Selbsttest für ${agentId} (${agent.mode}, ${agent.trust}) — ${auftrag.goal}`)
  const ergebnis = await createTaskFlow(ctx, {
    ...auftrag,
    assignee: agentId,
    from: von,
    originRoom: raum,
    ...(thread ? { originThread: thread } : {}),
    ...(elternId ? { parentTaskId: elternId, isHandoff: !ohneFreigabe } : {}),
    idempotencyKey: schluessel,
    budgetUsd: ziel ? 0.5 : 0.05,
    budgetMinutes: ziel ? 15 : 5,
  })
  if (!ergebnis.ok) {
    console.error(`Auftrag kam nicht zustande (${ergebnis.code}): ${ergebnis.reason}`)
    await sql.end({ timeout: 5 })
    process.exit(2)
  }
  const id = ergebnis.taskId
  // Kein Takt in der CLI: die vorgemerkten Belege selbst in die Kette schreiben (§4.35).
  await auditAbarbeiten()
  sagen(`Auftrag ${id} liegt bereit — warte höchstens ${warten} s. Details: auftrag.sh ${id}`)

  const zustand = async () =>
    (await sql`SELECT state, result, fail_reason, cost_usd, claimed_at, card_sent_at, created_at, updated_at
       FROM swarm.tasks WHERE id = ${id}`)[0]
  const ENDE = ['completed', 'failed', 'canceled', 'rejected']
  const bis = Date.now() + warten * 1000
  let letzter = ''
  let t = await zustand()
  while (Date.now() < bis) {
    const z = await zustand()
    if (z) t = z
    if (t && t.state !== letzter) {
      letzter = t.state
      sagen(`  ${new Date().toISOString().slice(11, 19)}  ${t.state}`)
    }
    if (t && ENDE.includes(String(t.state))) break
    await new Promise((r) => setTimeout(r, 1500))
  }
  const frisch = await zustand()
  if (frisch) t = frisch
  if (!t) { console.error(`Auftrag ${id} ist nicht mehr zu lesen.`); await sql.end({ timeout: 5 }); process.exit(2) }
  await auditAbarbeiten()
  const [ende] = await sql`SELECT at FROM swarm.audit WHERE target = ${id} ORDER BY id DESC LIMIT 1`

  const dauer = millis(t.created_at, ende?.at ?? null)
  const antwort = String(t.result ?? '').trim()
  // Mit eigenem Ziel zählt der Abschluss, nicht das Wort „OK" — das gehört zum
  // Kanari-Text. Eine leere Antwort ist trotzdem kein Erfolg.
  const gut = t.state === 'completed' && (ziel ? antwort.length > 0 : /ok/i.test(antwort))

  if (alsJson) {
    console.log(JSON.stringify({
      id, agent: agentId, state: t.state, ok: gut, dauerSekunden: dauer,
      karte: millis(t.created_at, t.card_sent_at), angenommen: millis(t.card_sent_at ?? t.created_at, t.claimed_at),
      antwort: antwort.slice(0, 300), grund: t.fail_reason, kosten: t.cost_usd,
    }, null, 1))
  } else {
    console.log(`\n── ${id} · ${t.state} ──`)
    console.log(`  Karte raus      ${zeit(t.card_sent_at)}  (+${millis(t.created_at, t.card_sent_at)})`)
    console.log(`  👀 angenommen   ${t.claimed_at ? `${zeit(t.claimed_at)}  (+${millis(t.card_sent_at ?? t.created_at, t.claimed_at)})` : 'nie — der Agent hat nicht reagiert'}`)
    console.log(`  Ende            ${zeit(ende?.at)}   Gesamt ${dauer}`)
    if (t.fail_reason) console.log(`  Grund           ${t.fail_reason}`)
    console.log(`  Antwort         ${antwort ? antwort.slice(0, 200) : '(leer)'}`)
    console.log(`  Kosten          ${t.cost_usd ?? 0} USD`)
    const was = ziel ? 'Sonde' : 'Selbsttest'
    console.log(gut
      ? `\n✓ ${agentId} hat den ${was} bestanden — Karte, 👀, Antwort und ✅ laufen.`
      : `\n✗ ${agentId} hat den ${was} nicht bestanden. Weiter mit: auftrag.sh ${id} --audit`)
  }
  await sql.end({ timeout: 5 })
  process.exit(gut ? 0 : 1)
}

main().catch(async (err) => {
  console.error('Selbsttest fehlgeschlagen:', err instanceof Error ? err.message : err)
  await sql.end({ timeout: 5 }).catch(() => {})
  process.exit(2)
})
