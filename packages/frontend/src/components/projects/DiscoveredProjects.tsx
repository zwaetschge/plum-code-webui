import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FolderSearch,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Plus,
  FileJson,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type { Session, ApiResponse, DiscoveredProject, CLIProvider } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';

interface DiscoveredProjectsProps {
  cliProvider?: CLIProvider;
  defaultExpanded?: boolean;
  className?: string;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function DiscoveredProjects({
  cliProvider,
  defaultExpanded = false,
  className,
}: DiscoveredProjectsProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  // Fetch discovered projects
  const {
    data: projects,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['discovered-projects'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DiscoveredProject[]>>('/api/projects');
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return [];
    },
    staleTime: 60000, // Cache for 1 minute
  });

  // Create session from project mutation
  const createMutation = useMutation({
    mutationFn: async (project: DiscoveredProject) => {
      const payload: { name: string; workingDirectory: string; cliProvider?: CLIProvider } = {
        name: project.name,
        workingDirectory: project.path,
      };
      if (cliProvider) {
        payload.cliProvider = cliProvider;
      }
      const response = await api.post<ApiResponse<Session>>('/api/sessions', payload);
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        toast({
          title: 'Session erstellt',
          description: `Session für ${data.data.name} gestartet`,
        });
        navigate(`/session/${data.data.id}`);
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Fehler', description: error.message, variant: 'destructive' });
    },
  });

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(projectId)) {
        newSet.delete(projectId);
      } else {
        newSet.add(projectId);
      }
      return newSet;
    });
  };

  if (isLoading) {
    return null; // Don't show loading state for this section
  }

  if (!projects || projects.length === 0) {
    return null; // Don't show if no projects discovered
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer select-none"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <FolderSearch className="h-5 w-5 text-purple-500" />
            <CardTitle className="text-lg">Discovered Projects</CardTitle>
            <span className="text-sm text-muted-foreground">({projects.length})</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              refetch();
            }}
            disabled={isRefetching}
            title="Refresh projects"
          >
            <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
          </Button>
        </div>
        {isExpanded && (
          <CardDescription>
            Projects found in ~/.claude/projects. Start a session with the selected provider.
          </CardDescription>
        )}
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          <div className="space-y-2">
            {projects.map((project) => (
              <div
                key={project.id}
                className={cn(
                  'rounded-lg border p-3 transition-colors',
                  project.hasSession
                    ? 'hover:border-primary cursor-pointer'
                    : 'opacity-60 border-dashed'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <FolderOpen
                        className={cn(
                          'h-4 w-4 shrink-0',
                          project.hasSession ? 'text-amber-500' : 'text-muted-foreground'
                        )}
                      />
                      <span className="font-medium truncate">{project.name}</span>
                      {!project.hasSession && (
                        <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded">
                          <AlertCircle className="h-3 w-3" />
                          Missing
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mb-2">{project.path}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(project.lastModified)}
                      </span>
                      <button
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleProject(project.id);
                        }}
                      >
                        <FileJson className="h-3 w-3" />
                        {project.sessionFiles.length} files
                        {expandedProjects.has(project.id) ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </button>
                    </div>

                    {/* Session files list */}
                    {expandedProjects.has(project.id) && project.sessionFiles.length > 0 && (
                      <div className="mt-2 pl-4 space-y-1 max-h-32 overflow-auto">
                        {project.sessionFiles.map((file, index) => (
                          <div
                            key={index}
                            className="text-xs text-muted-foreground font-mono truncate"
                          >
                            {file}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Action button */}
                  <Button
                    size="sm"
                    variant={project.hasSession ? 'default' : 'outline'}
                    disabled={!project.hasSession || createMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      createMutation.mutate(project);
                    }}
                    className="shrink-0"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {createMutation.isPending ? 'Creating...' : 'Start'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default DiscoveredProjects;
