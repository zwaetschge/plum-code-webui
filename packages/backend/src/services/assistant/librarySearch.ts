import { all } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  parseAssistantDocument,
  assistantDocumentText,
  parseAssistantSlides,
  assistantSlidesText,
  parseAssistantComparison,
  assistantComparisonText,
  type AssistantLibraryHit,
} from '@plum-code-webui/shared';

export async function searchAssistantLibrary(
  userId: string,
  input: { query: string; category?: 'all' | 'library' | 'chats' | 'code'; offset?: number }
) {
  const query = input.query.trim(),
    offset = input.offset ?? 0,
    category = input.category ?? 'all';
  if (
    query.length < 2 ||
    query.length > 200 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 10000 ||
    !['all', 'library', 'chats', 'code'].includes(category)
  )
    throw new AppError('Suchtext muss 2 bis 200 Zeichen lang sein', 400, 'SEARCH_INVALID');
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await all(
    `WITH candidates AS (
    SELECT 'resource' AS entry_type,r.id,r.kind,r.title,r.revision,r.updated_at,
      COALESCE(r.body_json::jsonb->>'text',r.body_json::jsonb->>'content',r.body_json::jsonb->>'goal',r.body_json::jsonb->>'transcript',r.body_json::jsonb->>'description',r.body_json::jsonb->>'instructions','') AS text,
      CASE WHEN r.kind='api-chat' THEN 'chats' ELSE 'library' END AS category,
      NULL::text AS parent_id,NULL::text AS chat_id,NULL::bigint AS seq
    FROM assistant_resources r WHERE r.user_id=? AND r.archived=0 AND r.kind<>'connection'
      AND NOT (r.kind='api-chat' AND COALESCE(r.body_json::jsonb->>'temporary','false')='true')
    UNION ALL
    SELECT 'api-turn',t.id,'api-chat',r.title,r.revision,t.updated_at,t.prompt || E'\n' || t.response,'chats',r.id,NULL::text,t.seq
    FROM assistant_api_turns t JOIN assistant_resources r ON r.id=t.chat_id
    WHERE r.user_id=? AND r.kind='api-chat' AND r.archived=0 AND COALESCE(r.body_json::jsonb->>'temporary','false')<>'true'
    UNION ALL
    SELECT 'session',s.id,'session',s.name,NULL::bigint,s.updated_at,'',CASE WHEN s.surface='code' THEN 'code' ELSE 'chats' END,NULL::text,NULL::text,NULL::bigint
    FROM sessions s LEFT JOIN assistant_session_bindings b ON b.session_id=s.id
    WHERE s.user_id=? AND s.archived=0 AND COALESCE(b.temporary,0)=0
    UNION ALL
    SELECT 'cli-message',m.id,'session',s.name,NULL::bigint,m.created_at,m.content,CASE WHEN s.surface='code' THEN 'code' ELSE 'chats' END,s.id,m.chat_id,m.seq
    FROM messages m JOIN sessions s ON s.id=m.session_id LEFT JOIN assistant_session_bindings b ON b.session_id=s.id
    WHERE s.user_id=? AND s.archived=0 AND COALESCE(b.temporary,0)=0 AND m.role IN ('user','assistant')
  ) SELECT entry_type,id,kind,title,revision,updated_at,category,parent_id,chat_id,seq,
    CASE WHEN entry_type IN ('api-turn','cli-message') THEN substr(text,greatest(1,strpos(lower(text),lower(?))-200),1000) ELSE text END AS text
    FROM candidates WHERE (?='all' OR category=?) AND (text ILIKE ? OR (entry_type IN ('resource','session') AND title ILIKE ?))
    ORDER BY updated_at::timestamptz DESC,entry_type,id LIMIT 31 OFFSET ?`,
    userId,
    userId,
    userId,
    userId,
    query,
    category,
    category,
    pattern,
    pattern,
    offset
  );
  const hits: AssistantLibraryHit[] = rows.slice(0, 30).map((row) => {
    let text = String(row.text);
    if (row.entry_type === 'resource' && text.startsWith('{')) {
      try {
        const type = JSON.parse(text).type;
        if (type === 'plum-document') text = assistantDocumentText(parseAssistantDocument(text));
        if (type === 'plum-slides') text = assistantSlidesText(parseAssistantSlides(text));
        if (type === 'plum-comparison')
          text = assistantComparisonText(parseAssistantComparison(text));
      } catch {
        /* Preserve literal original text for other formats. */
      }
    }
    const match = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()),
      start = Math.max(0, match - 200);
    let href = '';
    const id = encodeURIComponent(String(row.id));
    if (row.entry_type === 'cli-message') {
      const params = new URLSearchParams({ message: String(row.id) });
      if (row.chat_id) params.set('chat', String(row.chat_id));
      href = `/session/${encodeURIComponent(String(row.parent_id))}?${params}`;
    } else if (row.entry_type === 'session') href = `/session/${id}`;
    else if (row.entry_type === 'api-turn')
      href = `/chat/model/${encodeURIComponent(String(row.parent_id))}`;
    else if (row.kind === 'api-chat') href = `/chat/model/${id}`;
    else {
      const section =
        row.kind === 'task'
          ? '/tasks'
          : `/assistant/${row.kind === 'memory' ? 'memory' : row.kind + 's'}`;
      href = `${section}?resource=${id}&revision=${Number(row.revision)}`;
    }
    return {
      id: String(row.id),
      entryType: String(row.entry_type) as AssistantLibraryHit['entryType'],
      kind: String(row.kind),
      title: String(row.title),
      category: String(row.category) as AssistantLibraryHit['category'],
      revision: row.revision === null ? null : Number(row.revision),
      updatedAt: String(row.updated_at),
      excerpt: text.slice(start, start + 800),
      href,
    };
  });
  return { hits, hasMore: rows.length > 30 && offset < 10000 };
}
