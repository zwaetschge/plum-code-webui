import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitCommit as GitCommitIcon, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type { ApiResponse, GitStatus, GitCommitResult } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';

interface GitCommitProps {
  workingDirectory: string;
}

export function GitCommit({ workingDirectory }: GitCommitProps) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');

  // Fetch git status to check for staged changes
  const { data: status } = useQuery({
    queryKey: ['git-status', workingDirectory],
    queryFn: async () => {
      const response = await api.get<ApiResponse<GitStatus>>(
        `/api/git/status?path=${encodeURIComponent(workingDirectory)}`
      );
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return null;
    },
  });

  // Commit mutation
  const commitMutation = useMutation({
    mutationFn: async (commitMessage: string) => {
      const response = await api.post<ApiResponse<GitCommitResult>>('/api/git/commit', {
        path: workingDirectory,
        message: commitMessage,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        queryClient.invalidateQueries({ queryKey: ['git-status', workingDirectory] });
        queryClient.invalidateQueries({ queryKey: ['git-log', workingDirectory] });
        setMessage('');
        toast({
          title: 'Commit erstellt',
          description: `${data.data.summary.insertions} Einfügungen, ${data.data.summary.deletions} Löschungen`,
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Commit fehlgeschlagen', description: error.message, variant: 'destructive' });
    },
  });

  // Generate commit message mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<{ message: string }>>(
        '/api/git/generate-commit-message',
        {
          path: workingDirectory,
        }
      );
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        setMessage(data.data.message);
        toast({
          title: 'Nachricht erzeugt',
          description: 'KI-Commit-Nachricht eingefügt',
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Erzeugen fehlgeschlagen',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleCommit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && hasStagedChanges) {
      commitMutation.mutate(message.trim());
    }
  };

  const hasStagedChanges = status && status.staged.length > 0;

  return (
    <form onSubmit={handleCommit} className="space-y-3">
      {/* Commit message input */}
      <div className="relative">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={hasStagedChanges ? 'Commit message...' : 'No changes staged'}
          disabled={!hasStagedChanges}
          className={cn(
            'w-full min-h-[80px] p-3 text-sm rounded-lg border bg-background',
            'focus:outline-none focus:ring-2 focus:ring-ring resize-none',
            !hasStagedChanges && 'opacity-50 cursor-not-allowed'
          )}
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{message.length}/72</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={!hasStagedChanges || generateMutation.isPending}
            onClick={() => generateMutation.mutate()}
            title="Generate commit message with AI"
          >
            {generateMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-3 w-3 mr-1" />
                AI
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Status info */}
      {status && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className={cn(hasStagedChanges && 'text-green-500')}>
            {status.staged.length} staged
          </span>
          <span>{status.unstaged.length} modified</span>
          <span>{status.untracked.length} untracked</span>
        </div>
      )}

      {/* Commit button */}
      <Button
        type="submit"
        disabled={!hasStagedChanges || !message.trim() || commitMutation.isPending}
        className="w-full"
      >
        {commitMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Committing...
          </>
        ) : (
          <>
            <GitCommitIcon className="h-4 w-4 mr-2" />
            Commit
          </>
        )}
      </Button>
    </form>
  );
}

export default GitCommit;
