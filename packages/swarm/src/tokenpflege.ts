/**
 * Token-Pflege (matrix/PLAN-weiter.md, Punkt 5). Schwarm-Tokens laufen nie ab; am 26.09. klopfte der
 * Autoupdater fünf Stunden lang mit einem widerrufenen Token, ohne dass es jemand merkte.
 *
 *  - `!tokens` zeigt alle gültigen Tokens mit Alter und letzter Nutzung, dazu die Widerrufe der letzten Woche.
 *    Hashes und Klartexte zeigt der Hub nie (er kennt nur die Hashes).
 *  - Einmal am Tag: Ein gültiges Token, das seit 30 Tagen niemand benutzt hat, wird ein stiller Hinweis
 *    (`token-alt:<agent>:<zweck>`); sobald es wieder benutzt oder widerrufen wird, ist der Hinweis zu.
 *  - Klopft ein widerrufenes Token an (Worker, MCP, Absprachen), meldet der Hub das als Alarm
 *    (`token-widerrufen:<zweck>:<agent>`), wie schon beim Melder-Webhook (`melder-token:<agent>`).
 *
 * Rotieren: `node matrix/ops/token-rotieren.mjs <agent> <zweck>` schreibt das neue Token direkt in die
 * Ablage der Komponente, startet sie neu und prüft, dass sie wieder verbunden ist.
 */
import { sql } from './db/index.js';
import { getFlag, setFlag } from './db/audit.js';
import { alarmMelden } from './alarme.js';
import { widerrufenVon, type TokenZweck } from './tokens.js';
import { datumZeit } from './raumhinweis.js';
import type { Ctx } from './context.js';

const ALT_TAGE = Number(process.env.TOKEN_ALT_TAGE || 30);
const ZONE = 'Europe/Zurich';

const heute = (): string => new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE }).format(new Date());

function alter(iso: string | Date | null, jetzt = Date.now()): string {
  if (!iso) return 'nie';
  const ms = jetzt - new Date(iso).getTime();
  if (ms < 3_600_000) return `vor ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 86_400_000) return `vor ${Math.round(ms / 3_600_000)} h`;
  return `vor ${Math.round(ms / 86_400_000)} Tagen`;
}

/** `!tokens` */
export async function tokensText(jetzt = Date.now()): Promise<string> {
  const gueltig = await sql`
    SELECT agent, purpose, created_at, last_used_at FROM swarm.tokens WHERE revoked_at IS NULL ORDER BY agent, purpose, created_at`;
  const widerrufen = await sql`
    SELECT agent, purpose, count(*)::int AS n, max(revoked_at) AS zuletzt FROM swarm.tokens
     WHERE revoked_at > now() - interval '7 days' GROUP BY agent, purpose ORDER BY max(revoked_at) DESC`;
  const grenze = jetzt - ALT_TAGE * 86_400_000;
  const zeilen = [`Tokens: ${gueltig.length} gültig`];
  for (const t of gueltig) {
    const benutzt = t.last_used_at ? new Date(t.last_used_at as string).getTime() : null;
    const still = (benutzt ?? new Date(t.created_at as string).getTime()) < grenze;
    zeilen.push(
      `${still ? '⚠️' : benutzt ? '🟢' : '⚪'} ${t.agent} · ${t.purpose} · angelegt ${datumZeit(t.created_at as string)} · ` +
        `benutzt ${alter(t.last_used_at as string | null, jetzt)}${still ? ` · seit über ${ALT_TAGE} Tagen still` : ''}`
    );
  }
  if (widerrufen.length) {
    zeilen.push('', 'Widerrufen (7 Tage):');
    for (const w of widerrufen)
      zeilen.push(`• ${w.agent} · ${w.purpose}: ${w.n}× zuletzt ${datumZeit(w.zuletzt as string)}`);
  }
  zeilen.push(
    '',
    'Neu ausstellen und einsetzen: node matrix/ops/token-rotieren.mjs <agent> <zweck>'
  );
  return zeilen.join('\n');
}

/** Tägliche Prüfung auf stille Tokens (aus dem Takt in weiter.ts, einmal pro Tag ab 07:00). */
export async function tokenpflegeTakt(ctx: Ctx, jetzt = new Date()): Promise<number> {
  const stunde = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', hour12: false }).format(
      jetzt
    )
  );
  if (stunde < Number(process.env.TOKENPFLEGE_AB_STUNDE ?? 7)) return 0;
  const flag = await getFlag<{ tag?: string }>('tokenpflege');
  if (flag?.tag === heute()) return 0;
  const rows = await sql`
    SELECT agent, purpose, created_at, last_used_at, revoked_at FROM swarm.tokens
     WHERE revoked_at IS NULL OR revoked_at > now() - interval '2 days'`;
  const grenze = jetzt.getTime() - ALT_TAGE * 86_400_000;
  const still = new Map<string, { agent: string; zweck: string; seit: string }>();
  for (const t of rows) {
    if (t.revoked_at) continue;
    const zuletzt = new Date((t.last_used_at ?? t.created_at) as string);
    if (zuletzt.getTime() < grenze)
      still.set(`${t.agent}:${t.purpose}`, {
        agent: String(t.agent),
        zweck: String(t.purpose),
        seit: zuletzt.toISOString(),
      });
  }
  for (const [schluessel, s] of still) {
    await alarmMelden(ctx, {
      quelle: 'hub',
      agent: null,
      fingerabdruck: `token-alt:${schluessel}`,
      level: 'info',
      behoben: false,
      titel: `Token ${s.agent} (${s.zweck}) seit über ${ALT_TAGE} Tagen unbenutzt`,
      text: `Zuletzt ${datumZeit(s.seit)}. Wird es noch gebraucht? Sonst widerrufen; neu mit matrix/ops/token-rotieren.mjs.`,
    });
  }
  // Hinweise schliessen, deren Token wieder benutzt oder widerrufen wurde.
  const offen =
    await sql`SELECT fingerabdruck FROM swarm.alarme WHERE quelle = 'hub' AND fingerabdruck LIKE 'token-alt:%' AND zustand = 'offen'`;
  for (const o of offen) {
    const schluessel = String(o.fingerabdruck).slice('token-alt:'.length);
    if (still.has(schluessel)) continue;
    await alarmMelden(ctx, {
      quelle: 'hub',
      agent: null,
      fingerabdruck: String(o.fingerabdruck),
      level: 'info',
      behoben: true,
      titel: 'Token wieder in Ordnung',
      text: '',
    });
  }
  await setFlag('tokenpflege', { tag: heute(), still: still.size }, 'hub');
  return still.size;
}

const gemeldet = new Map<string, number>();

/**
 * Ein abgelehntes Token prüfen: Gehört es zu einem widerrufenen Eintrag, meldet der Hub das (höchstens
 * einmal pro Stunde und Agent). Fire-and-forget aus den Anmelde-Wegen von Worker, MCP und Absprachen.
 */
export async function widerrufenMelden(ctx: Ctx, roh: string, zweck: TokenZweck): Promise<void> {
  const agent = await widerrufenVon(roh, zweck);
  if (!agent) return;
  const schluessel = `${zweck}:${agent}`;
  if (Date.now() - (gemeldet.get(schluessel) ?? 0) < 3_600_000) return;
  gemeldet.set(schluessel, Date.now());
  await alarmMelden(ctx, {
    quelle: 'hub',
    agent: null,
    fingerabdruck: `token-widerrufen:${schluessel}`,
    level: 'warn',
    behoben: false,
    titel: `${agent} meldet sich mit einem widerrufenen ${zweck}-Token`,
    text:
      'Die Komponente läuft mit einem alten Token und kommt nicht rein. Neu ausstellen: node matrix/ops/token-rotieren.mjs ' +
      `${agent} ${zweck}`,
  });
}

/** Nach erfolgreicher Anmeldung: ein offener Widerrufs-Alarm dieses Agenten ist vorbei. */
export async function anmeldungWiederGut(
  ctx: Ctx,
  agent: string,
  zweck: TokenZweck
): Promise<void> {
  const fp = `token-widerrufen:${zweck}:${agent}`;
  const [offen] =
    await sql`SELECT 1 FROM swarm.alarme WHERE quelle = 'hub' AND fingerabdruck = ${fp} AND zustand = 'offen'`;
  if (!offen) return;
  gemeldet.delete(`${zweck}:${agent}`);
  await alarmMelden(ctx, {
    quelle: 'hub',
    agent: null,
    fingerabdruck: fp,
    level: 'info',
    behoben: true,
    titel: `${agent} meldet sich wieder mit gültigem Token`,
    text: '',
  });
}
