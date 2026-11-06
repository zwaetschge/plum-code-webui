/**
 * Zustandsübergang plus Meldung in derselben Transaktion (§10.2): Board-Karte
 * per Edit, Notice in die Lobby, `/stop` an den Bot bei einem Abbruch
 * (ADR-002 §4.1) und eine neue Karte bei einem Wiederholungsversuch.
 */
import { auditMerken } from '../db/audit.js';
import { reactionSignal, type TaskState } from '../protocol/index.js';
import { env } from '../env.js';
import { transition as pruefeUebergang } from './state.js';
import type { Db } from '../db/index.js';
import { agentById, roomsByKind } from '../agents/store.js';
import { edit, notice, text } from '../appservice/messages.js';
import { enqueue, releaseNextHeld, type NewOutbox } from '../outbox.js';
import { notify } from '../notify.js';
import type { Ctx } from '../context.js';
import { boardCardBody, permalink } from './card.js';
import { kuerzenUndAnhaengen } from '../artifacts.js';
import * as store from './store.js';

/** Kennwort für Ausgaben, die ein Abbruch bewusst verworfen hat. */
export const ABGEBROCHEN = 'abgebrochen';

/** Zustände, in denen ein Auftrag zu Ende ist und seine Kosten feststehen. */
const ENDE: TaskState[] = ['completed', 'failed', 'canceled', 'rejected'];

export interface UebergangInfo {
  result?: string | null;
  failReason?: string;
  retry?: boolean;
  note?: string;
  /** Nur fürs Audit: welche Reaktion den Übergang ausgelöst hat. */
  triggerEvent?: string;
  /** Wer den Übergang ausgelöst hat — fehlt er, steht `hub` im Audit. */
  actor?: string;
}

export async function zustandUndMeldung(
  ctx: Ctx,
  tx: Db,
  taskId: string,
  to: TaskState,
  info: UebergangInfo = {}
): Promise<boolean> {
  const vorher = await store.getTask(taskId, tx);
  if (!vorher) return false;
  // Ein ✅, das nach einem Abbruch eintrudelt, darf den Zustand nicht kippen (§8.3).
  const unerlaubt = pruefeUebergang(vorher.state, to);
  if (unerlaubt) {
    ctx.log.info({ task: taskId, unerlaubt }, 'Übergang nicht erlaubt — ignoriert');
    return false;
  }
  const task = await store.setState(
    taskId,
    to,
    {
      ...(info.result !== undefined ? { result: info.result } : {}),
      ...(info.failReason !== undefined ? { failReason: info.failReason } : {}),
      ...(info.retry ? { retry: true } : {}),
    },
    tx
  );
  if (!task) return false;

  // §6.6: Jeder Zustandswechsel in die unveränderliche Kette, in derselben
  // Transaktion. Ohne das liess sich ein Auftrag nachträglich nicht rekonstruieren —
  // der Selbsttest T-0004 lief komplett durch, ohne eine Audit-Zeile zu hinterlassen.
  auditMerken(info.actor ?? 'hub', `task.${to}`, taskId, {
    von: vorher.state,
    ...(info.result !== undefined ? { zeichen: String(info.result ?? '').length } : {}),
    ...(info.failReason ? { grund: String(info.failReason).slice(0, 160) } : {}),
    ...(info.retry ? { wiederholung: task.attempts } : {}),
    ...(info.triggerEvent ? { ausloeser: info.triggerEvent } : {}),
    ...(task.costUsd !== null && vorher.costUsd === null ? { kosten: task.costUsd } : {}),
  });

  if (to === 'working' && !task.claimedAt) await store.markClaimed(task.id, tx);

  // Kosten für native Bots sind eine Rechengrösse (§12.2): Laufzeit × Satz pro
  // Minute aus agents.swarm.yaml. Ohne sie bliebe `cost_usd` leer, das
  // Tagesbudget (§12.1, N3) würde nie greifen und `!budget` zeigte immer 0.00.
  // Worker und Rat melden echte Kosten, die gehen vor.
  if (ENDE.includes(to) && vorher.costUsd === null) {
    const satz = await store.usdProMinute(task.assignee, tx);
    if (satz !== null) {
      const start = vorher.claimedAt ?? vorher.createdAt;
      const minuten = Math.max(0, (Date.now() - new Date(start).getTime()) / 60_000);
      const geschaetzt = Math.round(minuten * satz * 10_000) / 10_000;
      // Die Schätzung deckelt sich am Budget des Auftrags. Ein Auftrag, der auf eine
      // Rückmeldung wartet, rechnet sonst Wartezeit als Rechenzeit ab und frisst das
      // Tagesbudget (§12.1): T-0031 wartete 115 min auf eine Freigabe, die nie kam,
      // und stand mit 2,87 USD von 3,00 Tagesbudget da — ohne ein einziges Token.
      const deckel =
        task.budgetUsd !== null && Number(task.budgetUsd) > 0 ? Number(task.budgetUsd) : null;
      const usd = deckel !== null ? Math.min(geschaetzt, deckel) : geschaetzt;
      if (usd > 0) await store.addCost(task.id, usd, tx);
      if (deckel !== null && geschaetzt > deckel) {
        auditMerken('hub', 'task.kosten_gedeckelt', taskId, {
          geschaetzt,
          deckel,
          minuten: Math.round(minuten),
        });
      }
    }
  }

  const agent = await agentById(task.assignee, tx);
  const [board] = await roomsByKind('board', tx);
  const [lobby] = await roomsByKind('lobby', tx);
  const ausgabe: NewOutbox[] = [];

  const kartenText = boardCardBody(
    {
      id: task.id,
      root: task.root,
      parent: task.parent,
      correlationId: task.correlationId,
      state: to,
      from: task.fromAgent,
      assignee: task.assignee,
      assigneeName: agent?.displayName ?? task.assignee,
      assigneeMxid: agent?.mxid ?? '',
      hop: task.hop,
      depth: task.depth,
      goal: task.goal,
      deliverable: task.deliverable,
      constraints: task.constraints,
      budgetUsd: task.budgetUsd === null ? null : Number(task.budgetUsd),
      budgetMinutes: task.budgetMinutes,
      deadline: task.deadline,
      trustRequired: task.trustRequired,
      ...(task.threadRoot && task.roomId ? { board: permalink(task.roomId, task.threadRoot) } : {}),
    },
    info.note ?? (to === 'completed' && task.result ? task.result.slice(0, 300) : undefined)
  );

  if (board?.roomId) {
    ausgabe.push(
      task.boardEvent
        ? {
            kind: 'edit',
            roomId: board.roomId,
            taskId: task.id,
            payload: {
              type: 'm.room.message',
              role: 'board',
              content: edit(task.boardEvent, kartenText),
            },
          }
        : {
            kind: 'message',
            roomId: board.roomId,
            taskId: task.id,
            payload: { type: 'm.room.message', role: 'board', content: notice(kartenText) },
          }
    );
  }

  const link = task.roomId && task.threadRoot ? permalink(task.roomId, task.threadRoot) : '';
  const zeile =
    to === 'completed'
      ? `✅ ${task.id} fertig · ${agent?.displayName ?? task.assignee}${link ? `\n${link}` : ''}`
      : to === 'failed'
        ? `❌ ${task.id} fehlgeschlagen${info.failReason ? ` (${info.failReason})` : ''}${link ? `\n${link}` : ''}`
        : to === 'canceled'
          ? `🛑 ${task.id} abgebrochen`
          : to === 'rejected'
            ? `🚫 ${task.id} abgelehnt${info.failReason ? `: ${info.failReason}` : ''}`
            : to === 'submitted' && info.retry
              ? `🔁 ${task.id}: ${info.note ?? 'neuer Versuch'}`
              : to === 'working' && info.note
                ? `⚙️ ${task.id}: ${info.note}`
                : ''; // ⚙️ ohne Hinweis steht nur auf der Board-Karte — die Lobby bleibt ruhig
  // Beiträge zum Rat (ADR-003 R3) stehen im Thread in #ag-rat; Lobby und ntfy bekommen nur den Lauf selbst.
  const ratBeitrag =
    ['completed', 'failed', 'canceled', 'rejected'].includes(to) &&
    (await tx`SELECT 1 FROM swarm.rat_beitraege WHERE task_id = ${task.id} LIMIT 1`).length > 0;
  if (zeile && lobby?.roomId && !ratBeitrag) {
    ausgabe.push({
      kind: 'message',
      roomId: lobby.roomId,
      taskId: task.id,
      payload: { type: 'm.room.message', role: 'rueckmeldung', content: notice(zeile) },
    });
  }

  // Abbruch: Eine Karte, die noch nicht draussen ist, darf nicht mehr raus —
  // sonst nimmt der Bot einen abgebrochenen Auftrag an. `last_error` bekommt
  // dafür das feste Kennwort ABGEBROCHEN, damit /health sie nicht als echten
  // Dead Letter zählt: Sie ist gewollt, kein Fehler.
  if (to === 'canceled' || to === 'rejected') {
    await tx`
      UPDATE swarm.outbox
      SET dead = true, last_error = ${ABGEBROCHEN}
      WHERE task_id = ${task.id} AND sent_event_id IS NULL AND payload->>'role' = 'karte'`;
  }

  // Abbruch: `/stop` in den Thread des Bots, ohne Erwähnung (§9.7). Dazu die
  // Nachfass-Nachricht der Bremsleiter-Stufe 1 — sie liegt `held` in der Outbox
  // und geht nur raus, wenn „⚡ Stopped" ausbleibt (§12.5).
  if (to === 'canceled' && task.roomId && task.threadRoot && agent?.mode === 'native') {
    ausgabe.push({
      kind: 'message',
      roomId: task.roomId,
      taskId: task.id,
      payload: {
        type: 'm.room.message',
        role: 'abbruch',
        content: text('/stop', { thread: task.threadRoot }),
      },
    });
    ausgabe.push({
      kind: 'message',
      roomId: task.roomId,
      taskId: task.id,
      held: true,
      notBefore: new Date(Date.now() + env.stopEscalationSeconds * 1000),
      payload: {
        type: 'm.room.message',
        role: 'abbruch',
        stufe: '2',
        content: text(`Abgebrochen, bitte aufhören. ${task.id} ist storniert.`, {
          thread: task.threadRoot,
          mentions: [agent.mxid],
        }),
      },
    });
  }
  // Neuer Versuch: eine neue Nachricht mit Erwähnung im selben Thread (§10.3).
  if (info.retry && task.roomId && agent) {
    ausgabe.push({
      kind: 'message',
      roomId: task.roomId,
      taskId: task.id,
      payload: {
        type: 'm.room.message',
        role: 'karte',
        content: text(
          `@${agent.displayName ?? agent.id} ${task.id} — ${info.note ?? 'neuer Versuch'}\n\n` +
            `Ziel: ${task.goal}\nErgebnis: ${task.deliverable}\nGrenzen: ${task.constraints.join(', ') || 'keine'}`,
          { mentions: [agent.mxid], thread: task.threadRoot }
        ),
      },
    });
  }

  if (ausgabe.length) await enqueue(tx, ausgabe, ctx.hub);

  // Rückmeldung an den Eltern-Auftrag (§9.3, Schritt 6): Der Auftraggeber des
  // Unterauftrags bekommt das Ergebnis in seinen Thread, mit Erwähnung — das
  // zählt als Hop. Liegt dort noch ein Lauf (§10.3), wartet die Nachricht.
  if ((to === 'completed' || to === 'failed') && task.parent) {
    await rueckmeldung(ctx, tx, task, to);
  }

  // Ein Platz wird frei: die nächste wartende Karte desselben Agenten geht raus.
  if (to === 'completed' || to === 'failed' || to === 'canceled' || to === 'rejected') {
    const naechster = await releaseNextHeld(task.assignee, tx);
    if (naechster)
      ctx.log.info({ agent: task.assignee, task: naechster }, 'Nächste wartende Karte freigegeben');
  }

  // Selbsttest und Kanarienvogel messen die Durchlaufzeit (§10.5).
  if (to === 'completed' && task.goal.startsWith('Selbsttest:') && lobby?.roomId) {
    const start = new Date(task.createdAt).getTime();
    const claim = task.claimedAt ? new Date(task.claimedAt).getTime() : null;
    const sekunden = (claim ?? Date.now()) - start;
    await enqueue(
      tx,
      [
        {
          kind: 'message',
          roomId: lobby.roomId,
          taskId: task.id,
          payload: {
            type: 'm.room.message',
            role: 'rueckmeldung',
            content: notice(
              `🧪 ${agent?.displayName ?? task.assignee}: 👀 nach ${(sekunden / 1000).toFixed(1)} s, ` +
                `✅ nach ${((Date.now() - start) / 1000).toFixed(1)} s`
            ),
          },
        },
      ],
      ctx.hub
    );
  }

  if ((to === 'failed' || to === 'canceled') && !ratBeitrag) {
    await notify(
      {
        title: `Schwarm: ${task.id} ${to === 'failed' ? 'fehlgeschlagen' : 'abgebrochen'}`,
        text: `${task.goal}\n${info.failReason ?? ''}\n${link}`.trim(),
        priority: to === 'failed' ? 4 : 3,
        tags: [to === 'failed' ? 'rotating_light' : 'stop_sign'],
      },
      ctx.log
    );
  }
  return true;
}

/** Board-Karte aktualisieren, ohne den Zustand zu ändern (z. B. Priorität). */
export async function boardHinweis(
  ctx: Ctx,
  tx: Db,
  taskId: string,
  hinweis: string
): Promise<void> {
  const task = await store.getTask(taskId, tx);
  if (!task) return;
  await zustandUndMeldung(ctx, tx, taskId, task.state, { note: hinweis });
}

/**
 * Ergebnis eines Unterauftrags an den Auftraggeber zurückgeben (§9.3, Schritt 6).
 *
 * Die Nachricht ist `m.text` mit Erwähnung — sie soll den Bot auslösen. Damit
 * sie keinen laufenden Lauf abbricht (`busy_input_mode: interrupt`), geht sie
 * erst raus, wenn der Lauf im Eltern-Thread beendet ist (§10.3): `held` solange
 * der Eltern-Auftrag `working` ist, freigegeben bei dessen ✅/❌.
 */
async function rueckmeldung(ctx: Ctx, tx: Db, kind: store.TaskRow, to: TaskState): Promise<void> {
  const eltern = await store.getTask(kind.parent!, tx);
  if (!eltern) return;
  if (!['submitted', 'working', 'input-required'].includes(eltern.state)) return;
  const agent = await agentById(eltern.assignee, tx);
  if (!agent?.roomId || !eltern.threadRoot) return;

  const quelle = await agentById(kind.assignee, tx);
  const link = kind.roomId && kind.threadRoot ? permalink(kind.roomId, kind.threadRoot) : '';
  // Lange Ergebnisse werden gekürzt und als Datei angehängt (§10.7): Die
  // Rückmeldung soll vollständig ankommen, nicht verstümmelt.
  const voll = kind.result || kind.failReason || 'ohne Ergebnis';
  const { text: ergebnis, anhang } = await kuerzenUndAnhaengen(
    ctx,
    {
      taskId: eltern.id,
      roomId: agent.roomId,
      thread: eltern.threadRoot,
      text: voll,
      zweck: `rueckmeldung-${kind.id}`,
      createdBy: kind.assignee,
      // Die Datei gehört dem Zuständigen des Eltern-Auftrags — ohne Erwähnung
      // übersieht ein Bot mit require_mention genau das lange Ergebnis.
      mentions: [agent.mxid],
    },
    tx
  );
  const body =
    `${to === 'completed' ? '✅' : '❌'} Ergebnis von ${kind.id} (${quelle?.displayName ?? kind.assignee}):\n${ergebnis}` +
    (link ? `\n↗ ${link}` : '') +
    `\nAuftrag ${eltern.id}: Bitte weitermachen und mit ✅ abschliessen, wenn das reicht.`;

  const hop = await store.bumpHop(eltern.root, tx);
  const zurueckhalten = eltern.state === 'working' && (await laufAktiv(tx, eltern.id, agent.mxid));
  const ausgabe: NewOutbox[] = [
    ...(anhang ? [{ ...anhang, held: zurueckhalten }] : []),
    {
      kind: 'message',
      roomId: agent.roomId,
      taskId: eltern.id,
      // Zurückhalten nur, solange im Eltern-Thread gerade ein Lauf läuft (§10.3, ADR-002 §4.15).
      held: zurueckhalten,
      payload: {
        type: 'm.room.message',
        role: 'rueckmeldung',
        content: text(body, { mentions: [agent.mxid], thread: eltern.threadRoot }),
      },
    },
  ];
  await enqueue(tx, ausgabe, ctx.hub);
  ctx.log.info(
    { task: eltern.id, kind: kind.id, hop, zurueckgehalten: zurueckhalten },
    'Rückmeldung an den Eltern-Auftrag'
  );
  const [lobby] = await roomsByKind('lobby', tx);
  if (lobby?.roomId) {
    await enqueue(
      tx,
      [
        {
          kind: 'message',
          roomId: lobby.roomId,
          taskId: eltern.id,
          payload: {
            type: 'm.room.message',
            role: 'rueckmeldung',
            content: notice(
              `↩️ ${kind.id} ist zurück an ${agent.displayName ?? agent.id} (${eltern.id}, Hop ${hop}).`
            ),
          },
        },
      ],
      ctx.hub
    );
  }
}

/**
 * Läuft im Thread des Auftrags gerade ein Lauf des Agenten (§10.3)? Das ist der Fall, wenn sein
 * letztes Bot-Signal auf einer Hub-Nachricht des Auftrags 👀 ist, ohne späteres ✅ oder ❌.
 * Im Normalfall aus §9.3 übergibt Brian und beendet seinen Lauf gleich mit ✅. Hielte der Hub die
 * spätere Rückmeldung dann zurück, wartete sie auf ein ✅, das schon war (ADR-002 §4.6, §4.15).
 */
export async function laufAktiv(db: Db, taskId: string, mxid: string): Promise<boolean> {
  const zeilen = await db`
    SELECT i.content->'m.relates_to'->>'key' AS zeichen
      FROM swarm.inbox i
      JOIN swarm.matrix_map m ON m.event_id = i.content->'m.relates_to'->>'event_id'
     WHERE m.task_id = ${taskId} AND i.sender = ${mxid} AND i.type = 'm.reaction'
     ORDER BY i.received_at DESC
     LIMIT 20`;
  for (const z of zeilen) {
    const signal = reactionSignal(String(z.zeichen ?? ''));
    if (signal === 'claim') return true;
    if (signal === 'done' || signal === 'fail') return false;
  }
  return false;
}
