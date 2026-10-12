import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Code2, ListTodo } from 'lucide-react';
import type { Session } from '@plum-code-webui/shared';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { moveSessionSurface, sessionSurface } from '@/lib/sessionSurface';
import { toast } from '@/hooks/use-toast';

export function SessionSurfaceMenuItem({ session }: { session: Session }) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (sessionSurface(session) === 'chat') return null;
  const target = sessionSurface(session) === 'task' ? 'code' : 'task';
  const Icon = target === 'task' ? ListTodo : Code2;
  return (
    <DropdownMenuItem
      disabled={busy}
      className="cursor-pointer"
      onClick={async () => {
        setBusy(true);
        try {
          await moveSessionSurface(session.id, target, cache);
          toast({ title: `Session nach Plum ${target === 'task' ? 'Task' : 'Code'} verschoben` });
        } catch (error) {
          toast({
            title: 'Zuordnung fehlgeschlagen',
            description: error instanceof Error ? error.message : 'Bitte erneut versuchen.',
            variant: 'destructive',
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon className="mr-2 h-3.5 w-3.5" />
      Nach Plum {target === 'task' ? 'Task' : 'Code'} verschieben
    </DropdownMenuItem>
  );
}
