/**
 * Agenten und Räume (§8.4, §6). `swarm.agents` ist die Wahrheit; das State-Event
 * `ch.zwaetschge.swarm.agent` ist nur der Spiegel für Matrix-Clients.
 */
import type { AGENT_MODES, AGENT_STATUS, AGENT_LEVELS, TRUST_LEVELS } from '../protocol/index.js';
import { camel, sql, type Db } from '../db/index.js';

export interface AgentRow {
  id: string;
  mxid: string;
  displayName: string | null;
  level: (typeof AGENT_LEVELS)[number];
  trust: (typeof TRUST_LEVELS)[number];
  mode: (typeof AGENT_MODES)[number];
  roomId: string | null;
  status: (typeof AGENT_STATUS)[number];
  frozen: boolean;
  parallel: number;
  budgetUsdDay: number | null;
  usdPerMinute: number | null;
  skills: string[];
  accepts: string[];
  card: Record<string, unknown>;
  lastSeen: string | null;
}

const SPALTEN = sql`
  id, mxid, display_name, level, trust, mode, room_id, status, frozen, parallel,
  budget_usd_day, usd_per_minute, skills, accepts, card, last_seen`;

function toAgent(row: Record<string, unknown>): AgentRow {
  const a = camel<AgentRow>(row);
  return {
    ...a,
    skills: (row.skills as string[] | null) ?? [],
    accepts: (row.accepts as string[] | null) ?? [],
    card: (row.card as Record<string, unknown> | null) ?? {},
  };
}

export interface AgentUpsert {
  id: string;
  mxid: string;
  displayName?: string;
  level: AgentRow['level'];
  trust: AgentRow['trust'];
  mode: AgentRow['mode'];
  parallel?: number;
  budgetUsdDay?: number | null;
  usdPerMinute?: number | null;
  skills?: string[];
  accepts?: string[];
}

export async function upsertAgent(a: AgentUpsert, db: Db = sql): Promise<void> {
  await db`
    INSERT INTO swarm.agents (id, mxid, display_name, level, trust, mode, parallel,
                              budget_usd_day, usd_per_minute, skills, accepts)
    VALUES (${a.id}, ${a.mxid}, ${a.displayName ?? a.id}, ${a.level}, ${a.trust}, ${a.mode},
            ${a.parallel ?? 1}, ${a.budgetUsdDay ?? null}, ${a.usdPerMinute ?? null},
            ${a.skills ?? []}::text[], ${a.accepts ?? []}::text[])
    ON CONFLICT (id) DO UPDATE SET
      mxid = EXCLUDED.mxid,
      display_name = EXCLUDED.display_name,
      level = EXCLUDED.level,
      trust = EXCLUDED.trust,
      mode = EXCLUDED.mode,
      parallel = EXCLUDED.parallel,
      budget_usd_day = EXCLUDED.budget_usd_day,
      usd_per_minute = EXCLUDED.usd_per_minute,
      skills = EXCLUDED.skills,
      accepts = EXCLUDED.accepts,
      updated_at = now()`;
}

export async function agentById(id: string, db: Db = sql): Promise<AgentRow | null> {
  const [row] = await db`SELECT ${SPALTEN} FROM swarm.agents WHERE id = ${id}`;
  return row ? toAgent(row) : null;
}

export async function agentByMxid(mxid: string, db: Db = sql): Promise<AgentRow | null> {
  const [row] = await db`SELECT ${SPALTEN} FROM swarm.agents WHERE mxid = ${mxid}`;
  return row ? toAgent(row) : null;
}

export async function listAgents(db: Db = sql): Promise<AgentRow[]> {
  const rows = await db`SELECT ${SPALTEN} FROM swarm.agents ORDER BY id`;
  return rows.map(toAgent);
}

export async function setStatus(
  id: string,
  status: AgentRow['status'],
  db: Db = sql
): Promise<void> {
  await db`UPDATE swarm.agents SET status = ${status}, updated_at = now() WHERE id = ${id}`;
}

export async function setFrozen(id: string, frozen: boolean, db: Db = sql): Promise<void> {
  await db`UPDATE swarm.agents SET frozen = ${frozen}, updated_at = now() WHERE id = ${id}`;
}

export async function touchSeen(id: string, db: Db = sql): Promise<void> {
  await db`UPDATE swarm.agents SET last_seen = now() WHERE id = ${id}`;
}

export async function setRoomId(agentId: string, roomId: string, db: Db = sql): Promise<void> {
  await db`UPDATE swarm.agents SET room_id = ${roomId}, updated_at = now() WHERE id = ${agentId}`;
}

// ─── Räume ──────────────────────────────────────────────────────────────────

export interface RoomRow {
  alias: string;
  roomId: string | null;
  kind: string;
  agent: string | null;
}

export async function upsertRoom(
  alias: string,
  kind: string,
  agent: string | null,
  roomId: string | null,
  db: Db = sql
): Promise<void> {
  await db`
    INSERT INTO swarm.rooms (alias, kind, agent, room_id)
    VALUES (${alias}, ${kind}, ${agent}, ${roomId})
    ON CONFLICT (alias) DO UPDATE SET
      kind = EXCLUDED.kind,
      agent = EXCLUDED.agent,
      room_id = COALESCE(EXCLUDED.room_id, swarm.rooms.room_id)`;
}

export async function roomByAlias(alias: string, db: Db = sql): Promise<RoomRow | null> {
  const [row] =
    await db`SELECT alias, room_id, kind, agent FROM swarm.rooms WHERE alias = ${alias}`;
  return row ? camel<RoomRow>(row) : null;
}

export async function roomsByKind(kind: string, db: Db = sql): Promise<RoomRow[]> {
  const rows =
    await db`SELECT alias, room_id, kind, agent FROM swarm.rooms WHERE kind = ${kind} ORDER BY alias`;
  return rows.map((r) => camel<RoomRow>(r));
}

export async function roomByRoomId(roomId: string, db: Db = sql): Promise<RoomRow | null> {
  const [row] =
    await db`SELECT alias, room_id, kind, agent FROM swarm.rooms WHERE room_id = ${roomId}`;
  return row ? camel<RoomRow>(row) : null;
}

export async function listRooms(db: Db = sql): Promise<RoomRow[]> {
  const rows = await db`SELECT alias, room_id, kind, agent FROM swarm.rooms ORDER BY alias`;
  return rows.map((r) => camel<RoomRow>(r));
}
