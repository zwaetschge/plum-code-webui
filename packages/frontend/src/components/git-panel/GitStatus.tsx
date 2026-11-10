import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare,
  Square,
  Plus,
  Minus,
  FileEdit,
  FileQuestion,
  ChevronDown,
  ChevronRight,
  Loader2,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type { ApiResponse, GitStatus as GitStatusType } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';

interface GitStatusProps {
  workingDirectory: string;
  onFileSelect?: (file: string, staged: boolean) => void;
}

export function GitStatus({ workingDirectory, onFileSelect }: GitStatusProps) {
  const queryClient = useQueryClient();
  const [expandedSections, setExpandedSections] = useState({
    staged: true,
    unstaged: true,
    untracked: true,
  });
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // Fetch git status
  const { data: status, isLoading } = useQuery({
    queryKey: ['git-status', workingDirectory],
    queryFn: async () => {
      const response = await api.get<ApiResponse<GitStatusType>>(
        `/api/git/status?path=${encodeURIComponent(workingDirectory)}`
      );
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      throw new Error('Failed to fetch git status');
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Stage mutation
  const stageMutation = useMutation({
    mutationFn: async (files: string[]) => {
      const response = await api.post<ApiResponse<unknown>>('/api/git/stage', {
        path: workingDirectory,
        files,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['git-status', workingDirectory] });
      setSelectedFiles(new Set());
    },
    onError: (error: Error) => {
      toast({ title: 'Stagen fehlgeschlagen', description: error.message, variant: 'destructive' });
    },
  });

  // Unstage mutation
  const unstageMutation = useMutation({
    mutationFn: async (files: string[]) => {
      const response = await api.post<ApiResponse<unknown>>('/api/git/unstage', {
        path: workingDirectory,
        files,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['git-status', workingDirectory] });
      setSelectedFiles(new Set());
    },
    onError: (error: Error) => {
      toast({
        title: 'Unstagen fehlgeschlagen',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Discard mutation
  const discardMutation = useMutation({
    mutationFn: async (file: string) => {
      const response = await api.post<ApiResponse<unknown>>('/api/git/discard', {
        path: workingDirectory,
        file,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['git-status', workingDirectory] });
      toast({ title: 'Änderungen verworfen' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Verwerfen fehlgeschlagen',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleFileSelection = (file: string) => {
    setSelectedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(file)) {
        newSet.delete(file);
      } else {
        newSet.add(file);
      }
      return newSet;
    });
  };

  const handleStageAll = () => {
    if (status) {
      const allUnstaged = [...status.unstaged, ...status.untracked];
      stageMutation.mutate(allUnstaged);
    }
  };

  const handleUnstageAll = () => {
    if (status) {
      unstageMutation.mutate(status.staged);
    }
  };

  const handleStageSelected = () => {
    const filesToStage = Array.from(selectedFiles).filter(
      (f) => status?.unstaged.includes(f) || status?.untracked.includes(f)
    );
    if (filesToStage.length > 0) {
      stageMutation.mutate(filesToStage);
    }
  };

  const handleUnstageSelected = () => {
    const filesToUnstage = Array.from(selectedFiles).filter((f) => status?.staged.includes(f));
    if (filesToUnstage.length > 0) {
      unstageMutation.mutate(filesToUnstage);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">Not a git repository</div>
    );
  }

  const hasChanges =
    status.staged.length > 0 || status.unstaged.length > 0 || status.untracked.length > 0;

  if (!hasChanges) {
    return <div className="text-center py-4 text-sm text-muted-foreground">Working tree clean</div>;
  }

  const renderFileList = (
    files: string[],
    type: 'staged' | 'unstaged' | 'untracked',
    icon: React.ReactNode
  ) => (
    <div className="space-y-0.5">
      {files.map((file) => (
        <div
          key={`${type}-${file}`}
          className={cn(
            'flex items-center gap-2 py-1 px-2 rounded-sm cursor-pointer transition-colors',
            'hover:bg-muted/50',
            selectedFiles.has(file) && 'bg-primary/10'
          )}
          onClick={() => onFileSelect?.(file, type === 'staged')}
        >
          <button
            aria-label={selectedFiles.has(file) ? 'Datei abwählen' : 'Datei auswählen'}
            onClick={(e) => {
              e.stopPropagation();
              toggleFileSelection(file);
            }}
            className="shrink-0"
          >
            {selectedFiles.has(file) ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : (
              <Square className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {icon}
          <span className="text-xs truncate flex-1 font-mono">{file}</span>
          {type === 'unstaged' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                discardMutation.mutate(file);
              }}
              className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
              title="Discard changes"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Quick Actions */}
      {selectedFiles.size > 0 && (
        <div className="flex gap-2 p-2 bg-muted/30 rounded-lg">
          <Button size="sm" variant="outline" onClick={handleStageSelected}>
            <Plus className="h-3 w-3 mr-1" />
            Stage ({selectedFiles.size})
          </Button>
          <Button size="sm" variant="outline" onClick={handleUnstageSelected}>
            <Minus className="h-3 w-3 mr-1" />
            Unstage
          </Button>
        </div>
      )}

      {/* Staged Changes */}
      {status.staged.length > 0 && (
        <div>
          <button
            className="flex items-center gap-2 w-full text-left py-1 px-2 hover:bg-muted/30 rounded-sm"
            onClick={() => toggleSection('staged')}
          >
            {expandedSections.staged ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="text-xs font-medium text-green-500">
              Staged Changes ({status.staged.length})
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                handleUnstageAll();
              }}
            >
              <Minus className="h-3 w-3 mr-1" />
              All
            </Button>
          </button>
          {expandedSections.staged &&
            renderFileList(
              status.staged,
              'staged',
              <FileEdit className="h-3.5 w-3.5 text-green-500 shrink-0" />
            )}
        </div>
      )}

      {/* Unstaged Changes */}
      {status.unstaged.length > 0 && (
        <div>
          <button
            className="flex items-center gap-2 w-full text-left py-1 px-2 hover:bg-muted/30 rounded-sm"
            onClick={() => toggleSection('unstaged')}
          >
            {expandedSections.unstaged ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="text-xs font-medium text-amber-500">
              Modified ({status.unstaged.length})
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                handleStageAll();
              }}
            >
              <Plus className="h-3 w-3 mr-1" />
              All
            </Button>
          </button>
          {expandedSections.unstaged &&
            renderFileList(
              status.unstaged,
              'unstaged',
              <FileEdit className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            )}
        </div>
      )}

      {/* Untracked Files */}
      {status.untracked.length > 0 && (
        <div>
          <button
            className="flex items-center gap-2 w-full text-left py-1 px-2 hover:bg-muted/30 rounded-sm"
            onClick={() => toggleSection('untracked')}
          >
            {expandedSections.untracked ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="text-xs font-medium text-blue-500">
              Untracked ({status.untracked.length})
            </span>
          </button>
          {expandedSections.untracked &&
            renderFileList(
              status.untracked,
              'untracked',
              <FileQuestion className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            )}
        </div>
      )}
    </div>
  );
}

export default GitStatus;
