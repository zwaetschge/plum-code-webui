import { timingSafeEqual } from 'node:crypto'
import { env } from '../env.js'

export type AuthResult = { ok: true } | { ok: false; status: 401 | 403; error: string }

/**
 * Synapse schickt `Authorization: Bearer <hs_token>` (§10.1, 1).
 * Vergleich in konstanter Zeit: fehlt der Header → 401, falsches Token → 403.
 */
export function checkHsToken(header: string | undefined): AuthResult {
  if (!header) return { ok: false, status: 401, error: 'M_MISSING_TOKEN' }
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim()
  const a = Buffer.from(token)
  const b = Buffer.from(env.hsToken)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 403, error: 'M_UNKNOWN_TOKEN' }
  }
  return { ok: true }
}

/**
 * Namensraum des Appservice (§15.2): Puppets `@_sw_*`, der Hub selbst, und die
 * Aliase `#schwarm`, `#ag-*`, `#proj-*`. Ausserhalb davon darf der Hub nichts
 * versprechen — Synapse würde sonst Nutzer anlegen, die ihm nicht gehören.
 */
export function inUserNamespace(mxid: string, domain = env.domain): boolean {
  const suffix = `:${domain}`
  if (!mxid.endsWith(suffix)) return false
  const local = mxid.slice(1, mxid.length - suffix.length)
  return local === env.senderLocalpart || local.startsWith('_sw_')
}

export function inAliasNamespace(alias: string, domain = env.domain): boolean {
  const suffix = `:${domain}`
  if (!alias.endsWith(suffix)) return false
  const local = alias.slice(1, alias.length - suffix.length)
  return local === env.senderLocalpart || local.startsWith('ag-') || local.startsWith('proj-')
}
