import type { Session } from '@plum-code-webui/shared';
import { sessionSurface } from '@/lib/sessionSurface';

/** The four work modes of the sidebar pill, in display order. */
export type SidebarMode = 'chat' | 'task' | 'code' | 'swarm';

export const SIDEBAR_MODE_HOME: Record<SidebarMode, string> = {
  chat: '/chat',
  task: '/tasks',
  code: '/code',
  swarm: '/swarm',
};

const LAST_MODE_KEY = 'plum:sidebar-mode';
const MODES = new Set<SidebarMode>(['chat', 'task', 'code', 'swarm']);

/**
 * Mode implied by the current route. Session pages take their session's
 * surface; global pages (Übersicht, Monitor, Einstellungen …) return null so
 * the sidebar keeps the mode the user last worked in.
 */
export function routeSidebarMode(
  pathname: string,
  session: Pick<Session, 'id' | 'surface'> | null
): SidebarMode | null {
  if (pathname === '/chat' || pathname.startsWith('/chat/')) return 'chat';
  if (pathname === '/tasks' || pathname === '/assistant/tasks') return 'task';
  if (pathname === '/code') return 'code';
  if (pathname === '/swarm') return 'swarm';
  const sessionId = pathname.match(/^\/session\/([^/]+)/)?.[1];
  if (sessionId && session?.id === sessionId) return sessionSurface(session);
  return null;
}

export function readRememberedSidebarMode(): SidebarMode {
  try {
    const stored = window.localStorage.getItem(LAST_MODE_KEY) as SidebarMode | null;
    return stored && MODES.has(stored) ? stored : 'code';
  } catch {
    return 'code';
  }
}

export function rememberSidebarMode(mode: SidebarMode) {
  try {
    window.localStorage.setItem(LAST_MODE_KEY, mode);
  } catch {
    // Private mode or full storage: the route still decides the mode.
  }
}
