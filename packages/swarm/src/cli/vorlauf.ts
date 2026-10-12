/**
 * Vorlauf-Prüfung: Läuft der Schwarm, und kann ein Auftrag durchlaufen?
 *
 *   pnpm --filter @council/matrix build
 *   docker run --rm --network council-net --env-file .env -v "$PWD:/app" -w /app \
 *     node:22-alpine node packages/matrix/dist/cli/vorlauf.js
 *
 * Ein Befehl statt Fehlersuche: Gesundheit, Migrationen, Räume und Mitglieder,
 * Agenten und ihre Tokens, wartende Freigaben, Rückstände, Sperren. Alles
 * lesend — es wird nichts geändert und nichts gesendet. Exit 0 heisst „ein
 * Auftrag kann laufen", Exit 2 nennt, was fehlt.
 *
 * Der Hub-Container selbst hat keinen Matrix-Zugang für Vale-Konfiguration:
 * Was in Brians `.env` steht, prüft `matrix/ops/brian-p2-umstellen.py --pruefen`.
 */
import Fastify from 'fastify'
import { sql } from '../db/index.js'
import { MatrixClient } from '../appservice/client.js'
import { env, HUB_MXID } from '../env.js'
import { healthReport } from '../health.js'
import { isSwarmFrozen } from '../db/audit.js'
import { listAgents, listRooms } from '../agents/store.js'
import { backlog } from '../outbox.js'
import { inboxLag, lastTransactionAge } from '../appservice/transactions.js'

const log = Fastify({ logger: false }).log

let fehler = 0
let warnungen = 0
function zeile(ok: boolean, text: string, detail = '', warnung = false): void {
  if (ok) console.log(`  ✓ ${text}`)
  else if (warnung) { console.log(`  ⚠ ${text}${detail ? ` — ${detail}` : ''}`); warnungen++ }
  else { console.log(`  ✗ ${text}${detail ? ` — ${detail}` : ''}`); fehler++ }
}

/** Zustand des laufenden Hubs, wenn er erreichbar ist (sonst null). */
async function hubZustand(): Promise<Record<string, unknown> | null> {
  const url = process.env.VORLAUF_HUB_URL || 'http://council-matrix:4700'
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Reachability: Ohne Synapse-Zugang sind Mitgliedschaften nicht prüfbar. */
async function synapseDirekt(): Promise<boolean> {
  try {
    const res = await fetch(`${env.homeserverUrl.replace(/\/$/, '')}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const matrix = new MatrixClient()
  const live = await hubZustand()
  const direkt = await synapseDirekt()
  const quelle = live ? 'laufender Hub' : 'dieser Prozess'

  console.log('\n── Hub ──')
  const h = await healthReport()
  zeile(h.body.db === true, 'Datenbank erreichbar', String((h.body as { problems?: string[] }).problems ?? ''))
  const synapse = (live?.synapse ?? h.body.synapse) as { ok: boolean; ping_ms: number; failures: number }
  zeile(synapse.ok, `Synapse-Ping über ${quelle}: ${synapse.ping_ms} ms`,
    `${synapse.failures} Fehlversuche — ist der Appservice eingetragen?`)
  if (live) {
    zeile(live.ok === true, '/health des laufenden Hubs meldet ok', JSON.stringify(live.problems ?? {}))
  } else {
    zeile(h.code === 200, '/health meldet ok', JSON.stringify(h.body.problems ?? {}))
    zeile(false, 'laufender Hub nicht erreichbar (VORLAUF_HUB_URL)', 'Prüfung läuft gegen die Datenbank allein', true)
  }

  const [migrationen] = await sql`SELECT count(*)::int AS n FROM swarm.schema_migrations`
  const erwartet = Number(process.env.VORLAUF_MIGRATIONEN ?? 5)
  zeile(Number(migrationen?.n) >= erwartet, `Migrationen: ${migrationen?.n} angewandt`, `erwartet ≥ ${erwartet}`, Number(migrationen?.n) < erwartet)

  console.log('\n── Räume ──')
  const raeume = await listRooms()
  const ohne = raeume.filter((r) => !r.roomId)
  zeile(raeume.length >= 6 && ohne.length === 0, `${raeume.length} Räume, alle mit ID`, ohne.map((r) => r.alias).join(','))
  for (const wichtig of ['schwarm-lobby', 'schwarm-auftraege', 'schwarm-freigaben']) {
    const raum = raeume.find((r) => r.alias === wichtig)
    zeile(Boolean(raum?.roomId), `${wichtig} vorhanden`)
  }

  console.log('\n── Agenten ──')
  const agenten = await listAgents()
  const nativ = agenten.filter((a) => a.mode === 'native')
  zeile(nativ.length >= 1, `${nativ.length} native Agenten (nehmen Aufträge über Matrix an)`)
  for (const a of nativ) {
    zeile(Boolean(a.roomId), `${a.id}: Arbeitsraum gesetzt`, a.roomId ?? 'keiner')
    zeile(a.status === 'online', `${a.id}: ${a.status}`, 'offline heisst: noch kein Lebenszeichen gesehen', a.status !== 'online')
    zeile(!a.frozen, `${a.id}: nicht eingefroren`)
    if (a.roomId && direkt) {
      const mitglieder = await matrix.members(a.roomId)
      zeile(
        mitglieder.length >= 3,
        `${a.id}: ${mitglieder.length} Mitglieder im Arbeitsraum`,
        'unter drei gilt der Raum bei Hermes als DM — Allowlist und Erwähnungspflicht greifen nicht (§6.1)',
      )
      zeile(mitglieder.includes(HUB_MXID), `${a.id}: ${HUB_MXID} ist im Raum`)
      zeile(mitglieder.includes(a.mxid), `${a.id}: ${a.mxid} ist im Raum`, 'ohne Beitritt kommt keine Karte an')
    } else if (a.roomId) {
      zeile(false, `${a.id}: Mitgliedschaften nicht prüfbar`,
        `Synapse ist von hier nicht erreichbar (${env.homeserverUrl}) — die CLI auf matrix-net laufen lassen`, true)
    }
    const [tok] = await sql`
      SELECT count(*)::int AS n FROM swarm.tokens
      WHERE agent = ${a.id} AND purpose = 'mcp' AND revoked_at IS NULL`
    zeile(Number(tok?.n) >= 1, `${a.id}: MCP-Token aktiv`, 'ohne Token kann der Agent nicht übergeben (handoff)', true)
  }
  const worker = agenten.filter((a) => a.mode === 'worker')
  for (const a of worker) {
    const [tok] = await sql`
      SELECT count(*)::int AS n, count(*) FILTER (WHERE last_used_at IS NOT NULL)::int AS benutzt
      FROM swarm.tokens WHERE agent = ${a.id} AND purpose = 'worker' AND revoked_at IS NULL`
    zeile(Number(tok?.n) >= 1, `${a.id}: Worker-Token aktiv`, 'keine Verbindung möglich', true)
    zeile(Number(tok?.benutzt) >= 1, `${a.id}: Worker hat sich schon verbunden`, 'Token unbenutzt — läuft der Worker?', true)
  }

  console.log('\n── Betrieb ──')
  const out = (live?.outbox as { pending: number; dead: number } | undefined) ?? await backlog()
  zeile(out.pending === 0, 'Outbox ohne Rückstand', `${out.pending} warten, ${out.dead} tot`)
  zeile(out.dead === 0, 'keine toten Ausgaben', `${out.dead}`)
  const inbox = (live?.inbox as { pending: number; dead: number; oldestMinutes: number | null } | undefined) ?? await inboxLag()
  zeile(inbox.pending === 0, 'Inbox abgearbeitet', `${inbox.pending} offen, älteste ${inbox.oldestMinutes} min`)
  zeile(inbox.dead === 0, 'keine Dead Letter im Eingang', `${inbox.dead}`)
  const alter = await lastTransactionAge()
  zeile(alter === null || alter < 3600, `letzte Transaktion vor ${alter === null ? '—' : `${Math.round(alter / 60)} min`}`,
    'Synapse liefert nichts — läuft der Appservice?', true)

  const frozen = live ? live.frozen === true : await isSwarmFrozen()
  zeile(!frozen, 'Schwarm nicht eingefroren', '!stop war aktiv — !weiter löst')
  const raumSperren = await sql`SELECT name FROM swarm.flags WHERE name LIKE 'raum:%'`
  zeile(raumSperren.length === 0, 'kein Arbeitsraum eingefroren', raumSperren.map((r) => r.name).join(', '))

  const [wartend] = await sql`
    SELECT count(*)::int AS n FROM swarm.tasks
    WHERE state IN ('submitted','working','input-required','auth-required')`
  const [freigaben] = await sql`SELECT count(*)::int AS n FROM swarm.tasks WHERE state = 'auth-required'`
  console.log(`\n  · ${wartend?.n ?? 0} offene Aufträge, ${freigaben?.n ?? 0} warten auf Freigabe`)

  // Seit ADR-003 R6 ist der Rat abgeschaltet und `!rat` läuft nativ im Hub.
  const ratNativ = process.env.RAT_NATIV === '1'
  if (ratNativ) {
    zeile(true, '!rat läuft nativ im Hub (ADR-003 R3)')
    if (env.councilUrl) {
      try {
        const res = await fetch(`${env.councilUrl.replace(/\/$/, '')}/api/capabilities`, {
          headers: { authorization: `Bearer ${env.councilToken}` },
          signal: AbortSignal.timeout(8000),
        })
        zeile(res.ok, `alter Rat erreichbar (${res.status}) — Rückweg steht`, '', true)
      } catch {
        zeile(false, 'alter Rat nicht erreichbar, obwohl COUNCIL_URL gesetzt ist',
          'R6 hat ihn gestoppt; COUNCIL_* aus dem Hub nehmen oder den Rückweg bedenken', true)
      }
    }
  } else if (env.councilUrl && env.councilToken) {
    try {
      const res = await fetch(`${env.councilUrl.replace(/\/$/, '')}/api/capabilities`, {
        headers: { authorization: `Bearer ${env.councilToken}` },
        signal: AbortSignal.timeout(8000),
      })
      zeile(res.ok, `Rat erreichbar (${res.status})`, '!rat und Kill-Kette brauchen ihn', true)
    } catch (err) {
      zeile(false, 'Rat nicht erreichbar und RAT_NATIV ist aus', `${(err as Error).message} — !rat geht nicht`, true)
    }
  } else {
    zeile(false, 'weder Rat noch RAT_NATIV', '!rat ist nicht erreichbar', true)
  }

  console.log(
    fehler === 0
      ? `\n✓ Vorlauf bestanden${warnungen ? `, ${warnungen} Warnung(en)` : ''} — ein Auftrag kann durchlaufen.`
      : `\n✗ Vorlauf: ${fehler} Problem(e), ${warnungen} Warnung(en).`,
  )
  void log
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .then(() => process.exit(fehler ? 2 : 0))
  .catch(async (err) => {
    console.error('Vorlauf fehlgeschlagen:', err instanceof Error ? err.message : err)
    await sql.end({ timeout: 5 }).catch(() => {})
    process.exit(2)
  })
