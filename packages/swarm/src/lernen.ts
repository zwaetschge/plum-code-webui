/**
 * Lernende Alarme (matrix/PLAN-weiter.md, Punkt 15). Der Hub merkt sich, wie Alarme enden (von selbst behoben,
 * von Vale quittiert, stummgeschaltet, liegen gelassen), und macht daraus Vorschläge statt Rauschen:
 *
 *  - Montags ab 08:05 ein Rückblick über 14 Tage in #schwarm-alarme, nur wenn es etwas vorzuschlagen gibt:
 *    Alarme, die kommen und von selbst gehen (→ `!alarm still`), oft stummgeschaltete (→ `!alarm stumm … 7d`)
 *    und solche, die seit Tagen offen liegen.
 *  - `!alarm stumm <fingerabdruck> [1h|8h|24h|7d|30d]`, `!alarm still <fingerabdruck>` (warn wird zum stillen
 *    Hinweis, crit bleibt laut) und `!alarm laut <fingerabdruck>` (beides aufheben).
 *  - Meldungen ohne Fingerabdruck von derselben Quelle: die ersten drei in 10 min kommen einzeln, weitere
 *    gesammelt als eine Notice am Ende des Fensters. crit kommt immer sofort.
 */
import { sql, type Db } from './db/index.js';
import { auditMerken, clearFlag, getFlag, setFlag } from './db/audit.js';
import { roomsByKind } from './agents/store.js';
import { notice } from './appservice/messages.js';
import { enqueue } from './outbox.js';
import { hinweis } from './raumhinweis.js';
import type { Ctx } from './context.js';

const ZONE = 'Europe/Zurich';
const DAUER: Record<string, number> = {
  '1h': 1,
  '8h': 8,
  '24h': 24,
  '1d': 24,
  '7d': 168,
  '30d': 720,
};

// ─── Still: warn → info für einen Fingerabdruck ─────────────────────────────

export async function istStill(
  quelle: string,
  fingerabdruck: string,
  db: Db = sql
): Promise<boolean> {
  return (await getFlag(`alarm-still:${quelle}:${fingerabdruck}`, db)) !== null;
}

/** Aus alarmMelden: Ein stiller Fingerabdruck meldet warn nur noch als stillen Hinweis; crit bleibt. */
export async function stufeNachLernen<
  T extends { quelle: string; fingerabdruck: string; level: 'info' | 'warn' | 'crit' },
>(m: T): Promise<T> {
  if (m.level !== 'warn') return m;
  return (await istStill(m.quelle, m.fingerabdruck)) ? { ...m, level: 'info' } : m;
}

async function quelleVon(fingerabdruck: string, db: Db): Promise<string | null> {
  const [z] =
    await db`SELECT quelle FROM swarm.alarme WHERE fingerabdruck = ${fingerabdruck} ORDER BY zuletzt DESC LIMIT 1`;
  return (z?.quelle as string | undefined) ?? null;
}

/** `!alarm stumm|still|laut <fingerabdruck> [dauer]` */
export async function cmdAlarm(
  ctx: Ctx,
  tx: Db,
  input: { body: string },
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const [befehl = '', fp = '', dauer = '24h'] = input.body
    .trim()
    .replace(/^!alarm\s*/i, '')
    .split(/\s+/);
  if (!['stumm', 'still', 'laut'].includes(befehl) || !fp) {
    return antwort(
      'Aufruf: `!alarm stumm <fingerabdruck> [1h|8h|24h|7d|30d]` · `!alarm still <fingerabdruck>` · `!alarm laut <fingerabdruck>`. Fingerabdrücke zeigt !alarme.'
    );
  }
  const quelle = await quelleVon(fp, tx);
  if (!quelle) return antwort(`Keinen Alarm mit dem Fingerabdruck „${fp}“ gefunden.`);
  if (befehl === 'stumm') {
    const stunden = DAUER[dauer];
    if (!stunden) return antwort('Dauer: 1h, 8h, 24h, 7d oder 30d.');
    const bis = new Date(Date.now() + stunden * 3600_000);
    await tx`
      INSERT INTO swarm.alarm_stumm (quelle, fingerabdruck, bis, von) VALUES (${quelle}, ${fp}, ${bis}, ${ctx.owner})
      ON CONFLICT (quelle, fingerabdruck) DO UPDATE SET bis = EXCLUDED.bis, von = EXCLUDED.von`;
    auditMerken(ctx.owner, 'alarm.stumm', null, {
      quelle,
      fingerabdruck: fp,
      bis: bis.toISOString(),
      per: 'befehl',
    });
    return antwort(
      `🔕 ${fp} (${quelle}) stumm für ${dauer}. Gezählt wird weiter; !alarm laut ${fp} hebt es auf.`
    );
  }
  if (befehl === 'still') {
    await setFlag(`alarm-still:${quelle}:${fp}`, { seit: new Date().toISOString() }, ctx.owner, tx);
    auditMerken(ctx.owner, 'alarm.still', null, { quelle, fingerabdruck: fp });
    return antwort(
      `🤫 ${fp} (${quelle}) meldet warn nur noch als stillen Hinweis (in !alarme sichtbar). crit bleibt laut.`
    );
  }
  await tx`DELETE FROM swarm.alarm_stumm WHERE quelle = ${quelle} AND fingerabdruck = ${fp}`;
  await clearFlag(`alarm-still:${quelle}:${fp}`, tx);
  auditMerken(ctx.owner, 'alarm.laut', null, { quelle, fingerabdruck: fp, per: 'befehl' });
  return antwort(`🔔 ${fp} (${quelle}) meldet wieder normal.`);
}

// ─── Wochenrückblick ────────────────────────────────────────────────────────

export interface Vorschlag {
  art: 'flattert' | 'oft-stumm' | 'liegt';
  quelle: string;
  fingerabdruck: string;
  text: string;
}

export async function vorschlaege(db: Db = sql): Promise<Vorschlag[]> {
  const gruppen = await db`
    SELECT quelle, fingerabdruck, max(titel) AS titel, count(*)::int AS alarme, COALESCE(sum(anzahl), 0)::int AS meldungen,
           count(*) FILTER (WHERE zustand = 'behoben')::int AS von_selbst,
           count(*) FILTER (WHERE zustand = 'geschlossen')::int AS quittiert,
           min(erstmals) FILTER (WHERE zustand = 'offen') AS offen_seit,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (COALESCE(beendet_am, now()) - erstmals))) AS dauer
      FROM swarm.alarme
     WHERE zuletzt > now() - interval '14 days' AND level <> 'info'
     GROUP BY quelle, fingerabdruck`;
  const stumm = await db`
    SELECT detail->>'quelle' AS quelle, detail->>'fingerabdruck' AS fingerabdruck, count(*)::int AS n
      FROM swarm.audit WHERE action = 'alarm.stumm' AND at > now() - interval '14 days' AND detail ? 'fingerabdruck'
     GROUP BY 1, 2`;
  const aus: Vorschlag[] = [];
  const min = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
  for (const g of gruppen) {
    const fp = String(g.fingerabdruck);
    const q = String(g.quelle);
    if (await istStill(q, fp, db)) continue;
    const titel = String(g.titel).slice(0, 80);
    if (g.alarme >= 3 && g.von_selbst >= 3 && g.quittiert === 0 && Number(g.dauer) < 1800) {
      aus.push({
        art: 'flattert',
        quelle: q,
        fingerabdruck: fp,
        text:
          `⚙️ „${titel}“ (${q}) kam ${g.alarme}× und ging jedes Mal von selbst (Median ${min(Number(g.dauer))}). ` +
          `Vorschlag: \`!alarm still ${fp}\`, dann meldet er warn nur noch still.`,
      });
    }
    if (g.offen_seit && Date.now() - new Date(g.offen_seit as string).getTime() > 3 * 86_400_000) {
      const tage = Math.floor(
        (Date.now() - new Date(g.offen_seit as string).getTime()) / 86_400_000
      );
      aus.push({
        art: 'liegt',
        quelle: q,
        fingerabdruck: fp,
        text: `⏳ „${titel}“ (${q}) ist seit ${tage} Tagen offen, ohne Reaktion. Beheben oder mit ✅ quittieren.`,
      });
    }
  }
  for (const s of stumm) {
    if (Number(s.n) < 2 || !s.fingerabdruck) continue;
    aus.push({
      art: 'oft-stumm',
      quelle: String(s.quelle ?? ''),
      fingerabdruck: String(s.fingerabdruck),
      text: `🔕 ${s.fingerabdruck} wurde ${s.n}× stummgeschaltet. Vorschlag: \`!alarm stumm ${s.fingerabdruck} 7d\` oder \`!alarm still ${s.fingerabdruck}\`.`,
    });
  }
  return aus.slice(0, 12);
}

function zuerich(d = new Date()): {
  wochentag: number;
  stunde: number;
  minute: number;
  woche: string;
} {
  const t = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  const tag = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE }).format(d);
  return {
    wochentag: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(t.weekday)),
    stunde: Number(t.hour) % 24,
    minute: Number(t.minute),
    woche: tag,
  };
}

/** Takt (weiter.ts): montags ab 08:05 einmal der Rückblick. `LERNEN_JETZT=1` erzwingt ihn (Tests). */
export async function lernenTakt(ctx: Ctx, jetzt = new Date()): Promise<boolean> {
  const z = zuerich(jetzt);
  const erzwungen = process.env.LERNEN_JETZT === '1';
  if (!erzwungen && (z.wochentag !== 1 || z.stunde * 60 + z.minute < 8 * 60 + 5)) return false;
  const flag = await getFlag<{ tag?: string }>('alarm-rueckblick');
  if (flag?.tag === z.woche) return false;
  await setFlag('alarm-rueckblick', { tag: z.woche }, 'hub');
  const liste = await vorschlaege();
  if (!liste.length) return false;
  await hinweis(
    ctx,
    'alerts',
    [
      '📊 Alarm-Rückblick (14 Tage): Vorschläge gegen Rauschen',
      ...liste.map((v) => `• ${v.text}`),
    ].join('\n')
  );
  return true;
}

// ─── Bündeln von Meldungen ohne Fingerabdruck ───────────────────────────────

const FENSTER_MS = Number(process.env.BUENDEL_FENSTER_MS || 10 * 60_000);
const EINZELN = 3;
interface Topf {
  start: number;
  einzeln: number;
  gesammelt: string[];
  asUser?: string;
  timer: NodeJS.Timeout | null;
}
const toepfe = new Map<string, Topf>();

/**
 * true, wenn die Meldung gesammelt wurde (der Aufrufer postet sie dann nicht). Nach dem Fenster geht eine
 * Sammel-Notice raus. crit wird nie gesammelt.
 */
export function buendeln(
  ctx: Ctx,
  raumArt: 'alerts' | 'log',
  quelle: string,
  level: string,
  zeile: string,
  asUser?: string,
  jetzt = Date.now()
): boolean {
  if (level === 'crit') return false;
  const schluessel = `${raumArt}|${quelle}`;
  let t = toepfe.get(schluessel);
  if (!t || jetzt - t.start >= FENSTER_MS) {
    if (t?.timer) clearTimeout(t.timer);
    t = { start: jetzt, einzeln: 0, gesammelt: [], asUser, timer: null };
    toepfe.set(schluessel, t);
  }
  if (t.einzeln < EINZELN) {
    t.einzeln++;
    return false;
  }
  t.gesammelt.push(zeile.split('\n')[0]!.slice(0, 160));
  if (!t.timer) {
    const topf = t;
    topf.timer = setTimeout(
      () => {
        const zeilen = topf.gesammelt.splice(0);
        topf.timer = null;
        if (!zeilen.length) return;
        void (async () => {
          const [raum] = await roomsByKind(raumArt);
          if (!raum?.roomId) return;
          const text =
            `📦 ${zeilen.length} weitere Meldung${zeilen.length === 1 ? '' : 'en'} von ${quelle} in ${Math.round(FENSTER_MS / 60_000)} min:\n` +
            zeilen
              .slice(0, 20)
              .map((z) => `• ${z}`)
              .join('\n') +
            (zeilen.length > 20 ? `\n… und ${zeilen.length - 20} weitere` : '');
          await enqueue(
            sql,
            [
              {
                kind: 'message',
                roomId: raum.roomId,
                ...(topf.asUser ? { asUser: topf.asUser } : {}),
                payload: { type: 'm.room.message', content: notice(text) },
              },
            ],
            ctx.hub
          );
        })().catch((err) => ctx.log.warn({ err, quelle }, 'Sammel-Notice nicht gesendet'));
      },
      Math.max(1000, t.start + FENSTER_MS - jetzt)
    );
    topf.timer.unref?.();
  }
  return true;
}
