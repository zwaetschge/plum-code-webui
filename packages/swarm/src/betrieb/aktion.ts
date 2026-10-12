/**
 * `!aktion` (ADR-003 R2): Vale löst eine Fähigkeit des Betriebs direkt aus der Lobby aus, so wie
 * früher mit dem Knopf in der Rat-UI. Geprüft wird wie beim MCP (Fähigkeit, Risiko, Ziel,
 * Sperrliste); ausgeführt wird vom Worker `betrieb`. Weil der Befehl aus Vales eigenem Konto kommt,
 * ist er die Freigabe: Auch Gelb läuft ohne zweite Notice. Rot und Unbekanntes lehnt der Hub ab.
 *
 *   !aktion                                   → was der Betrieb kann
 *   !aktion docker.logs council-core 200      → letzte 200 Zeilen
 *   !aktion docker.restart paperless hängt    → Neustart, Grund „hängt“
 *   !aktion unraid.array_status
 */
import { audit } from '../db/audit.js'
import type { Ctx } from '../context.js'
import { createTaskFlow } from '../tasks/create.js'
import { argumente, faehigkeitenLaden, zielPruefen } from './faehigkeiten.js'

const RISIKO = { green: 'sofort', yellow: 'Neustart/Änderung', red: 'gesperrt' } as const

export async function cmdAktion(
  ctx: Ctx,
  input: { body: string; roomId: string; eventId: string; thread: string | null },
  antwort: (t: string) => Promise<void>,
): Promise<void> {
  const liste = (await faehigkeitenLaden()).filter((f) => f.risk !== 'red')
  const teile = input.body.trim().replace(/^!aktion\s*/i, '').split(/\s+/).filter(Boolean)
  const uebersicht = () =>
    ['Betrieb: `!aktion <fähigkeit> [ziel] [grund]`', ...liste.map((f) => `· ${f.name} (${RISIKO[f.risk]}): ${f.beschreibung}`)].join('\n')
  if (!teile.length || teile[0] === 'liste') return antwort(uebersicht())

  const capability = teile.shift()!.toLowerCase()
  const f = liste.find((x) => x.name === capability)
  if (!f) {
    await audit(ctx.owner, 'betrieb.aktion_verweigert', null, { capability })
    return antwort(`🚫 ${capability} führt der Betrieb nicht aus.\n${uebersicht()}`)
  }
  const ziel = f.ziel === 'keins' ? '' : (teile.shift() ?? '')
  const args: Record<string, unknown> = {}
  if (f.name === 'docker.logs' && /^\d+$/.test(teile[0] ?? '')) args.tail = Number(teile.shift())
  const grund = teile.join(' ').trim().slice(0, 300) || 'von Vale'
  const geprueft = zielPruefen(f, ziel)
  if ('fehler' in geprueft) {
    await audit(ctx.owner, 'betrieb.aktion_verweigert', null, { capability, grund: geprueft.fehler })
    return antwort(`🚫 ${geprueft.fehler}`)
  }
  const spec = { capability, target: geprueft.ziel, args: argumente(f, args) }
  const r = await createTaskFlow(ctx, {
    goal: `${capability}${spec.target !== '-' ? ` ${spec.target}` : ''} — ${grund}`,
    deliverable: 'Ausgabe der Aktion',
    budgetMinutes: 5,
    assignee: 'betrieb',
    from: ctx.owner,
    originRoom: input.roomId,
    originThread: input.thread,
    idempotencyKey: input.eventId,
    betriebSpec: JSON.stringify(spec),
  })
  if (!r.ok) return antwort(`🚫 Betrieb lehnte ab (${r.code}): ${r.reason}`)
  await audit(ctx.owner, 'betrieb.aktion', r.taskId, { capability, risk: f.risk, ziel: spec.target })
}
