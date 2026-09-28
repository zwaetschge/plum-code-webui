import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Trash2, FolderKey, Loader2, AlertCircle, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { FolderBrowserDialog } from '@/components/ui/folder-browser';
import { api } from '@/services/api';
import type { ApiResponse } from '@plum-code-webui/shared';
import { useProviderStore } from '@/stores/providerStore';
import { UI_PROVIDER_META } from '@/lib/providers';

interface AllowedDirectoriesDialogProps {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDirectoriesChanged?: () => void;
  providerLabel?: string;
}

export function AllowedDirectoriesDialog({
  sessionId,
  open,
  onOpenChange,
  onDirectoriesChanged,
  providerLabel: explicitProviderLabel,
}: AllowedDirectoriesDialogProps) {
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const queryClient = useQueryClient();
  const { uiProvider } = useProviderStore();
  const providerLabel = explicitProviderLabel ?? UI_PROVIDER_META[uiProvider].label;

  // Fetch current allowed directories
  const { data: directories, isLoading } = useQuery({
    queryKey: ['allowed-directories', sessionId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<string[]>>(
        `/api/sessions/${sessionId}/allowed-directories`
      );
      return response.data.data || [];
    },
    enabled: open && !!sessionId,
  });

  // Add directory mutation
  const addMutation = useMutation({
    mutationFn: async (directory: string) => {
      const response = await api.post<ApiResponse<string[]>>(
        `/api/sessions/${sessionId}/allowed-directories`,
        { directory }
      );
      return response.data.data || [];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowed-directories', sessionId] });
      onDirectoriesChanged?.();
    },
  });

  // Remove directory mutation
  const removeMutation = useMutation({
    mutationFn: async (directory: string) => {
      const response = await api.delete<ApiResponse<string[]>>(
        `/api/sessions/${sessionId}/allowed-directories?directory=${encodeURIComponent(directory)}`
      );
      return response.data.data || [];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowed-directories', sessionId] });
      onDirectoriesChanged?.();
    },
  });

  const handleAddDirectory = (path: string) => {
    addMutation.mutate(path);
    setShowFolderBrowser(false);
  };

  const handleRemoveDirectory = (path: string) => {
    removeMutation.mutate(path);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="navigation-dialog sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderKey className="h-5 w-5 text-primary" />
              Allowed Directories
            </DialogTitle>
            <DialogDescription>
              Grant {providerLabel} access to additional directories beyond the working directory.
              Changes will take effect when the session is restarted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Directory list */}
            <div className="space-y-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : directories && directories.length > 0 ? (
                <div className="space-y-2">
                  {directories.map((dir) => (
                    <div
                      key={dir}
                      className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 group"
                    >
                      <FolderOpen className="h-4 w-4 text-primary shrink-0" />
                      <span className="flex-1 text-sm font-mono truncate" title={dir}>
                        {dir}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleRemoveDirectory(dir)}
                        disabled={removeMutation.isPending}
                      >
                        {removeMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FolderKey className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No additional directories allowed</p>
                  <p className="text-xs mt-1">
                    {providerLabel} can only access the session's working directory
                  </p>
                </div>
              )}
            </div>

            {/* Add button */}
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => setShowFolderBrowser(true)}
              disabled={addMutation.isPending}
            >
              {addMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderPlus className="h-4 w-4" />
              )}
              Add Directory
            </Button>

            {/* Info notice */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Granting directory access allows {providerLabel} to read and modify files in that
                directory. Only grant access to directories you trust.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Folder browser dialog */}
      <FolderBrowserDialog
        open={showFolderBrowser}
        onOpenChange={setShowFolderBrowser}
        onChange={handleAddDirectory}
      />
    </>
  );
}

// Component to detect directory access requests in messages
interface DirectoryAccessPromptProps {
  message: string;
  sessionId: string;
  onAccessGranted?: () => void;
  providerLabel?: string;
}

export function DirectoryAccessPrompt({
  message,
  sessionId,
  onAccessGranted,
  providerLabel: explicitProviderLabel,
}: DirectoryAccessPromptProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [isGranting, setIsGranting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const { uiProvider } = useProviderStore();
  const providerLabel = explicitProviderLabel ?? UI_PROVIDER_META[uiProvider].label;

  // Detect directory access request patterns
  const detectDirectoryRequest = (text: string): string | null => {
    // Common patterns Claude uses to request directory access
    const patterns = [
      /(?:access|zugriff|read|lesen|permission).{0,50}(?:directory|verzeichnis|folder|ordner|path)\s+([/\w.~/-]+)/i,
      /(?:grant|gewähre?|allow|erlaube).{0,30}(?:access|zugriff).{0,30}([/\w.~/-]+)/i,
      /(?:need|brauche?|require|benötige?).{0,30}(?:access|zugriff).{0,30}([/\w.~/-]+)/i,
      /([/\w.~/-]+).{0,30}(?:not accessible|nicht zugänglich|not allowed|nicht erlaubt)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        // Basic validation - must look like a path
        const detectedPath = match[1];
        if (detectedPath.startsWith('/') && detectedPath.length > 1) {
          return detectedPath;
        }
      }
    }
    return null;
  };

  // Check message for directory access requests
  const path = detectDirectoryRequest(message);

  if (!path || dismissed) return null;

  const handleGrantAccess = async () => {
    setIsGranting(true);
    try {
      await api.post(`/api/sessions/${sessionId}/allowed-directories`, { directory: path });
      onAccessGranted?.();
      setDismissed(true);
    } catch (error) {
      console.error('Failed to grant access:', error);
      // Open dialog on error for manual selection
      setShowDialog(true);
    } finally {
      setIsGranting(false);
    }
  };

  return (
    <>
      <div className="mt-3 p-3 rounded-lg bg-primary/10 border border-primary/30 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <FolderKey className="h-4 w-4 text-primary" />
          <span className="font-medium">Directory Access Requested</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {providerLabel} is requesting access to:{' '}
          <code className="px-1 py-0.5 rounded bg-muted">{path}</code>
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            className="gap-1"
            onClick={handleGrantAccess}
            disabled={isGranting}
          >
            {isGranting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderPlus className="h-3.5 w-3.5" />
            )}
            Grant Access
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            Ignore
          </Button>
        </div>
      </div>

      <AllowedDirectoriesDialog
        sessionId={sessionId}
        open={showDialog}
        onOpenChange={setShowDialog}
        providerLabel={providerLabel}
        onDirectoriesChanged={onAccessGranted}
      />
    </>
  );
}
