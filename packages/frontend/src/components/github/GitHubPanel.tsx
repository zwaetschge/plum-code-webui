import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  GitPullRequest,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Tag,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '@plum-code-webui/shared';

interface GitHubPanelProps {
  workingDirectory: string;
  className?: string;
}

type Tab = 'pulls' | 'runs' | 'issues' | 'releases';

interface PullRequest {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  author: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  statusCheckRollup?: { state: string; total: number; failed: number };
}

interface WorkflowRun {
  databaseId: number;
  name: string;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
  url: string;
  createdAt: string;
}

interface Issue {
  number: number;
  title: string;
  state: string;
  author: string;
  url: string;
  labels: string[];
}

interface Release {
  tagName: string;
  name: string;
  isDraft: boolean;
  isLatest: boolean;
  isPrerelease: boolean;
  publishedAt: string | null;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'pulls', label: 'Pull requests' },
  { key: 'runs', label: 'CI' },
  { key: 'issues', label: 'Issues' },
  { key: 'releases', label: 'Releases' },
];

function RunIcon({ run }: { run: WorkflowRun }) {
  if (run.status !== 'completed') {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-500" />;
  }
  if (run.conclusion === 'success') {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />;
  }
  return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
}

function CheckBadge({ rollup }: { rollup?: PullRequest['statusCheckRollup'] }) {
  if (!rollup) return null;
  const tone =
    rollup.state === 'SUCCESS'
      ? 'text-emerald-500'
      : rollup.state === 'FAILURE'
        ? 'text-destructive'
        : 'text-amber-500';
  return (
    <span className={cn('shrink-0 text-[10px] font-medium', tone)}>
      {rollup.state === 'FAILURE' ? `${rollup.failed}/${rollup.total} failed` : rollup.state}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-1 py-6 text-center text-[11px] text-muted-foreground">{text}</div>;
}

export function GitHubPanel({ workingDirectory, className }: GitHubPanelProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('pulls');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const dirParam = encodeURIComponent(workingDirectory || '');
  const enabled = Boolean(workingDirectory);

  const repo = useQuery({
    queryKey: ['github-repo', workingDirectory],
    enabled,
    retry: false,
    queryFn: async () => {
      const res = await api.get<
        ApiResponse<{ nameWithOwner: string; defaultBranchRef: { name: string } | null }>
      >(`/api/github/cli/repo?workingDirectory=${dirParam}`);
      return res.data.data;
    },
  });

  const list = useQuery({
    queryKey: ['github-list', tab, workingDirectory],
    enabled: enabled && !repo.isError,
    retry: false,
    queryFn: async () => {
      const path =
        tab === 'pulls'
          ? 'pulls'
          : tab === 'runs'
            ? 'runs'
            : tab === 'issues'
              ? 'issues'
              : 'releases';
      const res = await api.get<ApiResponse<unknown[]>>(
        `/api/github/${path}?workingDirectory=${dirParam}&limit=20`
      );
      return res.data.data || [];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['github-list', tab, workingDirectory] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const path = tab === 'issues' ? 'issues' : 'pulls';
      const res = await api.post<ApiResponse<{ url: string }>>(`/api/github/${path}`, {
        workingDirectory,
        title: title.trim(),
        body: body.trim() || undefined,
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      setCreating(false);
      setTitle('');
      setBody('');
      refresh();
      toast({
        title: tab === 'issues' ? 'Issue created' : 'Pull request created',
        description: data?.url,
      });
    },
    onError: (error) => {
      toast({
        title: 'Create failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async (number: number) => {
      await api.post(`/api/github/pulls/${number}/merge`, { workingDirectory, method: 'squash' });
    },
    onSuccess: () => {
      refresh();
      toast({ title: 'Pull request merged' });
    },
    onError: (error) => {
      toast({
        title: 'Merge failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const rerunMutation = useMutation({
    mutationFn: async (runId: number) => {
      await api.post(`/api/github/runs/${runId}/rerun`, { workingDirectory, failedOnly: true });
    },
    onSuccess: () => {
      refresh();
      toast({ title: 'Re-run requested' });
    },
    onError: (error) => {
      toast({
        title: 'Re-run failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const busy = createMutation.isPending || mergeMutation.isPending || rerunMutation.isPending;
  const items = (list.data || []) as unknown[];

  return (
    <div className={cn('flex flex-col gap-2 overflow-hidden p-2', className)}>
      <div className="flex items-center gap-2">
        <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {repo.isLoading
            ? 'Loading…'
            : repo.isError
              ? 'No GitHub repository here'
              : repo.data?.nameWithOwner || '—'}
        </div>
        {(tab === 'pulls' || tab === 'issues') && !repo.isError && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={busy}
            onClick={() => setCreating((open) => !open)}
            title={tab === 'issues' ? 'New issue' : 'New pull request'}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={list.isFetching}
          onClick={refresh}
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', list.isFetching && 'animate-spin')} />
        </Button>
      </div>

      <div className="flex shrink-0 gap-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'rounded px-2 py-1 text-[11px] transition-colors',
              tab === key
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {creating && (
        <div className="flex shrink-0 flex-col gap-1.5 rounded-md border border-border/45 p-2">
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title"
            className="h-7 text-[11px]"
          />
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Description (optional)"
            rows={3}
            className="text-[11px]"
          />
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={!title.trim() || busy}
              onClick={() => createMutation.mutate()}
            >
              Create
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-1 overflow-auto">
        {list.isLoading && <Empty text="Loading…" />}
        {list.isError && (
          <div className="flex items-start gap-1.5 px-1 py-4 text-[11px] text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{list.error instanceof Error ? list.error.message : 'Failed to load'}</span>
          </div>
        )}
        {!list.isLoading && !list.isError && items.length === 0 && (
          <Empty text={`No ${TABS.find((t) => t.key === tab)?.label.toLowerCase()}`} />
        )}

        {tab === 'pulls' &&
          (items as PullRequest[]).map((pr) => (
            <div
              key={pr.number}
              className="flex items-center gap-2 rounded-md border border-border/45 px-2 py-1.5"
            >
              <GitPullRequest
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  pr.isDraft ? 'text-muted-foreground' : 'text-emerald-500'
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  #{pr.number} {pr.title}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {pr.author} · {pr.headRefName} → {pr.baseRefName}
                </div>
              </div>
              <CheckBadge rollup={pr.statusCheckRollup} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px]"
                disabled={busy || pr.isDraft}
                onClick={() => mergeMutation.mutate(pr.number)}
              >
                Merge
              </Button>
              <a href={pr.url} target="_blank" rel="noreferrer" title="Open on GitHub">
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </a>
            </div>
          ))}

        {tab === 'runs' &&
          (items as WorkflowRun[]).map((run) => (
            <div
              key={run.databaseId}
              className="flex items-center gap-2 rounded-md border border-border/45 px-2 py-1.5"
            >
              <RunIcon run={run} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  {run.displayTitle}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {run.name} · {run.headBranch}
                </div>
              </div>
              {run.status === 'completed' && run.conclusion !== 'success' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={busy}
                  onClick={() => rerunMutation.mutate(run.databaseId)}
                  title="Re-run failed jobs"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
              <a href={run.url} target="_blank" rel="noreferrer" title="Open on GitHub">
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </a>
            </div>
          ))}

        {tab === 'issues' &&
          (items as Issue[]).map((issue) => (
            <div
              key={issue.number}
              className="flex items-center gap-2 rounded-md border border-border/45 px-2 py-1.5"
            >
              <CircleDot className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  #{issue.number} {issue.title}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {[issue.author, ...issue.labels].filter(Boolean).join(' · ')}
                </div>
              </div>
              <a href={issue.url} target="_blank" rel="noreferrer" title="Open on GitHub">
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </a>
            </div>
          ))}

        {tab === 'releases' &&
          (items as Release[]).map((release) => (
            <div
              key={release.tagName}
              className="flex items-center gap-2 rounded-md border border-border/45 px-2 py-1.5"
            >
              <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  {release.name || release.tagName}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {[
                    release.tagName,
                    release.isLatest ? 'latest' : null,
                    release.isDraft ? 'draft' : null,
                    release.isPrerelease ? 'pre-release' : null,
                    release.publishedAt?.slice(0, 10),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
