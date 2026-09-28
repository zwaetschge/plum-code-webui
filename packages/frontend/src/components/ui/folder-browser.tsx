import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  Home,
  HardDrive,
  ArrowUp,
  Check,
  X,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '@plum-code-webui/shared';

interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
  extension?: string;
}

interface DirectoryContents {
  path: string;
  files: FileInfo[];
}

interface HomeInfo {
  homeDir: string;
  allowedPaths: string[];
  commonPaths: { name: string; path: string }[];
}

interface FolderBrowserProps {
  value?: string;
  onChange: (path: string) => void;
  onClose?: () => void;
  showFiles?: boolean;
}

export function FolderBrowser({ value, onChange, onClose, showFiles = false }: FolderBrowserProps) {
  const queryClient = useQueryClient();
  const [currentPath, setCurrentPath] = useState(value || '');
  const [manualPath, setManualPath] = useState(value || '');

  // Fetch home directory info
  const { data: homeInfo } = useQuery({
    queryKey: ['files-home'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<HomeInfo>>('/api/files/home');
      return response.data.data;
    },
  });

  // Check if current path is fetchable (not root unless explicitly allowed)
  const canFetchPath = (path: string) => {
    if (!path) return false;
    if (path === '/') return false; // Never auto-fetch root
    return true;
  };

  // Fetch directory contents
  const {
    data: contents,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['files-list', currentPath],
    queryFn: async () => {
      if (!currentPath) return null;
      const response = await api.get<ApiResponse<DirectoryContents>>(
        `/api/files?path=${encodeURIComponent(currentPath)}`
      );
      return response.data.data;
    },
    enabled: canFetchPath(currentPath),
    retry: false,
  });

  // Initialize with a valid path
  useEffect(() => {
    if (homeInfo && !currentPath) {
      // Priority: value prop > first common path > first allowed path
      let initialPath = value;
      if (!initialPath || initialPath === '/') {
        initialPath =
          homeInfo.commonPaths?.[0]?.path || homeInfo.allowedPaths?.[0] || homeInfo.homeDir;
      }
      if (initialPath && initialPath !== '/') {
        setCurrentPath(initialPath);
        setManualPath(initialPath);
      }
    }
  }, [homeInfo, value, currentPath]);

  const navigateTo = (path: string) => {
    setCurrentPath(path);
    setManualPath(path);
  };

  const navigateUp = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    // Don't navigate to root if it's not in allowed paths
    if (parentPath === '/' && homeInfo?.allowedPaths && !homeInfo.allowedPaths.includes('/')) {
      return;
    }
    navigateTo(parentPath);
  };

  // Check if a path is allowed or is a parent of an allowed path
  const isPathAllowed = (path: string) => {
    if (!homeInfo?.allowedPaths) return false; // Don't allow anything until we know allowed paths
    const normalizePath = (value: string) => value.replace(/\/+$/, '') || '/';
    const isSameOrInside = (base: string, candidate: string) =>
      candidate === base ||
      (base === '/' ? candidate.startsWith('/') : candidate.startsWith(`${base}/`));
    const normalizedPath = normalizePath(path);
    if (normalizedPath === '/') {
      // Root is only allowed if explicitly in the list
      return homeInfo.allowedPaths.includes('/');
    }
    return homeInfo.allowedPaths.some((rawBase) => {
      const base = normalizePath(rawBase);
      return (
        isSameOrInside(base, normalizedPath) || // path is inside allowed base
        isSameOrInside(normalizedPath, base) // path is a parent of allowed base
      );
    });
  };

  const handleSelect = () => {
    onChange(currentPath);
    onClose?.();
  };

  const handleManualPathSubmit = () => {
    if (manualPath) {
      navigateTo(manualPath);
    }
  };

  const directories = contents?.files.filter((f) => f.type === 'directory') || [];
  const files = showFiles ? contents?.files.filter((f) => f.type === 'file') || [] : [];

  const pathParts = currentPath.split('/').filter(Boolean);

  return (
    <div className="glass-dialog flex flex-col h-full max-h-[500px] rounded-xl border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b bg-muted/30">
        <span className="text-sm font-medium">Select Folder</span>
        <div className="flex-1" />
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Quick access */}
      {homeInfo?.commonPaths && homeInfo.commonPaths.length > 0 && (
        <div className="flex items-center gap-1 p-2 border-b overflow-x-auto">
          {homeInfo.commonPaths.map((p) => (
            <Button
              key={p.path}
              variant={currentPath === p.path ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs shrink-0"
              onClick={() => navigateTo(p.path)}
            >
              {p.name === 'Home' ? (
                <Home className="h-3 w-3 mr-1" />
              ) : (
                <Folder className="h-3 w-3 mr-1" />
              )}
              {p.name}
            </Button>
          ))}
        </div>
      )}

      {/* Path input */}
      <div className="flex items-center gap-2 p-2 border-b">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={navigateUp}
          disabled={
            currentPath === '/' ||
            !isPathAllowed(currentPath.split('/').slice(0, -1).join('/') || '/')
          }
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Input
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleManualPathSubmit()}
          className="h-8 font-mono text-xs"
          placeholder="/path/to/folder"
        />
        <Button variant="ghost" size="sm" className="h-8 shrink-0" onClick={handleManualPathSubmit}>
          Go
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['files-list', currentPath] })}
          title="Refresh"
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground overflow-x-auto border-b">
        {isPathAllowed('/') && (
          <button
            onClick={() => navigateTo('/')}
            className="hover:text-foreground transition-colors shrink-0"
          >
            <HardDrive className="h-3 w-3" />
          </button>
        )}
        {pathParts.map((part, index) => {
          const fullPath = '/' + pathParts.slice(0, index + 1).join('/');
          const canNavigate = isPathAllowed(fullPath);
          return (
            <div key={fullPath} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="h-3 w-3" />
              {canNavigate ? (
                <button
                  onClick={() => navigateTo(fullPath)}
                  className="hover:text-foreground transition-colors truncate max-w-[100px]"
                >
                  {part}
                </button>
              ) : (
                <span className="truncate max-w-[100px]">{part}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Directory listing */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-sm text-destructive">
            <p>Cannot access this directory</p>
            <p className="text-xs text-muted-foreground mt-1">
              Path may not be allowed or doesn't exist
            </p>
          </div>
        ) : directories.length === 0 && files.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Empty folder</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {directories.map((dir) => (
              <div
                key={dir.path}
                className={cn(
                  'group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors',
                  'hover:bg-muted'
                )}
                onClick={() => navigateTo(dir.path)}
              >
                <Folder className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm truncate flex-1">{dir.name}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
            {files.map((file) => (
              <div
                key={file.path}
                className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground"
              >
                <div className="h-4 w-4 shrink-0" />
                <span className="text-sm truncate">{file.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 p-3 border-t bg-muted/30">
        <div className="text-xs text-muted-foreground truncate flex-1">{currentPath}</div>
        <div className="flex gap-2 shrink-0">
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={handleSelect} className="gap-1">
            <Check className="h-3 w-3" />
            Select
          </Button>
        </div>
      </div>
    </div>
  );
}

// Dialog wrapper for the folder browser
interface FolderBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value?: string;
  onChange: (path: string) => void;
}

export function FolderBrowserDialog({
  open,
  onOpenChange,
  value,
  onChange,
}: FolderBrowserDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative w-full max-w-lg mx-4 animate-scale-in">
        <FolderBrowser
          value={value}
          onChange={(path) => {
            onChange(path);
            onOpenChange(false);
          }}
          onClose={() => onOpenChange(false)}
        />
      </div>
    </div>
  );
}
