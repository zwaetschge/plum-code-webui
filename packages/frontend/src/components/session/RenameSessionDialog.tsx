import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiResponse, Session } from '@plum-code-webui/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/services/api';
import { useSessionStore } from '@/stores/sessionStore';
import { toast } from '@/hooks/use-toast';

interface RenameSessionDialogProps {
  session: Session | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameSessionDialog({ session, open, onOpenChange }: RenameSessionDialogProps) {
  const [name, setName] = useState('');
  const queryClient = useQueryClient();
  const updateSession = useSessionStore((s) => s.updateSession);

  useEffect(() => {
    if (open) {
      setName(session?.name ?? '');
    }
  }, [open, session?.name]);

  const renameMutation = useMutation({
    mutationFn: async (nextName: string) => {
      if (!session) throw new Error('No session selected');
      const response = await api.put<ApiResponse<Session>>(`/api/sessions/${session.id}`, {
        name: nextName,
      });
      return response.data;
    },
    onSuccess: (response) => {
      if (!response.success || !response.data) return;
      updateSession(response.data.id, response.data);
      queryClient.setQueryData(['session', response.data.id], response.data);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast({ title: 'Session renamed' });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      const description =
        error instanceof ApiError ? error.message : error.message || 'Rename failed';
      toast({ title: 'Rename failed', description, variant: 'destructive' });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!session || !trimmed) return;
    if (trimmed === session.name) {
      onOpenChange(false);
      return;
    }
    renameMutation.mutate(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="navigation-dialog sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rename Session</DialogTitle>
            <DialogDescription>
              Update the session name shown in the header and lists.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            maxLength={100}
            placeholder="Session name"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || renameMutation.isPending}>
              {renameMutation.isPending ? 'Saving...' : 'Rename'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
