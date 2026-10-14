import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Library, MessageCircle, SlidersHorizontal } from 'lucide-react';
import type { AssistantResource, Session } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';

const libraries = [
  ['profiles', 'Profile'],
  ['projects', 'Projekte'],
  ['sources', 'Quellen'],
  ['artifacts', 'Ergebnisse'],
  ['memory', 'Gedächtnis'],
  ['routines', 'Routinen'],
  ['collections', 'Sammlungen'],
  ['meetings', 'Besprechungen'],
  ['courses', 'Kurse'],
  ['agents', 'Agenten'],
  ['event-subscriptions', 'Ereignisse'],
];

const DAY_MS = 86_400_000;
const HISTORY_GROUPS = ['Heute', 'Gestern', 'Älter'] as const;
type HistoryGroup = (typeof HISTORY_GROUPS)[number];

type HistoryEntry =
  | { kind: 'model'; id: string; title: string; time: string }
  | { kind: 'session'; id: string; title: string; time: string; session: Session };

function historyGroup(time: string, todayStart: number): HistoryGroup {
  const ms = Date.parse(time);
  if (Number.isFinite(ms) && ms >= todayStart) return 'Heute';
  if (Number.isFinite(ms) && ms >= todayStart - DAY_MS) return 'Gestern';
  return 'Älter';
}

/**
 * Chat mode of the sidebar: model chats and earlier agent chats in one history,
 * grouped Heute / Gestern / Älter, then the library. Agent chats keep their
 * session row (run state, unread count, overflow menu) via `renderSession`.
 */
export function ChatSidebarResources({
  search,
  collapsed,
  onNavigate,
  chatSessions,
  renderSession,
}: {
  search: string;
  collapsed: boolean;
  onNavigate: () => void;
  chatSessions: Session[];
  renderSession: (session: Session) => ReactNode;
}) {
  const owner = useAuthStore((state) => state.user?.id);
  const chats = useQuery({
    queryKey: ['assistant', 'api-chats', owner],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/api-chats')).data.data,
    refetchInterval: 30000,
  });
  const query = search.trim().toLocaleLowerCase();
  const entries: HistoryEntry[] = [
    ...(chats.data ?? []).map(
      (chat): HistoryEntry => ({
        kind: 'model',
        id: chat.id,
        title: chat.title,
        time: chat.updatedAt,
      })
    ),
    ...chatSessions.map(
      (session): HistoryEntry => ({
        kind: 'session',
        id: session.id,
        title: session.name,
        time: String(session.updatedAt || session.createdAt || ''),
        session,
      })
    ),
  ]
    .filter((entry) => !query || entry.title.toLocaleLowerCase().includes(query))
    .sort((a, b) => b.time.localeCompare(a.time));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const groups = HISTORY_GROUPS.map((label) => ({
    label,
    items: entries.filter((entry) => historyGroup(entry.time, today.getTime()) === label),
  })).filter((group) => group.items.length > 0);
  const row = 'sidebar-nav-item flex items-center gap-3 px-3 py-2 text-xs min-w-0';

  return (
    <>
      <nav aria-label="Gesprächsverlauf" className="sidebar-chat-history">
        {groups.map((group) => (
          <div key={group.label} className="sidebar-session-group">
            {!collapsed && <div className="sidebar-section-label px-3 py-1.5">{group.label}</div>}
            {group.items.map((entry) =>
              entry.kind === 'session' ? (
                renderSession(entry.session)
              ) : (
                <NavLink
                  key={`model-${entry.id}`}
                  to={`/chat/model/${entry.id}`}
                  onClick={onNavigate}
                  title={entry.title}
                  className={({ isActive }) =>
                    cn(row, isActive && 'is-active', collapsed && 'justify-center')
                  }
                >
                  <MessageCircle className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{entry.title}</span>}
                </NavLink>
              )
            )}
          </div>
        ))}
        {!entries.length && !collapsed && (
          <p className="px-3 py-3 text-center text-xs text-muted-foreground/70">
            {query ? 'Keine passenden Gespräche.' : 'Deine Gespräche erscheinen hier.'}
          </p>
        )}
        {chats.isError && !collapsed && (
          <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
            Modellgespräche konnten nicht geladen werden.
          </p>
        )}
      </nav>
      <details className="sidebar-session-group" aria-label="Bibliothek">
        <summary
          className={cn(
            'sidebar-session-group-trigger flex items-center gap-2 cursor-pointer text-xs',
            collapsed && 'justify-center'
          )}
          title="Bibliothek"
        >
          <Library className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1">Bibliothek</span>
              <ChevronDown className="h-3 w-3" />
            </>
          )}
        </summary>
        <nav aria-label="Bibliothekseinträge">
          {libraries.map(([slug, label]) => (
            <NavLink
              key={slug}
              to={`/assistant/${slug}`}
              onClick={onNavigate}
              title={label}
              className={({ isActive }) =>
                cn(row, isActive && 'is-active', collapsed && 'justify-center')
              }
            >
              {collapsed ? <Library className="h-4 w-4" /> : label}
            </NavLink>
          ))}
          <NavLink
            to="/collaborate"
            onClick={onNavigate}
            className={row}
            title="Gemeinsame Dokumente"
          >
            {collapsed ? <Library className="h-4 w-4" /> : 'Gemeinsame Dokumente'}
          </NavLink>
        </nav>
      </details>
      <NavLink
        to="/chat/personalization"
        onClick={onNavigate}
        title="Personalisierung"
        className={({ isActive }) =>
          cn(row, isActive && 'is-active', collapsed && 'justify-center')
        }
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0" />
        {!collapsed && 'Personalisierung'}
      </NavLink>
    </>
  );
}
