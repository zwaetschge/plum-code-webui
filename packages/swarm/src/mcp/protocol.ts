/**
 * MCP Streamable HTTP ohne SDK (§14.1: „Kein Matrix-SDK", dasselbe gilt hier).
 * Der Hub beantwortet JSON-RPC über `POST /mcp` mit `application/json` — die
 * SSE-Variante braucht es nicht, weil jedes Werkzeug sofort antwortet.
 *
 * Auth: Bearer-Token mit Zweck `mcp` aus `swarm.tokens`, bei jedem Aufruf
 * geprüft, ohne Cache (§11.3). Sampling ist aus (O12): Der Hub ruft nie selbst
 * ein Modell des Agenten auf.
 */
import type { FastifyInstance } from 'fastify'
import { audit } from '../db/audit.js'
import { verifyToken } from '../tokens.js'
import { widerrufenMelden } from '../tokenpflege.js'
import type { Ctx } from '../context.js'
import { VERFASSUNG, WERKZEUGE, WerkzeugFehler, werkzeug } from './tools.js'

const PROTOKOLL_VERSION = '2025-06-18'
const BEKANNTE_VERSIONEN = ['2024-11-05', '2025-03-26', '2025-06-18']

/**
 * Drosselung pro MCP-Token (ADR-002 §4.27). `/hooks/notify` kennt sie längst,
 * das MCP nicht — ein Agent in einer Schleife könnte sonst `task_create` und
 * `handoff` fluten und damit Outbox, Board und Lobby lahmlegen. Der Eimer füllt
 * sich gleichmässig; der Handshake bleibt frei, damit niemand ausgesperrt wird,
 * während er sich einrichtet.
 */
const PRO_MINUTE = Number(process.env.MCP_RATE_PRO_MINUTE || 120)
const BURST = Number(process.env.MCP_RATE_BURST || 30)
const FREI = new Set(['initialize', 'notifications/initialized', 'ping', 'tools/list'])

interface Eimer { marken: number; zeit: number; gemeldet: number }
const eimer = new Map<string, Eimer>()

function imTakt(schluessel: string, kosten: number): { ok: boolean; warteSekunden: number } {
  const jetzt = Date.now()
  // Nicht endlos sammeln: Ein Token, das lange still war, bekommt höchstens BURST.
  if (eimer.size > 256) {
    for (const [k, e] of eimer) if (jetzt - e.zeit > 10 * 60_000) eimer.delete(k)
  }
  const e = eimer.get(schluessel) ?? { marken: BURST, zeit: jetzt, gemeldet: 0 }
  e.marken = Math.min(BURST, e.marken + ((jetzt - e.zeit) / 60_000) * PRO_MINUTE)
  e.zeit = jetzt
  if (e.marken < kosten) {
    eimer.set(schluessel, e)
    return { ok: false, warteSekunden: Math.max(1, Math.ceil(((kosten - e.marken) / PRO_MINUTE) * 60)) }
  }
  e.marken -= kosten
  eimer.set(schluessel, e)
  return { ok: true, warteSekunden: 0 }
}

interface RpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

function antwort(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}
function fehler(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export async function mcpRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  // Der Server braucht kein SSE-Angebot: 405 ist die vorgesehene Antwort, wenn
  // ein Server keinen Server-zu-Client-Strom öffnet.
  app.get('/mcp', async (_req, reply) => reply.code(405).send({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Dieser MCP-Server antwortet nur auf POST.' },
  }))
  app.delete('/mcp', async (_req, reply) => reply.code(405).send({}))

  app.post('/mcp', async (req, reply) => {
    const auth = req.headers.authorization
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    const identitaet = token ? await verifyToken(token, 'mcp') : null
    if (!identitaet) {
      // Ein widerrufenes Token meldet der Hub (matrix/PLAN-weiter.md, Punkt 5).
      if (token) void widerrufenMelden(ctx, token, 'mcp').catch(() => {})
      return reply.code(401).send(fehler(null, -32001, 'Kein gültiges MCP-Token (Zweck mcp)'))
    }

    const roh = req.body as RpcRequest | RpcRequest[] | undefined
    const anfragen = Array.isArray(roh) ? roh : roh ? [roh] : []
    if (anfragen.length === 0) {
      return reply.code(400).send(fehler(null, -32600, 'Leere Anfrage'))
    }

    // Jede JSON-RPC-Anfrage im Stapel kostet eine Marke — ein Stapel darf die
    // Drosselung nicht umgehen.
    const kosten = anfragen.filter((a) => !FREI.has(String(a?.method ?? ''))).length
    const tokenId = String(identitaet.tokenId)
    if (kosten > 0) {
      const takt = imTakt(tokenId, kosten)
      if (!takt.ok) {
        const e = eimer.get(tokenId)
        // Höchstens einmal pro Minute ins Audit, sonst füllt die Drosselung es selbst.
        if (e && Date.now() - e.gemeldet > 60_000) {
          e.gemeldet = Date.now()
          await audit(identitaet.agent, 'mcp.gedrosselt', null, {
            tokenId, kosten, proMinute: PRO_MINUTE, warteSekunden: takt.warteSekunden,
          })
        }
        reply.header('retry-after', String(takt.warteSekunden))
        return reply.code(429).send(fehler(anfragen[0]?.id ?? null, -32029,
          `Zu viele MCP-Aufrufe: höchstens ${PRO_MINUTE} pro Minute. Erneut versuchen in ${takt.warteSekunden} s.`))
      }
    }

    const ausgaben: unknown[] = []
    for (const anfrage of anfragen) {
      // Notifications (ohne id) beantwortet der Hub nicht: `bearbeite` liefert null.
      const kopf = String(req.headers['x-plum-session'] ?? '')
      const sitzung = identitaet.agent === 'plum' && /^[A-Za-z0-9_-]{8,64}$/.test(kopf) ? kopf : undefined
      const antw = await bearbeite(ctx, identitaet.agent, identitaet.tokenId, anfrage, anfrage?.id ?? null, sitzung)
      if (antw !== null) ausgaben.push(antw)
    }

    if (ausgaben.length === 0) return reply.code(202).send()
    reply.header('content-type', 'application/json')
    return reply.code(200).send(Array.isArray(roh) ? ausgaben : ausgaben[0])
  })
}

async function bearbeite(
  ctx: Ctx,
  agent: string,
  tokenId: number,
  anfrage: RpcRequest,
  id: string | number | null,
  sitzung?: string,
): Promise<unknown> {
  const method = anfrage?.method ?? ''
  const params = (anfrage?.params ?? {}) as Record<string, unknown>

  switch (method) {
    case 'initialize': {
      const wanted = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      return antwort(id, {
        protocolVersion: BEKANNTE_VERSIONEN.includes(wanted) ? wanted : PROTOKOLL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'council-matrix', version: '0.1.0' },
        instructions: VERFASSUNG,
      })
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null

    case 'ping':
      return antwort(id, {})

    case 'tools/list':
      return antwort(id, {
        tools: WERKZEUGE.map((w) => ({
          name: w.name,
          description: w.description,
          inputSchema: w.inputSchema,
        })),
      })

    case 'tools/call': {
      const name = String(params.name ?? '')
      const w = werkzeug(name)
      if (!w) return antwort(id, { content: [{ type: 'text', text: `Unbekanntes Werkzeug „${name}"` }], isError: true })
      const args = (params.arguments ?? {}) as Record<string, unknown>
      const start = Date.now()
      try {
        const ergebnis = await w.handler({ ctx, agent, tokenId, ...(sitzung ? { sitzung } : {}) }, args)
        ctx.log.debug({ agent, werkzeug: name, ms: Date.now() - start }, 'MCP-Aufruf')
        return antwort(id, {
          content: [{ type: 'text', text: typeof ergebnis === 'string' ? ergebnis : JSON.stringify(ergebnis, null, 1) }],
          isError: false,
        })
      } catch (err) {
        const meldung = err instanceof WerkzeugFehler
          ? err.message
          : `Interner Fehler: ${err instanceof Error ? err.message : String(err)}`
        ctx.log.error({ err, agent, werkzeug: name }, 'MCP-Aufruf fehlgeschlagen')
        return antwort(id, { content: [{ type: 'text', text: meldung }], isError: true })
      }
    }

    default:
      return fehler(id, -32601, `Methode ${method || '(leer)'} gibt es hier nicht`)
  }
}
