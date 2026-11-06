/**
 * Hub-Policy (§12.1): prüft jeden neuen Auftrag und jede Übergabe, *bevor*
 * etwas angelegt wird. Rein — die Fakten holt der Aufrufer aus der Datenbank.
 *
 * Reihenfolge ist Absicht: Der Kill-Switch schlägt alles, dann die Sperren,
 * dann Duplikate, dann die Ketten-Grenzen, dann Budget und Auslastung.
 * Auslastung lehnt nicht ab, sie reiht ein (`queued`).
 */
import { SWARM_LIMITS, type TaskState, type TRUST_LEVELS } from '../protocol/index.js';

type Trust = (typeof TRUST_LEVELS)[number];

const TRUST_RANG: Record<Trust, number> = { T0: 0, T1: 1, T2: 2 };

export interface PolicyAgent {
  id: string;
  status: 'online' | 'unresponsive' | 'offline';
  frozen: boolean;
  parallel: number;
  trust: Trust;
  budgetUsdDay: number | null;
  dailyCostUsd: number;
}

export interface PolicyFacts {
  agent: PolicyAgent;
  /** Hop des *neuen* Auftrags: Auftrag 0, Übergabe 1, Rückmeldung 2, … (§9.3). */
  hop: number;
  depth: number;
  /** Offene direkte Unteraufträge des Eltern-Auftrags. */
  fanOut: number;
  /** Alle Aufträge unter derselben Wurzel, inklusive der offenen. */
  tasksInRoot: number;
  /** Auftrag mit gleichem `prompt_hash` in den letzten 10 min, falls es einen gibt. */
  duplicateTaskId: string | null;
  /** Laufende Aufträge des Agenten (`submitted`, `working`, `input-required`). */
  runningForAssignee: number;
  trustRequired: Trust;
  swarmFrozen: boolean;
  /** `max_hops` aus der Raum-Policy (§8.5), sonst das globale Limit. */
  maxHops: number;
  /** Übergabe eines Bots an einen anderen — gegen dich gerichtet nie. */
  isHandoff: boolean;
  /** Betriebs-Aufträge mit gelber Fähigkeit: Freigabe unabhängig von Übergabe und Vertrauen (ADR-003 R2). */
  freigabePflicht?: boolean;
  /**
   * Rückmeldungen lehnt der Hub nie ab (§12.1): Sonst bliebe ein Auftrag ohne
   * Ergebnis hängen. Sie zählen als Hop, werden aber nicht begrenzt.
   */
  isRueckmeldung: boolean;
}

export type PolicyVerdict =
  | {
      ok: true;
      state: Extract<TaskState, 'submitted' | 'auth-required'>;
      queued: boolean;
      note?: string;
    }
  | { ok: false; code: string; reason: string };

export function checkPolicy(f: PolicyFacts): PolicyVerdict {
  if (f.swarmFrozen) {
    return {
      ok: false,
      code: 'kill-switch',
      reason: 'Der Schwarm ist eingefroren (!stop). Weiter mit !weiter.',
    };
  }
  if (f.agent.frozen) {
    return {
      ok: false,
      code: 'agent-frozen',
      reason: `${f.agent.id} ist eingefroren. Weiter mit !weiter @${f.agent.id}.`,
    };
  }
  if (f.duplicateTaskId) {
    return {
      ok: false,
      code: 'duplicate',
      reason: `Derselbe Auftrag läuft schon als ${f.duplicateTaskId} (Fenster ${SWARM_LIMITS.duplicateWindowMinutes} min).`,
    };
  }
  if (!f.isRueckmeldung && f.hop > f.maxHops) {
    return {
      ok: false,
      code: 'hops',
      reason: `Hop ${f.hop} über dem Limit von ${f.maxHops}. Die Kette ist zu Ende — ein neuer Auftrag startet eine neue.`,
    };
  }
  if (!f.isRueckmeldung && f.fanOut >= SWARM_LIMITS.maxFanOut) {
    return {
      ok: false,
      code: 'fan-out',
      reason: `Schon ${f.fanOut} direkte Unteraufträge (Limit ${SWARM_LIMITS.maxFanOut}).`,
    };
  }
  if (!f.isRueckmeldung && f.depth > SWARM_LIMITS.maxDepth) {
    return {
      ok: false,
      code: 'depth',
      reason: `Tiefe ${f.depth} über dem Limit von ${SWARM_LIMITS.maxDepth}.`,
    };
  }
  if (!f.isRueckmeldung && f.tasksInRoot >= SWARM_LIMITS.maxTasksPerRoot) {
    return {
      ok: false,
      code: 'root',
      reason: `${f.tasksInRoot} Aufträge unter dieser Wurzel (Limit ${SWARM_LIMITS.maxTasksPerRoot}).`,
    };
  }
  if (TRUST_RANG[f.agent.trust] < TRUST_RANG[f.trustRequired]) {
    return {
      ok: false,
      code: 'trust',
      reason: `${f.agent.id} ist ${f.agent.trust}, der Auftrag verlangt ${f.trustRequired}.`,
    };
  }
  if (f.agent.budgetUsdDay !== null && f.agent.dailyCostUsd >= f.agent.budgetUsdDay) {
    return {
      ok: false,
      code: 'budget',
      reason: `Tagesbudget von ${f.agent.id} ausgeschöpft (${f.agent.dailyCostUsd.toFixed(2)} von ${f.agent.budgetUsdDay.toFixed(2)} USD).`,
    };
  }
  if (f.agent.status === 'offline') {
    return { ok: false, code: 'offline', reason: `${f.agent.id} ist offline.` };
  }

  // Eine Übergabe an einen Operator mit Host-Zugriff braucht deine Freigabe (§7.3).
  const state =
    (f.isHandoff && f.agent.trust === 'T2') || f.freigabePflicht ? 'auth-required' : 'submitted';

  if (f.agent.status === 'unresponsive') {
    return {
      ok: true,
      state,
      queued: true,
      note: `${f.agent.id} gilt als nicht reagierend — Auftrag wartet.`,
    };
  }
  if (f.runningForAssignee >= f.agent.parallel) {
    return {
      ok: true,
      state,
      queued: true,
      note: `${f.agent.id} arbeitet schon an ${f.runningForAssignee} Auftrag/Aufträgen (Limit ${f.agent.parallel}) — eingereiht.`,
    };
  }
  return { ok: true, state, queued: false };
}

/**
 * Circuit-Breaker (§12.1): mehr als `breakerMessages` Nachrichten eines Agenten
 * in `breakerWindowMinutes` frieren ihn ein. Rein — zählt über Zeitstempel.
 */
export function breakerTripped(
  timestampsMs: number[],
  nowMs: number,
  limit = SWARM_LIMITS.breakerMessages,
  windowMinutes = SWARM_LIMITS.breakerWindowMinutes
): boolean {
  const since = nowMs - windowMinutes * 60_000;
  return timestampsMs.filter((t) => t >= since).length > limit;
}
