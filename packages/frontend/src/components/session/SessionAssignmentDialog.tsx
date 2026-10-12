import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { useAuthStore } from '@/stores/authStore';
import { moveSessionSurface, sessionSurface } from '@/lib/sessionSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function SessionAssignmentDialog({ surface }: { surface: 'task' | 'code' }) {
  const owner = useAuthStore((state) => state.user?.id);
  return <Assignment key={`${owner}:${surface}`} surface={surface} />;
}
function Assignment({ surface }: { surface: 'task' | 'code' }) {
  const sessions = useSessionStore((state) => state.sessions);
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const source = surface === 'task' ? 'Code' : 'Task';
  const target = surface === 'task' ? 'Task' : 'Code';
  const candidates = useMemo(
    () => sessions.filter((s) => sessionSurface(s) === (surface === 'task' ? 'code' : 'task')),
    [sessions, surface]
  );
  const visible = candidates.filter((s) =>
    `${s.name} ${s.workingDirectory}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  );
  const chosen = selected.filter((id) => candidates.some((s) => s.id === id));
  const changeOpen = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    setError('');
    setSelected([]);
    setSearch('');
  };
  return (
    <>
      <Button variant="outline" onClick={() => changeOpen(true)} className="gap-2">
        <ArrowRightLeft className="h-4 w-4" />
        Sessions aus {source} übernehmen
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Sessions nach Plum {target} verschieben</DialogTitle>
            <DialogDescription>
              Wähle deine bestehenden Sessions aus. Verlauf, Arbeitsordner und laufende Agenten
              bleiben erhalten.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="search"
            aria-label="Sessions zur Zuordnung suchen"
            placeholder="Sessions suchen …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={busy}
          />
          <div className="max-h-[45vh] overflow-y-auto space-y-1" aria-label="Verfügbare Sessions">
            {visible.map((session) => (
              <label
                key={session.id}
                className="flex gap-3 rounded-lg border border-border/50 p-3 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={chosen.includes(session.id)}
                  disabled={busy}
                  aria-label={session.name}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, session.id]
                        : ids.filter((id) => id !== session.id)
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block font-medium break-words">{session.name}</span>
                  <span className="block text-xs text-muted-foreground break-all">
                    {session.workingDirectory}
                  </span>
                </span>
              </label>
            ))}
            {!visible.length && (
              <p className="py-4 text-sm text-muted-foreground">
                {search ? 'Keine passenden Sessions.' : `Keine Sessions in Plum ${source}.`}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            disabled={!chosen.length || busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              const failed: string[] = [];
              for (const id of chosen) {
                try {
                  await moveSessionSurface(id, surface, cache);
                } catch {
                  failed.push(id);
                }
              }
              setBusy(false);
              setSelected(failed);
              if (!failed.length) setOpen(false);
              else
                setError(
                  `${failed.length} Zuordnungen fehlgeschlagen. Erfolgreich verschobene Sessions sind bereits übernommen. Bitte erneut versuchen.`
                );
            }}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy
              ? 'Sessions werden zugeordnet …'
              : `${chosen.length} Sessions nach ${target} verschieben`}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
