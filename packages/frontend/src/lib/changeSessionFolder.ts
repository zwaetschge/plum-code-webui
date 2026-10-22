import { api, ApiError } from '@/services/api';
import { useSessionStore } from '@/stores/sessionStore';
import { toast } from '@/hooks/use-toast';

/**
 * Points a session at its folder's new location, e.g. after a project was
 * moved to the Unraid array by hand. The backend rejects missing folders.
 */
export async function changeSessionFolder(sessionId: string, currentPath = '') {
  const next = window.prompt(
    'Neuer Arbeitsordner für diese Session (vollständiger Pfad, z. B. /mnt/user/…):',
    currentPath
  );
  const trimmed = next?.trim();
  if (!trimmed || trimmed === currentPath) return;
  try {
    await api.put(`/api/sessions/${sessionId}`, { workingDirectory: trimmed });
    useSessionStore.getState().updateSession(sessionId, { workingDirectory: trimmed });
    toast({ title: 'Arbeitsordner geändert', description: trimmed });
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
