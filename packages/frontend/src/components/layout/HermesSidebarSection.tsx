import { Link, useLocation } from 'react-router-dom';
import { Network } from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentDot, agentVersion, useHermesStatus } from '@/pages/HermesPage';

/**
 * Hermes mode of the sidebar: one row per Schwarm agent with its state, and
 * the Schwarm's rooms as a quiet last link. Shares the page's query, so both
 * refresh together.
 */
export function HermesSidebarSection({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const location = useLocation();
  const status = useHermesStatus();
  const agents = (status.data?.agents ?? []).filter(
    (agent) => agent.group === 'swarm' || agent.group === 'watch'
  );
  const updates = agents.filter(
    (agent) => agent.update?.kind === 'hermes' && agent.update.available
  ).length;

  return (
    <div className="space-y-0.5 px-2 py-1">
      {agents.map((agent) => (
        <Link
          key={agent.id}
          to="/hermes"
          onClick={onNavigate}
          title={collapsed ? agent.name : undefined}
          className={cn(
            'sidebar-session-row flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
            location.pathname === '/hermes' && agent.id === 'brian' && 'is-active'
          )}
        >
          {/* The refined sidebar hides idle session dots; a ready agent keeps a neutral one. */}
          <span
            className={cn(
              'sidebar-session-run-dot',
              agentDot(agent) === 'live-idle' ? 'is-ready' : `is-${agentDot(agent)}`,
              'is-visible'
            )}
            aria-hidden
          />
          {!collapsed && (
            <>
              <span className="truncate">{agent.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {agent.update?.running ? 'Update …' : (agentVersion(agent) ?? '')}
              </span>
            </>
          )}
        </Link>
      ))}
      {!collapsed && updates > 0 && status.data?.latestTag && (
        <Link to="/hermes" onClick={onNavigate} className="block px-2 py-1 text-xs text-primary">
          Hermes {status.data.latestTag} verfügbar
        </Link>
      )}
      {!collapsed && status.isError && (
        <p className="px-2 py-1 text-xs text-muted-foreground">Hermes nicht erreichbar</p>
      )}
      <Link
        to="/swarm"
        onClick={onNavigate}
        title={collapsed ? 'Räume und Aufträge' : undefined}
        className="mt-2 flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Network className="h-3.5 w-3.5" />
        {!collapsed && 'Räume und Aufträge'}
      </Link>
    </div>
  );
}
