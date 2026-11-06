/**
 * Abläufe (matrix/PLAN-weiter.md, Punkt 11): mehrstufige Vorlagen mit Rollen und Toren.
 *
 *   !ablauf                      → Vorlagen und laufende Abläufe
 *   !ablauf <name> <ziel>        → starten
 *   !ablauf stop <nr>            → abbrechen
 *
 * Ein Ablauf hat eine Wurzel-Notice in der Lobby; jeder Schritt ist ein normaler Auftrag, der in deren Thread
 * antwortet. Ein Agent-Schritt bekommt das Ergebnis des vorigen als Material (keine Anweisung). Ein Tor
 * („🚦 … Weiter? ✅ / ❌“) wartet auf Vales Reaktion; ein Patch-Schritt gibt den Patch eines früheren
 * Schritts dem Worker git (wie `!patch`). Scheitert ein Schritt, endet der Ablauf mit Hinweis.
 */
import { sql, type Db } from './db/index.js';
import { auditMerken } from './db/audit.js';
import { roomsByKind } from './agents/store.js';
import { enqueue } from './outbox.js';
import { notice } from './appservice/messages.js';
import { createTaskFlow } from './tasks/create.js';
import { patchVon } from './patches.js';
import { createHash } from 'node:crypto';
import type { Ctx } from './context.js';

type Schritt =
  | { agent: string; ziel: string; material?: 'vorher' }
  | { tor: string }
  | { patch: 'pruefen' | 'anwenden'; von: number };

export const ABLAEUFE: Record<string, { beschreibung: string; schritte: Schritt[] }> = {
  'code-aenderung': {
    beschreibung: 'plum setzt um, claude-code prüft als Zweitmeinung, du entscheidest',
    schritte: [
      { agent: 'plum', ziel: '{ziel}' },
      {
        agent: 'claude-code',
        ziel: 'Zweitmeinung: Prüfe das Ergebnis von {vorher} kritisch. Stimmt es, was fehlt, welches Risiko? Ziel war: {ziel}',
        material: 'vorher',
      },
      { tor: 'Umsetzung (Plum) und Zweitmeinung (Claude Code) liegen vor. Ablauf abschliessen?' },
    ],
  },
  'code-patch': {
    beschreibung:
      'claude-code liefert einen Patch, plum prüft, du entscheidest, git prüft den Patch',
    schritte: [
      { agent: 'claude-code', ziel: '{ziel}' },
      {
        agent: 'plum',
        ziel: 'Prüfe das Ergebnis von {vorher} kritisch: Stimmt es, was fehlt, welches Risiko? Ziel war: {ziel}',
        material: 'vorher',
      },
      { tor: 'Patch und Prüfung liegen vor. Soll git den Patch aus Schritt 1 prüfen?' },
      { patch: 'pruefen', von: 1 },
    ],
  },
  recherche: {
    beschreibung: 'Brian recherchiert, claude-code prüft und fasst zusammen',
    schritte: [
      { agent: 'brian', ziel: 'Recherchiere: {ziel}' },
      {
        agent: 'claude-code',
        ziel: 'Prüfe die Recherche aus {vorher}, fasse sie zusammen und nenne Lücken. Ziel: {ziel}',
        material: 'vorher',
      },
    ],
  },
  zweitmeinung: {
    beschreibung: 'plum und claude-code lösen dieselbe Aufgabe, du vergleichst',
    schritte: [
      { agent: 'plum', ziel: '{ziel}' },
      { agent: 'claude-code', ziel: 'Zweitmeinung, unabhängig und kurz: {ziel}' },
      { tor: 'Beide Lösungen liegen vor (Schritt 1 und 2). Ablauf abschliessen?' },
    ],
  },
};

interface Ablauf {
  id: number;
  name: string;
  ziel: string;
  schritt: number;
  zustand: string;
  tasks: string[];
  torOutbox: number | null;
  wurzelOutbox: number | null;
}
const zeile = (r: Record<string, unknown>): Ablauf => ({
  id: Number(r.id),
  name: String(r.name),
  ziel: String(r.ziel),
  schritt: Number(r.schritt),
  zustand: String(r.zustand),
  tasks: (r.tasks as string[]) ?? [],
  torOutbox: r.tor_outbox === null ? null : Number(r.tor_outbox),
  wurzelOutbox: r.wurzel_outbox === null ? null : Number(r.wurzel_outbox),
});

async function eventVon(db: Db, outboxId: number | null): Promise<string | null> {
  if (!outboxId) return null;
  const [z] = await db`SELECT sent_event_id FROM swarm.outbox WHERE id = ${outboxId}`;
  return (z?.sent_event_id as string | null) ?? null;
}

async function imThread(ctx: Ctx, db: Db, a: Ablauf, text: string): Promise<number | null> {
  const [lobby] = await roomsByKind('lobby', db);
  if (!lobby?.roomId) return null;
  const thread = await eventVon(db, a.wurzelOutbox);
  const [id] = await enqueue(
    db,
    [
      {
        kind: 'message',
        roomId: lobby.roomId,
        payload: { type: 'm.room.message', content: notice(text, { thread }) },
      },
    ],
    ctx.hub
  );
  return id ?? null;
}

const einsetzen = (t: string, ziel: string, vorher: string | null) =>
  t.replaceAll('{ziel}', ziel).replaceAll('{vorher}', vorher ?? '—');

/** Den Schritt `a.schritt` beginnen (Auftrag, Tor oder Patch). */
async function schrittStarten(ctx: Ctx, db: Db, a: Ablauf): Promise<void> {
  const vorlage = ABLAEUFE[a.name];
  const s = vorlage?.schritte[a.schritt];
  if (!vorlage || !s) {
    await db`UPDATE swarm.ablaeufe SET zustand = 'fertig', beendet = now() WHERE id = ${a.id}`;
    await imThread(ctx, db, a, `🏁 Ablauf ${a.name} #${a.id} fertig: ${a.tasks.join(' → ')}`);
    return;
  }
  const nr = `${a.schritt + 1}/${vorlage.schritte.length}`;
  const vorher = a.tasks.at(-1) ?? null;
  if ('tor' in s) {
    const id = await imThread(
      ctx,
      db,
      a,
      `🚦 Ablauf ${a.name} #${a.id}, Schritt ${nr}: ${s.tor}\nWeiter? ✅ / ❌ (Reaktion auf diese Nachricht)`
    );
    await db`UPDATE swarm.ablaeufe SET zustand = 'wartet', tor_outbox = ${id} WHERE id = ${a.id}`;
    return;
  }
  const [lobby] = await roomsByKind('lobby', db);
  const thread = await eventVon(db, a.wurzelOutbox);
  let r;
  if ('patch' in s) {
    const quelle = a.tasks[s.von - 1];
    const p = quelle ? await patchVon(quelle, db) : null;
    if (!p || p.repo === 'unbekannt') {
      await imThread(
        ctx,
        db,
        a,
        `⏭️ Schritt ${nr}: ${quelle ?? 'Schritt ' + s.von} hat keinen Patch, übersprungen.`
      );
      await db`UPDATE swarm.ablaeufe SET schritt = schritt + 1 WHERE id = ${a.id}`;
      return schrittStarten(ctx, db, { ...a, schritt: a.schritt + 1 });
    }
    r = await createTaskFlow(
      ctx,
      {
        goal: `patch.${s.patch} ${quelle} in ${p.repo} — Ablauf ${a.name} #${a.id}`,
        deliverable: 'Ergebnis des git-Schritts',
        budgetMinutes: 10,
        assignee: 'git',
        from: ctx.owner,
        originRoom: lobby?.roomId ?? '',
        originThread: thread,
        idempotencyKey: `ablauf:${a.id}:${a.schritt}`,
        betriebSpec: JSON.stringify({
          aktion: s.patch,
          task: quelle,
          repo: p.repo,
          patch: p.text,
          sha: createHash('sha256').update(p.text).digest('hex').slice(0, 12),
        }),
      },
      db
    );
  } else {
    let material: string | undefined;
    if (s.material === 'vorher' && vorher) {
      const [t] = await db`SELECT result FROM swarm.tasks WHERE id = ${vorher}`;
      material = t?.result ? String(t.result).slice(0, 8000) : undefined;
    }
    r = await createTaskFlow(
      ctx,
      {
        goal: einsetzen(s.ziel, a.ziel, vorher),
        ...(material ? { context: material } : {}),
        assignee: s.agent,
        from: ctx.owner,
        originRoom: lobby?.roomId ?? '',
        originThread: thread,
        idempotencyKey: `ablauf:${a.id}:${a.schritt}`,
      },
      db
    );
  }
  if (!r.ok) {
    await db`UPDATE swarm.ablaeufe SET zustand = 'fehler', beendet = now() WHERE id = ${a.id}`;
    await imThread(
      ctx,
      db,
      a,
      `⚠️ Ablauf ${a.name} #${a.id}, Schritt ${nr} nicht gestartet (${r.code}): ${r.reason}`
    );
    return;
  }
  await db`UPDATE swarm.ablaeufe SET zustand = 'laeuft', tasks = array_append(tasks, ${r.taskId}) WHERE id = ${a.id}`;
}

/** `!ablauf …` */
export async function cmdAblauf(
  ctx: Ctx,
  tx: Db,
  input: { body: string },
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const [kopf = '', ...rest] = input.body
    .trim()
    .replace(/^!ablauf\s*/i, '')
    .split(/\s+/);
  if (!kopf) {
    const laufend = (
      (await tx`SELECT * FROM swarm.ablaeufe WHERE zustand IN ('laeuft', 'wartet') ORDER BY id`) as Record<
        string,
        unknown
      >[]
    ).map(zeile);
    return antwort(
      [
        'Abläufe: `!ablauf <name> <ziel>`',
        ...Object.entries(ABLAEUFE).map(
          ([n, v]) => `• ${n} — ${v.beschreibung} (${v.schritte.length} Schritte)`
        ),
        ...(laufend.length
          ? [
              '',
              'Laufend:',
              ...laufend.map(
                (a) =>
                  `• #${a.id} ${a.name} · Schritt ${a.schritt + 1} · ${a.zustand === 'wartet' ? 'wartet auf dich' : 'läuft'} · ${a.tasks.join(' → ') || '—'}`
              ),
            ]
          : []),
      ].join('\n')
    );
  }
  if (kopf === 'stop') {
    const id = Number(rest[0]);
    const r =
      await tx`UPDATE swarm.ablaeufe SET zustand = 'abgebrochen', beendet = now() WHERE id = ${id} AND zustand IN ('laeuft', 'wartet') RETURNING id`;
    return antwort(
      r.length
        ? `🛑 Ablauf #${id} abgebrochen (laufende Aufträge stoppst du mit !stop T-…).`
        : `Kein laufender Ablauf #${id}.`
    );
  }
  const vorlage = ABLAEUFE[kopf];
  const ziel = rest.join(' ').trim();
  if (!vorlage) return antwort(`Keine Vorlage „${kopf}“. !ablauf zeigt die Liste.`);
  if (!ziel) return antwort(`Ohne Ziel kein Ablauf: \`!ablauf ${kopf} <ziel>\``);
  const [lobby] = await roomsByKind('lobby', tx);
  const [wurzel] = lobby?.roomId
    ? await enqueue(
        tx,
        [
          {
            kind: 'message',
            roomId: lobby.roomId,
            payload: {
              type: 'm.room.message',
              content: notice(
                `🧭 Ablauf ${kopf}: ${ziel}\n${vorlage.schritte.map((s, i) => `${i + 1}. ${'tor' in s ? '🚦 du entscheidest' : 'patch' in s ? `git: Patch ${s.patch}` : `@${s.agent}`}`).join('  ')}\nDie Schritte antworten hier im Thread.`
              ),
            },
          },
        ],
        ctx.hub
      )
    : [];
  const [z] =
    await tx`INSERT INTO swarm.ablaeufe (name, ziel, wurzel_outbox) VALUES (${kopf}, ${ziel.slice(0, 2000)}, ${wurzel ?? null}) RETURNING *`;
  auditMerken(ctx.owner, 'ablauf.start', null, { name: kopf, id: Number(z!.id) });
  await antwort(`🧭 Ablauf ${kopf} #${z!.id} gestartet.`);
}

/** ✅/❌ von Vale auf ein 🚦-Tor. true, wenn die Reaktion damit erledigt ist. */
export async function torReaktion(
  ctx: Ctx,
  tx: Db,
  row: { sender: string },
  ziel: string,
  key: string | undefined
): Promise<boolean> {
  if (key !== '✅' && key !== '❌') return false;
  const [a] = (
    (await tx`
    SELECT a.* FROM swarm.ablaeufe a JOIN swarm.outbox o ON o.id = a.tor_outbox
     WHERE o.sent_event_id = ${ziel} AND a.zustand = 'wartet'`) as Record<string, unknown>[]
  ).map(zeile);
  if (!a) return false;
  if (row.sender !== ctx.owner) return true;
  if (key === '❌') {
    await tx`UPDATE swarm.ablaeufe SET zustand = 'abgebrochen', beendet = now(), tor_outbox = NULL WHERE id = ${a.id}`;
    await imThread(
      ctx,
      tx,
      a,
      `🛑 Ablauf ${a.name} #${a.id} an Schritt ${a.schritt + 1} von dir beendet.`
    );
    auditMerken(ctx.owner, 'ablauf.tor', null, { id: a.id, weiter: false });
    return true;
  }
  await tx`UPDATE swarm.ablaeufe SET zustand = 'laeuft', schritt = schritt + 1, tor_outbox = NULL WHERE id = ${a.id}`;
  auditMerken(ctx.owner, 'ablauf.tor', null, { id: a.id, weiter: true });
  await schrittStarten(ctx, tx, { ...a, schritt: a.schritt + 1, zustand: 'laeuft' });
  return true;
}

/** Takt (weiter.ts): neue Abläufe beginnen, fertige Schritte weiterschalten, gescheiterte beenden. */
export async function ablaeufeTakt(ctx: Ctx): Promise<number> {
  let bewegt = 0;
  const laufend = (
    (await sql`SELECT * FROM swarm.ablaeufe WHERE zustand = 'laeuft' ORDER BY id LIMIT 20`) as Record<
      string,
      unknown
    >[]
  ).map(zeile);
  for (const a of laufend) {
    await sql.begin(async (tx) => {
      const [frisch] = (
        (await tx`SELECT * FROM swarm.ablaeufe WHERE id = ${a.id} AND zustand = 'laeuft' FOR UPDATE SKIP LOCKED`) as Record<
          string,
          unknown
        >[]
      ).map(zeile);
      if (!frisch) return;
      // Noch kein Auftrag für den aktuellen Schritt: jetzt beginnen.
      if (
        frisch.tasks.length <= frisch.schritt &&
        !('tor' in (ABLAEUFE[frisch.name]?.schritte[frisch.schritt] ?? {}))
      ) {
        await schrittStarten(ctx, tx, frisch);
        bewegt++;
        return;
      }
      const aktuell = frisch.tasks[frisch.schritt];
      if (!aktuell) return;
      const [t] = await tx`SELECT state FROM swarm.tasks WHERE id = ${aktuell}`;
      if (
        !t ||
        ['submitted', 'working', 'input-required', 'auth-required'].includes(String(t.state))
      )
        return;
      if (t.state !== 'completed') {
        await tx`UPDATE swarm.ablaeufe SET zustand = 'fehler', beendet = now() WHERE id = ${frisch.id}`;
        await imThread(
          ctx,
          tx,
          frisch,
          `⚠️ Ablauf ${frisch.name} #${frisch.id}: ${aktuell} endete mit ${t.state}. Ablauf beendet.`
        );
        bewegt++;
        return;
      }
      await tx`UPDATE swarm.ablaeufe SET schritt = schritt + 1 WHERE id = ${frisch.id}`;
      await schrittStarten(ctx, tx, { ...frisch, schritt: frisch.schritt + 1 });
      bewegt++;
    });
  }
  return bewegt;
}
