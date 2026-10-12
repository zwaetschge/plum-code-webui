/**
 * Einheiten der Worker als State-Event in der Lobby (matrix/PLAN-weiter.md, Punkt 17): Die App zeigt die
 * Plum-Sitzungen mit Zustand, Link und laufendem Auftrag, ohne `!plum` zu tippen und die Antwort zu lesen.
 *
 *   Typ ch.zwaetschge.swarm.einheiten · state_key = Agent (etwa `plum`)
 *   { v: 1, agent, at, verbunden, eintraege: [{ name, zustand, text, link, id, auftrag }] }
 *
 * Der Worker schickt `status` alle paar Sekunden neu. Ein State-Event geht nur raus, wenn sich etwas
 * geändert hat, und höchstens alle 20 s; eine Änderung dazwischen folgt am Ende der Pause, damit der
 * letzte Stand nie fehlt. `at` zählt beim Vergleich nicht mit. Ohne Änderung frischt ein `status` den
 * Stand alle 10 min auf: Die App wertet `at` nach 25 min als veraltet, auch wenn der Hub selbst steht.
 */
import { lobbyZustand } from './raumhinweis.js'
import type { Ctx } from './context.js'

export const EINHEITEN_EVENT = 'ch.zwaetschge.swarm.einheiten'
const PAUSE_MS = Number(process.env.EINHEITEN_PAUSE_MS || 20_000)
const AUFFRISCHEN_MS = Number(process.env.EINHEITEN_AUFFRISCHEN_MS || 600_000)

export interface EinheitEintrag {
  name: string
  zustand: string
  text: string
  link: string | null
  id?: string | null
  auftrag?: string | null
}

interface Stand {
  inhalt: string
  gesendet: number
  wartet: NodeJS.Timeout | null
  offen: { eintraege: EinheitEintrag[]; verbunden: boolean } | null
}

const staende = new Map<string, Stand>()

function vergleichbar(eintraege: EinheitEintrag[], verbunden: boolean): string {
  return JSON.stringify({ verbunden, eintraege })
}

export async function einheitenVeroeffentlichen(
  ctx: Ctx,
  agent: string,
  eintraege: EinheitEintrag[],
  verbunden = true,
  jetzt = Date.now(),
): Promise<'gesendet' | 'gleich' | 'spaeter'> {
  const s = staende.get(agent) ?? { inhalt: '', gesendet: 0, wartet: null, offen: null }
  staende.set(agent, s)
  const inhalt = vergleichbar(eintraege, verbunden)
  const auffrischen = jetzt - s.gesendet >= AUFFRISCHEN_MS
  if (inhalt === s.inhalt && !s.offen && !auffrischen) return 'gleich'
  if (jetzt - s.gesendet < PAUSE_MS) {
    s.offen = { eintraege, verbunden }
    if (!s.wartet) {
      s.wartet = setTimeout(() => {
        s.wartet = null
        const offen = s.offen
        s.offen = null
        if (offen) void einheitenVeroeffentlichen(ctx, agent, offen.eintraege, offen.verbunden).catch((err) =>
          ctx.log.warn({ err, agent }, 'Einheiten-Stand nicht veröffentlicht'))
      }, PAUSE_MS - (jetzt - s.gesendet) + 50)
      s.wartet.unref?.()
    }
    return 'spaeter'
  }
  s.offen = null
  if (inhalt === s.inhalt && !auffrischen) return 'gleich'
  const ok = await lobbyZustand(ctx, EINHEITEN_EVENT, agent, {
    v: 1,
    agent,
    at: jetzt,
    verbunden,
    eintraege: eintraege.map((e) => ({
      name: e.name,
      zustand: e.zustand,
      text: e.text,
      link: e.link,
      ...(e.id ? { id: e.id } : {}),
      ...(e.auftrag ? { auftrag: e.auftrag } : {}),
    })),
  })
  if (ok) {
    s.inhalt = inhalt
    s.gesendet = jetzt
  }
  return ok ? 'gesendet' : 'spaeter'
}
