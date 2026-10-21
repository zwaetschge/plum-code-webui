import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, MessageCircle } from 'lucide-react';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { formatRelativeTime, useNow } from '@/lib/relativeTime';
import { SHOW_CHAT_HISTORY_EVENT } from '@/lib/chatHistory';
import './start-suggestions.css';

const RECENT_LIMIT = 5;

/**
 * "Zuletzt" on the chat start page: the five most recently updated model
 * chats. Shares the sidebar history's query, so both stay in sync.
 */
export function RecentChats() {
  const owner = useAuthStore((state) => state.user?.id);
  const now = useNow();
  const chats = useQuery({
    queryKey: ['assistant', 'api-chats', owner],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/api-chats')).data.data,
    refetchInterval: 30000,
  });
  // Project chats stay in their project folder, as in the sidebar history.
  const recent = (chats.data ?? [])
    .filter((chat) => !chat.body.projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_LIMIT);
  if (!recent.length) return null;

  return (
    <section className="plum-recent-chats" aria-labelledby="plum-recent-chats-title">
      <header className="plum-recent-chats-header">
        <h2 id="plum-recent-chats-title">Zuletzt</h2>
        <button
          type="button"
          className="plum-recent-chats-all"
          onClick={() => window.dispatchEvent(new Event(SHOW_CHAT_HISTORY_EVENT))}
        >
          Alle anzeigen
          <ChevronRight size={13} aria-hidden />
        </button>
      </header>
      <ul>
        {recent.map((chat, index) => (
          <li key={chat.id} style={{ '--i': index } as CSSProperties}>
            {/* Same target as the sidebar history entry. */}
            <Link to={`/chat/model/${chat.id}`} className="plum-recent-chat" title={chat.title}>
              <MessageCircle size={14} aria-hidden />
              <span className="plum-recent-chat-title">{chat.title || 'Ohne Titel'}</span>
              <time dateTime={chat.updatedAt}>{formatRelativeTime(chat.updatedAt, now)}</time>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
