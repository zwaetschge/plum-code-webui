/**
 * Freigaben für Übergaben an T2, direkt in Matrix (ADR-003 R1; §7.3, §9.3, §15.6).
 *
 * Eine Übergabe an einen Agenten mit Host-Zugriff legt der Hub als `auth-required` an und postet
 * eine Freigabe-Notice in `#schwarm-freigaben`. Vale entscheidet dort mit einer Reaktion aus dem
 * eigenen Konto: ✅ gibt frei, ❌ oder 🛑 lehnt ab. Ohne Entscheidung läuft die Freigabe nach 30 min
 * ab. Freigegeben wird der Auftrag `submitted` und seine Karte geht raus, sonst wird er `canceled`.
 * Beides meldet der Hub in der Lobby und auf dem Board.
 *
 * Bis ADR-003 lief das über den Broker des Rats und die Rat-UI. Jetzt zählt eine Reaktion nur,
 * wenn alles passt: Sie kommt von `OWNER_MXID`, liegt im Freigaben-Raum, gilt der Notice des Hubs
 * zu genau diesem Auftrag und kommt innerhalb der Frist. Den Absender beglaubigt Synapse, und
 * `@zwaetschge` liegt nicht im Namensraum des Appservice: Der Hub kann sich also nicht selbst
 * freigeben, und kein Bot kann es (§7.1).
 */
import { reactionSignal } from '../protocol/index.js';
import { sql, type Db } from '../db/index.js';
import { audit, getFlag, setFlag } from '../db/audit.js';
import { agentById, roomsByKind } from '../agents/store.js';
import { notice } from '../appservice/messages.js';
import { enqueue, releaseHeld } from '../outbox.js';
import { notify } from '../notify.js';
import { redact } from '../redact.js';
import type { Ctx } from '../context.js';
import { zustandUndMeldung } from '../tasks/transition.js';
import * as store from '../tasks/store.js';

/** Frist einer Freigabe, wie bisher im Rat. */
/**
 * Fenster für Vales Entscheidung. 30 min sind knapp, wenn er nicht am Rechner
 * sitzt — T-0032 verhungerte daran (ADR-002 §4.42). Über die Umgebung änderbar.
 */
export const FREIGABE_MIN = Number(process.env.SCHWARM_FREIGABE_MINUTEN || 30);
/** Wie oft der Hub eine Notice nachholt, die nie rausging (etwa nach einem Absturz). */
const MAX_ANFRAGEN = 5;
/** Marker in `council_action_id`: Die Freigabe läuft über Matrix, nicht mehr über den Rat. */
const MATRIX = 'matrix';

/** Kette als Text: „Vale → Brian → Codex (Host)" (§11.4). */
export function kettenText(task: store.TaskRow, zielName: string): string {
  const kette = (task as unknown as { chain?: string[] }).chain ?? [];
  const glieder = kette.length ? kette : [task.fromAgent];
  return `${glieder.join(' → ')} → ${zielName}`;
}

const uhrzeit = (d: Date) =>
  d.toLocaleTimeString('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' });

/** Freigabe-Notice in `#schwarm-freigaben` posten und per ntfy melden — ohne Token, ohne Link nach aussen. */
export async function freigabeBeantragen(
  ctx: Ctx,
  task: store.TaskRow
): Promise<{ ok: boolean; fehler?: string }> {
  const [freigaben] = await roomsByKind('approvals');
  if (!freigaben?.roomId) return { ok: false, fehler: '#schwarm-freigaben fehlt' };
  const ziel = await agentById(task.assignee);
  const zielName = ziel?.displayName ?? task.assignee;
  const kette = kettenText(task, zielName);
  const bis = new Date(Date.now() + FREIGABE_MIN * 60_000);
  await enqueue(
    sql,
    [
      {
        kind: 'message',
        roomId: freigaben.roomId,
        taskId: task.id,
        payload: {
          type: 'm.room.message',
          role: 'freigabe',
          content: notice(
            `🔐 Freigabe nötig · ${task.id} · ${ziel?.trust ?? 'T2'}-Agent\n` +
              `Kette: ${kette}\n` +
              `Was: ${redact(task.goal)}\n` +
              `Ergebnis: ${redact(task.deliverable ?? '')}\n` +
              `Grenzen: ${task.constraints.map((c) => redact(c)).join(', ') || 'keine'}\n` +
              `Läuft ab: ${uhrzeit(bis)} (nach ${FREIGABE_MIN} min)\n` +
              '✅ auf diese Nachricht gibt frei, ❌ lehnt ab. Es zählt nur deine Reaktion (§7.3).'
          ),
        },
      },
    ],
    ctx.hub
  );
  await sql`UPDATE swarm.tasks SET council_action_id = ${MATRIX} WHERE id = ${task.id}`;
  await audit('hub', 'freigabe.anfrage', task.id, { ziel: task.assignee, weg: MATRIX });
  await notify(
    {
      title: `Schwarm: Freigabe nötig (${task.id})`,
      text: `${kette}: ${redact(task.goal).slice(0, 200)} — ✅ oder ❌ in #schwarm-freigaben`,
      priority: 4,
      tags: ['lock'],
    },
    ctx.log
  );
  ctx.log.info({ task: task.id, ziel: task.assignee }, 'Freigabe angefragt (Matrix)');
  return { ok: true };
}

type Art = 'erteilt' | 'abgelehnt' | 'abgelaufen';

/** Entscheidung umsetzen: Zustand, Karte, Antwort unter der Notice, Audit. */
async function entscheiden(ctx: Ctx, tx: Db, taskId: string, art: Art, von: string): Promise<void> {
  const erteilt = art === 'erteilt';
  await zustandUndMeldung(
    ctx,
    tx,
    taskId,
    erteilt ? 'submitted' : 'canceled',
    erteilt
      ? { note: 'Freigabe erteilt (✅ von Vale)' }
      : {
          failReason:
            art === 'abgelehnt'
              ? 'Freigabe abgelehnt (❌ von Vale)'
              : `Freigabe abgelaufen (${FREIGABE_MIN} min)`,
        }
  );
  if (erteilt) await releaseHeld(taskId, tx);
  const [karte] = await tx`
    SELECT m.event_id, r.room_id FROM swarm.matrix_map m
      JOIN swarm.rooms r ON r.kind = 'approvals'
     WHERE m.task_id = ${taskId} AND m.role = 'freigabe'
     ORDER BY m.created_at DESC LIMIT 1`;
  if (karte?.room_id && karte.event_id) {
    const text = {
      erteilt: '✅ freigegeben',
      abgelehnt: '❌ abgelehnt',
      abgelaufen: `⌛ abgelaufen nach ${FREIGABE_MIN} min`,
    }[art];
    await enqueue(
      tx,
      [
        {
          kind: 'message',
          roomId: String(karte.room_id),
          taskId,
          payload: {
            type: 'm.room.message',
            role: 'quittung',
            content: notice(`${text} · ${taskId}`, { thread: String(karte.event_id) }),
          },
        },
      ],
      ctx.hub
    );
  }
  await audit(von, `freigabe.${art}`, taskId, { weg: MATRIX });
  ctx.log.info({ task: taskId, art }, 'Freigabe entschieden');
}

/**
 * Reaktion auf eine Freigabe-Notice des Hubs. Gibt `true` zurück, wenn es eine war, denn dann ist
 * die Reaktion damit erledigt, egal von wem. Entscheiden kann nur Vale.
 */
export async function freigabeReaktion(
  ctx: Ctx,
  tx: Db,
  row: { sender: string; room_id: string },
  zielEvent: string,
  zeichen: string | undefined
): Promise<boolean> {
  const [map] =
    await tx`SELECT task_id, role, created_at FROM swarm.matrix_map WHERE event_id = ${zielEvent}`;
  if (!map || map.role !== 'freigabe') return false;
  const taskId = String(map.task_id);
  const [freigaben] = await roomsByKind('approvals', tx);
  if (row.sender !== ctx.owner || row.room_id !== freigaben?.roomId) {
    await audit(row.sender, 'freigabe.fremde_reaktion', taskId, {
      zeichen: zeichen ?? null,
      raum: row.room_id === freigaben?.roomId,
    });
    ctx.log.warn(
      { task: taskId, von: row.sender },
      'Reaktion auf Freigabe nicht von Vale oder nicht im Freigaben-Raum — ignoriert'
    );
    return true;
  }
  const task = await store.getTask(taskId, tx);
  if (!task || task.state !== 'auth-required') return true; // schon entschieden
  if (Date.now() - new Date(String(map.created_at)).getTime() > FREIGABE_MIN * 60_000) {
    await entscheiden(ctx, tx, taskId, 'abgelaufen', 'hub');
    return true;
  }
  const signal = reactionSignal(zeichen);
  if (signal === 'done') await entscheiden(ctx, tx, taskId, 'erteilt', row.sender);
  else if (signal === 'fail' || signal === 'cancel')
    await entscheiden(ctx, tx, taskId, 'abgelehnt', row.sender);
  return true;
}

export interface FreigabeLauf {
  erteilt: number;
  abgelehnt: number;
  abgelaufen: number;
  offen: number;
}

/**
 * Zwei Erinnerungen pro Freigabe: bei der Hälfte und bei 90 % des Fensters
 * (§4.42). Eine Karte, die niemand sieht, ist keine Frage an Vale — sie läuft
 * einfach ab. Der Stand steht in einem Flag, damit der 15-s-Takt nicht flutet.
 */
async function erinnern(
  ctx: Ctx,
  zeile: { id: string; goal: string | null; notice: string | null; gesendet: Date | string }
): Promise<void> {
  const minuten = (Date.now() - new Date(zeile.gesendet).getTime()) / 60_000;
  const anteil = minuten / FREIGABE_MIN;
  const stufe = anteil >= 0.9 ? 2 : anteil >= 0.5 ? 1 : 0;
  if (!stufe) return;
  const flag = `freigabe-erinnert:${zeile.id}`;
  const stand = await getFlag<{ stufe?: number }>(flag);
  if ((stand?.stufe ?? 0) >= stufe) return;
  const [raum] = await roomsByKind('approvals');
  if (!raum?.roomId) return;
  const rest = Math.max(1, Math.round(FREIGABE_MIN - minuten));
  await enqueue(
    sql,
    [
      {
        kind: 'message',
        roomId: raum.roomId,
        taskId: zeile.id,
        payload: {
          type: 'm.room.message',
          role: 'erinnerung',
          content: notice(
            `${stufe === 2 ? '⏳' : '🔔'} ${zeile.id} wartet seit ${Math.round(minuten)} min auf deine Entscheidung — ` +
              `noch ${rest} min, dann gilt sie als abgelehnt.\n` +
              `${zeile.goal ?? ''}\n✅ gibt frei, ❌ lehnt ab.`,
            { thread: zeile.notice }
          ),
        },
      },
    ],
    ctx.hub
  );
  await setFlag(flag, { stufe }, 'hub');
}

/**
 * Takt (15 s): abgelaufene Freigaben schliessen und Notices nachholen, die nie rausgingen.
 * Entschieden wird nur per Reaktion; hier gibt es kein „erteilt".
 */
export async function pollFreigaben(ctx: Ctx): Promise<FreigabeLauf> {
  const lauf: FreigabeLauf = { erteilt: 0, abgelehnt: 0, abgelaufen: 0, offen: 0 };
  const zeilen = (await sql`
    SELECT t.id, t.council_action_id, t.attempts, t.goal,
           (SELECT max(m.created_at) FROM swarm.matrix_map m WHERE m.task_id = t.id AND m.role = 'freigabe') AS gesendet,
           (SELECT m.event_id FROM swarm.matrix_map m WHERE m.task_id = t.id AND m.role = 'freigabe'
             ORDER BY m.created_at DESC LIMIT 1) AS notice
      FROM swarm.tasks t
     WHERE t.state = 'auth-required'
     ORDER BY t.created_at LIMIT 50`) as unknown as {
    id: string;
    council_action_id: string | null;
    attempts: number;
    goal: string | null;
    gesendet: Date | string | null;
    notice: string | null;
  }[];

  for (const zeile of zeilen) {
    if (!zeile.council_action_id) {
      if (Number(zeile.attempts ?? 0) >= MAX_ANFRAGEN) continue;
      const task = await store.getTask(zeile.id);
      if (!task) continue;
      const res = await freigabeBeantragen(ctx, task);
      if (!res.ok) {
        await sql`UPDATE swarm.tasks SET attempts = attempts + 1 WHERE id = ${zeile.id}`;
        ctx.log.warn({ task: zeile.id, fehler: res.fehler }, 'Freigabe-Notice nicht angelegt');
      }
      lauf.offen++;
      continue;
    }
    // Die Frist beginnt, wenn die Notice sichtbar ist; bis dahin wartet sie in der Outbox.
    if (
      !zeile.gesendet ||
      Date.now() - new Date(zeile.gesendet).getTime() <= FREIGABE_MIN * 60_000
    ) {
      if (zeile.gesendet) {
        await erinnern(ctx, {
          id: zeile.id,
          goal: zeile.goal,
          notice: zeile.notice,
          gesendet: zeile.gesendet as Date | string,
        });
      }
      lauf.offen++;
      continue;
    }
    await sql.begin(async (tx) => {
      const task = await store.getTask(zeile.id, tx);
      if (task?.state === 'auth-required')
        await entscheiden(ctx, tx, zeile.id, 'abgelaufen', 'hub');
    });
    lauf.abgelaufen++;
  }
  return lauf;
}
