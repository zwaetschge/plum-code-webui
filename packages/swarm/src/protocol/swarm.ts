/**
 * Schwarm-Protokoll v1 (PLAN-swarm §8, ADR-002).
 *
 * Hier stehen die Begriffe, die Hub und Rat teilen: Zustände und ihre Übergänge,
 * Auftragskarte, Agent Card, Raum-Policy und die Reaktionen, die etwas bedeuten.
 * Bewusst ohne Matrix-SDK und ohne Datenbank — reine Typen und Tabellen.
 */
import { z } from 'zod'

// ─── Aufträge ───────────────────────────────────────────────────────────────

/** Die acht A2A-Zustände (§8.3). Endzustände bleiben unverändert. */
export const TASK_STATES = [
  'submitted',
  'working',
  'input-required',
  'auth-required',
  'completed',
  'failed',
  'canceled',
  'rejected',
] as const
export type TaskState = (typeof TASK_STATES)[number]

export const TASK_END_STATES = ['completed', 'failed', 'canceled', 'rejected'] as const

/**
 * Wer wohin darf. `retry` ist kein eigener Zustand: 🔁 führt denselben Auftrag
 * mit `attempts + 1` auf `submitted` zurück (§8.3).
 */
export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  // `failed` aus submitted ist der Watchdog-Fall: niemand hat den Auftrag
  // überhaupt angenommen (§10.4, stalled).
  submitted: ['working', 'auth-required', 'rejected', 'canceled', 'failed'],
  'auth-required': ['submitted', 'canceled', 'rejected'],
  working: ['completed', 'failed', 'canceled', 'input-required', 'submitted'],
  'input-required': ['working', 'completed', 'canceled', 'failed'],
  completed: [],
  failed: ['submitted', 'canceled'],
  canceled: ['submitted'],   // 🔁 startet einen neuen Versuch (§8.3)
  rejected: [],
}

export function isEndState(state: TaskState): boolean {
  return (TASK_END_STATES as readonly string[]).includes(state)
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to)
}

// ─── Agenten ────────────────────────────────────────────────────────────────

export const AGENT_LEVELS = ['L0', 'L1', 'L2', 'L3'] as const
export const TRUST_LEVELS = ['T0', 'T1', 'T2'] as const
export const AGENT_MODES = ['native', 'worker', 'gateway', 'council', 'notify'] as const
export const AGENT_STATUS = ['online', 'unresponsive', 'offline'] as const

/** Puppets beginnen mit `_`, der Hub selbst nicht (§7.1). */
export const PUPPET_PREFIX = '@_sw_'

export function isPuppet(mxid: string): boolean {
  return mxid.startsWith(PUPPET_PREFIX)
}

/**
 * Reaktionen sind Signale (§8.1, Regel 6). 👀 ✅ ❌ kommen vom Bot,
 * 🛑 🔁 ⬆️ nur vom Menschen — Bedien-Reaktionen von Bots zählt der Hub nicht.
 */
export const REACTION_SIGNALS = {
  '👀': 'claim',
  '✅': 'done',
  '❌': 'fail',
  '🛑': 'cancel',
  '🔁': 'retry',
  '⬆️': 'priority',
} as const
export type ReactionSignal = (typeof REACTION_SIGNALS)[keyof typeof REACTION_SIGNALS]

export function reactionSignal(key: string | undefined): ReactionSignal | null {
  return (key && (REACTION_SIGNALS as Record<string, ReactionSignal>)[key]) || null
}

/** Bot-Signale und Mensch-Signale getrennt: wer darf was auslösen. */
export const BOT_SIGNALS: readonly ReactionSignal[] = ['claim', 'done', 'fail']
export const HUMAN_SIGNALS: readonly ReactionSignal[] = ['cancel', 'retry', 'priority']

// ─── Felder und Event-Typen auf der Leitung ─────────────────────────────────

export const SWARM_TASK_FIELD = 'ch.zwaetschge.swarm.task'
/** Trägt jede Ausgabe des Hubs, damit er sein eigenes Event wiedererkennt (§10.2). */
export const SWARM_OUT_FIELD = 'ch.zwaetschge.swarm.out'
export const SWARM_AGENT_EVENT = 'ch.zwaetschge.swarm.agent'
export const SWARM_ROOM_EVENT = 'ch.zwaetschge.swarm.room'

export const ROOM_KINDS_SWARM = [
  'lobby',
  'board',
  'approvals',
  'log',
  'alerts',
  'work',
  'project',
  'mirror',
] as const

// ─── Schemata ───────────────────────────────────────────────────────────────

export const TaskBudget = z.object({
  usd: z.number().nonnegative().optional(),
  minutes: z.number().nonnegative().optional(),
})

/** `ch.zwaetschge.swarm.task` in der Auftragskarte (§8.2). */
export const TaskCardContent = z.object({
  v: z.literal(1),
  id: z.string(),
  root: z.string(),
  parent: z.string().nullable(),
  correlation_id: z.string().uuid(),
  state: z.enum(TASK_STATES),
  from: z.string(),
  assignee: z.string(),
  hop: z.number().int().nonnegative(),
  depth: z.number().int().nonnegative(),
  goal: z.string(),
  deliverable: z.string(),
  constraints: z.array(z.string()).default([]),
  budget: TaskBudget.default({}),
  deadline: z.string().datetime({ offset: true }).nullable().optional(),
  trust_required: z.enum(TRUST_LEVELS).default('T1'),
  board: z.string().optional(),
})
export type TaskCardContent = z.infer<typeof TaskCardContent>

/** `ch.zwaetschge.swarm.agent`, state_key ist die Agent-ID (§8.4). */
export const AgentCardContent = z.object({
  v: z.literal(1),
  id: z.string(),
  name: z.string(),
  level: z.enum(AGENT_LEVELS),
  trust: z.enum(TRUST_LEVELS),
  mode: z.enum(AGENT_MODES),
  runtime: z.string().optional(),
  model: z.string().optional(),
  owner: z.string(),
  room: z.string().optional(),
  skills: z.array(z.string()).default([]),
  accepts: z.array(z.string()).default([]),
  limits: z
    .object({
      parallel: z.number().int().positive().default(1),
      budget_usd_day: z.number().nonnegative().optional(),
      usd_per_minute: z.number().nonnegative().optional(),
    })
    .default({ parallel: 1 }),
  status: z.enum(AGENT_STATUS).default('offline'),
})
export type AgentCardContent = z.infer<typeof AgentCardContent>

/** `ch.zwaetschge.swarm.room` (§8.5). */
export const RoomPolicyContent = z.object({
  v: z.literal(1),
  kind: z.enum(ROOM_KINDS_SWARM),
  agent: z.string().optional(),
  handoffs: z.boolean().default(true),
  max_hops: z.number().int().positive().default(4),
})
export type RoomPolicyContent = z.infer<typeof RoomPolicyContent>

// ─── Grenzen (§12.1) ────────────────────────────────────────────────────────

export const SWARM_LIMITS = {
  maxHops: 4,
  maxFanOut: 3,
  maxDepth: 3,
  maxTasksPerRoot: 10,
  /** Gleicher prompt_hash innerhalb dieser Fenster gilt als Duplikat (§10.3). */
  duplicateWindowMinutes: 10,
  /** Circuit-Breaker: so viele Nachrichten eines Agenten in breakerWindowMinutes. */
  breakerMessages: 20,
  breakerWindowMinutes: 5,
  defaultBudgetUsd: 0.5,
  defaultBudgetMinutes: 20,
  defaultDeadlineHours: 2,
  /** Automatische Neuversuche nach ❌ (§10.3). */
  maxAttempts: 2,
} as const
