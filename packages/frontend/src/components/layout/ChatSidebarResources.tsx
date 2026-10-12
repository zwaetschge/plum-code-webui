import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, FolderOpen, Library, MessageCircle } from 'lucide-react';
import type { AssistantResource } from '@plum-code-webui/shared';
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

/** Chat-specific content inside the same navigation shell used by Task and Code. */
export function ChatSidebarResources({
  search,
  collapsed,
  onNavigate,
}: {
  search: string;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const owner = useAuthStore((state) => state.user?.id);
  const chats = useQuery({
    queryKey: ['assistant', 'api-chats', owner],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/api-chats')).data.data,
    refetchInterval: 30000,
  });
  const projects = useQuery({
    queryKey: ['assistant', 'resources', 'projects', owner],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/projects')).data.data,
  });
  const history = [...(chats.data ?? [])]
    .filter((chat) => chat.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const row = 'sidebar-nav-item flex items-center gap-3 px-3 py-2 text-xs min-w-0';
  return (
    <>
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
      {!!projects.data?.length && (
        <nav aria-label="Deine Projekte" className="sidebar-session-group">
          {!collapsed && <div className="sidebar-section-label px-3 py-1.5">Projekte</div>}
          {projects.data.slice(0, 5).map((project) => (
            <NavLink
              key={project.id}
              to={`/assistant/projects?resource=${project.id}`}
              onClick={onNavigate}
              title={project.title}
              className={({ isActive }) =>
                cn(row, isActive && 'is-active', collapsed && 'justify-center')
              }
            >
              <FolderOpen className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{project.title}</span>}
            </NavLink>
          ))}
        </nav>
      )}
      <nav aria-label="Modellgespräche" className="sidebar-session-group">
        {!!history.length && !collapsed && (
          <div className="sidebar-section-label px-3 py-1.5">Modellgespräche</div>
        )}
        {history.map((chat) => (
          <NavLink
            key={chat.id}
            to={`/chat/model/${chat.id}`}
            onClick={onNavigate}
            title={chat.title}
            className={({ isActive }) =>
              cn(row, isActive && 'is-active', collapsed && 'justify-center')
            }
          >
            <MessageCircle className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{chat.title}</span>}
          </NavLink>
        ))}
        {chats.isError && !collapsed && (
          <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
            Modellgespräche konnten nicht geladen werden.
          </p>
        )}
      </nav>
    </>
  );
}
