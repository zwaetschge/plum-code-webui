/**
 * Aufträge in Postgres (§14.2). Der Hub ist die einzige Quelle für Zustände;
 * Matrix spiegelt sie nur (§5.5). Jede Zustandsänderung und die Meldung dazu
 * stehen in derselben Transaktion (§10.2) — deshalb nehmen die Funktionen hier
 * eine `tx` an, wenn sie aus einem größeren Ablauf kommen.
 */
import type { TaskState, TRUST_LEVELS } from '../protocol/index.js';
import { camel, jsonParam, sql, type Db } from '../db/index.js';
import { formatTaskId } from './card.js';

export interface TaskRow {
  id: string;
  root: string;
  parent: string | null;
  correlationId: string;
  state: TaskState;
  fromAgent: string;
  assignee: string;
  hop: number;
  depth: number;
  goal: string;
  deliverable: string;
  constraints: string[];
  budgetUsd: number | null;
  budgetMinutes: number | null;
  deadline: string | null;
  trustRequired: (typeof TRUST_LEVELS)[number];
  priority: 'low' | 'normal' | 'high';
  attempts: number;
  claimedAt: string | null;
  cardSentAt: string | null;
  remindedAt: string | null;
  longRunNotifiedAt: string | null;
  deadlineNotifiedAt: string | null;
  roomId: string | null;
  threadRoot: string | null;
  boardEvent: string | null;
  result: string | null;
  failReason: string | null;
  costUsd: number | null;
  idempotencyKey: string | null;
  promptHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewTask {
  id: string;
  root?: string;
  parent?: string | null;
  correlationId: string;
  state: TaskState;
  fromAgent: string;
  assignee: string;
  hop: number;
  depth: number;
  goal: string;
  deliverable: string;
  constraints: string[];
  budgetUsd: number | null;
  budgetMinutes: number | null;
  deadline: string | null;
  trustRequired: (typeof TRUST_LEVELS)[number];
  roomId?: string | null;
  idempotencyKey: string;
  promptHash: string;
  chain?: string[];
  provenance?: Record<string, unknown>;
}

const SPALTEN = sql`
  id, root, parent, correlation_id, state, from_agent, assignee, hop, depth, goal,
  deliverable, constraints, budget_usd, budget_minutes, deadline, trust_required,
  priority, attempts, room_id, thread_root, board_event, result, fail_reason,
  cost_usd, idempotency_key, prompt_hash, created_at, updated_at,
  claimed_at, card_sent_at, reminded_at, long_run_notified_at, deadline_notified_at`;

function toTask(row: Record<string, unknown>): TaskRow {
  const t = camel<TaskRow>(row);
  return { ...t, constraints: (row.constraints as string[] | null) ?? [] };
}

export async function nextTaskId(db: Db = sql): Promise<string> {
  const [row] = await db`SELECT nextval('swarm.task_no') AS n`;
  return formatTaskId(Number(row!.n));
}

/**
 * Anlegen mit Doppelschutz: `idempotency_key` ist UNIQUE, dasselbe Event erzeugt
 * also genau einen Auftrag (§10.3). Bei einem Treffer kommt der bestehende zurück.
 */
export async function createTask(
  t: NewTask,
  db: Db = sql
): Promise<{ task: TaskRow; created: boolean }> {
  async function bestehend(): Promise<TaskRow | null> {
    const [row] =
      await db`SELECT ${SPALTEN} FROM swarm.tasks WHERE idempotency_key = ${t.idempotencyKey}`;
    return row ? toTask(row) : null;
  }
  const vorher = await bestehend();
  if (vorher) return { task: vorher, created: false };
  try {
    const rows = await db`
      INSERT INTO swarm.tasks (
        id, root, parent, correlation_id, state, from_agent, assignee, hop, depth,
        goal, deliverable, constraints, budget_usd, budget_minutes, deadline,
        trust_required, room_id, idempotency_key, prompt_hash, chain, provenance)
      VALUES (
        ${t.id}, ${t.root ?? t.id}, ${t.parent ?? null}, ${t.correlationId}, ${t.state},
        ${t.fromAgent}, ${t.assignee}, ${t.hop}, ${t.depth}, ${t.goal}, ${t.deliverable},
        ${jsonParam(db, t.constraints)}, ${t.budgetUsd}, ${t.budgetMinutes},
        ${t.deadline}, ${t.trustRequired}, ${t.roomId ?? null}, ${t.idempotencyKey},
        ${t.promptHash}, ${t.chain ?? []}::text[], ${jsonParam(db, t.provenance ?? {})})
      RETURNING ${SPALTEN}`;
    return { task: toTask(rows[0]!), created: true };
  } catch (err) {
    // 23505 = unique_violation: derselbe Auftrag kam zweimal gleichzeitig rein.
    if ((err as { code?: string }).code === '23505') {
      const doch = await bestehend();
      if (doch) return { task: doch, created: false };
    }
    throw err;
  }
}

export async function getTask(id: string, db: Db = sql): Promise<TaskRow | null> {
  const [row] = await db`SELECT ${SPALTEN} FROM swarm.tasks WHERE id = ${id}`;
  return row ? toTask(row) : null;
}

export async function setState(
  id: string,
  state: TaskState,
  patch: { result?: string | null; failReason?: string | null; retry?: boolean } = {},
  db: Db = sql
): Promise<TaskRow | null> {
  const [row] = await db`
    UPDATE swarm.tasks SET
      state = ${state},
      attempts = attempts + ${patch.retry ? 1 : 0},
      result = COALESCE(${patch.result ?? null}, result),
      fail_reason = ${patch.failReason ?? null},
      updated_at = now()
    WHERE id = ${id}
    RETURNING ${SPALTEN}`;
  return row ? toTask(row) : null;
}

/** Zeitstempel des Watchdogs (§10.4): was er schon gemeldet hat, meldet er nicht erneut. */
export async function markClaimed(id: string, db: Db = sql): Promise<void> {
  await db`UPDATE swarm.tasks SET claimed_at = now() WHERE id = ${id} AND claimed_at IS NULL`;
}

export async function markCardSent(id: string, db: Db = sql): Promise<void> {
  await db`UPDATE swarm.tasks SET card_sent_at = now() WHERE id = ${id} AND card_sent_at IS NULL`;
}

export async function markNotified(
  id: string,
  spalte: 'reminded_at' | 'long_run_notified_at' | 'deadline_notified_at',
  db: Db = sql
): Promise<void> {
  // Spaltenname kommt aus einer festen Liste, nie aus Benutzereingaben.
  await db.unsafe(`UPDATE swarm.tasks SET ${spalte} = now(), updated_at = now() WHERE id = $1`, [
    id,
  ]);
}

/** Offene Aufträge, die der Watchdog ansehen muss (§10.4). */
export interface WatchdogFund {
  id: string;
  assignee: string;
  state: TaskState;
  roomId: string | null;
  threadRoot: string | null;
  cardSentAt: string | null;
  claimedAt: string | null;
  deadline: string | null;
  budgetMinutes: number | null;
  leaseUntil: string | null;
  attempts: number;
  goal: string;
  remindedAt: string | null;
  longRunNotifiedAt: string | null;
  deadlineNotifiedAt: string | null;
}

const W_SPALTEN = sql`
  id, assignee, state, room_id, thread_root, card_sent_at, claimed_at, deadline,
  budget_minutes, lease_until, attempts, goal, reminded_at, long_run_notified_at,
  deadline_notified_at`;

export async function watchdogKandidaten(db: Db = sql): Promise<WatchdogFund[]> {
  const rows = await db`
    SELECT ${W_SPALTEN} FROM swarm.tasks
    WHERE state IN ('submitted','working','input-required')
    ORDER BY created_at
    LIMIT 200`;
  return rows.map((r) => camel<WatchdogFund>(r));
}

/** Älteste wartende Karte eines Agenten freigeben (§12.1: 1 parallel pro Agent). */
/**
 * Hop der Kette weiterschreiben (§9.3). Gezählt wird auf der **Wurzel**: Jede
 * Übergabe und jede Rückmeldung zählt 1, Erinnerungen und Notices nicht. Ohne
 * die Wurzel könnte ein Ping-Pong beliebig oft bei Hop 1 neu anfangen (N2).
 */
export async function bumpHop(rootId: string, db: Db = sql): Promise<number> {
  const [row] = await db`
    UPDATE swarm.tasks SET hop = hop + 1, updated_at = now()
    WHERE id = ${rootId} RETURNING hop`;
  return Number(row?.hop ?? 0);
}

export async function setPriority(
  id: string,
  priority: 'low' | 'normal' | 'high',
  db: Db = sql
): Promise<void> {
  await db`UPDATE swarm.tasks SET priority = ${priority}, updated_at = now() WHERE id = ${id}`;
}

export async function setThreadRoot(id: string, eventId: string, db: Db = sql): Promise<void> {
  await db`UPDATE swarm.tasks SET thread_root = ${eventId}, updated_at = now() WHERE id = ${id}`;
}

export async function setBoardEvent(id: string, eventId: string, db: Db = sql): Promise<void> {
  await db`UPDATE swarm.tasks SET board_event = ${eventId}, updated_at = now() WHERE id = ${id}`;
}

/** Satz pro Minute aus agents.swarm.yaml — die Rechengrösse für native Bots (§12.2). */
export async function usdProMinute(assignee: string, db: Db = sql): Promise<number | null> {
  const [row] = await db`SELECT usd_per_minute FROM swarm.agents WHERE id = ${assignee}`;
  return row?.usd_per_minute === null || row?.usd_per_minute === undefined
    ? null
    : Number(row.usd_per_minute);
}

export async function addCost(id: string, usd: number, db: Db = sql): Promise<void> {
  await db`
    UPDATE swarm.tasks SET cost_usd = COALESCE(cost_usd, 0) + ${usd}, updated_at = now()
    WHERE id = ${id}`;
}

/** Offene Unteraufträge — ✅ schliesst den Eltern-Auftrag sonst nicht ab (§10.3). */
export async function openSubtasks(parentId: string, db: Db = sql): Promise<string[]> {
  const rows = await db`
    SELECT id FROM swarm.tasks
    WHERE parent = ${parentId}
      AND state IN ('submitted','working','input-required','auth-required')
    ORDER BY id`;
  return rows.map((r) => r.id as string);
}

export async function runningCount(assignee: string, db: Db = sql): Promise<number> {
  const [row] = await db`
    SELECT count(*)::int AS n FROM swarm.tasks
    WHERE assignee = ${assignee}
      AND state IN ('submitted','working','input-required')`;
  return Number(row!.n);
}

export async function tasksInRoot(root: string, db: Db = sql): Promise<number> {
  const [row] = await db`SELECT count(*)::int AS n FROM swarm.tasks WHERE root = ${root}`;
  return Number(row!.n);
}

/** Gleicher `prompt_hash` im Duplikat-Fenster (§10.3). */
export async function duplicateWithin(
  promptHash: string,
  minutes: number,
  excludeTaskId?: string,
  db: Db = sql
): Promise<string | null> {
  const ausnahme = excludeTaskId ?? '';
  const [row] = await db`
    SELECT id FROM swarm.tasks
    WHERE prompt_hash = ${promptHash}
      AND created_at > now() - make_interval(mins => ${minutes})
      AND state NOT IN ('completed','failed','canceled','rejected')
      AND id <> ${ausnahme}
    ORDER BY created_at DESC LIMIT 1`;
  return (row?.id as string | undefined) ?? null;
}

/** Verbrauch heute pro Agent: Summe `cost_usd` (§14.2, Tagesbudget). */
export async function dailyCost(assignee: string, db: Db = sql): Promise<number> {
  const [row] = await db`
    SELECT COALESCE(sum(cost_usd), 0)::float AS usd FROM swarm.tasks
    WHERE assignee = ${assignee} AND created_at >= date_trunc('day', now())`;
  return Number(row!.usd);
}

export async function listOpen(db: Db = sql): Promise<TaskRow[]> {
  const rows = await db`
    SELECT ${SPALTEN} FROM swarm.tasks
    WHERE state IN ('submitted','working','input-required','auth-required')
    ORDER BY (priority = 'high') DESC, created_at`;
  return rows.map(toTask);
}

export async function listForAgent(assignee: string, db: Db = sql): Promise<TaskRow[]> {
  const rows = await db`
    SELECT ${SPALTEN} FROM swarm.tasks WHERE assignee = ${assignee}
    ORDER BY created_at DESC LIMIT 20`;
  return rows.map(toTask);
}

/** Welche Matrix-Events zu welchem Auftrag gehören (§10.2). */
export async function mapEvent(
  eventId: string,
  taskId: string,
  role: 'karte' | 'board' | 'freigabe' | 'rueckmeldung' | 'erinnerung' | 'abbruch' | 'quittung',
  db: Db = sql
): Promise<void> {
  await db`
    INSERT INTO swarm.matrix_map (event_id, task_id, role)
    VALUES (${eventId}, ${taskId}, ${role})
    ON CONFLICT (event_id) DO UPDATE SET task_id = EXCLUDED.task_id, role = EXCLUDED.role`;
}

export async function taskByEvent(
  eventId: string,
  db: Db = sql
): Promise<{ taskId: string; role: string } | null> {
  const [row] = await db`SELECT task_id, role FROM swarm.matrix_map WHERE event_id = ${eventId}`;
  return row ? { taskId: row.task_id as string, role: row.role as string } : null;
}
