import type { QueryClient } from '@tanstack/react-query';
import type { ApiResponse, Session, SessionSurface } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useSessionStore } from '@/stores/sessionStore';

export function sessionSurface(session: Pick<Session, 'surface'>): SessionSurface {
  return session.surface || 'code';
}

/** Reclassify the existing session. Never start, stop, copy or recreate its runtime. */
export async function moveSessionSurface(
  sessionId: string,
  surface: 'code' | 'task',
  cache: QueryClient
): Promise<void> {
  const owner = useAuthStore.getState().user?.id;
  const response = await api.patch<ApiResponse<{ surface: SessionSurface }>>(
    `/api/sessions/${sessionId}/surface`,
    { surface }
  );
  if (!response.data.success || response.data.data?.surface !== surface)
    throw new Error('Die Session konnte nicht zugeordnet werden.');
  if (useAuthStore.getState().user?.id !== owner) return;
  useSessionStore.getState().updateSession(sessionId, { surface });
  cache.setQueryData<Session[]>(['sessions'], (current) =>
    current?.map((session) => (session.id === sessionId ? { ...session, surface } : session))
  );
  cache.setQueryData<Session>(['session', sessionId], (current) =>
    current ? { ...current, surface } : current
  );
  void cache.invalidateQueries({ queryKey: ['sessions'] });
  void cache.invalidateQueries({ queryKey: ['session', sessionId] });
}
