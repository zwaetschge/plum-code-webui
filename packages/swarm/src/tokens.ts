/**
 * Tokens der Agenten (§11.3, §14.2): gespeichert wird nur der SHA-256, geprüft
 * bei jedem Aufruf ohne Cache — eine Sperre wirkt also sofort (N5).
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { sql } from './db/index.js'

/** `absprache`: Sitzungen melden Absprachen (matrix/PLAN-weiter.md, Punkt 2), sonst nichts. */
export type TokenZweck = 'mcp' | 'worker' | 'notify' | 'absprache'

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface TokenIdentitaet {
  tokenId: number
  agent: string
  purpose: TokenZweck
}

/**
 * Bearer-Token prüfen. `timingSafeEqual` über den Hash ist doppelt gemoppelt
 * (der Hash-Vergleich in der Datenbank ist es schon), kostet aber nichts und
 * hält den Weg konstant, falls jemand später den Vergleich ins Programm zieht.
 */
export async function verifyToken(raw: string, zweck: TokenZweck): Promise<TokenIdentitaet | null> {
  if (!raw || raw.length < 8) return null
  const hash = hashToken(raw)
  const rows = (await sql`
    SELECT id, agent, purpose, hash FROM swarm.tokens
    WHERE revoked_at IS NULL AND purpose = ${zweck}`) as unknown as
    { id: number; agent: string; purpose: string; hash: string }[]
  const treffer = rows.find(
    (r) => r.hash.length === hash.length && timingSafeEqual(Buffer.from(r.hash), Buffer.from(hash)),
  )
  if (!treffer) return null
  // Ohne await: ein Last-Used-Stempel darf keinen Aufruf verzögern.
  void sql`UPDATE swarm.tokens SET last_used_at = now() WHERE id = ${treffer.id}`.catch(() => {})
  return { tokenId: Number(treffer.id), agent: treffer.agent as string, purpose: treffer.purpose as TokenZweck }
}

/**
 * Gehört das Token zu einem widerrufenen Eintrag? Dann nennt es den Agenten. So fällt auf, wenn ein
 * Melder still mit einem alten Token scheitert (am 2026-09-26 der Autoupdater, fünf Stunden lang).
 */
export async function widerrufenVon(raw: string, zweck: TokenZweck): Promise<string | null> {
  if (!raw || raw.length < 8) return null
  const [z] = await sql`
    SELECT agent FROM swarm.tokens
     WHERE hash = ${hashToken(raw)} AND purpose = ${zweck} AND revoked_at IS NOT NULL
     LIMIT 1`
  return (z?.agent as string | undefined) ?? null
}

export async function revokeAgent(agent: string, zweck?: TokenZweck): Promise<number> {
  const rows = zweck
    ? await sql`
        UPDATE swarm.tokens SET revoked_at = now()
        WHERE agent = ${agent} AND purpose = ${zweck} AND revoked_at IS NULL RETURNING id`
    : await sql`
        UPDATE swarm.tokens SET revoked_at = now()
        WHERE agent = ${agent} AND revoked_at IS NULL RETURNING id`
  return rows.length
}
