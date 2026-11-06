export * from './agents.js';
export * from './swarm.js';

import { z } from 'zod';

// ─── Kernbegriffe ────────────────────────────────────────────────────────────

export const SPACES = ['rat', 'ops', 'netz', 'proj'] as const;
export type Space = (typeof SPACES)[number];

export const ROOM_KINDS = ['chat', 'board', 'log', 'feed', 'project'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

export const EVENT_TYPES = [
  'message',
  'proposal',
  'critique',
  'verdict',
  'action_request',
  'action_result',
  'alert',
  'system',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const AGENTS = ['claude', 'codex', 'glm', 'qwen', 'rat'] as const;
export type AgentId = (typeof AGENTS)[number];

export const COUNCIL_MODES = ['broadcast', 'debatte', 'vote', 'lead', 'staffel', 'still'] as const;
export type CouncilMode = (typeof COUNCIL_MODES)[number];

export const RISK_LEVELS = ['green', 'yellow', 'red'] as const;
export type Risk = (typeof RISK_LEVELS)[number];

export const SEVERITIES = ['info', 'warn', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** `user:valentin` · `agent:claude` · `service:watcher-docker` · `system:core` */
export type SenderId = string;

// ─── Räume ───────────────────────────────────────────────────────────────────

export const notifyPolicySchema = z.object({
  level: z.enum(['all', 'mention', 'severity', 'off']).default('mention'),
  minSeverity: z.enum(SEVERITIES).optional(),
  sound: z.boolean().default(false),
});
export type NotifyPolicy = z.infer<typeof notifyPolicySchema>;

export const roomSchema = z.object({
  id: z.string(),
  space: z.enum(SPACES),
  name: z.string(),
  kind: z.enum(ROOM_KINDS),
  projectPath: z.string().nullable(),
  appendOnly: z.boolean(),
  retentionDays: z.number().int().nullable(),
  notify: notifyPolicySchema,
  position: z.number().int(),
  archivedAt: z.string().nullable(),
});
export type Room = z.infer<typeof roomSchema>;

// ─── Events ──────────────────────────────────────────────────────────────────

/** Jeder Event-Content hat `text` — die menschenlesbare Fassung. Immer. */
export const attachmentSchema = z.object({
  id: z.string().regex(/^me_[A-Za-z0-9_-]+$/),
  url: z.string().regex(/^\/api\/media\/me_[A-Za-z0-9_-]+$/),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(255),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(32 * 1024 * 1024),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const eventContentSchema = z
  .object({
    text: z.string().max(200_000),
    attachments: z.array(attachmentSchema).max(8).optional(),
  })
  .passthrough()
  .refine((v) => JSON.stringify(v).length <= 512_000, 'Ereignisinhalt ist zu groß');
export type EventContent = z.infer<typeof eventContentSchema>;

export const councilEventSchema = z.object({
  id: z.number(),
  roomId: z.string(),
  seq: z.number(),
  threadId: z.number().nullable(),
  sender: z.string(),
  type: z.enum(EVENT_TYPES),
  content: eventContentSchema,
  refId: z.string().nullable(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  redactedAt: z.string().nullable(),
});
export type CouncilEvent = z.infer<typeof councilEventSchema>;

export const sendEventSchema = z.object({
  type: z.enum(EVENT_TYPES).default('message'),
  content: eventContentSchema,
  threadId: z.number().int().positive().nullable().optional(),
  refId: z.string().max(512).nullable().optional(),
  /** Verhindert Doppel-Sends bei Reconnect. */
  clientId: z.string().min(8).max(64).optional(),
});
export type SendEvent = z.infer<typeof sendEventSchema>;

// ─── Sync ────────────────────────────────────────────────────────────────────

export const syncRequestSchema = z.object({
  cursors: z
    .record(z.string().min(1).max(128), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER))
    .refine((v) => Object.keys(v).length <= 200, 'Zu viele Raumzeiger'),
  limitPerRoom: z.number().int().min(1).max(1000).default(500),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

// ─── WebSocket-Protokoll (§5 PLAN.md) ────────────────────────────────────────

export type ServerFrame =
  | { t: 'hello'; user: string; scopes: string[]; rooms: Room[]; serverTime: string }
  | { t: 'batch'; roomId: string; events: CouncilEvent[]; hasMore: boolean }
  | { t: 'event'; roomId: string; seq: number; event: CouncilEvent }
  /** Streaming-Teilstück. Wird bewusst NICHT persistiert. */
  | {
      t: 'delta';
      jobId: number;
      agent: string;
      roomId: string;
      threadId: number | null;
      text: string;
    }
  | { t: 'final'; roomId: string; seq: number; event: CouncilEvent; jobId: number }
  | {
      t: 'patch';
      table: 'tasks' | 'action_requests' | 'alerts';
      id: string;
      fields: Record<string, unknown>;
    }
  | { t: 'read'; roomId: string; seq: number }
  | { t: 'pong'; ts: number }
  | { t: 'error'; code: string; message: string };

export type ClientFrame =
  | { t: 'sync'; cursors: Record<string, number> }
  | { t: 'read'; roomId: string; seq: number }
  | { t: 'ping'; ts: number };

export const clientFrameSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('sync'),
    cursors: z
      .record(z.string().min(1).max(128), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER))
      .refine((v) => Object.keys(v).length <= 200, 'Zu viele Raumzeiger'),
  }),
  z.object({
    t: z.literal('read'),
    roomId: z.string().min(1).max(128),
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  z.object({ t: z.literal('ping'), ts: z.number().finite() }),
]);

// ─── Identität ───────────────────────────────────────────────────────────────

export interface Identity {
  id: SenderId;
  kind: 'user' | 'service' | 'system';
  name: string;
  scopes: string[];
}

export const SCOPES = [
  'events:read',
  'events:write',
  'rooms:manage',
  'tasks:write',
  'actions:request',
  'actions:approve',
  /** Darf Aufträge aus der Warteschlange holen und Ergebnisse zurückmelden. */
  'runner',
  /**
   * Darf den Rat nur anhalten (Not-Aus), nie fortsetzen. Für den Schwarm-Hub:
   * `!stop` friert zuerst den Hub ein und ruft dann `/council/kill`
   * (PLAN-swarm §9.7, §15.6). Fortsetzen bleibt ein Mensch in der Rat-UI.
   */
  'council:halt',
  'admin',
] as const;
export type Scope = (typeof SCOPES)[number];

export function hasScope(id: Identity, scope: Scope): boolean {
  return id.scopes.includes('admin') || id.scopes.includes(scope);
}
