/**
 * Routinen (matrix/PLAN-weiter.md, Punkt 10): wiederkehrende Aufträge mit Zeitplan, Budget und eigenem Thread.
 *
 *   !routine                                        → Liste
 *   !routine neu <name> <zeitplan> @agent <ziel>    → anlegen (Zeitplan bis zum @agent)
 *   !routine pause|weiter|jetzt|weg <name>
 *
 * Zeitpläne in Zürcher Zeit: `täglich 07:00`, `werktags 06:30`, `mo,do 18:00`, `monatlich 1 05:00`,
 * `stündlich` (`stündlich :15`), `alle 30 min`, `alle 6 h`.
 *
 * Jede Routine hat eine Notice in der Lobby als Wurzel; die Aufträge antworten in deren Thread. Für den
 * Betrieb ist das Ziel eine Fähigkeit (`docker.list unhealthy`); Routinen dürfen nur grüne Fähigkeiten,
 * denn niemand gibt sie beim Lauf frei. Aufträge laufen auf Vales Namen, der die Routine angelegt hat.
 */
import { sql, type Db } from './db/index.js';
import { auditMerken } from './db/audit.js';
import { agentById, roomsByKind } from './agents/store.js';
import { enqueue } from './outbox.js';
import { notice } from './appservice/messages.js';
import { createTaskFlow } from './tasks/create.js';
import { argumente, faehigkeitenLaden, zielPruefen } from './betrieb/faehigkeiten.js';
import { lobbyZustand, datumZeit } from './raumhinweis.js';
import type { Ctx } from './context.js';

export const ROUTINEN_EVENT = 'ch.zwaetschge.swarm.routinen';
const ZONE = 'Europe/Zurich';
const TAG_MS = 86_400_000;
const WOCHENTAGE = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'];

export type Zeitplan =
  | { art: 'zeit'; tage: number[] | null; stunde: number; minute: number }
  | { art: 'monatlich'; tag: number; stunde: number; minute: number }
  | { art: 'alle'; ms: number }
  | { art: 'stuendlich'; minute: number };

/** Zeitplan lesen; null, wenn er nicht passt. */
export function zeitplanLesen(roh: string): Zeitplan | null {
  const t = roh.trim().toLowerCase().replace(/ä/g, 'ae').replace(/ü/g, 'ue').replace(/\s+/g, ' ');
  const zeit = (s: string | undefined) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '');
    if (!m) return null;
    const [h, mi] = [Number(m[1]), Number(m[2])];
    return h < 24 && mi < 60 ? { stunde: h, minute: mi } : null;
  };
  let m = /^(?:taeglich|jeden tag) (\S+)$/.exec(t);
  if (m) {
    const z = zeit(m[1]);
    return z ? { art: 'zeit', tage: null, ...z } : null;
  }
  m = /^werktags (\S+)$/.exec(t);
  if (m) {
    const z = zeit(m[1]);
    return z ? { art: 'zeit', tage: [1, 2, 3, 4, 5], ...z } : null;
  }
  m = /^wochenende (\S+)$/.exec(t);
  if (m) {
    const z = zeit(m[1]);
    return z ? { art: 'zeit', tage: [0, 6], ...z } : null;
  }
  m =
    /^(?:woechentlich |jeden )?((?:mo|di|mi|do|fr|sa|so)(?:,(?:mo|di|mi|do|fr|sa|so))*) (\S+)$/.exec(
      t
    );
  if (m) {
    const z = zeit(m[2]);
    return z
      ? {
          art: 'zeit',
          tage: [...new Set(m[1]!.split(',').map((w) => WOCHENTAGE.indexOf(w)))].sort(),
          ...z,
        }
      : null;
  }
  m = /^monatlich (\d{1,2}) (\S+)$/.exec(t);
  if (m) {
    const tag = Number(m[1]);
    const z = zeit(m[2]);
    return z && tag >= 1 && tag <= 28 ? { art: 'monatlich', tag, ...z } : null;
  }
  m = /^stuendlich(?: :(\d{2}))?$/.exec(t);
  if (m) {
    const mi = Number(m[1] ?? 0);
    return mi < 60 ? { art: 'stuendlich', minute: mi } : null;
  }
  m = /^alle (\d{1,3}) ?(min|minuten|h|stunden)$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    const ms = m[2]!.startsWith('m') ? n * 60_000 : n * 3_600_000;
    return ms >= 5 * 60_000 && ms <= 7 * TAG_MS ? { art: 'alle', ms } : null;
  }
  return null;
}

function zuerich(d: Date): {
  jahr: number;
  monat: number;
  tag: number;
  wochentag: number;
  stunde: number;
  minute: number;
} {
  const t = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return {
    jahr: Number(t.year),
    monat: Number(t.month),
    tag: Number(t.day),
    wochentag: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(t.weekday)),
    stunde: Number(t.hour) % 24,
    minute: Number(t.minute),
  };
}

/** Zürcher Wandzeit → Zeitpunkt (Sommer- und Winterzeit richtig, auch am Umstellungstag). */
export function zuerichZeit(
  jahr: number,
  monat: number,
  tag: number,
  stunde: number,
  minute: number
): Date {
  let t = Date.UTC(jahr, monat - 1, tag, stunde, minute);
  for (let i = 0; i < 3; i++) {
    const z = zuerich(new Date(t));
    const ist = Date.UTC(z.jahr, z.monat - 1, z.tag, z.stunde, z.minute);
    const soll = Date.UTC(jahr, monat - 1, tag, stunde, minute);
    if (ist === soll) break;
    t += soll - ist;
  }
  return new Date(t);
}

/** Nächster Lauf nach `nach` (für `alle`: nach dem letzten Lauf). */
export function naechsterLauf(p: Zeitplan, nach: Date, letzter: Date | null = null): Date {
  if (p.art === 'alle') {
    const basis = letzter ? letzter.getTime() + p.ms : nach.getTime() + p.ms;
    return new Date(Math.max(basis, nach.getTime() + 60_000));
  }
  if (p.art === 'stuendlich') {
    const t = new Date(nach.getTime() + 60_000);
    t.setUTCSeconds(0, 0);
    const z = zuerich(t);
    let kandidat = zuerichZeit(z.jahr, z.monat, z.tag, z.stunde, p.minute);
    if (kandidat.getTime() <= nach.getTime()) kandidat = new Date(kandidat.getTime() + 3_600_000);
    return kandidat;
  }
  for (let i = 0; i <= 62; i++) {
    const z = zuerich(new Date(nach.getTime() + i * TAG_MS));
    if (p.art === 'monatlich' && z.tag !== p.tag) continue;
    if (p.art === 'zeit' && p.tage && !p.tage.includes(z.wochentag)) continue;
    const kandidat = zuerichZeit(z.jahr, z.monat, z.tag, p.stunde, p.minute);
    if (kandidat.getTime() > nach.getTime()) return kandidat;
  }
  return new Date(nach.getTime() + 31 * TAG_MS);
}

export interface Routine {
  id: number;
  name: string;
  zeitplan: string;
  agent: string;
  ziel: string;
  pausiert: boolean;
  naechster: string | null;
  letzterTask: string | null;
  letzterZeit: string | null;
  letzterFehler: string | null;
  wurzelOutbox: number | null;
}

const zeile = (r: Record<string, unknown>): Routine => ({
  id: Number(r.id),
  name: String(r.name),
  zeitplan: String(r.zeitplan),
  agent: String(r.agent),
  ziel: String(r.ziel),
  pausiert: Boolean(r.pausiert),
  naechster: r.naechster ? new Date(r.naechster as string).toISOString() : null,
  letzterTask: (r.letzter_task as string | null) ?? null,
  letzterZeit: r.letzter_zeit ? new Date(r.letzter_zeit as string).toISOString() : null,
  letzterFehler: (r.letzter_fehler as string | null) ?? null,
  wurzelOutbox:
    r.wurzel_outbox === null || r.wurzel_outbox === undefined ? null : Number(r.wurzel_outbox),
});

export async function routinenListe(db: Db = sql): Promise<Routine[]> {
  return ((await db`SELECT * FROM swarm.routinen ORDER BY name`) as Record<string, unknown>[]).map(
    zeile
  );
}

/** Betriebsziel „docker.list unhealthy“ → geprüfte Spezifikation, nur grün. */
async function betriebSpec(ziel: string): Promise<{ spec: string } | { fehler: string }> {
  const [faehigkeit, ...rest] = ziel.trim().split(/\s+/);
  const f = (await faehigkeitenLaden()).find((x) => x.name === (faehigkeit ?? '').toLowerCase());
  if (!f) return { fehler: `${faehigkeit} kennt der Betrieb nicht (!aktion zeigt die Liste)` };
  if (f.risk !== 'green')
    return {
      fehler: `${f.name} ist ${f.risk === 'yellow' ? 'gelb' : 'rot'}; Routinen dürfen nur grüne Fähigkeiten, weil sie niemand freigibt`,
    };
  const geprueft = zielPruefen(f, f.ziel === 'keins' ? '' : (rest.shift() ?? ''));
  if ('fehler' in geprueft) return geprueft;
  const args: Record<string, unknown> = {};
  if (f.name === 'docker.logs' && /^\d+$/.test(rest[0] ?? '')) args.tail = Number(rest.shift());
  return {
    spec: JSON.stringify({ capability: f.name, target: geprueft.ziel, args: argumente(f, args) }),
  };
}

async function wurzelEvent(db: Db, outboxId: number | null): Promise<string | null> {
  if (!outboxId) return null;
  const [z] = await db`SELECT sent_event_id FROM swarm.outbox WHERE id = ${outboxId}`;
  return (z?.sent_event_id as string | null) ?? null;
}

/** Einen Lauf starten (fällig oder `!routine jetzt`). */
export async function routineStarten(
  ctx: Ctx,
  r: Routine,
  schluessel: string,
  db: Db = sql
): Promise<{ ok: boolean; text: string }> {
  const [lobby] = await roomsByKind('lobby', db);
  const thread = await wurzelEvent(db, r.wurzelOutbox);
  let betrieb: string | undefined;
  if (r.agent === 'betrieb') {
    const b = await betriebSpec(r.ziel);
    if ('fehler' in b) return { ok: false, text: b.fehler };
    betrieb = b.spec;
  }
  const [zahlen] =
    await db`SELECT budget_usd, budget_minuten FROM swarm.routinen WHERE id = ${r.id}`;
  const ergebnis = await createTaskFlow(
    ctx,
    {
      goal: r.agent === 'betrieb' ? `${r.ziel} — Routine ${r.name}` : r.ziel,
      ...(betrieb ? { betriebSpec: betrieb, deliverable: 'Ausgabe der Aktion' } : {}),
      assignee: r.agent,
      from: ctx.owner,
      originRoom: lobby?.roomId ?? '',
      originThread: thread,
      idempotencyKey: schluessel,
      ...(zahlen?.budget_usd !== null && zahlen?.budget_usd !== undefined
        ? { budgetUsd: Number(zahlen.budget_usd) }
        : {}),
      ...(zahlen?.budget_minuten !== null && zahlen?.budget_minuten !== undefined
        ? { budgetMinutes: Number(zahlen.budget_minuten) }
        : {}),
    },
    db
  );
  if (!ergebnis.ok) return { ok: false, text: `${ergebnis.code}: ${ergebnis.reason}` };
  return { ok: true, text: ergebnis.taskId };
}

/** Takt (aus weiter.ts): fällige Routinen starten. */
export async function routinenTakt(ctx: Ctx, jetzt = new Date()): Promise<number> {
  const faellig = (
    (await sql`
    SELECT * FROM swarm.routinen WHERE NOT pausiert AND naechster IS NOT NULL AND naechster <= ${jetzt}
     ORDER BY naechster LIMIT 5`) as Record<string, unknown>[]
  ).map(zeile);
  let gestartet = 0;
  for (const r of faellig) {
    const plan = zeitplanLesen(r.zeitplan);
    const naechster = plan ? naechsterLauf(plan, jetzt, jetzt) : null;
    // Erst weiterschalten, dann starten: Ein Absturz dazwischen verliert einen Lauf, verdoppelt aber keinen.
    // Nur wer die Routine noch fällig antrifft, schaltet sie weiter (kein Vergleich auf Gleichheit: die
    // Datenbank speichert Mikrosekunden, JavaScript nur Millisekunden).
    const [vorwaerts] = await sql`
      UPDATE swarm.routinen SET naechster = ${naechster}
       WHERE id = ${r.id} AND NOT pausiert AND naechster <= ${jetzt} RETURNING id`;
    if (!vorwaerts) continue;
    const lauf = await routineStarten(ctx, r, `routine:${r.id}:${r.naechster}`);
    await sql`
      UPDATE swarm.routinen SET letzter_zeit = now(),
             letzter_task = ${lauf.ok ? lauf.text : r.letzterTask}, letzter_fehler = ${lauf.ok ? null : lauf.text}
       WHERE id = ${r.id}`;
    if (lauf.ok) gestartet++;
    else {
      const [lobby] = await roomsByKind('lobby');
      const thread = await wurzelEvent(sql, r.wurzelOutbox);
      if (lobby?.roomId) {
        await enqueue(
          sql,
          [
            {
              kind: 'message',
              roomId: lobby.roomId,
              payload: {
                type: 'm.room.message',
                content: notice(`⚠️ Routine ${r.name}: nicht gestartet (${lauf.text})`, { thread }),
              },
            },
          ],
          ctx.hub
        );
      }
    }
    auditMerken('hub', 'routine.lauf', lauf.ok ? lauf.text : null, {
      routine: r.name,
      ok: lauf.ok,
    });
  }
  return gestartet;
}

let veroeffentlicht = '';
/** State-Event für die App, nur bei Änderung; aus dem Takt, damit auch der Zustand des letzten Laufs nachkommt. */
export async function routinenVeroeffentlichen(ctx: Ctx): Promise<boolean> {
  const liste = await routinenListe();
  const inhalt = {
    v: 1,
    routinen: await Promise.all(
      liste.map(async (r) => {
        const [t] = r.letzterTask
          ? await sql`SELECT state FROM swarm.tasks WHERE id = ${r.letzterTask}`
          : [];
        return {
          name: r.name,
          zeitplan: r.zeitplan,
          agent: r.agent,
          ziel: r.ziel,
          pausiert: r.pausiert,
          naechster: r.pausiert ? null : r.naechster,
          letzter: r.letzterTask
            ? {
                auftrag: r.letzterTask,
                zustand: (t?.state as string | undefined) ?? 'unbekannt',
                zeit: r.letzterZeit,
              }
            : null,
          ...(r.letzterFehler ? { fehler: r.letzterFehler } : {}),
        };
      })
    ),
  };
  const vergleich = JSON.stringify(inhalt);
  if (vergleich === veroeffentlicht) return false;
  if (!(await lobbyZustand(ctx, ROUTINEN_EVENT, '', inhalt))) return false;
  veroeffentlicht = vergleich;
  return true;
}

/** `!routine …` */
export async function cmdRoutine(
  ctx: Ctx,
  tx: Db,
  input: { body: string; roomId: string; eventId: string; thread: string | null },
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const rest = input.body.trim().replace(/^!routinen?\s*/i, '');
  const [befehl = 'liste', name = '', ...weiter] = rest.split(/\s+/).filter(Boolean);
  const aenderung = async () => {
    await routinenVeroeffentlichen(ctx);
  };

  if (befehl === 'liste' || befehl === '') {
    const liste = await routinenListe(tx);
    if (!liste.length)
      return antwort(
        'Keine Routinen. Anlegen: `!routine neu <name> <zeitplan> @agent <ziel>`, etwa `!routine neu stand werktags 07:00 @brian Was steht heute an?`'
      );
    return antwort(
      [
        'Routinen:',
        ...liste.map(
          (r) =>
            `${r.pausiert ? '⏸️' : '🔁'} ${r.name} · ${r.zeitplan} · @${r.agent}: ${r.ziel.slice(0, 60)}` +
            (r.pausiert
              ? ' · pausiert'
              : r.naechster
                ? ` · nächster ${datumZeit(r.naechster)}`
                : '') +
            (r.letzterTask ? ` · zuletzt ${r.letzterTask}` : '') +
            (r.letzterFehler ? ` · ⚠️ ${r.letzterFehler.slice(0, 80)}` : '')
        ),
      ].join('\n')
    );
  }

  if (befehl === 'neu') {
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(name))
      return antwort('Name: 2–40 Zeichen, Kleinbuchstaben, Ziffern, Bindestrich.');
    const i = weiter.findIndex((w) => w.startsWith('@'));
    if (i < 1) return antwort('Aufruf: `!routine neu <name> <zeitplan> @agent <ziel>`');
    const zeitplan = weiter.slice(0, i).join(' ').replace(/^"|"$/g, '');
    const agentId = weiter[i]!.slice(1).split(':')[0]!.replace(/^_sw_/, '');
    const ziel = weiter
      .slice(i + 1)
      .join(' ')
      .trim();
    const plan = zeitplanLesen(zeitplan);
    if (!plan)
      return antwort(
        `Zeitplan „${zeitplan}“ verstehe ich nicht. Beispiele: täglich 07:00 · werktags 06:30 · mo,do 18:00 · monatlich 1 05:00 · stündlich · alle 30 min`
      );
    const agent = await agentById(agentId, tx);
    if (!agent || !agent.roomId || agent.mode === 'notify')
      return antwort(`${agentId} nimmt keine Aufträge an.`);
    if (!ziel) return antwort('Ohne Ziel keine Routine.');
    if (agent.id === 'betrieb') {
      const b = await betriebSpec(ziel);
      if ('fehler' in b) return antwort(`🚫 ${b.fehler}`);
    }
    const naechster = naechsterLauf(plan, new Date());
    const [lobby] = await roomsByKind('lobby', tx);
    let wurzel: number | null = null;
    if (lobby?.roomId) {
      const [id] = await enqueue(
        tx,
        [
          {
            kind: 'message',
            roomId: lobby.roomId,
            payload: {
              type: 'm.room.message',
              content: notice(
                `🔁 Routine ${name} · ${zeitplan} · @${agent.id}\n${ziel}\nDie Läufe antworten hier im Thread. Pause: !routine pause ${name}`
              ),
            },
          },
        ],
        ctx.hub
      );
      wurzel = id ?? null;
    }
    try {
      await tx`
        INSERT INTO swarm.routinen (name, zeitplan, agent, ziel, naechster, wurzel_outbox, erstellt_von)
        VALUES (${name}, ${zeitplan}, ${agent.id}, ${ziel}, ${naechster}, ${wurzel ?? null}, ${ctx.owner})`;
    } catch {
      return antwort(`Eine Routine „${name}“ gibt es schon.`);
    }
    auditMerken(ctx.owner, 'routine.neu', null, { name, zeitplan, agent: agent.id });
    await antwort(`🔁 Routine ${name} angelegt, erster Lauf ${datumZeit(naechster)}.`);
    return aenderung();
  }

  const [r] = (
    (await tx`SELECT * FROM swarm.routinen WHERE name = ${name}`) as Record<string, unknown>[]
  ).map(zeile);
  if (!r) return antwort(`Keine Routine „${name}“. !routine zeigt die Liste.`);
  if (befehl === 'pause') {
    await tx`UPDATE swarm.routinen SET pausiert = true WHERE id = ${r.id}`;
    await antwort(`⏸️ Routine ${r.name} pausiert.`);
    return aenderung();
  }
  if (befehl === 'weiter') {
    const plan = zeitplanLesen(r.zeitplan);
    const naechster = plan ? naechsterLauf(plan, new Date()) : null;
    await tx`UPDATE swarm.routinen SET pausiert = false, naechster = ${naechster} WHERE id = ${r.id}`;
    await antwort(
      `▶️ Routine ${r.name} läuft wieder${naechster ? `, nächster Lauf ${datumZeit(naechster)}` : ''}.`
    );
    return aenderung();
  }
  if (befehl === 'jetzt') {
    const lauf = await routineStarten(ctx, r, `routine:${r.id}:jetzt:${input.eventId}`, tx);
    await tx`UPDATE swarm.routinen SET letzter_zeit = now(), letzter_task = ${lauf.ok ? lauf.text : r.letzterTask},
             letzter_fehler = ${lauf.ok ? null : lauf.text} WHERE id = ${r.id}`;
    await antwort(
      lauf.ok
        ? `▶️ Routine ${r.name} läuft jetzt: ${lauf.text}`
        : `🚫 Routine ${r.name}: ${lauf.text}`
    );
    return aenderung();
  }
  if (befehl === 'weg' || befehl === 'loeschen' || befehl === 'löschen') {
    await tx`DELETE FROM swarm.routinen WHERE id = ${r.id}`;
    auditMerken(ctx.owner, 'routine.weg', null, { name: r.name });
    await antwort(`🗑 Routine ${r.name} gelöscht.`);
    return aenderung();
  }
  return antwort(
    'Befehle: !routine · !routine neu <name> <zeitplan> @agent <ziel> · !routine pause|weiter|jetzt|weg <name>'
  );
}
