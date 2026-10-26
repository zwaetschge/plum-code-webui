import type { ChatContextReceipt, ChatContextReference } from '@plum-code-webui/shared';
import { all } from '../../db/pg.js';

/** Resolve references in one page-sized batch. Never persist another copy of a fact. */
export async function contextReceipts(
  userId: string,
  chatId: string,
  turns: Record<string, unknown>[]
) {
  const snapshots = turns.flatMap((row) => {
    const context = JSON.parse(String(row.profile_json));
    if (context.memoryContext?.version !== 1) return [];
    return [{ row, context, refs: context.memoryContext.references as ChatContextReference[] }];
  });
  const result = new Map<string, ChatContextReceipt>();
  if (!snapshots.length) return result;
  const turnIds = snapshots.map(({ row }) => String(row.id));
  const memoryIds = snapshots.flatMap(({ refs }) =>
    refs.filter((r) => r.kind === 'memory').map((r) => r.id)
  );
  const historyIds = snapshots.flatMap(({ refs }) =>
    refs.filter((r) => r.kind === 'history' || r.kind === 'writing-style').map((r) => r.id)
  );
  const projectTurns = snapshots.flatMap(({ refs }) =>
    refs.filter((r) => r.kind === 'project-chat' || r.kind === 'chat-reference').map((r) => r.turnId!)
  );
  const [memories, history, project, jobs, learned, learnedHistory] = await Promise.all([
    all(
      `SELECT r.id,r.title,v.revision,v.body_json FROM assistant_resources r JOIN assistant_resource_revisions v ON v.resource_id=r.id WHERE r.user_id=? AND r.kind='memory' AND r.archived=0 AND r.id=ANY(?::text[])`,
      userId,
      memoryIds
    ),
    all(
      `SELECT id,summary,writing_style FROM assistant_memory_history WHERE user_id=? AND id=ANY(?::text[])`,
      userId,
      historyIds
    ),
    all(
      `SELECT r.id,r.title,t.id AS turn_id,t.prompt,t.response FROM assistant_resources r JOIN assistant_api_turns t ON t.chat_id=r.id WHERE r.user_id=? AND r.kind='api-chat' AND r.archived=0 AND t.id=ANY(?::text[]) AND NOT EXISTS(SELECT 1 FROM assistant_memory_forgotten f WHERE f.user_id=r.user_id AND f.fingerprint='source:' || encode(sha256(convert_to('api:'||r.id||':'||t.id,'UTF8')),'hex'))`,
      userId,
      projectTurns
    ),
    all(
      `SELECT turn_id,status FROM assistant_memory_jobs WHERE user_id=? AND source_type='api' AND source_id=? AND turn_id=ANY(?::text[])`,
      userId,
      chatId,
      turnIds
    ),
    all(
      `SELECT id,title,revision,body_json FROM assistant_resources WHERE user_id=? AND kind='memory' AND archived=0 AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(body_json::jsonb->'origins','[]'::jsonb)) o WHERE o->>'type'='api' AND o->>'id'=? AND o->>'turnId'=ANY(?::text[]))`,
      userId,
      chatId,
      turnIds
    ),
    all(
      `SELECT turn_id,summary,writing_style FROM assistant_memory_history WHERE user_id=? AND source_type='api' AND source_id=? AND turn_id=ANY(?::text[])`,
      userId,
      chatId,
      turnIds
    ),
  ]);
  for (const { row, context, refs } of snapshots) {
    const id = String(row.id);
    const job = jobs.find((j) => j.turn_id === id);
    const learnedRow = learnedHistory.find((h) => h.turn_id === id);
    result.set(id, {
      version: 1,
      memoryRead: context.memoryRead === true,
      memoryLearn: context.memoryLearn === true,
      personalizationRevision: context.personalizationRevision ?? 0,
      profileId: context.profileId ?? null,
      profileRevision: context.profileRevision ?? null,
      projectId: context.projectId ?? null,
      projectRevision: context.memoryContext.projectRevision ?? null,
      legacyNotes: !!context.memoryContext.legacyNotes,
      voiceHistory: !!context.memoryContext.voiceHistory,
      references: refs.map((ref) => {
        if (ref.kind === 'memory') {
          const memory = memories.find(
            (m) => m.id === ref.id && Number(m.revision) === ref.revision
          );
          const text = memory ? String(JSON.parse(memory.body_json).text ?? '') : '';
          return {
            ...ref,
            title: memory?.title ?? 'Vergessene Erinnerung',
            available: !!memory,
            ...(memory
              ? {
                  text: text.slice(
                    ref.excerptStart ?? 0,
                    (ref.excerptStart ?? 0) + (ref.excerptLength ?? 4000)
                  ),
                }
              : {}),
          };
        }
        if (ref.kind === 'project-chat' || ref.kind === 'chat-reference') {
          const chat = project.find((c) => c.id === ref.id && c.turn_id === ref.turnId);
          return {
            ...ref,
            title: chat?.title ?? 'Nicht mehr verfügbares Gespräch',
            available: !!chat,
          };
        }
        const item = history.find((h) => h.id === ref.id);
        return {
          ...ref,
          title: ref.kind === 'writing-style' ? 'Gelernter Schreibstil' : 'Früherer Chat',
          available: !!item,
          ...(item
            ? { text: String(ref.kind === 'writing-style' ? item.writing_style : item.summary) }
            : {}),
        };
      }),
      learning: {
        status: !context.memoryLearn
          ? 'disabled'
          : job
            ? (job.status as ChatContextReceipt['learning']['status'])
            : row.status === 'running'
              ? 'pending'
              : 'skipped',
        memories: learned.flatMap((m) => {
          const body = JSON.parse(m.body_json);
          return body.origins?.some(
            (o: Record<string, unknown>) => o.type === 'api' && o.id === chatId && o.turnId === id
          )
            ? [
                {
                  id: m.id,
                  title: m.title,
                  revision: Number(m.revision),
                  proposed: body.state === 'proposed',
                },
              ]
            : [];
        }),
        historySaved: !!learnedRow?.summary,
        writingStyleSaved: !!learnedRow?.writing_style,
      },
    });
  }
  return result;
}
