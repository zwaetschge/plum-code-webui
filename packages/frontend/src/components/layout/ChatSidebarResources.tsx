import { useState, type ReactNode } from 'react';
import { ModelChatMenu, ModelChatRename, ProjectMenu } from './ModelChatMenu';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isPlainClick, rememberLibraryOrigin, transitionPane } from '@/lib/motion/navigation';
import { LIBRARY_PARAM, LIBRARY_SECTIONS, libraryHref } from './libraryNav';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  Folder,
  FolderOpen,
  ChevronDown,
  Library,
  MessageCircle,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import type { AssistantResource, Session } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';

const DAY_MS = 86_400_000;
const HISTORY_GROUPS = ['Heute', 'Gestern', 'Älter'] as const;
type HistoryGroup = (typeof HISTORY_GROUPS)[number];

type HistoryEntry =
  | { kind: 'model'; id: string; title: string; time: string; chat: AssistantResource }
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
 * As in ChatGPT, project chats live in their project folder, not in the
 * history; a search still finds them.
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
  const location = useLocation();
  const navigate = useNavigate();
  const openLibrary = new URLSearchParams(location.search).get(LIBRARY_PARAM);
  const chats = useQuery({
    queryKey: ['assistant', 'api-chats', owner],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/api-chats')).data.data,
    refetchInterval: 30000,
  });
  const projects = useQuery({
    queryKey: ['assistant', 'resources', 'projects', owner],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/projects?limit=100')).data.data,
  });
  const [renaming, setRenaming] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const projectChats = (projectId: string) =>
    (chats.data ?? [])
      .filter((chat) => chat.body.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const entries: HistoryEntry[] = [
    ...(chats.data ?? [])
      .filter((chat) => query || !chat.body.projectId)
      .map(
        (chat): HistoryEntry => ({
          kind: 'model',
          id: chat.id,
          title: chat.title,
          time: chat.updatedAt,
          chat,
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
  const modelRow = (chat: AssistantResource, nested = false) => (
    <div
      key={`model-${chat.id}`}
      className={cn(
        'sidebar-session-row group/session relative flex items-center',
        nested && 'sidebar-project-chat'
      )}
    >
      {renaming === chat.id && !collapsed ? (
        <ModelChatRename chat={chat} onDone={() => setRenaming('')} />
      ) : (
        <>
          <NavLink
            to={`/chat/model/${chat.id}`}
            onClick={(event) => {
              // Between model chats the pane swaps through a view transition.
              const to = `/chat/model/${chat.id}`;
              if (
                isPlainClick(event) &&
                location.pathname !== to &&
                transitionPane(() => navigate(to))
              )
                event.preventDefault();
              onNavigate();
            }}
            title={chat.title}
            className={({ isActive }) =>
              cn(row, isActive && 'is-active', collapsed && 'justify-center')
            }
          >
            <MessageCircle className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{chat.title}</span>}
          </NavLink>
          {!collapsed && (
            <ModelChatMenu
              chat={chat}
              projects={projects.data ?? []}
              onRename={() => setRenaming(chat.id)}
            />
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      <nav aria-label="Chat-Arbeitsbereiche">
        <NavLink
          to="/chat/history"
          onClick={onNavigate}
          className={({ isActive }) => cn(row, isActive && 'is-active')}
          title="Verlauf verwalten"
        >
          <MessageCircle className="h-4 w-4 shrink-0" />
          {!collapsed && 'Verlauf verwalten'}
        </NavLink>
          <NavLink to="/assistant/knowledge" onClick={onNavigate} className={({ isActive }) => cn(row, isActive && 'is-active')} title="Wissen"><Library className="h-4 w-4 shrink-0" />{!collapsed && 'Wissen'}</NavLink>
          <NavLink to="/assistant/schedules" onClick={onNavigate} className={({ isActive }) => cn(row, isActive && 'is-active')} title="Geplant"><MessageCircle className="h-4 w-4 shrink-0" />{!collapsed && 'Geplant'}</NavLink>
        <NavLink
          to="/chat/assistants"
          onClick={onNavigate}
          className={({ isActive }) => cn(row, isActive && 'is-active')}
          title="Assistenten (Gems / Custom GPTs)"
        >
          <Bot className="h-4 w-4 shrink-0" />
          {!collapsed && 'Assistenten'}
        </NavLink>
        <NavLink
          to="/chat/projects"
          onClick={onNavigate}
          className={({ isActive }) => cn(row, isActive && 'is-active')}
          title="Projekte"
        >
          <FolderOpen className="h-4 w-4 shrink-0" />
          {!collapsed && 'Projekte'}
        </NavLink>
      </nav>
      {!collapsed && !!projects.data?.length && (
        <nav aria-label="Projektordner" className="sidebar-projects">
          {projects.data.map((project) => {
            const items = projectChats(project.id);
            const to = `/chat/projects/${project.id}`;
            const inside = items.some((chat) => location.pathname === `/chat/model/${chat.id}`);
            return (
              <details key={project.id} className="sidebar-project" open={inside || undefined}>
                <summary className={cn(row, location.pathname === to && 'is-active')}>
                  <Folder className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{project.title}</span>
                  {!!items.length && (
                    <ChevronDown className="sidebar-library-chevron h-3 w-3 shrink-0" />
                  )}
                  <ProjectMenu project={project} chatCount={items.length} />
                </summary>
                <Link
                  to={to}
                  onClick={onNavigate}
                  className={cn(row, 'sidebar-project-chat text-muted-foreground')}
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Projekt öffnen</span>
                </Link>
                {items.map((chat) => modelRow(chat, true))}
              </details>
            );
          })}
        </nav>
      )}
      <nav aria-label="Gesprächsverlauf" className="sidebar-chat-history">
        {groups.map((group) => (
          <div key={group.label} className="sidebar-session-group">
            {!collapsed && <div className="sidebar-section-label px-3 py-1.5">{group.label}</div>}
            {group.items.map((entry) =>
              entry.kind === 'session' ? renderSession(entry.session) : modelRow(entry.chat)
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
      <details className="sidebar-session-group sidebar-library" aria-label="Bibliothek">
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
              <ChevronDown className="sidebar-library-chevron h-3 w-3" />
            </>
          )}
        </summary>
        {/* Icon tiles instead of a long text list; one column when the rail is collapsed. */}
        <nav
          aria-label="Bibliothekseinträge"
          className={cn('sidebar-library-grid', collapsed && 'is-collapsed')}
        >
          {LIBRARY_SECTIONS.map(({ slug, label, icon: Icon }) => (
            // Opens the library panel over the current chat instead of a page.
            <Link
              key={slug}
              to={libraryHref(location.pathname, location.search, slug)}
              onClick={(event) => {
                rememberLibraryOrigin(event.currentTarget);
                onNavigate();
              }}
              title={label}
              aria-label={label}
              className={cn('sidebar-library-tile', openLibrary === slug && 'is-active')}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          ))}
          <NavLink
            to="/collaborate"
            onClick={onNavigate}
            title="Gemeinsame Dokumente"
            aria-label="Gemeinsame Dokumente"
            className={({ isActive }) => cn('sidebar-library-tile', isActive && 'is-active')}
          >
            <Users className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Dokumente</span>}
          </NavLink>
        </nav>
      </details>
      <NavLink
        to="/chat/personalization"
        onClick={onNavigate}
        title="Chat-Einstellungen"
        className={({ isActive }) =>
          cn(row, isActive && 'is-active', collapsed && 'justify-center')
        }
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0" />
        {!collapsed && 'Chat-Einstellungen'}
      </NavLink>
    </>
  );
}
