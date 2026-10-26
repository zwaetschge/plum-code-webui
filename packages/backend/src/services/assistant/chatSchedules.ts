import { createHash } from 'node:crypto';
import { z } from 'zod';
import { all, run, transaction, type TransactionScope } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createResource, findResource, reviseResource } from './resources.js';
import { CHAT_SCHEDULE_PLAN, nextChatSchedule } from './chatScheduleTime.js';

export const CHAT_SCHEDULE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS assistant_chat_schedules (
    routine_id TEXT PRIMARY KEY REFERENCES assistant_resources(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    next_at TEXT, paused BIGINT NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_chat_schedules_due ON assistant_chat_schedules(paused,next_at)`,
  `CREATE TABLE IF NOT EXISTS assistant_chat_schedule_runs (
    id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES assistant_chat_schedules(routine_id) ON DELETE CASCADE,
    slot_at TEXT NOT NULL, status TEXT NOT NULL, input_json TEXT NOT NULL,
    lease_until TEXT, attempts BIGINT NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL,
    UNIQUE(routine_id,slot_at)
  )`,
];
export const CHAT_SCHEDULE_INPUT = z
  .object({
    commandId: z.string().uuid(),
    chatId: z.string().max(200),
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1).max(20000),
    plan: CHAT_SCHEDULE_PLAN,
    enabled: z.boolean().default(true),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
async function chat(tx: TransactionScope, userId: string, id: string) {
  const resource = await findResource(userId, id, tx);
  if (resource.kind !== 'api-chat' || resource.body.temporary)
    throw new AppError('Dauerhafter Modellchat erforderlich', 400, 'CHAT_REQUIRED');
  return resource;
}
export async function chatSchedules(userId: string, chatId?: string) {
  const rows = await all(
    `SELECT s.*,r.title,r.revision,r.body_json FROM assistant_chat_schedules s JOIN assistant_resources r ON r.id=s.routine_id JOIN assistant_resources c ON c.id=s.chat_id WHERE s.user_id=? AND r.archived=0 AND c.archived=0 ${chatId ? 'AND s.chat_id=?' : ''} ORDER BY s.updated_at DESC LIMIT 100`,
    userId,
    ...(chatId ? [chatId] : [])
  );
  return Promise.all(
    rows.map(async (row) => ({
      id: row.routine_id,
      chatId: row.chat_id,
      title: row.title,
      revision: Number(row.revision),
      prompt: JSON.parse(String(row.body_json)).goal,
      plan: JSON.parse(String(row.body_json)).chatSchedule,
      paused: !!row.paused,
      nextAt: row.next_at,
      error: row.last_error,
      runs: await all(
        'SELECT id,slot_at AS "slotAt",status,error FROM assistant_chat_schedule_runs WHERE routine_id=? ORDER BY created_at DESC LIMIT 10',
        row.routine_id
      ),
    }))
  );
}
export async function saveChatSchedule(
  userId: string,
  raw: z.input<typeof CHAT_SCHEDULE_INPUT>,
  id?: string
) {
  const input = CHAT_SCHEDULE_INPUT.parse(raw);
  const hash = createHash('sha256')
    .update(JSON.stringify({ id: id ?? null, input }))
    .digest('hex');
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const prior = await tx.get(
      'SELECT * FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (prior.action !== 'chat-schedule-save' || prior.payload_hash !== hash)
        throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
      return findResource(userId, String(prior.resource_id), tx);
    }
    await chat(tx, userId, input.chatId);
    const next = nextChatSchedule(input.plan, new Date());
    if (input.enabled && !next)
      throw new AppError('Zeitplan besitzt keinen zukünftigen Lauf', 400, 'SCHEDULE_EXPIRED');
    const body = {
      goal: input.prompt,
      schedule: input.plan.frequency,
      timezone: input.plan.timezone,
      enabled: input.enabled,
      owner: 'api-chat',
      chatId: input.chatId,
      chatSchedule: input.plan,
    };
    let resource;
    if (id) {
      await tx.get(
        'SELECT routine_id FROM assistant_chat_schedules WHERE routine_id=? AND user_id=? FOR UPDATE',
        id,
        userId
      );
      const original = await findResource(userId, id, tx);
      if (
        original.kind !== 'routine' ||
        original.body.owner !== 'api-chat' ||
        !input.expectedRevision
      )
        throw new AppError('Chatplan nicht gefunden', 404, 'NOT_FOUND');
      resource = await reviseResource(userId, id, input.expectedRevision, input.title, body, tx);
      await tx.run(
        "UPDATE assistant_chat_schedule_runs SET status='cancelled',error='Zeitplan geändert' WHERE routine_id=? AND status='pending'",
        id
      );
    } else resource = await createResource(userId, 'routine', input.title, body, tx);
    const now = new Date().toISOString();
    await tx.run(
      `INSERT INTO assistant_chat_schedules(routine_id,user_id,chat_id,next_at,paused,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(routine_id) DO UPDATE SET chat_id=excluded.chat_id,next_at=excluded.next_at,paused=excluded.paused,last_error=NULL,updated_at=excluded.updated_at`,
      resource.id,
      userId,
      input.chatId,
      next,
      input.enabled ? 0 : 1,
      now
    );
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,'chat-schedule-save','accepted',?,?,?)",
      userId,
      input.commandId,
      resource.id,
      hash,
      JSON.stringify({ id: resource.id }),
      now,
      now
    );
    return resource;
  });
}
function runId(id: string, slot: string) {
  const hash = createHash('sha256')
    .update(id + ':' + slot)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
async function reserve(
  tx: TransactionScope,
  userId: string,
  routineId: string,
  chatId: string,
  prompt: string,
  slot: string
) {
  const resource = await chat(tx, userId, chatId),
    id = runId(routineId, slot);
  const input = { commandId: id, expectedRevision: resource.revision, prompt };
  await tx.run(
    "INSERT INTO assistant_chat_schedule_runs(id,routine_id,slot_at,status,input_json,created_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(routine_id,slot_at) DO NOTHING",
    id,
    routineId,
    slot,
    JSON.stringify(input),
    new Date().toISOString()
  );
  return { id, chatId };
}
export async function runChatSchedule(userId: string, id: string, commandId: string) {
  z.string().uuid().parse(commandId);
  return transaction(async (tx) => {
    const state = await tx.get(
      'SELECT * FROM assistant_chat_schedules WHERE routine_id=? AND user_id=? FOR UPDATE',
      id,
      userId
    );
    const resource = await findResource(userId, id, tx);
    if (!state || resource.kind !== 'routine')
      throw new AppError('Chatplan nicht gefunden', 404, 'NOT_FOUND');
    return reserve(
      tx,
      userId,
      id,
      String(state.chat_id),
      String(resource.body.goal),
      'manual:' + commandId
    );
  });
}
export async function removeChatSchedule(userId: string, id: string, revision: number) {
  return transaction(async (tx) => {
    await tx.get(
      'SELECT routine_id FROM assistant_chat_schedules WHERE routine_id=? AND user_id=? FOR UPDATE',
      id,
      userId
    );
    const resource = await findResource(userId, id, tx);
    if (resource.kind !== 'routine' || resource.revision !== revision)
      throw new AppError('Zeitplan wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
    await tx.run(
      'UPDATE assistant_resources SET archived=1,revision=revision+1,updated_at=? WHERE id=? AND user_id=?',
      new Date().toISOString(),
      id,
      userId
    );
    await tx.run(
      'UPDATE assistant_chat_schedules SET paused=1,next_at=NULL WHERE routine_id=?',
      id
    );
    await tx.run(
      "UPDATE assistant_chat_schedule_runs SET status='cancelled' WHERE routine_id=? AND status='pending'",
      id
    );
    return { removed: true };
  });
}
type Sender = (
  userId: string,
  chatId: string,
  input: { commandId: string; expectedRevision: number; prompt: string }
) => Promise<unknown>;
export async function dispatchChatSchedules(now = new Date(), send?: Sender) {
  const stamp = now.toISOString();
  await transaction(async (tx) => {
    const due = await tx.all(
      `SELECT s.*,r.body_json FROM assistant_chat_schedules s JOIN assistant_resources r ON r.id=s.routine_id JOIN users u ON u.id=s.user_id WHERE s.paused=0 AND s.next_at<=? AND r.archived=0 AND u.status<>'suspended' ORDER BY s.next_at LIMIT 4 FOR UPDATE OF s SKIP LOCKED`,
      stamp
    );
    for (const state of due) {
      const body = JSON.parse(String(state.body_json));
      try {
        if (!body.enabled || body.owner !== 'api-chat' || body.chatId !== state.chat_id)
          throw new Error('Zeitplan deaktiviert oder verändert');
        await reserve(
          tx,
          String(state.user_id),
          String(state.routine_id),
          String(state.chat_id),
          String(body.goal),
          String(state.next_at)
        );
        const next = nextChatSchedule(
          CHAT_SCHEDULE_PLAN.parse(body.chatSchedule),
          now,
          String(state.next_at)
        );
        await tx.run(
          'UPDATE assistant_chat_schedules SET next_at=?,paused=?,last_error=NULL,updated_at=? WHERE routine_id=?',
          next,
          next ? 0 : 1,
          stamp,
          state.routine_id
        );
      } catch (error) {
        await tx.run(
          'UPDATE assistant_chat_schedules SET paused=1,last_error=?,updated_at=? WHERE routine_id=?',
          error instanceof Error ? error.message.slice(0, 500) : 'Zeitplan nicht verfügbar',
          stamp,
          state.routine_id
        );
      }
    }
  });
  const jobs = await transaction(async (tx) => {
    const rows = await tx.all(
      `SELECT j.*,s.user_id,s.chat_id,r.archived,r.body_json,u.status AS user_status FROM assistant_chat_schedule_runs j JOIN assistant_chat_schedules s ON s.routine_id=j.routine_id JOIN assistant_resources r ON r.id=j.routine_id JOIN users u ON u.id=s.user_id WHERE j.status='pending' OR (j.status='dispatching' AND j.lease_until<?) ORDER BY j.created_at LIMIT 4 FOR UPDATE OF j SKIP LOCKED`,
      stamp
    );
    const claimed = [];
    for (const row of rows) {
      if (row.archived || row.user_status === 'suspended') {
        await tx.run(
          "UPDATE assistant_chat_schedule_runs SET status='cancelled' WHERE id=?",
          row.id
        );
        continue;
      }
      const lease = new Date(now.getTime() + 60000).toISOString();
      await tx.run(
        "UPDATE assistant_chat_schedule_runs SET status='dispatching',lease_until=?,attempts=attempts+1 WHERE id=?",
        lease,
        row.id
      );
      claimed.push({ ...row, lease });
    }
    return claimed;
  });
  for (const job of jobs) {
    try {
      const deliver = send ?? (await import('./apiChats.js')).startApiTurn;
      await deliver(String(job.user_id), String(job.chat_id), JSON.parse(String(job.input_json)));
      await run(
        "UPDATE assistant_chat_schedule_runs SET status='accepted',lease_until=NULL,error=NULL WHERE id=? AND status='dispatching' AND lease_until=?",
        job.id,
        job.lease
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 500) : 'Chatlauf fehlgeschlagen';
      await run(
        "UPDATE assistant_chat_schedule_runs SET status='failed',error=?,lease_until=NULL WHERE id=? AND status='dispatching' AND lease_until=?",
        message,
        job.id,
        job.lease
      );
      await run(
        'UPDATE assistant_chat_schedules SET last_error=? WHERE routine_id=?',
        message,
        job.routine_id
      );
    }
  }
  return jobs.length;
}
export function startChatScheduleWorker() {
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    void dispatchChatSchedules()
      .catch((error) =>
        console.error('[chat-schedules]', error instanceof Error ? error.message : 'failed')
      )
      .finally(() => {
        busy = false;
      });
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
