/**
 * Absprachen-Register (matrix/PLAN-weiter.md, Punkt 2): Wer arbeitet gerade an welchen Dateien?
 *
 * Mehrere Sitzungen (Plum, Codex) und Agenten ändern dieselben Repos. Bisher standen die Ansprüche von
 * Hand in ADR-003 §6, und Überschneidungen fielen erst im Diff auf. Jetzt meldet jede Seite, was sie
 * anfasst, mit Ablaufzeit; der Hub sagt sofort, wenn sich etwas überschneidet.
 *
 *   GET  /absprachen                      → offene Absprachen
 *   POST /absprachen {wer, pfade, zweck, stunden?, trotzdem?}
 *        → 201 {id, konflikte: []} · 409 {konflikte} ohne `trotzdem`
 *   POST /absprachen/freigeben {wer, id? | pfade?}
 *
 * Auth: Bearer-Token mit Zweck `absprache` (Sitzungen, über `schwarm-plum-relay`); Agenten nutzen die
 * MCP-Werkzeuge `absprache_*` (`mcp/zusatz.ts`). In Matrix zeigt `!absprachen` die Liste.
 *
 * Pfade sind relativ zu /mnt/cache/AI/plum-code (etwa `bot-council/packages/matrix/src/inbox.ts`). Ein
 * Pfad mit `/` am Ende oder mit `*` meint alles darunter. Die Prüfung ist bewusst grob: lieber ein
 * Hinweis zu viel als eine überschriebene Datei.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql, type Db } from './db/index.js';
import { auditMerken } from './db/audit.js';
import { verifyToken } from './tokens.js';
import { widerrufenMelden } from './tokenpflege.js';
import { redact } from './redact.js';
import { hinweis, uhrzeit, datumZeit } from './raumhinweis.js';
import type { Ctx } from './context.js';

export const WURZEL = '/mnt/cache/AI/plum-code/';
export const STANDARD_STUNDEN = 4;
export const MAX_STUNDEN = 48;
const PFADE_MAX = 40;
const PRO_MINUTE = 60;

export interface Absprache {
  id: number;
  wer: string;
  quelle: 'sitzung' | 'agent';
  pfade: string[];
  zweck: string;
  erstellt: string;
  ablauf: string;
}

export interface Konflikt {
  id: number;
  wer: string;
  pfad: string;
  gegen: string;
  zweck: string;
  ablauf: string;
}

/** `./bot-council//x.ts` und `/mnt/cache/AI/plum-code/bot-council/x.ts` → `bot-council/x.ts`; null bei Unsinn. */
export function pfadNormalisieren(roh: string): string | null {
  let p = String(roh ?? '')
    .trim()
    .replace(/\\/g, '/');
  if (p.startsWith(WURZEL)) p = p.slice(WURZEL.length);
  p = p
    .replace(/^\.\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+/, '');
  if (!p || p.length > 200) return null;
  if (p.split('/').some((teil) => teil === '..')) return null;
  if (!/^[\w.@*?+\-/ äöüÄÖÜ]+$/.test(p)) return null;
  return p;
}

/** Literaler Anfang und ob der Eintrag mehr als eine Datei meint (Ordner oder Muster). */
export function reichweite(muster: string): { anfang: string; weit: boolean } {
  const stern = muster.search(/[*?]/);
  if (stern >= 0) return { anfang: muster.slice(0, stern), weit: true };
  if (muster.endsWith('/')) return { anfang: muster, weit: true };
  return { anfang: muster, weit: false };
}

export function ueberschneiden(a: string, b: string): boolean {
  const ra = reichweite(a);
  const rb = reichweite(b);
  if (!ra.weit && !rb.weit) return ra.anfang === rb.anfang;
  if (ra.weit && !rb.weit) return rb.anfang.startsWith(ra.anfang);
  if (!ra.weit && rb.weit) return ra.anfang.startsWith(rb.anfang);
  return ra.anfang.startsWith(rb.anfang) || rb.anfang.startsWith(ra.anfang);
}

const zeile = (r: Record<string, unknown>): Absprache => ({
  id: Number(r.id),
  wer: String(r.wer),
  quelle: r.quelle === 'agent' ? 'agent' : 'sitzung',
  pfade: (r.pfade as string[]) ?? [],
  zweck: String(r.zweck ?? ''),
  erstellt: new Date(r.erstellt as string).toISOString(),
  ablauf: new Date(r.ablauf as string).toISOString(),
});

export async function offeneAbsprachen(db: Db = sql): Promise<Absprache[]> {
  const rows = await db`
    SELECT id, wer, quelle, pfade, zweck, erstellt, ablauf FROM swarm.absprachen
     WHERE freigegeben IS NULL AND ablauf > now()
     ORDER BY erstellt`;
  return (rows as Record<string, unknown>[]).map(zeile);
}

export function konflikteFinden(offen: Absprache[], wer: string, pfade: string[]): Konflikt[] {
  const funde: Konflikt[] = [];
  for (const a of offen) {
    if (a.wer === wer) continue;
    for (const p of pfade) {
      const gegen = a.pfade.find((q) => ueberschneiden(p, q));
      if (gegen)
        funde.push({ id: a.id, wer: a.wer, pfad: p, gegen, zweck: a.zweck, ablauf: a.ablauf });
    }
  }
  return funde;
}

export interface Anspruch {
  wer: string;
  quelle: 'sitzung' | 'agent';
  pfade: string[];
  zweck?: string;
  stunden?: number;
  trotzdem?: boolean;
}

export type AnspruchErgebnis =
  | { ok: true; id: number; verlaengert: boolean; konflikte: Konflikt[]; ablauf: string }
  | { ok: false; code: 'ungueltig' | 'konflikt'; grund: string; konflikte: Konflikt[] };

export async function beanspruchen(ctx: Ctx, a: Anspruch, db: Db = sql): Promise<AnspruchErgebnis> {
  const wer = String(a.wer ?? '')
    .trim()
    .slice(0, 80);
  if (!/^[\w.@:/+-]{2,80}$/.test(wer))
    return {
      ok: false,
      code: 'ungueltig',
      grund: 'wer: 2–80 Zeichen, ohne Leerzeichen',
      konflikte: [],
    };
  const pfade = [...new Set((a.pfade ?? []).map(pfadNormalisieren))];
  if (!pfade.length || pfade.some((p) => p === null)) {
    return {
      ok: false,
      code: 'ungueltig',
      grund: 'pfade: relativ zu /mnt/cache/AI/plum-code, ohne „..“',
      konflikte: [],
    };
  }
  if (pfade.length > PFADE_MAX)
    return { ok: false, code: 'ungueltig', grund: `höchstens ${PFADE_MAX} Pfade`, konflikte: [] };
  const liste = pfade as string[];
  const stunden = Math.min(MAX_STUNDEN, Math.max(0.25, Number(a.stunden) || STANDARD_STUNDEN));
  const zweck = redact(String(a.zweck ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  const offen = await offeneAbsprachen(db);
  const konflikte = konflikteFinden(offen, wer, liste);
  if (konflikte.length && !a.trotzdem) {
    await hinweis(ctx, 'log', konfliktText(wer, konflikte, false), db);
    auditMerken(wer, 'absprache.konflikt', null, {
      pfade: liste,
      gegen: [...new Set(konflikte.map((k) => k.wer))],
    });
    return {
      ok: false,
      code: 'konflikt',
      grund: 'überschneidet sich mit einer offenen Absprache',
      konflikte,
    };
  }

  // Dieselbe Seite mit denselben Pfaden: verlängern statt doppelt führen.
  const gleich = offen.find(
    (x) =>
      x.wer === wer && x.pfade.length === liste.length && liste.every((p) => x.pfade.includes(p))
  );
  let id: number;
  let ablauf: string;
  if (gleich) {
    const [z] = await db`
      UPDATE swarm.absprachen SET ablauf = now() + make_interval(mins => ${Math.round(stunden * 60)}),
             zweck = CASE WHEN ${zweck} = '' THEN zweck ELSE ${zweck} END
       WHERE id = ${gleich.id} RETURNING id, ablauf`;
    id = Number(z!.id);
    ablauf = new Date(z!.ablauf as string).toISOString();
  } else {
    const [z] = await db`
      INSERT INTO swarm.absprachen (wer, quelle, pfade, zweck, ablauf)
      VALUES (${wer}, ${a.quelle}, ${liste}, ${zweck}, now() + make_interval(mins => ${Math.round(stunden * 60)}))
      RETURNING id, ablauf`;
    id = Number(z!.id);
    ablauf = new Date(z!.ablauf as string).toISOString();
    await hinweis(
      ctx,
      'log',
      `📌 ${wer} arbeitet an ${pfadListe(liste)}${zweck ? ` — ${zweck}` : ''} (bis ${uhrzeit(ablauf)})`,
      db
    );
  }
  if (konflikte.length) await hinweis(ctx, 'log', konfliktText(wer, konflikte, true), db);
  auditMerken(wer, gleich ? 'absprache.verlaengert' : 'absprache.neu', String(id), {
    pfade: liste,
    konflikte: konflikte.length,
  });
  return { ok: true, id, verlaengert: Boolean(gleich), konflikte, ablauf };
}

export async function freigeben(
  ctx: Ctx,
  f: { wer: string; id?: number; pfade?: string[] },
  db: Db = sql
): Promise<number> {
  const wer = String(f.wer ?? '').trim();
  let rows: Record<string, unknown>[];
  if (f.id) {
    rows = await db`
      UPDATE swarm.absprachen SET freigegeben = now()
       WHERE id = ${f.id} AND wer = ${wer} AND freigegeben IS NULL RETURNING id, pfade`;
  } else if (f.pfade?.length) {
    const pfade = f.pfade.map(pfadNormalisieren).filter((p): p is string => Boolean(p));
    rows = await db`
      UPDATE swarm.absprachen SET freigegeben = now()
       WHERE wer = ${wer} AND freigegeben IS NULL AND pfade && ${pfade}::text[] RETURNING id, pfade`;
  } else {
    rows = await db`
      UPDATE swarm.absprachen SET freigegeben = now()
       WHERE wer = ${wer} AND freigegeben IS NULL RETURNING id, pfade`;
  }
  if (rows.length) {
    const alle = rows.flatMap((r) => r.pfade as string[]);
    await hinweis(ctx, 'log', `✔️ ${wer} ist fertig mit ${pfadListe(alle)}`, db);
    auditMerken(wer, 'absprache.frei', null, { ids: rows.map((r) => Number(r.id)) });
  }
  return rows.length;
}

function pfadListe(pfade: string[], max = 4): string {
  const teile = pfade.slice(0, max).map((p) => `\`${p}\``);
  return teile.join(', ') + (pfade.length > max ? ` und ${pfade.length - max} weitere` : '');
}

function konfliktText(wer: string, k: Konflikt[], trotzdem: boolean): string {
  const nachWer = new Map<string, Konflikt[]>();
  for (const x of k) nachWer.set(x.wer, [...(nachWer.get(x.wer) ?? []), x]);
  const zeilen = [...nachWer].map(
    ([anderer, liste]) =>
      `• ${anderer} hält ${pfadListe([...new Set(liste.map((x) => x.gegen))])} bis ${uhrzeit(liste[0]!.ablauf)}` +
      (liste[0]!.zweck ? ` (${liste[0]!.zweck})` : '')
  );
  return [
    `⚠️ Überschneidung: ${wer} ${trotzdem ? 'arbeitet trotzdem an' : 'wollte'} ${pfadListe([...new Set(k.map((x) => x.pfad))])}`,
    ...zeilen,
  ].join('\n');
}

/** `!absprachen` */
export async function absprachenText(db: Db = sql): Promise<string> {
  const offen = await offeneAbsprachen(db);
  if (!offen.length)
    return 'Keine offenen Absprachen. Sitzungen melden sich mit `matrix/ops/absprache.mjs nimm …`.';
  return [
    `Absprachen: ${offen.length} offen`,
    ...offen.map(
      (a) =>
        `• ${a.quelle === 'agent' ? '🤖' : '🧑‍💻'} ${a.wer}: ${pfadListe(a.pfade, 3)}${a.zweck ? ` — ${a.zweck}` : ''} · bis ${datumZeit(a.ablauf)}`
    ),
  ].join('\n');
}

// ─── HTTP für Sitzungen ─────────────────────────────────────────────────────

const AnspruchKoerper = z.object({
  wer: z.string().min(2).max(80),
  pfade: z.array(z.string().min(1).max(300)).min(1).max(PFADE_MAX),
  zweck: z.string().max(400).default(''),
  stunden: z.number().positive().max(MAX_STUNDEN).optional(),
  trotzdem: z.boolean().default(false),
});
const FreigabeKoerper = z.object({
  wer: z.string().min(2).max(80),
  id: z.number().int().positive().optional(),
  pfade: z.array(z.string().min(1).max(300)).max(PFADE_MAX).optional(),
});

const fenster = new Map<number, number[]>();
function imTakt(tokenId: number, jetzt = Date.now()): boolean {
  const zeiten = (fenster.get(tokenId) ?? []).filter((t) => jetzt - t < 60_000);
  if (zeiten.length >= PRO_MINUTE) return false;
  zeiten.push(jetzt);
  fenster.set(tokenId, zeiten);
  return true;
}

export async function absprachenRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.addHook('preHandler', async (req, reply) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const wer = token ? await verifyToken(token, 'absprache') : null;
    if (!wer) {
      if (token) void widerrufenMelden(ctx, token, 'absprache').catch(() => {});
      return reply.code(401).send({ error: 'Kein gültiges Token (Zweck absprache)' });
    }
    if (!imTakt(wer.tokenId))
      return reply.code(429).send({ error: `Mehr als ${PRO_MINUTE} Anfragen pro Minute` });
  });

  app.get('/absprachen', async () => ({ absprachen: await offeneAbsprachen() }));

  app.post('/absprachen', async (req, reply) => {
    const k = AnspruchKoerper.safeParse(req.body ?? {});
    if (!k.success)
      return reply.code(400).send({ error: k.error.issues[0]?.message ?? 'ungültig' });
    const r = await beanspruchen(ctx, { ...k.data, quelle: 'sitzung' });
    if (r.ok) return reply.code(201).send(r);
    return reply.code(r.code === 'konflikt' ? 409 : 400).send(r);
  });

  app.post('/absprachen/freigeben', async (req, reply) => {
    const k = FreigabeKoerper.safeParse(req.body ?? {});
    if (!k.success)
      return reply.code(400).send({ error: k.error.issues[0]?.message ?? 'ungültig' });
    return { freigegeben: await freigeben(ctx, k.data) };
  });
}
