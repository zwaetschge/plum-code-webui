import { z } from 'zod'

export const ADAPTER_KINDS = ['claude', 'codex', 'openai', 'echo'] as const
export type AdapterKind = (typeof ADAPTER_KINDS)[number]

/**
 * Konfiguration eines Ratsmitglieds.
 *
 * Geheimnisse stehen NICHT hier drin — sie liegen getrennt und werden von der
 * API nie zurückgeliefert, nur als `hasKey` angezeigt.
 */
export const agentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  adapter: z.enum(ADAPTER_KINDS).default('echo'),
  label: z.string().max(100).default(''),
  /** Modellname; leer heisst „Voreinstellung der CLI bzw. des Anbieters". */
  model: z.string().max(200).default(''),
  /** Tagesbudget in USD. null = unbegrenzt. */
  budgetUsd: z.number().min(0).max(10_000).nullable().default(null),

  // ─ claude ─
  permissionMode: z
    .enum(['plan', 'acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk'])
    .default('plan'),

  // ─ codex ─
  sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).default('read-only'),

  // ─ openai-kompatibel (GLM, Qwen, alles mit /chat/completions) ─
  baseUrl: z.union([z.literal(''), z.string().url().max(2_048)]).default(''),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(256).max(200_000).default(4096),
  /** Wird an die Rollenanweisung angehängt — für Eigenheiten des Modells. */
  systemExtra: z.string().max(10_000).default(''),
  /** Preis je 1M Token, für die Kostenrechnung. 0 = unbekannt. */
  pricePerMTokenIn: z.number().min(0).max(1_000_000).default(0),
  pricePerMTokenOut: z.number().min(0).max(1_000_000).default(0),

  timeoutSeconds: z.number().int().min(30).max(3600).default(600),
})

export type AgentConfig = z.infer<typeof agentConfigSchema>

export const agentsConfigSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  agentConfigSchema,
)
export type AgentsConfig = z.infer<typeof agentsConfigSchema>

export const DEFAULT_AGENTS: AgentsConfig = {
  claude: {
    ...agentConfigSchema.parse({}),
    adapter: 'echo',
    label: 'Claude Code',
  },
  codex: {
    ...agentConfigSchema.parse({}),
    adapter: 'echo',
    label: 'Codex',
  },
  glm: {
    ...agentConfigSchema.parse({}),
    adapter: 'echo',
    label: 'Hermes · GLM',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-4.6',
  },
  qwen: {
    ...agentConfigSchema.parse({}),
    adapter: 'echo',
    label: 'Hermes · Qwen',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
  },
  rat: {
    ...agentConfigSchema.parse({}),
    adapter: 'echo',
    label: 'Moderator',
  },
}

/** Was die Oberfläche über ein Mitglied wissen darf. */
export interface AgentStatus {
  id: string
  config: AgentConfig
  hasKey: boolean
  connected: boolean
  /** Von der CLI gemeldeter Anmeldezustand. */
  auth: { ok: boolean; detail: string; checkedAt: string } | null
  version: string | null
  spentToday: number
}

// ─── Steuerkanal zu den Runnern ──────────────────────────────────────────────

export const CONTROL_COMMANDS = [
  'status',
  'version',
  'login',
  'login-key',
  'import',
  'logout',
  'update',
  'ping',
] as const
export type ControlCommand = (typeof CONTROL_COMMANDS)[number]

export interface ControlResult {
  ok: boolean
  detail: string
  /** Bei `login`: die URL, die der Mensch im Browser öffnen muss. */
  url?: string
  /** Bei `login`: ob der Vorgang noch auf eine Eingabe wartet. */
  awaitingInput?: boolean
  /** Kennung, unter der die Eingabe nachgereicht wird. */
  runId?: string
  version?: string
}
