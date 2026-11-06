/**
 * Tagesbericht (Verbesserung 10, 27.09.): Um 21:00 Zürcher Zeit ein kurzer Rückblick auf den Tag.
 *
 *  - State-Event `ch.zwaetschge.swarm.tagesbericht` (state_key "") in der Lobby: Die App zeigt ihn als Karte in
 *    „Aktuell“ und meldet ihn einmal mit einer ruhigen Benachrichtigung.
 *  - Dieselben Zahlen als Notice in der Lobby, wie die Tagesübersicht am Morgen.
 *  - `!tagesbericht` schickt ihn jederzeit (Antwort im Thread) und frischt das Event auf.
 *
 * Inhalt: Aufträge des Tages (erledigt, fehlgeschlagen, abgebrochen), was jetzt noch offen ist und davon auf Vale
 * wartet, Kosten des Tages gegen die Summe der Tagesbudgets, die höchste Abo-Auslastung je Agent und offene
 * Alarme. Nur ganze Zahlen (Cent, Prozent), weil Synapse kanonisches JSON verlangt.
 */
import { sql, type Db } from './db/index.js';
import { getFlag, setFlag } from './db/audit.js';
import { listAgents } from './agents/store.js';
import { hinweis, lobbyZustand } from './raumhinweis.js';
import { auslastung } from './kontingente.js';
import type { Ctx } from './context.js';

export const TAGESBERICHT_EVENT = 'ch.zwaetschge.swarm.tagesbericht';
const ZONE = 'Europe/Zurich';
const cent = (usd: number) => Math.round(usd * 100);
const usd = (c: number) => (c / 100).toFixed(2);

/** Die Uhrzeit des Berichts, als „HH:MM“ (Test: `TAGESBERICHT_UHRZEIT=00:00`). */
function uhrzeitMinuten(): number {
  const [h, m] = (process.env.TAGESBERICHT_UHRZEIT || '21:00').split(':').map(Number);
  return (h ?? 21) * 60 + (m ?? 0);
}

function zuercher(jetzt: Date): { tag: string; minuten: number } {
  const t = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(jetzt)
      .map((p) => [p.type, p.value])
  );
  return {
    tag: new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE }).format(jetzt),
    minuten: Number(t.hour) * 60 + Number(t.minute),
  };
}

export async function tagesbericht(
  jetzt = new Date(),
  db: Db = sql
): Promise<Record<string, unknown>> {
  const { tag } = zuercher(jetzt);
  const [heute] = await db`
    SELECT count(*)::int AS auftraege,
           count(*) FILTER (WHERE state = 'completed')::int AS ok,
           count(*) FILTER (WHERE state = 'failed')::int AS fehler,
           count(*) FILTER (WHERE state IN ('canceled', 'rejected'))::int AS abbruch,
           COALESCE(sum(cost_usd), 0)::float AS kosten
      FROM swarm.tasks
     WHERE (created_at AT TIME ZONE ${ZONE})::date = ${tag}::date AND goal NOT LIKE 'Selbsttest:%'`;
  const [offen] = await db`
    SELECT count(*)::int AS offen,
           count(*) FILTER (WHERE state IN ('input-required', 'auth-required'))::int AS warten
      FROM swarm.tasks WHERE state IN ('submitted', 'working', 'input-required', 'auth-required')`;
  const [alarme] =
    await db`SELECT count(*)::int AS n FROM swarm.alarme WHERE zustand = 'offen' AND level <> 'info'`;
  const agenten = await listAgents(db);
  const budget = agenten.reduce(
    (s, a) => s + (a.budgetUsdDay === null ? 0 : Number(a.budgetUsdDay)),
    0
  );
  const abo = agenten
    .map((a) => ({ agent: a.id, a: auslastung(a.id, jetzt.getTime()) }))
    .filter((x) => x.a !== null)
    .map((x) => ({ agent: x.agent, pct: Math.round(x.a!.wert * 100), zurueck: x.a!.zurueck }))
    .sort((x, y) => y.pct - x.pct)
    .slice(0, 4);
  return {
    v: 1,
    tag,
    erstellt: jetzt.getTime(),
    auftraege: Number(heute?.auftraege ?? 0),
    ok: Number(heute?.ok ?? 0),
    fehler: Number(heute?.fehler ?? 0),
    abbruch: Number(heute?.abbruch ?? 0),
    offen: Number(offen?.offen ?? 0),
    warten: Number(offen?.warten ?? 0),
    kosten_cent: cent(Number(heute?.kosten ?? 0)),
    budget_cent: budget > 0 ? cent(budget) : null,
    alarme_offen: Number(alarme?.n ?? 0),
    abo,
  };
}

export function tagesberichtText(b: Record<string, unknown>): string {
  const n = (k: string) => Number(b[k] ?? 0);
  const tag = String(b.tag ?? '');
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(tag) ? `${tag.slice(8, 10)}.${tag.slice(5, 7)}.` : tag;
  const abo = (b.abo as { agent: string; pct: number }[] | undefined) ?? [];
  return [
    `🌙 Tagesbericht ${datum}`,
    n('auftraege') === 0
      ? 'Heute keine neuen Aufträge.'
      : `Aufträge heute: ${n('auftraege')} (${n('ok')} ✅, ${n('fehler')} ❌, ${n('abbruch')} 🛑)`,
    `Noch offen: ${n('offen')}${n('warten') ? `, davon ${n('warten')} wartet auf dich` : ''}`,
    `Kosten heute: ${usd(n('kosten_cent'))} USD${b.budget_cent ? ` von ${usd(n('budget_cent'))} USD Tagesbudget` : ''}`,
    abo.length ? `Abo: ${abo.map((x) => `${x.agent} ${x.pct} %`).join(' · ')}` : '',
    n('alarme_offen')
      ? `⚠️ ${n('alarme_offen')} Alarm${n('alarme_offen') === 1 ? '' : 'e'} offen`
      : 'Keine offenen Alarme.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Event auffrischen (auch für `!tagesbericht`). */
export async function tagesberichtVeroeffentlichen(
  ctx: Ctx,
  jetzt = new Date(),
  db: Db = sql
): Promise<Record<string, unknown> | null> {
  const b = await tagesbericht(jetzt, db);
  return (await lobbyZustand(ctx, TAGESBERICHT_EVENT, '', b, db)) ? b : null;
}

/** Takt (weiter.ts): einmal am Tag ab 21:00 Zürcher Zeit. */
export async function tagesberichtTakt(ctx: Ctx, jetzt = new Date()): Promise<boolean> {
  const { tag, minuten } = zuercher(jetzt);
  if (minuten < uhrzeitMinuten()) return false;
  const flag = await getFlag<{ tag?: string }>('tagesbericht');
  if (flag?.tag === tag) return false;
  await setFlag('tagesbericht', { tag }, 'hub');
  const b = await tagesberichtVeroeffentlichen(ctx, jetzt);
  if (!b) return false;
  // In die Lobby wie die Tagesübersicht am Morgen: Die App meldet „🌙“ als ruhige Benachrichtigung.
  await hinweis(ctx, 'lobby', tagesberichtText(b));
  return true;
}

/** `!tagesbericht` */
export async function cmdTagesbericht(
  ctx: Ctx,
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const b = await tagesberichtVeroeffentlichen(ctx);
  return antwort(tagesberichtText(b ?? (await tagesbericht())));
}
