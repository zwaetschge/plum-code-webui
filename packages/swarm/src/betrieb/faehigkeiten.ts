/**
 * Fähigkeiten des Betriebs im Schwarm (ADR-003 R2): `ops/matrix/faehigkeiten.yaml` → Risiko,
 * Zielart und Sperrliste. Ersetzt den Broker des Rats. Grün führt der Worker `betrieb` sofort aus,
 * gelb erst nach Vales ✅ (R1), rot und Unbekanntes gar nicht.
 */
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { oeffentlicheIp } from '../netz.js'

export type Risiko = 'green' | 'yellow' | 'red'
export type Zielart = 'filter' | 'container' | 'domain' | 'ip' | 'keins'

export interface Faehigkeit {
  name: string
  risk: Risiko
  ziel: Zielart
  beschreibung: string
  gesperrt: string[]
}

const DATEI = process.env.FAEHIGKEITEN_FILE || '/app/ops/matrix/faehigkeiten.yaml'
const CONTAINER = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/
const FILTER = /^[a-zA-Z0-9._-]{0,64}$/
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

let zwischen: { at: number; liste: Faehigkeit[] } | null = null

export async function faehigkeitenLaden(datei = DATEI): Promise<Faehigkeit[]> {
  if (zwischen && Date.now() - zwischen.at < 60_000) return zwischen.liste
  let roh: string
  try {
    roh = await readFile(datei, 'utf8')
  } catch {
    return []
  }
  const doc = parse(roh) as { faehigkeiten?: Record<string, Record<string, unknown>> } | null
  const liste: Faehigkeit[] = []
  for (const [name, f] of Object.entries(doc?.faehigkeiten ?? {})) {
    const risk = String(f.risk ?? '')
    const ziel = String(f.ziel ?? 'keins')
    if (!['green', 'yellow', 'red'].includes(risk) || !['filter', 'container', 'domain', 'ip', 'keins'].includes(ziel)) continue
    liste.push({
      name,
      risk: risk as Risiko,
      ziel: ziel as Zielart,
      beschreibung: String(f.beschreibung ?? ''),
      gesperrt: Array.isArray(f.gesperrt) ? f.gesperrt.map(String) : [],
    })
  }
  zwischen = { at: Date.now(), liste }
  return liste
}

/** `authelia*` sperrt alles, was so beginnt; sonst gilt der genaue Name. */
export function gesperrt(f: Faehigkeit, ziel: string): boolean {
  const z = ziel.toLowerCase()
  return f.gesperrt.some((m) => (m.endsWith('*') ? z.startsWith(m.slice(0, -1).toLowerCase()) : z === m.toLowerCase()))
}

/** Normalisiertes Ziel oder ein Fehlertext. */
export function zielPruefen(f: Faehigkeit, roh: unknown): { ziel: string } | { fehler: string } {
  const ziel = String(roh ?? '').trim()
  switch (f.ziel) {
    case 'keins':
      return { ziel: '-' }
    case 'filter':
      return FILTER.test(ziel) ? { ziel: ziel || 'alle' } : { fehler: `„${ziel}“ ist kein gültiger Filter` }
    case 'domain': {
      const d = ziel.toLowerCase()
      return DOMAIN.test(d) ? { ziel: d } : { fehler: `„${ziel}“ ist keine gültige Domain` }
    }
    case 'ip': {
      // Türsteher (matrix/PLAN-weiter.md, Punkt 4): nur öffentliche Adressen, private sperrt er nie.
      const ip = oeffentlicheIp(ziel)
      return ip ? { ziel: ip } : { fehler: `„${ziel}“ ist keine öffentliche IP-Adresse` }
    }
    case 'container':
      if (!CONTAINER.test(ziel)) return { fehler: `„${ziel}“ ist kein gültiger Containername` }
      if (gesperrt(f, ziel)) return { fehler: `${f.name} auf ${ziel} ist gesperrt (ops/matrix/faehigkeiten.yaml)` }
      return { ziel }
  }
}

/** Nur bekannte Argumente, damit nichts Beliebiges beim Worker ankommt. */
export function argumente(f: Faehigkeit, roh: unknown): Record<string, unknown> {
  const a = roh && typeof roh === 'object' ? (roh as Record<string, unknown>) : {}
  if (f.name === 'docker.logs' && a.tail !== undefined) {
    const n = Math.trunc(Number(a.tail))
    return Number.isFinite(n) ? { tail: Math.max(1, Math.min(n, 1000)) } : {}
  }
  if (f.name === 'tuersteher.entsperren' && typeof a.grund === 'string') {
    return { grund: a.grund.replace(/[\r\n#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) }
  }
  return {}
}
