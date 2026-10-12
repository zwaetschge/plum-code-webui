/**
 * `ops/matrix/agents.swarm.yaml` → `swarm.agents` (§15.5). Die Datei ist die
 * Betriebskonfiguration, die Datenbank die Wahrheit zur Laufzeit; `syncAgents`
 * ist idempotent und überschreibt keine Laufzeitfelder (`status`, `frozen`).
 */
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { z } from 'zod'
import { AGENT_LEVELS, AGENT_MODES, TRUST_LEVELS } from '../protocol/index.js'
import { sql } from '../db/index.js'
import { upsertAgent } from './store.js'
import { env } from '../env.js'

const AgentYaml = z.object({
  mxid: z.string(),
  name: z.string().optional(),
  level: z.enum(AGENT_LEVELS),
  trust: z.enum(TRUST_LEVELS),
  mode: z.enum(AGENT_MODES),
  room: z.string().optional(),
  runtime: z.string().optional(),
  model: z.string().optional(),
  skills: z.array(z.string()).default([]),
  accepts: z.array(z.string()).default([]),
  limits: z
    .object({ parallel: z.number().int().positive().default(1), budget_usd_day: z.number().nonnegative().optional() })
    .default({ parallel: 1 }),
  usd_per_minute: z.number().nonnegative().optional(),
  defaults: z
    .object({
      deliverable: z.string().optional(),
      budget: z.object({ usd: z.number().nonnegative().optional(), minutes: z.number().nonnegative().optional() }).optional(),
      deadline: z.string().optional(),
    })
    .optional(),
  puppets: z.array(z.string()).default([]),
})

export interface AgentConfig extends z.infer<typeof AgentYaml> {
  id: string
}

export async function loadAgents(file = env.agentsFile): Promise<Record<string, AgentConfig>> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return {}
  }
  const doc = parse(raw) as { agents?: Record<string, unknown> } | null
  const out: Record<string, AgentConfig> = {}
  for (const [id, value] of Object.entries(doc?.agents ?? {})) {
    const parsed = AgentYaml.safeParse(value)
    if (!parsed.success) {
      throw new Error(`agents.swarm.yaml: ${id} ist unvollständig — ${parsed.error.issues[0]?.message ?? '?'}`)
    }
    out[id] = { id, ...parsed.data }
  }
  return out
}

/** `deadline: 2h` → ISO-Zeitstempel. Mehr braucht es für den Standard nicht. */
export function deadlineFrom(spec: string | undefined, fallbackHours = 2): string {
  const ms = spec ? parseDuration(spec) : fallbackHours * 3600_000
  return new Date(Date.now() + ms).toISOString()
}

export function parseDuration(spec: string): number {
  const m = /^(\d+(?:[.,]\d+)?)\s*(min|h|d|s)$/.exec(spec.trim())
  if (!m) return 2 * 3600_000
  const wert = Number(m[1]!.replace(',', '.'))
  const einheit = m[2]
  return wert * (einheit === 's' ? 1000 : einheit === 'min' ? 60_000 : einheit === 'h' ? 3600_000 : 86_400_000)
}

export async function syncAgents(file = env.agentsFile): Promise<Record<string, AgentConfig>> {
  const configs = await loadAgents(file)
  for (const a of Object.values(configs)) {
    await upsertAgent(
      {
        id: a.id,
        mxid: a.mxid,
        displayName: a.name ?? a.id,
        level: a.level,
        trust: a.trust,
        mode: a.mode,
        parallel: a.limits.parallel,
        budgetUsdDay: a.limits.budget_usd_day ?? null,
        usdPerMinute: a.usd_per_minute ?? null,
        skills: a.skills,
        accepts: a.accepts,
      },
      sql,
    )
  }
  // Bis der Watchdog etwas anderes sieht, gilt ein eingetragener Agent als
  // erreichbar: Sonst könnte der Hub keinen einzigen Auftrag anlegen, bevor der
  // Agent zufällig etwas schreibt (§8.4). `last_seen` bleibt die Evidenz.
  await sql`
    UPDATE swarm.agents SET status = 'online'
    WHERE status = 'offline' AND last_seen IS NULL`
  return configs
}
