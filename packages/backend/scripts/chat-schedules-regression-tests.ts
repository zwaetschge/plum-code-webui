import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'schedule-fixture-encryption-key-000000';
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { run, get } = await import('../src/db/pg.js');
const { createResource, BODY_SCHEMAS } = await import('../src/services/assistant/resources.js');
const {
  saveChatSchedule,
  dispatchChatSchedules,
  runChatSchedule,
  chatSchedules,
  removeChatSchedule,
} = await import('../src/services/assistant/chatSchedules.js');
const { CHAT_SCHEDULE_PLAN, nextChatSchedule } =
  await import('../src/services/assistant/chatScheduleTime.js');
const { enqueueApiTurn } = await import('../src/services/assistant/apiChatQueue.js');
const { API_TURN_INPUT } = await import('../src/services/assistant/apiChats.js');
const daily = CHAT_SCHEDULE_PLAN.parse({ frequency: 'daily', time: '02:30' });
assert.equal(
  nextChatSchedule(daily, new Date('2026-03-29T00:00:00Z')),
  '2026-03-30T00:30:00.000Z',
  'DST gap is skipped'
);
assert.equal(
  nextChatSchedule(daily, new Date('2026-10-25T00:31:00Z'), '2026-10-25T00:30:00Z'),
  '2026-10-26T01:30:00.000Z',
  'repeated local time runs once'
);
assert.equal(
  nextChatSchedule(
    CHAT_SCHEDULE_PLAN.parse({ frequency: 'weekly', days: [1], time: '07:00' }),
    new Date('2026-10-26T07:00:00Z')
  ),
  '2026-11-02T06:00:00.000Z'
);
if (!(await testing.databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await testing.createTestSchema();
try {
  const user = 'schedule-owner',
    other = 'schedule-other';
  for (const id of [user, other])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      id,
      id + '@example.invalid',
      id
    );
  const chat = await createResource(
    user,
    'api-chat',
    'Chat',
    BODY_SCHEMAS['api-chat'].parse({ providerId: 'fixture', model: 'glm-5.3-flash' })
  );
  const blocker = randomUUID(),
    stamp = new Date().toISOString();
  await run(
    "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,status,model,profile_json,created_at,updated_at,expires_at) VALUES(?,?,1,'fixture','Blocking fixture','running','fixture','{}',?,?,?)",
    blocker,
    chat.id,
    stamp,
    stamp,
    new Date(Date.now() + 86400000).toISOString()
  );
  const input = {
    commandId: randomUUID(),
    chatId: chat.id,
    title: 'Morgen',
    prompt: 'Prüfe den aktuellen Stand',
    plan: { frequency: 'interval' as const, intervalMinutes: 60 },
    enabled: true,
  };
  const routine = await saveChatSchedule(user, input);
  assert.equal((await saveChatSchedule(user, input)).id, routine.id, 'create replay');
  await assert.rejects(saveChatSchedule(other, { ...input, commandId: randomUUID() }));
  const due = new Date(Date.now() - 60000).toISOString();
  await run('UPDATE assistant_chat_schedules SET next_at=? WHERE routine_id=?', due, routine.id);
  const send = async (
    owner: string,
    id: string,
    turn: { commandId: string; expectedRevision: number; prompt: string }
  ) => enqueueApiTurn(owner, id, API_TURN_INPUT.parse(turn));
  await Promise.all([
    dispatchChatSchedules(new Date(), send),
    dispatchChatSchedules(new Date(), send),
  ]);
  assert.equal(
    Number((await get('SELECT COUNT(*) AS n FROM assistant_api_turns WHERE chat_id=?', chat.id)).n),
    2,
    'competing scheduler workers enqueue one occurrence'
  );
  const accepted = (await chatSchedules(user))[0]!;
  assert.equal(accepted.runs[0]?.status, 'accepted');
  assert.equal(
    (await get('SELECT prompt FROM assistant_api_turns WHERE id=?', accepted.runs[0]!.id)).prompt,
    input.prompt
  );
  await run(
    "UPDATE assistant_chat_schedule_runs SET status='dispatching',lease_until=? WHERE id=?",
    due,
    accepted.runs[0]!.id
  );
  await dispatchChatSchedules(new Date(), send);
  assert.equal(
    Number((await get('SELECT COUNT(*) AS n FROM assistant_api_turns WHERE chat_id=?', chat.id)).n),
    2,
    'lost acknowledgement/restart reuses exact turn ID/input'
  );
  const manual = await runChatSchedule(user, routine.id, randomUUID());
  await dispatchChatSchedules(new Date(), send);
  assert.equal(
    (await get('SELECT status FROM assistant_api_turns WHERE id=?', manual.id)).status,
    'queued',
    'manual run returns through normal durable chat queue'
  );
  const paused = await saveChatSchedule(
    user,
    { ...input, commandId: randomUUID(), expectedRevision: 1, enabled: false },
    routine.id
  );
  await run('UPDATE assistant_chat_schedules SET next_at=? WHERE routine_id=?', due, routine.id);
  assert.equal(await dispatchChatSchedules(new Date(), send), 0);
  await assert.rejects(removeChatSchedule(other, routine.id, paused.revision));
  await removeChatSchedule(user, routine.id, paused.revision);
  assert.equal((await chatSchedules(user)).length, 0);
  console.log(
    'PASS DST/timezones, owner checks, durable occurrence/restart idempotence, competing workers, queue result handoff, manual run, pause and remove; no model calls'
  );
} finally {
  await testing.dropTestSchema();
}
