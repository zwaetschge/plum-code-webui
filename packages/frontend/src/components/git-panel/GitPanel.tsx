import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  GitBranch,
  GitCommit as GitCommitIcon,
  History,
  FileCode,
  RefreshCw,
  ChevronDown,
  Loader2,
  Upload,
  Download,
  CloudDownload,
  Plus,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import { PushToGitHubDialog } from '@/components/github';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GitStatus } from './GitStatus';
import { GitCommit } from './GitCommit';
import { GitHistory } from './GitHistory';
import { GitDiffViewer } from './GitDiffViewer';
import type {
  ApiResponse,
  GitStatus as GitStatusType,
  GitBranch as GitBranchType,
} from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';

interface GitPanelProps {
  workingDirectory: string;
  className?: string;
}

type TabId = 'changes' | 'commit' | 'history';

export function GitPanel({ workingDirectory, className }: GitPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('changes');
  const [selectedDiff, setSelectedDiff] = useState<{ file: string; staged: boolean } | null>(null);
  const [showPushDialog, setShowPushDialog] = useState(false);
  const [showNewBranchDialog, setShowNewBranchDialog] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const queryClient = useQueryClient();

  // Fetch git status to check if this is a git repo
  const {
    data: status,
    isLoading: statusLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['git-status', workingDirectory],
    queryFn: async () => {
      const response = await api.get<ApiResponse<GitStatusType>>(
        `/api/git/status?path=${encodeURIComponent(workingDirectory)}`
      );
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return null;
    },
    retry: false,
  });

  // Fetch current branch
  const { data: branches } = useQuery({
    queryKey: ['git-branches', workingDirectory],
    queryFn: async () => {
      const response = await api.get<ApiResponse<GitBranchType[]>>(
        `/api/git/branches?path=${encodeURIComponent(workingDirectory)}`
      );
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return [];
    },
    enabled: !!status,
    retry: false,
  });

  const currentBranch = branches?.find((b) => b.isCurrent);

  // Fetch remotes
  const { data: remotes } = useQuery({
    queryKey: ['git-remotes', workingDirectory],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Array<{ name: string; url: string }>>>(
        `/api/git/remotes?path=${encodeURIComponent(workingDirectory)}`
      );
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return [];
    },
    enabled: !!status,
    retry: false,
  });

  // Fetch remote status (ahead/behind)
  const { data: remoteStatus } = useQuery({
    queryKey: ['git-remote-status', workingDirectory],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<{ branch: string; tracking: string | null; ahead: number; behind: number }>
      >(`/api/git/remote-status?path=${encodeURIComponent(workingDirectory)}`);
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return null;
    },
    enabled: !!status && (remotes?.length ?? 0) > 0,
    retry: false,
    refetchInterval: 60000, // Refresh every minute
  });

  // Pull mutation
  const pullMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<
        ApiResponse<{ files: string[]; insertions: number; deletions: number }>
      >('/api/git/pull', {
        path: workingDirectory,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['git-status', workingDirectory] });
        queryClient.invalidateQueries({ queryKey: ['git-log', workingDirectory] });
        queryClient.invalidateQueries({ queryKey: ['git-remote-status', workingDirectory] });
        toast({
          title: 'Pull erfolgreich',
          description: data.data
            ? `${data.data.files.length} Dateien aktualisiert`
            : 'Bereits aktuell',
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Pull fehlgeschlagen', description: error.message, variant: 'destructive' });
    },
  });

  // Fetch mutation
  const fetchMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<void>>('/api/git/fetch', {
        path: workingDirectory,
        prune: true,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['git-branches', workingDirectory] });
      queryClient.invalidateQueries({ queryKey: ['git-remote-status', workingDirectory] });
      toast({ title: 'Fetch erfolgreich', description: 'Remote-Refs aktualisiert' });
    },
    onError: (error: Error) => {
      toast({ title: 'Fetch fehlgeschlagen', description: error.message, variant: 'destructive' });
    },
  });

  // Create branch mutation
  const createBranchMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.post<ApiResponse<{ branch: string; checkedOut: boolean }>>(
        '/api/git/branch/create',
        {
          path: workingDirectory,
          name,
          checkout: true,
        }
      );
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        queryClient.invalidateQueries({ queryKey: ['git-branches', workingDirectory] });
        queryClient.invalidateQueries({ queryKey: ['git-status', workingDirectory] });
        setShowNewBranchDialog(false);
        setNewBranchName('');
        toast({
          title: 'Branch erstellt',
          description: `Gewechselt zu ${data.data.branch}`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Branch konnte nicht erstellt werden',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /**
   * Switch to an existing branch. The server refuses while the tree is dirty,
   * which surfaces here as a toast rather than silently dragging changes over.
   */
  const checkoutMutation = useMutation({
    mutationFn: async (branch: string) => {
      const response = await api.post<ApiResponse<{ branch: string }>>('/api/git/checkout', {
        path: workingDirectory,
        branch,
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['git-branches', workingDirectory] });
      queryClient.invalidateQueries({ queryKey: ['git-status', workingDirectory] });
      queryClient.invalidateQueries({ queryKey: ['git-log', workingDirectory] });
      toast({ title: 'Branch gewechselt', description: `Jetzt auf ${data.data?.branch ?? ''}` });
    },
    onError: (error: Error) => {
      toast({
        title: 'Checkout fehlgeschlagen',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleFileSelect = (file: string, staged: boolean) => {
    setSelectedDiff({ file, staged });
  };

  const handleCreateBranch = (e: React.FormEvent) => {
    e.preventDefault();
    if (newBranchName.trim()) {
      createBranchMutation.mutate(newBranchName.trim());
    }
  };

  if (statusLoading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-8 text-center', className)}>
        <GitBranch className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Not a git repository</p>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'changes', label: 'Changes', icon: <FileCode className="h-3.5 w-3.5" /> },
    { id: 'commit', label: 'Commit', icon: <GitCommitIcon className="h-3.5 w-3.5" /> },
    { id: 'history', label: 'History', icon: <History className="h-3.5 w-3.5" /> },
  ];

  const changesCount = status.staged.length + status.unstaged.length + status.untracked.length;

  return (
    <div className={cn('flex flex-col h-full bg-card', className)}>
      {/* Header */}
      <div className="shrink-0 p-2 border-b space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            {/* Listing branches without being able to switch made the panel
                read-only in practice; this is the actual checkout. */}
            <select
              value={currentBranch?.name || status.branch}
              onChange={(event) => {
                const next = event.target.value;
                if (next && next !== (currentBranch?.name || status.branch)) {
                  checkoutMutation.mutate(next);
                }
              }}
              disabled={checkoutMutation.isPending}
              className="max-w-[10rem] truncate rounded border border-border/60 bg-transparent px-1 py-0.5 text-sm font-medium"
              title="Switch branch"
            >
              {(branches ?? []).map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                </option>
              ))}
              {!branches?.some((b) => b.name === (currentBranch?.name || status.branch)) && (
                <option value={currentBranch?.name || status.branch}>
                  {currentBranch?.name || status.branch}
                </option>
              )}
            </select>
            <button
              type="button"
              onClick={() => pullMutation.mutate()}
              disabled={pullMutation.isPending}
              className="text-xs text-muted-foreground hover:text-foreground"
              title="Pull from remote"
            >
              {pullMutation.isPending ? '…' : 'Pull'}
            </button>
            {changesCount > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500">
                {changesCount}
              </span>
            )}
            {/* Ahead/Behind badges */}
            {remoteStatus?.tracking && (
              <div className="flex items-center gap-1">
                {remoteStatus.ahead > 0 && (
                  <span
                    className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500"
                    title={`${remoteStatus.ahead} commits ahead`}
                  >
                    <ArrowUp className="h-3 w-3" />
                    {remoteStatus.ahead}
                  </span>
                )}
                {remoteStatus.behind > 0 && (
                  <span
                    className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500"
                    title={`${remoteStatus.behind} commits behind`}
                  >
                    <ArrowDown className="h-3 w-3" />
                    {remoteStatus.behind}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* New Branch */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowNewBranchDialog(true)}
              title="New Branch"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            {/* Pull */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => pullMutation.mutate()}
              disabled={pullMutation.isPending || !remotes?.length}
              title="Pull"
            >
              {pullMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </Button>
            {/* Fetch */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => fetchMutation.mutate()}
              disabled={fetchMutation.isPending || !remotes?.length}
              title="Fetch"
            >
              {fetchMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CloudDownload className="h-3.5 w-3.5" />
              )}
            </Button>
            {/* Push */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowPushDialog(true)}
              title="Push to GitHub"
            >
              <Upload className="h-3.5 w-3.5" />
            </Button>
            {/* Refresh */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => refetch()}
              disabled={isRefetching}
              title="Refresh"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isRefetching && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSelectedDiff(null);
              }}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors',
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-muted-foreground'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {selectedDiff ? (
          <div className="h-full flex flex-col">
            <button
              onClick={() => setSelectedDiff(null)}
              className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className="h-3 w-3 rotate-90" />
              Back to {activeTab}
            </button>
            <div className="flex-1 min-h-0">
              <GitDiffViewer
                workingDirectory={workingDirectory}
                file={selectedDiff.file}
                staged={selectedDiff.staged}
              />
            </div>
          </div>
        ) : (
          <div className="h-full overflow-auto p-2">
            {activeTab === 'changes' && (
              <GitStatus workingDirectory={workingDirectory} onFileSelect={handleFileSelect} />
            )}
            {activeTab === 'commit' && <GitCommit workingDirectory={workingDirectory} />}
            {activeTab === 'history' && <GitHistory workingDirectory={workingDirectory} />}
          </div>
        )}
      </div>

      <PushToGitHubDialog
        open={showPushDialog}
        onOpenChange={setShowPushDialog}
        workingDirectory={workingDirectory}
        currentBranch={currentBranch?.name || status.branch}
        remotes={remotes}
        onPushed={() => {
          queryClient.invalidateQueries({ queryKey: ['git-status', workingDirectory] });
        }}
      />

      {/* New Branch Dialog */}
      <Dialog open={showNewBranchDialog} onOpenChange={setShowNewBranchDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create New Branch
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateBranch} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="branch-name" className="text-sm font-medium">
                Branch Name
              </label>
              <Input
                id="branch-name"
                placeholder="feature/my-new-feature"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Based on: {currentBranch?.name || status.branch}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowNewBranchDialog(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newBranchName.trim() || createBranchMutation.isPending}
              >
                {createBranchMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create & Switch'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default GitPanel;
