import { GitBranch, GitPullRequest, History } from 'lucide-react';
import type { ReactElement } from 'react';
import { GitPanel } from '@/components/git-panel';
import { GitHubPanel } from '@/components/github/GitHubPanel';
import { CheckpointsPanel } from '@/components/session/CheckpointsPanel';
import { cn } from '@/lib/utils';

export type VersionsTab = 'git' | 'github' | 'checkpoints';

const TABS: Array<{ id: VersionsTab; label: string; icon: ReactElement }> = [
  { id: 'git', label: 'Git', icon: <GitBranch className="h-3.5 w-3.5" /> },
  { id: 'github', label: 'GitHub', icon: <GitPullRequest className="h-3.5 w-3.5" /> },
  { id: 'checkpoints', label: 'Checkpoints', icon: <History className="h-3.5 w-3.5" /> },
];

/** Versionen: Git, GitHub and Checkpoints of one code session as tabs. */
export function VersionsPanel({
  sessionId,
  workingDirectory,
  tab,
  onTabChange,
  uncommittedCount = 0,
  className,
}: {
  sessionId: string;
  workingDirectory: string;
  tab: VersionsTab;
  onTabChange: (tab: VersionsTab) => void;
  uncommittedCount?: number;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div
        role="tablist"
        aria-label="Versionen"
        className="flex shrink-0 gap-1 border-b border-border/60 bg-muted/30 p-1.5"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => onTabChange(entry.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
              tab === entry.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
            )}
          >
            {entry.icon}
            {entry.label}
            {entry.id === 'git' && uncommittedCount > 0 && (
              <span className="panel-badge" title={`${uncommittedCount} ungesicherte Änderungen`}>
                {uncommittedCount}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-hidden">
        {tab === 'git' ? (
          <GitPanel workingDirectory={workingDirectory} className="h-full" />
        ) : tab === 'github' ? (
          <GitHubPanel workingDirectory={workingDirectory} className="h-full" />
        ) : (
          <CheckpointsPanel sessionId={sessionId} className="h-full" />
        )}
      </div>
    </div>
  );
}
