import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Hash, Loader2, OctagonX, Sparkles } from 'lucide-react';
import type { AssistantAgent, SwarmAgentHealth } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { HEALTH_LABEL, useSwarmDirectory } from '@/components/assistant/SwarmDirectoryPanel';

interface SwarmRoom {
  id: string;
  name: string;
  alias: string | null;
  agents: AssistantAgent[];
}

/** Dot per directory state; none of them pulses, the hub reports presence, not work. */
const DOT: Record<SwarmAgentHealth, string> = {
  online: 'online',
  idle: 'live-idle',
  offline: 'offline',
  stopped: 'error',
  unknown: 'idle',
};

/**
 * Swarm mode of the sidebar: Brian, rooms and agents with status. Reads the same
 * query keys as SwarmPage, so both share one cache and refresh together.
 */
export function SwarmSidebarSection({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const account = useAuthStore((state) => state.user?.id);
  const cache = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const activeRoom =
    location.pathname === '/swarm' ? new URLSearchParams(location.search).get('room') : null;
  const status = useQuery({
    queryKey: ['assistant', 'matrix-status', account],
    queryFn: async () =>
      (
        await api.get<{
          data: { configured: boolean; connected: boolean; userId?: string; epoch?: string };
        }>('/api/assistant/matrix/status')
      ).data.data,
  });
  const rooms = useQuery({
    queryKey: ['assistant', 'matrix-rooms', account, status.data?.epoch],
    queryFn: async () =>
      (await api.get<{ data: SwarmRoom[] }>('/api/assistant/matrix/rooms')).data.data,
    enabled: !!status.data?.connected,
  });
  // Agents come from the server-side directory, so they show even without the Matrix account.
  const directory = useSwarmDirectory();
  const agents = (directory.data?.agents ?? []).filter((agent) => agent.kind === 'hub');
  const openBrian = useMutation({
    mutationFn: async () =>
      (await api.post<{ data: { roomId: string } }>('/api/assistant/matrix/brian/conversation'))
        .data.data,
    onSuccess: ({ roomId }) => {
      void cache.invalidateQueries({ queryKey: ['assistant', 'matrix-rooms'] });
      onNavigate();
      navigate(`/swarm?room=${encodeURIComponent(roomId)}`);
    },
  });
  const row = cn(
    'sidebar-nav-item flex items-center gap-2.5 px-3 py-2 text-xs min-w-0',
    collapsed && 'is-collapsed justify-center px-2'
  );

  const agentList = agents.length > 0 && (
    <section aria-label="Agenten" className="sidebar-session-group">
      {!collapsed && <div className="sidebar-section-label px-3 py-1.5">Agenten</div>}
      {agents.map((agent) => (
        <Link
          key={agent.id}
          to="/swarm"
          onClick={onNavigate}
          className={cn(row, 'sidebar-swarm-agent')}
          title={`${agent.name} · ${HEALTH_LABEL[agent.health]} · ${agent.healthReason}`}
        >
          <Bot className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
              <span className="truncate text-[11px] text-muted-foreground">
                {HEALTH_LABEL[agent.health]}
              </span>
            </>
          )}
          <span
            className={cn('sidebar-session-run-dot', `is-${DOT[agent.health]}`, 'is-visible')}
            aria-hidden="true"
          />
        </Link>
      ))}
    </section>
  );

  if (!status.data?.connected) {
    return (
      <div className="sidebar-mode-empty">
        {!collapsed && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {status.isLoading
              ? 'Schwarm wird geladen …'
              : 'Schwarm-Konto nicht verbunden; Räume und Befehle fehlen.'}
          </p>
        )}
        <Link to="/swarm" onClick={onNavigate} className={row} title="Schwarm öffnen">
          <Bot className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">Schwarm öffnen</span>}
        </Link>
        {agentList}
      </div>
    );
  }

  return (
    <div className="sidebar-swarm-section">
      <button
        type="button"
        className={row}
        disabled={openBrian.isPending}
        onClick={() => openBrian.mutate()}
        title="Mit Brian sprechen"
        aria-label="Mit Brian sprechen"
      >
        {openBrian.isPending ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4 shrink-0" />
        )}
        {!collapsed && <span className="truncate">Brian</span>}
      </button>
      {openBrian.isError && !collapsed && (
        <p role="status" className="px-3 text-xs text-destructive">
          {openBrian.error.message}
        </p>
      )}

      <nav aria-label="Räume" className="sidebar-session-group">
        {!collapsed && <div className="sidebar-section-label px-3 py-1.5">Räume</div>}
        {(rooms.data ?? []).map((room) => (
          <Link
            key={room.id}
            to={`/swarm?room=${encodeURIComponent(room.id)}`}
            onClick={onNavigate}
            title={room.name}
            aria-current={activeRoom === room.id ? 'page' : undefined}
            className={cn(row, activeRoom === room.id && 'is-active')}
          >
            <Hash className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{room.name}</span>}
          </Link>
        ))}
        {rooms.isError && !collapsed && (
          <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
            Räume konnten nicht geladen werden.
          </p>
        )}
      </nav>

      {agentList}

      <Link
        to="/swarm?prepare=stop"
        onClick={onNavigate}
        className={cn('sidebar-swarm-emergency', collapsed && 'is-collapsed')}
        title="Not-Aus: bereitet den Schwarm-Stopp im Schwarm-Nachrichtenfeld vor"
        aria-label="Not-Aus"
      >
        <OctagonX className="h-4 w-4 shrink-0" />
        {!collapsed && <span>Not-Aus</span>}
      </Link>
    </div>
  );
}
