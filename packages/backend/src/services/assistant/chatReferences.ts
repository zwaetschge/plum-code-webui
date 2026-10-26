import { all } from '../../db/pg.js';
import type { MemoryScope } from './memorySemantic.js';
import { extractDynamicUi } from '@plum-code-webui/shared';

/** Explicit selections retain the account read/history ceiling and project isolation. */
export async function selectedChatReferences(
  userId: string,
  chatId: string,
  ids: string[],
  scope: MemoryScope
) {
  const selected = [...new Set(ids)].filter((id) => id !== chatId);
  if (!selected.length) return [];
  const rows = await all(
    `SELECT r.id,r.title,t.id AS turn_id,t.prompt,t.response FROM assistant_resources r
    JOIN LATERAL (SELECT t.id,t.prompt,t.response FROM assistant_api_turns t WHERE t.chat_id=r.id AND t.status='completed' AND t.hidden_by IS NULL
      AND NOT EXISTS(SELECT 1 FROM assistant_memory_forgotten f WHERE f.user_id=r.user_id AND f.fingerprint='source:'||encode(sha256(convert_to('api:'||r.id||':'||t.id,'UTF8')),'hex')) ORDER BY t.seq DESC LIMIT 1) t ON true
    WHERE r.user_id=? AND r.kind='api-chat' AND r.archived=0 AND r.id=ANY(?::text[]) AND COALESCE((r.body_json::jsonb->>'temporary')::boolean,false)=false
      AND ((r.body_json::jsonb->>'projectId' IS NULL AND ?::boolean) OR r.body_json::jsonb->>'projectId'=ANY(?::text[]))`,
    userId,
    selected,
    scope.personal,
    scope.projects
  );
  return selected.flatMap((id) => {
    const row = rows.find((r) => r.id === id);
    return row
      ? [
          {
            chatId: row.id,
            turnId: row.turn_id,
            title: row.title,
            prompt: String(row.prompt).slice(0, 1000),
            response: extractDynamicUi(String(row.response)).text.slice(0, 2000),
          },
        ]
      : [];
  });
}
