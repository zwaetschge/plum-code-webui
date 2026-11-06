/**
 * Abo-Stand und anbieterbewusste Zuteilung (matrix/PLAN-weiter.md, Punkt 7).
 *
 * Code-Aufträge hängen an Abos (Claude, Codex, Z.AI). Worker melden ihr Kontingent im Frame `status`:
 *
 *   { type: 'status', kontingente: [{ anbieter: 'claude', fenster: '5h', auslastung: 0.42, zurueck: '…Z' }] }
 *
 * Der Hub merkt sich den letzten Stand je Agent (im Speicher, die Worker schicken ihn regelmässig), zeigt
 * ihn mit `!abo`, schreibt ihn als State-Event `ch.zwaetschge.swarm.kontingente` für die App und leitet
 * Code-Aufträge um, wenn das Kontingent des Ziels fast leer ist (ab 95 % in einem Fenster), nur wenn die
 * Rückfallebene verbunden ist und selbst Luft hat. Seit 28.09. codet Plum, Claude Code gibt die Zweitmeinung,
 * und Codex fällt am 5.10. weg: claude-code → plum, plum → claude-code, codex-host → plum.
 * `SCHWARM_RUECKFALL="a:b,c:d"` stellt es anders ein (die älteren Tests nutzen claude-code ↔ codex-host).
 */
import { lobbyZustand, uhrzeit } from './raumhinweis.js';
import { reply } from './reply.js';
import { sql, type Db } from './db/index.js';
import { auditMerken } from './db/audit.js';
import type { Ctx } from './context.js';

export const KONTINGENTE_EVENT = 'ch.zwaetschge.swarm.kontingente';
/** Wer wohin ausweicht. */
export const RUECKFALL: Record<string, string> = Object.fromEntries(
  (process.env.SCHWARM_RUECKFALL || 'claude-code:plum,plum:claude-code,codex-host:plum')
    .split(',')
    .map((p) => p.split(':').map((x) => x.trim()))
    .filter((p) => p.length === 2 && p[0] && p[1]) as [string, string][]
);
const VOLL = Number(process.env.KONTINGENT_VOLL || 0.95);
const LUFT = Number(process.env.KONTINGENT_LUFT || 0.9);
/** Ein Stand, der älter ist, zählt nicht mehr (der Worker ist weg oder meldet nicht). */
const FRISCH_MS = 2 * 3600_000;

export interface Kontingent {
  anbieter: string;
  fenster: string;
  auslastung: number | null;
  zurueck: string | null;
}

const staende = new Map<string, { at: number; eintraege: Kontingent[] }>();
let veroeffentlicht = '';
let verbundenVon: () => Set<string> = () => new Set();

/** worker/server.ts meldet, wer verbunden ist (vermeidet einen Import im Kreis). */
export function verbundeneQuelle(f: () => Set<string>): void {
  verbundenVon = f;
}

export function kontingenteLesen(roh: unknown): Kontingent[] {
  return (Array.isArray(roh) ? roh : [])
    .slice(0, 8)
    .map((e) => {
      const r = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
      const wert = Number(r.auslastung);
      const zurueck =
        typeof r.zurueck === 'string' && !Number.isNaN(Date.parse(r.zurueck))
          ? new Date(r.zurueck).toISOString()
          : null;
      return {
        anbieter: String(r.anbieter ?? '')
          .replace(/[^\w.-]/g, '')
          .slice(0, 20),
        fenster: String(r.fenster ?? '')
          .replace(/[^\w.-]/g, '')
          .slice(0, 12),
        auslastung:
          r.auslastung === null || r.auslastung === undefined || !Number.isFinite(wert)
            ? null
            : Math.max(0, Math.min(1, wert)),
        zurueck,
      };
    })
    .filter((k) => k.anbieter);
}

export function kontingentMelden(agent: string, roh: unknown, jetzt = Date.now()): void {
  const eintraege = kontingenteLesen(roh);
  if (eintraege.length) staende.set(agent, { at: jetzt, eintraege });
}

/** Höchste Auslastung eines Agenten über alle Fenster, nur aus einem frischen Stand. */
export function auslastung(
  agent: string,
  jetzt = Date.now()
): { wert: number; zurueck: string | null } | null {
  const s = staende.get(agent);
  if (!s || jetzt - s.at > FRISCH_MS) return null;
  const mit = s.eintraege.filter((k) => k.auslastung !== null);
  if (!mit.length) return null;
  const hoechste = mit.reduce((a, b) => ((b.auslastung ?? 0) > (a.auslastung ?? 0) ? b : a));
  return { wert: hoechste.auslastung ?? 0, zurueck: hoechste.zurueck };
}

/** Ausweichziel für einen Auftrag an `agent`, oder null. */
export function umleitungFuer(
  agent: string,
  goal: string,
  jetzt = Date.now()
): { ziel: string; grund: string } | null {
  const ziel = RUECKFALL[agent];
  if (!ziel || /^selbsttest:/i.test(goal.trim())) return null;
  const hier = auslastung(agent, jetzt);
  if (!hier || hier.wert < VOLL) return null;
  if (!verbundenVon().has(ziel)) return null;
  const dort = auslastung(ziel, jetzt);
  if (dort && dort.wert >= LUFT) return null;
  const pct = Math.round(hier.wert * 100);
  return {
    ziel,
    grund: `${agent} ist bei ${pct} % des Kontingents${hier.zurueck ? `, wieder frei um ${uhrzeit(hier.zurueck)}` : ''}`,
  };
}

/**
 * Aus createTaskFlow: Übergaben, Rückmeldungen und Betriebsaufträge bleiben, wo sie sind. Die Umleitung
 * wird im Thread des Auslösers gesagt, damit niemand sucht, warum Codex antwortet.
 */
export async function umleiten<
  T extends {
    assignee: string;
    goal: string;
    originRoom: string;
    originThread?: string | null;
    isRueckmeldung?: boolean;
    isHandoff?: boolean;
    betriebSpec?: string;
  },
>(ctx: Ctx, req: T, tx?: Db): Promise<T> {
  if (req.isRueckmeldung || req.isHandoff || req.betriebSpec) return req;
  const u = umleitungFuer(req.assignee, req.goal);
  if (!u) return req;
  auditMerken('hub', 'kontingent.umleitung', null, { von: req.assignee, nach: u.ziel });
  if (req.originRoom) {
    await reply(
      ctx,
      tx ?? sql,
      req.originRoom,
      req.originThread ?? null,
      `↪️ ${u.grund}. Der Auftrag geht an ${u.ziel}.`
    );
  }
  return { ...req, assignee: u.ziel };
}

/** `!abo` */
export function aboText(jetzt = Date.now()): string {
  if (!staende.size)
    return 'Noch kein Worker hat sein Kontingent gemeldet (Claude braucht die Anmeldung im Worker, Plum das Gateway-Token).';
  const zeilen = ['Abo-Stand:'];
  for (const [agent, s] of [...staende].sort()) {
    const alt = jetzt - s.at > FRISCH_MS;
    for (const k of s.eintraege) {
      const pct = k.auslastung === null ? '?' : `${Math.round(k.auslastung * 100)} %`;
      const zeichen =
        k.auslastung === null
          ? '⚪'
          : k.auslastung >= VOLL
            ? '🔴'
            : k.auslastung >= 0.8
              ? '🟡'
              : '🟢';
      zeilen.push(
        `${zeichen} ${agent} · ${k.anbieter} ${k.fenster}: ${pct}${k.zurueck ? ` · frei um ${uhrzeit(k.zurueck)}` : ''}${alt ? ' (Stand veraltet)' : ''}`
      );
    }
  }
  const aktiv = Object.keys(RUECKFALL)
    .map((a) => [a, umleitungFuer(a, 'x', jetzt)] as const)
    .filter(([, u]) => u);
  for (const [a, u] of aktiv) zeilen.push(`↪️ Aufträge an ${a} gehen gerade an ${u!.ziel}.`);
  return zeilen.join('\n');
}

/** State-Event für die App, bei Änderung (aus dem Takt in weiter.ts). */
export async function kontingenteVeroeffentlichen(ctx: Ctx, jetzt = Date.now()): Promise<boolean> {
  if (!staende.size) return false;
  // Kommazahlen gehen als Text hinaus (kanonisches JSON, appservice/client.ts): deshalb ganze Prozent.
  const eintraege = [...staende].sort().flatMap(([agent, s]) =>
    s.eintraege.map((k) => ({
      agent,
      anbieter: k.anbieter,
      fenster: k.fenster,
      prozent: k.auslastung === null ? null : Math.round(k.auslastung * 100),
      zurueck: k.zurueck,
      stand: s.at,
    }))
  );
  const umleitung = Object.fromEntries(
    Object.keys(RUECKFALL)
      .map((a) => [a, umleitungFuer(a, 'x', jetzt)?.ziel] as const)
      .filter(([, z]) => z)
  );
  const vergleich = JSON.stringify({ e: eintraege.map(({ stand: _s, ...k }) => k), umleitung });
  if (vergleich === veroeffentlicht) return false;
  if (!(await lobbyZustand(ctx, KONTINGENTE_EVENT, '', { v: 1, at: jetzt, eintraege, umleitung })))
    return false;
  veroeffentlicht = vergleich;
  return true;
}

/** Nur für Tests. */
export function kontingenteLeeren(): void {
  staende.clear();
  veroeffentlicht = '';
}
