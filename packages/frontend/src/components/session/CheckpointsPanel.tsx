import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Save,
  History,
  Loader2,
  RotateCcw,
  Trash2,
  Edit3,
  Plus,
  Clock,
  MessageSquare,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type { ApiResponse } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';

interface Checkpoint {
  id: string;
  name: string;
  description: string | null;
  message_count: number;
  created_at: string;
}

interface CheckpointsPanelProps {
  sessionId: string;
  className?: string;
  onRestore?: () => void;
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

export function CheckpointsPanel({ sessionId, className, onRestore }: CheckpointsPanelProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState<Checkpoint | null>(null);
  const [showEditDialog, setShowEditDialog] = useState<Checkpoint | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState<Checkpoint | null>(null);
  const [newCheckpointName, setNewCheckpointName] = useState('');
  const [newCheckpointDescription, setNewCheckpointDescription] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const queryClient = useQueryClient();

  // Fetch checkpoints
  const { data: checkpoints, isLoading } = useQuery({
    queryKey: ['checkpoints', sessionId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Checkpoint[]>>(
        `/api/checkpoints/sessions/${sessionId}`
      );
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return [];
    },
  });

  // Create checkpoint mutation
  const createMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const response = await api.post<ApiResponse<Checkpoint>>('/api/checkpoints', {
        sessionId,
        name,
        description: description || undefined,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkpoints', sessionId] });
      setShowCreateDialog(false);
      setNewCheckpointName('');
      setNewCheckpointDescription('');
      toast({ title: 'Checkpoint erstellt', description: 'Session-Zustand gespeichert' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Checkpoint konnte nicht erstellt werden',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Restore checkpoint mutation
  const restoreMutation = useMutation({
    mutationFn: async (checkpointId: string) => {
      const response = await api.post<ApiResponse<{ sessionId: string; messagesRestored: number }>>(
        `/api/checkpoints/${checkpointId}/restore`
      );
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
      setShowRestoreDialog(null);
      toast({
        title: 'Checkpoint wiederhergestellt',
        description: `${data.data?.messagesRestored || 0} Nachrichten wiederhergestellt`,
      });
      onRestore?.();
    },
    onError: (error: Error) => {
      toast({
        title: 'Checkpoint konnte nicht wiederhergestellt werden',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Update checkpoint mutation
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      description,
    }: {
      id: string;
      name: string;
      description: string;
    }) => {
      const response = await api.put<ApiResponse<Checkpoint>>(`/api/checkpoints/${id}`, {
        name,
        description: description || undefined,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkpoints', sessionId] });
      setShowEditDialog(null);
      toast({ title: 'Checkpoint aktualisiert' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Checkpoint konnte nicht aktualisiert werden',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Delete checkpoint mutation
  const deleteMutation = useMutation({
    mutationFn: async (checkpointId: string) => {
      const response = await api.delete<ApiResponse<void>>(`/api/checkpoints/${checkpointId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkpoints', sessionId] });
      setShowDeleteDialog(null);
      toast({ title: 'Checkpoint gelöscht' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Checkpoint konnte nicht gelöscht werden',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newCheckpointName.trim()) {
      createMutation.mutate({
        name: newCheckpointName.trim(),
        description: newCheckpointDescription.trim(),
      });
    }
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (showEditDialog && editName.trim()) {
      updateMutation.mutate({
        id: showEditDialog.id,
        name: editName.trim(),
        description: editDescription.trim(),
      });
    }
  };

  const openEditDialog = (checkpoint: Checkpoint) => {
    setEditName(checkpoint.name);
    setEditDescription(checkpoint.description || '');
    setShowEditDialog(checkpoint);
  };

  return (
    <div className={cn('flex flex-col h-full bg-card', className)}>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Checkpoints</span>
          {checkpoints && checkpoints.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {checkpoints.length}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => setShowCreateDialog(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Save
        </Button>
      </div>

      {/* Checkpoints list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !checkpoints || checkpoints.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Save className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No checkpoints yet</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Save your session state to restore later
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setShowCreateDialog(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Create Checkpoint
              </Button>
            </div>
          ) : (
            checkpoints.map((checkpoint) => (
              <div
                key={checkpoint.id}
                className="group relative p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 p-1.5 rounded-full bg-primary/10">
                    <Save className="h-3 w-3 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{checkpoint.name}</p>
                    {checkpoint.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {checkpoint.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {checkpoint.message_count} msgs
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(checkpoint.created_at)}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                {/* Action buttons */}
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRestoreDialog(checkpoint);
                    }}
                    title="Restore"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditDialog(checkpoint);
                    }}
                    title="Edit"
                  >
                    <Edit3 className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteDialog(checkpoint);
                    }}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="h-5 w-5" />
              Create Checkpoint
            </DialogTitle>
            <DialogDescription>Save the current session state to restore later</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="checkpoint-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="checkpoint-name"
                placeholder="e.g., Before refactoring"
                value={newCheckpointName}
                onChange={(e) => setNewCheckpointName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="checkpoint-description" className="text-sm font-medium">
                Description (optional)
              </label>
              <Input
                id="checkpoint-description"
                placeholder="Notes about this checkpoint..."
                value={newCheckpointDescription}
                onChange={(e) => setNewCheckpointDescription(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newCheckpointName.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Checkpoint'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Restore Dialog */}
      <Dialog open={!!showRestoreDialog} onOpenChange={() => setShowRestoreDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              Restore Checkpoint
            </DialogTitle>
            <DialogDescription>
              This will replace your current session messages with the checkpoint state. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="p-3 rounded-lg bg-muted/50 border">
              <p className="font-medium">{showRestoreDialog?.name}</p>
              {showRestoreDialog?.description && (
                <p className="text-sm text-muted-foreground mt-1">
                  {showRestoreDialog.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                {showRestoreDialog?.message_count} messages will be restored
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRestoreDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => showRestoreDialog && restoreMutation.mutate(showRestoreDialog.id)}
              disabled={restoreMutation.isPending}
            >
              {restoreMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Restoring...
                </>
              ) : (
                'Restore Checkpoint'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!showEditDialog} onOpenChange={() => setShowEditDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5" />
              Edit Checkpoint
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="edit-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-description" className="text-sm font-medium">
                Description
              </label>
              <Input
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowEditDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!editName.trim() || updateMutation.isPending}>
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!showDeleteDialog} onOpenChange={() => setShowDeleteDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Checkpoint
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this checkpoint? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="p-3 rounded-lg bg-muted/50 border">
              <p className="font-medium">{showDeleteDialog?.name}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {showDeleteDialog?.message_count} messages saved
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => showDeleteDialog && deleteMutation.mutate(showDeleteDialog.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Checkpoint'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CheckpointsPanel;
