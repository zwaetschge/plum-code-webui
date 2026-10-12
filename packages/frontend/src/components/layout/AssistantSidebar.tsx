import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  MessageCircle,
  Plus,
  Search,
  CheckCheck,
  Code2,
  Network,
  FolderOpen,
  Library,
  SlidersHorizontal,
  Settings,
  ChevronDown,
  Home,
} from 'lucide-react';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionMenu } from './SessionMenuContext';
import { ProviderLogo } from '@/components/branding/ProviderLogo';

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
export function AssistantSidebar({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const owner = useAuthStore((state) => state.user?.id);
  const user = useAuthStore((state) => state.user);
  const sessions = useSessionStore((state) => state.sessions);
  const location = useLocation();
  const menu = useSessionMenu();
  const [search, setSearch] = useState('');
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
  const history = [
    ...sessions
      .filter((s) => s.surface === 'chat')
      .map((s) => ({
        id: s.id,
        title: s.name,
        path: `/chat/session/${s.id}`,
        time: String(s.updatedAt || s.createdAt || ''),
      })),
    ...(chats.data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      path: `/chat/model/${c.id}`,
      time: c.updatedAt,
    })),
  ]
    .filter((c) => c.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => b.time.localeCompare(a.time));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = today.getTime() - 6 * 86400000;
  const groups = ['Heute', 'Letzte 7 Tage', 'Älter']
    .map((label) => ({
      label,
      items: history.filter((chat) => {
        const time = Date.parse(chat.time);
        const group =
          time >= today.getTime() ? 'Heute' : time >= weekStart ? 'Letzte 7 Tage' : 'Älter';
        return group === label;
      }),
    }))
    .filter((group) => group.items.length);
  const sessionRoute = /^\/(?:chat\/session|session)\//.test(location.pathname);
  const [toolsOpen, setToolsOpen] = useState(mobile && menu.view === 'tools');
  useEffect(() => {
    const expand = () => setToolsOpen(true);
    window.addEventListener('plum:expand-navigation', expand);
    return () => window.removeEventListener('plum:expand-navigation', expand);
  }, []);
  useEffect(() => {
    if (mobile) setToolsOpen(menu.view === 'tools');
  }, [menu.view, mobile]);
  return (
    <aside className="assistant-sidebar" aria-label="Plum Navigation">
      <NavLink to="/" onClick={onNavigate} className="assistant-brand">
        <ProviderLogo provider="plum" className="h-8 w-8" />
        <span>Plum</span>
      </NavLink>
      <nav aria-label="Arbeitsbereiche" className="assistant-primary-nav">
        {[
          ['/chat', 'Chat', MessageCircle],
          ['/tasks', 'Task', CheckCheck],
          ['/code', 'Code', Code2],
        ].map(([to, label, Icon]) => {
          const Symbol = Icon as typeof MessageCircle;
          return (
            <NavLink
              key={String(to)}
              to={String(to)}
              aria-label={`Plum ${label}`}
              onClick={onNavigate}
              className={({ isActive }) => `assistant-nav-link ${isActive ? 'is-active' : ''}`}
            >
              <Symbol size={14} />
              {String(label)}
            </NavLink>
          );
        })}
      </nav>
      <label className="assistant-history-search">
        <Search size={15} />
        <span className="sr-only">Gespräche suchen</span>
        <input
          type="search"
          placeholder="Gespräche suchen"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <NavLink to="/chat" end onClick={onNavigate} className="assistant-new-chat">
        <Plus size={17} />
        Neuer Chat
      </NavLink>
      <div className="assistant-sidebar-content">
        <nav aria-label="Bibliothek" className="space-y-1">
          <NavLink to="/swarm" onClick={onNavigate} className="assistant-nav-link">
            <Network size={16} />
            Schwarm
          </NavLink>
          <NavLink to="/" end onClick={onNavigate} className="assistant-nav-link">
            <Home size={16} />
            Übersicht
          </NavLink>
          <NavLink to="/assistant/projects" onClick={onNavigate} className="assistant-nav-link">
            <FolderOpen size={16} />
            Projekte
          </NavLink>
          <details className="assistant-library">
            <summary>
              <Library size={16} />
              Bibliothek
              <ChevronDown size={14} className="ml-auto" />
            </summary>
            <div>
              {libraries.map(([slug, label]) => (
                <NavLink
                  key={slug}
                  to={`/assistant/${slug}`}
                  onClick={onNavigate}
                  className="assistant-nav-link"
                >
                  {label}
                </NavLink>
              ))}
              <NavLink to="/collaborate" onClick={onNavigate} className="assistant-nav-link">
                Gemeinsame Dokumente
              </NavLink>
            </div>
          </details>
        </nav>
        {!!projects.data?.length && (
          <nav aria-label="Deine Projekte" className="assistant-projects">
            <div className="assistant-history-title">Projekte</div>
            {projects.data.slice(0, 5).map((project) => (
              <NavLink
                key={project.id}
                to={`/assistant/projects?resource=${project.id}`}
                onClick={onNavigate}
                className="assistant-history-link"
                title={project.title}
              >
                <FolderOpen size={14} />
                <span>{project.title}</span>
              </NavLink>
            ))}
          </nav>
        )}
        <nav aria-label="Gesprächsverlauf" className="assistant-history">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="assistant-history-title">{group.label}</div>
              {group.items.map((c) => (
                <NavLink
                  key={c.path}
                  to={c.path}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `assistant-history-link ${isActive ? 'is-active' : ''}`
                  }
                  title={c.title}
                >
                  {c.title}
                </NavLink>
              ))}
            </div>
          ))}
          {!history.length && (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {search ? 'Keine passenden Gespräche.' : 'Deine Gespräche erscheinen hier.'}
            </p>
          )}
          {chats.isError && (
            <p role="status" className="px-3 text-xs text-muted-foreground">
              Modellgespräche konnten nicht geladen werden.
            </p>
          )}
        </nav>
        {sessionRoute && (
          <details
            className="assistant-library mt-4"
            open={toolsOpen}
            onToggle={(e) => setToolsOpen(e.currentTarget.open)}
          >
            <summary>
              Gesprächswerkzeuge
              <ChevronDown size={14} className="ml-auto" />
            </summary>
            <div ref={mobile ? menu.setMobileTarget : menu.setDesktopTarget} />
          </details>
        )}
      </div>
      <NavLink to="/chat/personalization" onClick={onNavigate} className="assistant-nav-link">
        <SlidersHorizontal size={16} />
        Personalisierung
      </NavLink>
      <NavLink
        to="/settings"
        onClick={onNavigate}
        className="assistant-account"
        aria-label="Einstellungen"
      >
        <span className="assistant-avatar">
          {String(user?.name || user?.email || 'P')
            .slice(0, 1)
            .toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {user?.name || user?.email || 'Einstellungen'}
        </span>
        <Settings size={17} />
      </NavLink>
    </aside>
  );
}
