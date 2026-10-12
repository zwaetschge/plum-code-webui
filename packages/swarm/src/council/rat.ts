/**
 * Rat-Spiegel (§9.4): `!rat <frage>` geht an den Rat, und der Hub spiegelt den
 * Verlauf nach `#ag-rat` — Start-Notice, das Endergebnis jeder Rolle als ihr
 * Puppet, die Synthese und der Link in die Rat-UI.
 *
 * Bewusst **Polling** statt `/ws`: Der Hub hat schon vier Schleifen, eine
 * WebSocket-Verbindung mit Reconnect und Herzschlag wäre mehr bewegliche Teile
 * für etwas, das in Minuten statt Sekunden läuft. 15 s Takt reichen.
 *
 * Die Freigaben des Rats bleiben, wo sie sind (ntfy und Rat-UI); der Spiegel
 * zeigt sie nur als Link, nie mit einem Token (§9.6, §11.4).
 */
import { env } from '../env.js'
import { sql, jsonParam } from '../db/index.js'
import { audit } from '../db/audit.js'
import { agentById, roomsByKind } from '../agents/store.js'
import { notice, text } from '../appservice/messages.js'
import { enqueue } from '../outbox.js'
import { ensurePuppet } from '../appservice/puppets.js'
import { redact } from '../redact.js'
import { puppetMxid } from '../env.js'
import type { Ctx } from '../context.js'
import { createTaskFlow } from '../tasks/create.js'
import { zustandUndMeldung } from '../tasks/transition.js'
import * as store from '../tasks/store.js'

const MODI = ['broadcast', 'debatte', 'vote', 'lead', 'staffel', 'still'] as const
const ROLLEN = ['claude', 'codex', 'glm', 'qwen']
const SYNTHESIZER = 'rat'
const TAKT_MS = 15_000

export interface RatBefehl {
  modus: (typeof MODI)[number]
  rollen: string[]
  frage: string
}

/**
 * `!rat debatte Soll der Backup-Job auf 03:00?` → Modus und Rollen.
 * `!rat lead claude …` und `!rat still glm …` nennen die Rolle ausdrücklich.
 * Ohne Modus: Debatte mit allen vier Rollen (Grammatik wie im Rat, §9.4).
 */
export function parseRat(eingabe: string): RatBefehl | null {
  const rest = eingabe.trim()
  if (!rest) return null
  const [kopf, ...tail] = rest.split(/\s+/)
  const modus = (kopf ?? '').toLowerCase()
  if ((MODI as readonly string[]).includes(modus)) {
    const brauchtRolle = modus === 'lead' || modus === 'still'
    const rolle = brauchtRolle ? (tail[0] ?? '').toLowerCase() : ''
    if (brauchtRolle && !ROLLEN.includes(rolle)) return null
    const frage = (brauchtRolle ? tail.slice(1) : tail).join(' ').trim()
    if (!frage) return null
    return {
      modus: modus as RatBefehl['modus'],
      rollen: brauchtRolle ? [rolle] : [...ROLLEN],
      frage,
    }
  }
  return { modus: 'debatte', rollen: [...ROLLEN], frage: rest }
}

async function ruf(pfad: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${env.councilUrl.replace(/\/$/, '')}${pfad}`, {
    ...init,
    headers: { authorization: `Bearer ${env.councilToken}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    body = {}
  }
  return { status: res.status, body }
}

/** Raum des Rats: Konfiguration, sonst der erste Raum im Space `rat`. */
export async function ratRaum(): Promise<string | null> {
  if (env.councilRoom) return env.councilRoom
  try {
    const { status, body } = await ruf('/api/rooms')
    if (status !== 200) return null
    const raeume = (body.rooms ?? []) as { id?: string; space?: string }[]
    // `rat-plenum` ist der Debatten-Raum (rooms.seed.yaml, kind: chat); danach
    // kommt jeder andere Raum im Space `rat`.
    return (
      raeume.find((r) => r.id === 'rat-plenum')?.id
      ?? raeume.find((r) => r.id === 'rat')?.id
      ?? raeume.find((r) => r.space === 'rat')?.id
      ?? null
    )
  } catch {
    return null
  }
}

export type RatStart =
  | { ok: true; task: string; councilTask: string }
  | { ok: false; code: string; reason: string }

/** `!rat …` → Auftrag im Rat und ein Schwarm-Auftrag, der ihn spiegelt. */
export async function startRat(
  ctx: Ctx,
  o: { cmd: RatBefehl; originRoom: string; originThread: string | null; eventId: string },
): Promise<RatStart> {
  if (!env.councilUrl || !env.councilToken) {
    return { ok: false, code: 'nicht-konfiguriert', reason: 'Der Rat ist am Hub nicht konfiguriert (COUNCIL_URL/COUNCIL_TOKEN).' }
  }
  const agent = await agentById('rat')
  if (!agent) {
    return { ok: false, code: 'kein-agent', reason: 'Agent `rat` fehlt in agents.swarm.yaml (§15.5).' }
  }
  const roomId = await ratRaum()
  if (!roomId) return { ok: false, code: 'kein-raum', reason: 'Der Rat hat keinen erreichbaren Raum (GET /api/rooms).' }

  let councilTask: string
  try {
    const { status, body } = await ruf('/api/council/tasks', {
      method: 'POST',
      body: JSON.stringify({
        roomId,
        mode: o.cmd.modus,
        assignees: o.cmd.rollen,
        prompt: o.cmd.frage,
      }),
    })
    if (status !== 201 && status !== 200) {
      return {
        ok: false,
        code: `rat-${status}`,
        reason: redact(String((body as { error?: string }).error ?? `Der Rat lehnte ab (${status})`)),
      }
    }
    const task = (body as { task?: { id?: string } }).task
    councilTask = String(task?.id ?? '')
    if (!councilTask) return { ok: false, code: 'rat-antwort', reason: 'Der Rat nannte keine Auftrags-ID.' }
  } catch (err) {
    // §10.6: Der Rat ist eine eigene Ausfallstelle.
    return { ok: false, code: 'rat-erreichbar', reason: `Rat nicht erreichbar: ${(err as Error).message}` }
  }

  const erstellt = await createTaskFlow(
    ctx,
    {
      goal: `Rat (${o.cmd.modus}): ${o.cmd.frage}`.slice(0, 900),
      deliverable: 'Beschluss des Rats, gespiegelt in diesen Thread',
      constraints: ['Der Rat arbeitet mit seinen eigenen Budgets und Freigaben (§2.2)'],
      assignee: 'rat',
      from: ctx.owner,
      originRoom: o.originRoom,
      originThread: o.originThread,
      idempotencyKey: o.eventId,
      budgetUsd: null,
      budgetMinutes: null,
      trustRequired: 'T1',
    },
  )
  if (!erstellt.ok) return { ok: false, code: erstellt.code, reason: erstellt.reason }

  await sql`
    UPDATE swarm.tasks SET council_task_id = ${councilTask}, state = 'working'
    WHERE id = ${erstellt.taskId}`
  await audit(ctx.owner, 'rat.start', erstellt.taskId, {
    council: councilTask,
    modus: o.cmd.modus,
    rollen: o.cmd.rollen,
  })
  return { ok: true, task: erstellt.taskId, councilTask }
}

interface Vorschlag {
  id: number
  agent: string
  round: number
  summary: string
  confidence: number | null
  costUsd: number | null
}

/** Neue Ergebnisse des Rats in den Thread spiegeln und den Auftrag abschliessen. */
export async function spiegelRat(ctx: Ctx): Promise<{ gespiegelt: number; fertig: number }> {
  if (!env.councilUrl || !env.councilToken) return { gespiegelt: 0, fertig: 0 }
  const offen = (await sql`
    SELECT id, council_task_id, room_id, thread_root, provenance FROM swarm.tasks
    WHERE council_task_id IS NOT NULL AND state IN ('submitted','working','input-required')
    ORDER BY created_at LIMIT 20`) as unknown as
    { id: string; council_task_id: string; room_id: string | null; thread_root: string | null; provenance: Record<string, unknown> }[]

  let gespiegelt = 0
  let fertig = 0
  for (const zeile of offen) {
    try {
      const { status, body } = await ruf(`/api/council/tasks/${encodeURIComponent(zeile.council_task_id)}`)
      if (status !== 200) continue
      const councilTask = (body.task ?? {}) as { status?: string; costUsd?: number; mode?: string; id?: string }
      const vorschlaege = ((body.proposals ?? []) as Vorschlag[]).sort((a, b) => a.round - b.round || a.id - b.id)
      const gesehen = new Set(((zeile.provenance?.gespiegelt as number[] | undefined) ?? []).map(Number))
      const neu = vorschlaege.filter((v) => !gesehen.has(v.id))

      if (neu.length && zeile.room_id && zeile.thread_root) {
        const ausgabe = []
        for (const v of neu) {
          const mxid = v.agent === SYNTHESIZER ? puppetMxid(SYNTHESIZER) : puppetMxid(`rat-${v.agent}`)
          if (!(await ensurePuppet(ctx, mxid, zeile.room_id))) continue
          const synthese = v.agent === SYNTHESIZER || v.round >= 99
          const inhalt = redact(v.summary ?? '').slice(0, 3500)
          if (!inhalt) continue
          ausgabe.push({
            kind: 'message' as const,
            roomId: zeile.room_id,
            taskId: zeile.id,
            asUser: mxid,
            payload: {
              type: 'm.room.message',
              role: 'rueckmeldung' as const,
              content: notice(
                `${synthese ? '⚖️ Synthese' : `🗣 ${v.agent}`} · Runde ${v.round}\n${inhalt}` +
                  (v.confidence === null || v.confidence === undefined ? '' : `\nZuversicht: ${v.confidence}`) +
                  (v.costUsd ? ` · ${Number(v.costUsd).toFixed(3)} USD` : ''),
                { thread: zeile.thread_root },
              ),
            },
          })
          gesehen.add(v.id)
          gespiegelt++
        }
        if (ausgabe.length) await enqueue(sql, ausgabe, ctx.hub)
        await sql`
          UPDATE swarm.tasks SET provenance = jsonb_set(COALESCE(provenance,'{}'::jsonb), '{gespiegelt}', ${jsonParam(sql, [...gesehen])})
          WHERE id = ${zeile.id}`
      }

      if (councilTask.status === 'done' || councilTask.status === 'cancelled') {
        const synthese = [...vorschlaege].reverse().find((v) => v.agent === SYNTHESIZER || v.round >= 99)
        const ergebnis = redact(synthese?.summary ?? vorschlaege.at(-1)?.summary ?? '').slice(0, 12_000)
        const kosten = typeof councilTask.costUsd === 'number' ? councilTask.costUsd : null
        await sql.begin(async (tx) => {
          if (kosten !== null) await store.addCost(zeile.id, kosten, tx)
          await zustandUndMeldung(
            ctx,
            tx,
            zeile.id,
            councilTask.status === 'done' ? 'completed' : 'canceled',
            councilTask.status === 'done'
              ? { result: ergebnis || 'Der Rat hat keinen Text hinterlassen.' }
              : { failReason: 'Rat-Auftrag abgebrochen' },
          )
          const [mirror] = await roomsByKind('mirror', tx)
          if (mirror?.roomId && zeile.thread_root) {
            await enqueue(tx, [{
              kind: 'message',
              roomId: mirror.roomId,
              taskId: zeile.id,
              payload: {
                type: 'm.room.message',
                role: 'rueckmeldung',
                content: notice(
                  `${councilTask.status === 'done' ? '⚖️' : '🛑'} Rat ${councilTask.id ?? zeile.council_task_id} ist ` +
                    `${councilTask.status === 'done' ? 'fertig' : 'abgebrochen'}` +
                    (kosten !== null ? ` · ${kosten.toFixed(2)} USD` : '') +
                    (env.councilPublicUrl ? `\nLive-Verlauf: ${env.councilPublicUrl}` : ''),
                  { thread: zeile.thread_root },
                ),
              },
            }], ctx.hub)
          }
        })
        await audit('hub', councilTask.status === 'done' ? 'rat.fertig' : 'rat.abgebrochen', zeile.id, {
          council: zeile.council_task_id,
          kosten,
        })
        fertig++
      }
    } catch (err) {
      ctx.log.warn({ err, task: zeile.id, council: zeile.council_task_id }, 'Rat-Spiegel fehlgeschlagen')
    }
  }
  return { gespiegelt, fertig }
}

export const RAT_TAKT_MS = TAKT_MS
