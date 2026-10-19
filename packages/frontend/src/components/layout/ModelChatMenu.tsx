import { useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, FolderInput, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * ChatGPT's chat row menu for model chats: rename (inline), move to project,
 * archive and a confirmed permanent delete.
 */
export function ModelChatMenu({
  chat,
  projects,
  onRename,
}: {
  chat: AssistantResource;
  projects: AssistantResource[];
  onRename: () => void;
}) {
  const cache = useQueryClient(),
    navigate = useNavigate(),
    location = useLocation();
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const path = `/chat/model/${chat.id}`;
  const done = async (left: boolean) => {
    await cache.invalidateQueries({ queryKey: ['assistant'] });
    if (left && location.pathname === path) navigate('/chat');
  };
  const act = async (operation: () => Promise<unknown>, left: boolean) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      await done(left);
      setConfirm(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };
  const move = (projectId: string | null) =>
    void act(
      () =>
        api.post(`/api/assistant/api-chats/${chat.id}/meta`, {
          expectedRevision: chat.revision,
          projectId,
        }),
      false
    );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="sidebar-session-options"
            aria-label={`Optionen für ${chat.title}`}
            title="Chat-Optionen"
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent navigation align="end" className="w-56">
          <DropdownMenuItem onSelect={onRename} className="cursor-pointer">
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Umbenennen
          </DropdownMenuItem>
          {!chat.body.temporary && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <FolderInput className="mr-2 h-3.5 w-3.5" />
                In Projekt verschieben
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                {projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    disabled={busy || chat.body.projectId === project.id}
                    onSelect={() => move(project.id)}
                  >
                    {project.title}
                  </DropdownMenuItem>
                ))}
                {!!chat.body.projectId && (
                  <>
                    {!!projects.length && <DropdownMenuSeparator />}
                    <DropdownMenuItem disabled={busy} onSelect={() => move(null)}>
                      Aus Projekt entfernen
                    </DropdownMenuItem>
                  </>
                )}
                {!projects.length && !chat.body.projectId && (
                  <DropdownMenuItem onSelect={() => navigate('/chat/projects/new')}>
                    Neues Projekt …
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={busy}
            className="cursor-pointer"
            onSelect={() =>
              void act(
                () =>
                  api.delete(`/api/assistant/api-chats/${chat.id}`, {
                    body: JSON.stringify({ expectedRevision: chat.revision }),
                  }),
                true
              )
            }
          >
            <Archive className="mr-2 h-3.5 w-3.5" />
            Archivieren
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer text-destructive focus:text-destructive"
            onSelect={() => setConfirm(true)}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirm} onOpenChange={(open) => !busy && setConfirm(open)}>
        <DialogContent className="max-w-md">
          <DialogTitle>Chat löschen?</DialogTitle>
          <DialogDescription>
            Dadurch wird <strong>{chat.title}</strong> endgültig gelöscht, mit allen Antworten und
            Versionen. Gespeicherte Erinnerungen bleiben erhalten.
          </DialogDescription>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void act(() => api.post(`/api/assistant/api-chats/${chat.id}/delete`, {}), true)
              }
            >
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Inline title editor for a sidebar chat row (Enter saves, Escape cancels). */
export function ModelChatRename({ chat, onDone }: { chat: AssistantResource; onDone: () => void }) {
  const cache = useQueryClient();
  const [title, setTitle] = useState(chat.title);
  const cancelled = useRef(false);
  const save = async () => {
    const next = title.trim();
    if (cancelled.current) return;
    if (next && next !== chat.title)
      await api
        .post(`/api/assistant/api-chats/${chat.id}/meta`, {
          expectedRevision: chat.revision,
          title: next,
        })
        .then(() => cache.invalidateQueries({ queryKey: ['assistant'] }))
        .catch(() => undefined);
    onDone();
  };
  return (
    <input
      autoFocus
      aria-label="Chat umbenennen"
      className="sidebar-nav-item w-full min-w-0 rounded-md bg-background/60 px-3 py-2 text-xs outline-none ring-1 ring-ring"
      value={title}
      maxLength={200}
      onChange={(event) => setTitle(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          cancelled.current = true;
          onDone();
        }
      }}
    />
  );
}
