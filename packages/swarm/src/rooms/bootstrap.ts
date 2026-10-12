/**
 * Raum-Bootstrap (§6, §15.5): idempotent über den Alias. Er legt den Space und
 * die Räume an, setzt Power-Levels, Raum-Policy und Retention, lädt dich und die
 * Agenten ein und schreibt die Agent Cards als State-Event in die Lobby (§8.4).
 *
 * Raumversion 12: Ersteller stehen in `additional_creators` und **nicht** in
 * `power_levels.users` — die Auth-Regeln weisen sonst ab (ADR-002 §4.1, O7).
 */
import type { CreateRoomAntwort } from '../appservice/client.js'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import {
  AGENT_STATUS,
  SWARM_AGENT_EVENT,
  SWARM_ROOM_EVENT,
  type AgentCardContent,
} from '../protocol/index.js'
import { sql } from '../db/index.js'
import { env, HUB_MXID, puppetMxid } from '../env.js'
import { enqueue } from '../outbox.js'
import type { Ctx } from '../context.js'
import { listAgents, roomsByKind, setRoomId, upsertRoom } from '../agents/store.js'
import { loadAgents, type AgentConfig } from '../agents/config.js'

export interface RoomSpec {
  kind: string
  agent?: string
  handoffs?: boolean
  max_hops?: number
  retention_days?: number
  power_levels?: Record<string, unknown>
}

export interface RoomsConfig {
  defaults: {
    room_version: string
    additional_creators: string[]
    power_levels: Record<string, unknown>
    join_rule: string
    history_visibility: string
  }
  space?: { alias: string; name: string }
  rooms: Record<string, RoomSpec>
}

export async function loadRooms(file = env.roomsFile): Promise<RoomsConfig | null> {
  try {
    return parse(await readFile(file, 'utf8')) as RoomsConfig
  } catch {
    return null
  }
}

function powerLevels(cfg: RoomsConfig, spec: RoomSpec): Record<string, unknown> {
  const basis = (cfg.defaults?.power_levels ?? {}) as Record<string, unknown>
  const events = {
    ...((basis.events as Record<string, unknown>) ?? {}),
    [SWARM_AGENT_EVENT]: 90,
    [SWARM_ROOM_EVENT]: 90,
    'm.room.encryption': 100,
    ...((spec.power_levels?.events as Record<string, unknown>) ?? {}),
  }
  return {
    ...basis,
    ...spec.power_levels,
    events,
    // Ersteller (Hub und du) stehen hier bewusst nicht drin (§7.2).
    users: {},
  }
}

export interface BootstrapResult {
  created: string[]
  known: string[]
  failed: string[]
}

export async function bootstrapRooms(
  ctx: Ctx,
  agents: Record<string, AgentConfig>,
): Promise<BootstrapResult> {
  const cfg = await loadRooms()
  const ergebnis: BootstrapResult = { created: [], known: [], failed: [] }
  if (!cfg?.rooms) {
    ctx.log.warn(`${env.roomsFile} fehlt oder ist leer — kein Raum-Bootstrap`)
    return ergebnis
  }

  let spaceId: string | null = null
  if (cfg.space?.alias) {
    const alias = `#${cfg.space.alias}:${env.domain}`
    spaceId = await ctx.matrix.resolveAlias(alias)
    if (!spaceId) {
      const spaceAntwort = await ctx.matrix.createRoom({
        name: cfg.space.name ?? cfg.space.alias,
        room_alias_name: cfg.space.alias,
        room_version: cfg.defaults?.room_version ?? '12',
        creation_content: { type: 'm.space', additional_creators: cfg.defaults?.additional_creators ?? [] },
        preset: 'private_chat',
        invite: [ctx.owner],
        power_level_content_override: powerLevels(cfg, { kind: 'lobby' }),
      })
      spaceId = spaceAntwort.roomId
      if (!spaceId) {
        ctx.log.error({ alias: `#${cfg.space.alias}:${env.domain}`, ...spaceAntwort }, 'Space konnte nicht angelegt werden')
      }
    }
    if (spaceId) await upsertRoom(cfg.space.alias, 'mirror', null, spaceId)
  }

  for (const [name, spec] of Object.entries(cfg.rooms)) {
    const alias = `#${name}:${env.domain}`
    let roomId = await ctx.matrix.resolveAlias(alias)
    const neu = roomId === null
    let antwort: CreateRoomAntwort = { roomId, status: 200, errcode: null, message: null }
    if (!roomId) {
      const einladungen = new Set<string>([ctx.owner])
      const agent = spec.agent ? agents[spec.agent] : undefined
      if (agent?.mxid) einladungen.add(agent.mxid)
      for (const p of agent?.puppets ?? []) einladungen.add(puppetMxid(p))
      antwort = await ctx.matrix.createRoom({
        name,
        room_alias_name: name,
        room_version: cfg.defaults?.room_version ?? '12',
        creation_content: { additional_creators: cfg.defaults?.additional_creators ?? [] },
        preset: 'private_chat',
        invite: [...einladungen],
        power_level_content_override: powerLevels(cfg, spec),
        initial_state: [
          { type: 'm.room.join_rules', state_key: '', content: { join_rule: cfg.defaults?.join_rule ?? 'invite' } },
          {
            type: 'm.room.history_visibility',
            state_key: '',
            content: { history_visibility: cfg.defaults?.history_visibility ?? 'shared' },
          },
          {
            type: SWARM_ROOM_EVENT,
            state_key: '',
            content: {
              v: 1,
              kind: spec.kind,
              ...(spec.agent ? { agent: spec.agent } : {}),
              handoffs: spec.handoffs ?? true,
              max_hops: spec.max_hops ?? 4,
            },
          },
          ...(spec.retention_days
            ? [{
                type: 'm.room.retention',
                state_key: '',
                content: { enabled: true, max_lifetime: spec.retention_days * 86_400_000 },
              }]
            : []),
        ],
      })
    }
    roomId = antwort.roomId
    if (!roomId) {
      ergebnis.failed.push(name)
      ctx.log.error({ alias, status: antwort.status, errcode: antwort.errcode, message: antwort.message },
        'Raum konnte nicht angelegt werden')
      continue
    }
    await upsertRoom(name, spec.kind, spec.agent ?? null, roomId)
    ;(neu ? ergebnis.created : ergebnis.known).push(name)

    if (spaceId) {
      await ctx.matrix.sendState(spaceId, 'm.space.child', roomId, { via: [env.domain] }, {
        txnId: `space-child-${roomId}`,
      })
    }
    if (spec.agent) await setRoomId(spec.agent, roomId)
  }

  // Agenten, deren Raum ein gemeinsamer ist (Melder in `#schwarm-alarme`),
  // stehen in rooms.swarm.yaml ohne `agent:`. Ohne diesen Schritt hätte ihr
  // Puppet keine Raum-ID und träte nie bei — `/hooks/notify` lieferte dann 403.
  for (const [id, a] of Object.entries(agents)) {
    if (!a.room) continue
    const [zeile] = await sql`SELECT room_id FROM swarm.rooms WHERE alias = ${a.room}`
    if (zeile?.room_id) await setRoomId(id, zeile.room_id as string)
  }

  // Arbeitsräume brauchen drei Mitglieder, sonst gilt der Raum bei Hermes als DM (§6.1).
  for (const a of await listAgents()) {
    if (!a.roomId) continue
    const mitglieder = await ctx.matrix.members(a.roomId)
    if (mitglieder.length && mitglieder.length < 3) {
      ctx.log.warn({ agent: a.id, room: a.roomId, mitglieder }, 'Arbeitsraum hat weniger als drei Mitglieder — DM-Gefahr')
    }
  }

  await publishAgentCards(ctx)
  return ergebnis
}

/**
 * Agent Cards als State-Event in die Lobby — nur bei echten Änderungen, nie für
 * Heartbeats (§8.4): Jede State-Änderung vergrössert Synapses State-Gruppen.
 */
export async function publishAgentCards(ctx: Ctx): Promise<number> {
  const [lobby] = await roomsByKind('lobby')
  if (!lobby?.roomId) return 0
  const agenten = await listAgents()
  const configs = await loadAgents()
  let geschrieben = 0
  const ausgabe = []
  for (const a of agenten) {
    const cfg = configs[a.id]
    const card: AgentCardContent = {
      v: 1,
      id: a.id,
      name: a.displayName ?? a.id,
      level: a.level,
      trust: a.trust,
      mode: a.mode,
      ...(cfg?.runtime ? { runtime: cfg.runtime } : {}),
      ...(cfg?.model ? { model: cfg.model } : {}),
      owner: ctx.owner,
      ...(a.roomId ? { room: a.roomId } : {}),
      skills: a.skills,
      accepts: a.accepts,
      limits: {
        parallel: a.parallel,
        ...(a.budgetUsdDay !== null ? { budget_usd_day: Number(a.budgetUsdDay) } : {}),
        ...(a.usdPerMinute !== null ? { usd_per_minute: Number(a.usdPerMinute) } : {}),
      },
      status: (AGENT_STATUS as readonly string[]).includes(a.status) ? a.status : 'offline',
    }
    if (JSON.stringify(a.card) === JSON.stringify(card)) continue
    await sql`UPDATE swarm.agents SET card = ${sql.json(card)} WHERE id = ${a.id}`
    ausgabe.push({
      kind: 'state' as const,
      roomId: lobby.roomId,
      payload: { type: SWARM_AGENT_EVENT, stateKey: a.id, content: card as unknown as Record<string, unknown> },
    })
    geschrieben++
  }
  if (ausgabe.length) await enqueue(sql, ausgabe, ctx.hub)
  return geschrieben
}
