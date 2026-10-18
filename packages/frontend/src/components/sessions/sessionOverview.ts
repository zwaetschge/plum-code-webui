import { useEffect, useState } from 'react';
import type { CLIProvider, Session, SessionLifecycleEvent } from '@plum-code-webui/shared';
import type { SessionRunState } from '@/lib/sessionRunState';

export type SessionOverviewView = 'situation' | 'projects' | 'board' | 'categories';

export const SESSION_OVERVIEW_VIEWS: Array<{ value: SessionOverviewView; label: string }> = [
  { value: 'situation', label: 'Lagebild' },
  { value: 'projects', label: 'Projekte' },
  { value: 'board', label: 'Board' },
  // The original category list keeps drag-and-drop and category management.
  { value: 'categories', label: 'Kategorien' },
];

const storageKey = (surface: string) => `plum-session-overview-view:${surface}`;

function readView(surface: string): SessionOverviewView {
  if (typeof window === 'undefined') return 'situation';
  const stored = window.localStorage.getItem(storageKey(surface));
  return SESSION_OVERVIEW_VIEWS.some((view) => view.value === stored)
    ? (stored as SessionOverviewView)
    : 'situation';
}

/** View choice per surface (Task and Code each remember their own). */
export function useSessionOverviewView(surface: string) {
  const [view, setView] = useState<SessionOverviewView>(() => readView(surface));
  useEffect(() => {
    window.localStorage.setItem(storageKey(surface), view);
  }, [surface, view]);
  return [view, setView] as const;
}

/** Accent per harness; the theme colours are near-black and do not read as accents. */
export const PROVIDER_ACCENT: Record<CLIProvider, string> = {
  claude: '#d97757',
  zai: '#14b8a6',
  codex: '#10a37f',
  opencode: '#8b5cf6',
  pi: '#0ea5e9',
  vibe: '#ff7000',
};

/** Last path segment of the working directory, e.g. "/workspace/plum" → "plum". */
export function projectName(directory: string | null | undefined): string {
  const segments = (directory ?? '').split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] || 'Ohne Projekt';
}

/** The freshest activity stamp we have, live lifecycle beat first. */
export function sessionActivityAt(session: Session, lifecycle?: SessionLifecycleEvent | null) {
  return (
    lifecycle?.lastActivityAt ||
    session.runtime?.lastActivityAt ||
    session.lastActivity ||
    session.updatedAt ||
    session.createdAt
  );
}

export function sessionUnreadCount(session: Session): number {
  return Math.max(0, Number(session.unreadCount) || 0);
}

export type BoardColumn = 'needs-you' | 'working' | 'waiting' | 'done';

export const BOARD_COLUMNS: Array<{ value: BoardColumn; label: string }> = [
  { value: 'needs-you', label: 'Braucht dich' },
  { value: 'working', label: 'Arbeitet' },
  { value: 'waiting', label: 'Wartet' },
  { value: 'done', label: 'Erledigt' },
];

/**
 * Board column from the existing run state:
 * - Braucht dich: an approval or question blocks the session (`needs-you`), or it errored.
 * - Arbeitet: the agent is busy (`working`).
 * - Wartet: the process is alive but idle (`live-idle`), work is queued, or the
 *   last reply has not been read yet — the next move is yours, but nothing blocks.
 * - Erledigt: no process and nothing unread.
 */
export function boardColumn(session: Session, runState: SessionRunState): BoardColumn {
  if (runState.tone === 'needs-you' || runState.tone === 'error') return 'needs-you';
  if (runState.tone === 'working') return 'working';
  if (runState.tone === 'live-idle' || runState.queueDepth > 0 || sessionUnreadCount(session) > 0)
    return 'waiting';
  return 'done';
}

/** German labels for the run-state tones; the shared helper speaks English. */
export const TONE_LABEL: Record<SessionRunState['tone'], string> = {
  'needs-you': 'Braucht dich',
  working: 'Arbeitet',
  'live-idle': 'Bereit',
  idle: 'Ruht',
  error: 'Fehler',
};

/** One-line preview of the last message without Markdown noise. */
export function messagePreview(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
