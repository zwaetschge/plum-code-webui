import { useEffect, useState } from 'react';
import { api, ApiError } from '@/services/api';
import { useSessionStore } from '@/stores/sessionStore';
import { toast } from '@/hooks/use-toast';
import { FolderBrowserDialog } from '@/components/ui/folder-browser';

const EVENT = 'plum:change-session-folder';
/** Where a moved project folder is looked for first: the Unraid share. */
const UNRAID_SHARE = '/mnt/user';

/**
 * Opens the folder browser to point a session at its folder's new location,
 * e.g. after a project was moved to the Unraid array. Callable from anywhere
 * (sidebar menu, error toasts); the dialog itself lives in the layout.
 */
export function changeSessionFolder(sessionId: string, currentPath = '') {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { sessionId, currentPath } }));
}

async function save(sessionId: string, path: string) {
  try {
    await api.put(`/api/sessions/${sessionId}`, { workingDirectory: path });
    useSessionStore.getState().updateSession(sessionId, { workingDirectory: path });
    toast({ title: 'Arbeitsordner geändert', description: path });
  } catch (err) {
    const msg =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Ändern fehlgeschlagen';
    toast({ title: 'Arbeitsordner nicht geändert', description: msg, variant: 'destructive' });
  }
}

export function SessionFolderDialog() {
  const [target, setTarget] = useState<{ sessionId: string; start: string } | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const { sessionId, currentPath } = (event as CustomEvent).detail as {
        sessionId: string;
        currentPath: string;
      };
      // A missing folder cannot be listed, so browsing starts on the share.
      void api
        .get(`/api/files?path=${encodeURIComponent(currentPath)}`)
        .then(() => setTarget({ sessionId, start: currentPath }))
        .catch(() => setTarget({ sessionId, start: UNRAID_SHARE }));
    };
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);
  return (
    <FolderBrowserDialog
      open={!!target}
      onOpenChange={(open) => !open && setTarget(null)}
      value={target?.start}
      onChange={(path) => {
        if (target) void save(target.sessionId, path);
        setTarget(null);
      }}
    />
  );
}
