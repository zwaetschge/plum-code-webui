/**
 * Zustandsmaschine der Aufträge (§8.3). Rein — keine Datenbank, damit die
 * Übergänge in den Einheitstests vollständig durchgespielt werden können.
 */
import {
  canTransition,
  isEndState,
  type ReactionSignal,
  type TaskState,
  SWARM_LIMITS,
} from '../protocol/index.js';

export interface SignalContext {
  state: TaskState;
  attempts: number;
  /** Offene Unteraufträge: ✅ schliesst dann nicht ab (§10.3). */
  openSubtasks: number;
  /** Kommt das Signal vom Zuständigen (Bot) bzw. vom Menschen? */
  fromAssignee: boolean;
  fromOwner: boolean;
}

export type SignalResult =
  | { kind: 'transition'; to: TaskState; note?: string; retry?: boolean }
  | { kind: 'priority'; value: 'high' | 'normal' }
  | { kind: 'ignored'; reason: string };

/**
 * Reaktion → Zustandsübergang. `retry` (🔁) ist kein Zustand: derselbe Auftrag
 * geht mit `attempts + 1` zurück auf `submitted`.
 */
export function applySignal(signal: ReactionSignal, ctx: SignalContext): SignalResult {
  const { state } = ctx;

  switch (signal) {
    case 'claim':
      if (!ctx.fromAssignee) return { kind: 'ignored', reason: '👀 kam nicht vom Zuständigen' };
      if (state !== 'submitted') return { kind: 'ignored', reason: `👀 im Zustand ${state}` };
      return { kind: 'transition', to: 'working' };

    case 'done':
      if (!ctx.fromAssignee) return { kind: 'ignored', reason: '✅ kam nicht vom Zuständigen' };
      if (isEndState(state)) return { kind: 'ignored', reason: `✅ im Endzustand ${state}` };
      if (state === 'submitted') {
        // Hermes setzt ✅ auch, wenn es nie ein 👀 gab (etwa nach einem Neustart).
        // Der Auftrag war dann offenbar bearbeitet — abgeschlossen wird trotzdem.
        if (ctx.openSubtasks > 0) {
          return {
            kind: 'transition',
            to: 'working',
            note: `wartet auf ${ctx.openSubtasks} Unterauftrag/Unteraufträge`,
          };
        }
        return { kind: 'transition', to: 'completed' };
      }
      if (state !== 'working' && state !== 'input-required') {
        return { kind: 'ignored', reason: `✅ im Zustand ${state}` };
      }
      if (ctx.openSubtasks > 0) {
        return {
          kind: 'transition',
          to: 'working',
          note: `wartet auf ${ctx.openSubtasks} Unterauftrag/Unteraufträge`,
        };
      }
      return { kind: 'transition', to: 'completed' };

    case 'fail':
      if (!ctx.fromAssignee) return { kind: 'ignored', reason: '❌ kam nicht vom Zuständigen' };
      if (isEndState(state)) return { kind: 'ignored', reason: `❌ im Endzustand ${state}` };
      if (ctx.attempts + 1 < SWARM_LIMITS.maxAttempts) {
        return {
          kind: 'transition',
          to: 'submitted',
          retry: true,
          note: `Versuch ${ctx.attempts + 2}/${SWARM_LIMITS.maxAttempts}`,
        };
      }
      return { kind: 'transition', to: 'failed' };

    case 'cancel':
      if (!ctx.fromOwner) return { kind: 'ignored', reason: '🛑 kam nicht vom Menschen' };
      if (isEndState(state)) return { kind: 'ignored', reason: `🛑 im Endzustand ${state}` };
      return { kind: 'transition', to: 'canceled' };

    case 'retry':
      if (!ctx.fromOwner) return { kind: 'ignored', reason: '🔁 kam nicht vom Menschen' };
      if (state !== 'failed' && state !== 'canceled' && !isEndState(state)) {
        return { kind: 'ignored', reason: `🔁 im Zustand ${state} — der Auftrag läuft noch` };
      }
      if (state === 'rejected')
        return { kind: 'ignored', reason: '🔁 auf einen abgelehnten Auftrag wirkt nicht' };
      return {
        kind: 'transition',
        to: 'submitted',
        retry: true,
        note: `Versuch ${ctx.attempts + 2}`,
      };

    case 'priority':
      if (!ctx.fromOwner) return { kind: 'ignored', reason: '⬆️ kam nicht vom Menschen' };
      if (isEndState(state)) return { kind: 'ignored', reason: `⬆️ im Endzustand ${state}` };
      return { kind: 'priority', value: 'high' };
  }
}

/** Explizite Übergänge aus dem Hub heraus (Watchdog, MCP, Befehle). */
export function transition(from: TaskState, to: TaskState): string | null {
  if (from === to) return null;
  if (!canTransition(from, to)) return `${from} → ${to} ist kein erlaubter Übergang`;
  return null;
}
