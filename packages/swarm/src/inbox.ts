/**
 * Inbox-Verarbeiter (§10.1, 5–6): holt unerledigte Events, fasst pro Raum einen
 * Advisory-Lock, damit auch während eines Neustarts nie zwei Verarbeiter
 * denselben Raum bearbeiten, und sortiert Kaputtes erst hier aus — nie beim
 * Annehmen, sonst blockiert ein Gift-Event die ganze Warteschlange dahinter.
 */
import {
  BOT_SIGNALS,
  HUMAN_SIGNALS,
  isPuppet,
  reactionSignal,
  type TaskState,
} from './protocol/index.js';
import { sql, type Db } from './db/index.js';
import { audit, auditMerken, clearFlag, getFlag, setFlag } from './db/audit.js';
import {
  agentByMxid,
  agentById,
  roomByRoomId,
  roomsByKind,
  setFrozen,
  setStatus,
  touchSeen,
} from './agents/store.js';
import { adoptEvent, enqueue, imThread, releaseHeldRueckmeldungen } from './outbox.js';
import { freigabeReaktion } from './council/freigabe.js';
import { alarmReaktion } from './alarme.js';
import { notice, outMarker } from './appservice/messages.js';
import { notify } from './notify.js';
import { reply } from './reply.js';
import type { Ctx } from './context.js';
import { frageReaktion } from './plan.js';
import { bewertungReaktion } from './profil.js';
import { torReaktion } from './ablaeufe.js';
import { gastNachricht } from './gaeste.js';
import { applySignal } from './tasks/state.js';
import { breakerTripped } from './tasks/policy.js';
import {
  createTaskFlow,
  ergebnisAusThread,
  ergebnisVonWiederherstellung,
  istFortschritt,
  istWiederherstellung,
  istWerkzeugZeile,
} from './tasks/create.js';
import { zustandUndMeldung, boardHinweis } from './tasks/transition.js';
import { istStopBestaetigung, stopBestaetigt } from './bremsleiter.js';
import { anWorker } from './worker/server.js';
import * as store from './tasks/store.js';
import { runCommand } from './commands/index.js';
import { env } from './env.js';
import { VORLESEN_EVENT, vorlesenAnfrage } from './vorlesen.js';
import { modellBestaetigung } from './modelle.js';
import { wecken } from './push.js';

interface InboxRow {
  event_id: string;
  room_id: string;
  sender: string;
  type: string;
  content: Record<string, unknown>;
  attempts: number;
}

interface Vorab {
  taskId?: string;
  threadMessages?: { sender: string; body: string; ts: number }[];
  /** Mitgliederzahl des Raums, wenn sich eine Mitgliedschaft geändert hat. */
  mitglieder?: string[];
}

export async function processInbox(
  ctx: Ctx,
  limit = env.inboxBatch
): Promise<{ processed: number; failed: number; dead: number }> {
  const rows = (await sql`
    SELECT event_id, room_id, sender, type, content, attempts
    FROM swarm.inbox
    WHERE processed_at IS NULL AND attempts < 3
    ORDER BY received_at
    LIMIT ${limit}`) as unknown as InboxRow[];

  let processed = 0;
  let failed = 0;
  let dead = 0;

  for (const row of rows) {
    const vorab = await vorbereiten(ctx, row);
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${row.room_id}))`;
        const [frisch] = await tx`
          SELECT processed_at FROM swarm.inbox WHERE event_id = ${row.event_id} FOR UPDATE`;
        if (frisch?.processed_at) return;
        await behandeln(ctx, tx, row, vorab);
        await tx`UPDATE swarm.inbox SET processed_at = now(), error = NULL WHERE event_id = ${row.event_id}`;
      });
      processed++;
    } catch (err) {
      const meldung = err instanceof Error ? err.message : String(err);
      const versuche = row.attempts + 1;
      await sql`
        UPDATE swarm.inbox SET attempts = ${versuche}, error = ${meldung.slice(0, 500)}
        WHERE event_id = ${row.event_id}`;
      failed++;
      ctx.log.error(
        { event: row.event_id, typ: row.type, versuche, err },
        'Inbox-Verarbeitung fehlgeschlagen'
      );
      if (versuche >= 3) {
        dead++;
        await deadLetter(ctx, row, meldung);
      }
    }
  }
  return { processed, failed, dead };
}

/**
 * Netz vor der Transaktion: Bei einem ✅ holt der Hub den Thread, um daraus das
 * Ergebnis zusammenzustellen (§10.3). Ein HTTP-Abruf gehört nicht in eine
 * DB-Transaktion, also passiert er hier.
 */
async function vorbereiten(ctx: Ctx, row: InboxRow): Promise<Vorab> {
  // Mitgliedschaften: Die Zahl der Mitglieder entscheidet, ob Hermes einen Raum
  // als DM behandelt (§6.1). Der HTTP-Abruf gehört nicht in die Transaktion.
  if (row.type === 'm.room.member') {
    return { mitglieder: await ctx.matrix.members(row.room_id) };
  }
  if (row.type !== 'm.reaction') return {};
  const rel = row.content['m.relates_to'] as
    | { rel_type?: string; key?: string; event_id?: string }
    | undefined;
  if (rel?.rel_type !== 'm.annotation' || !rel.event_id) return {};
  if (reactionSignal(rel.key) !== 'done') return {};
  const taskId = await taskForEvent(rel.event_id);
  if (!taskId) return {};
  const task = await store.getTask(taskId);
  if (!task?.roomId || !task.threadRoot) return { taskId };
  const messages = await ctx.matrix.threadMessages(task.roomId, task.threadRoot);
  return {
    taskId,
    threadMessages: messages
      .filter((m) => m.msgtype === 'm.text' || m.msgtype === 'm.notice')
      .map((m) => ({ sender: m.sender, body: m.body, ts: m.ts })),
  };
}

/** Auftrag zu einem Event finden: Karte, Thread-Root oder eine Nachricht im Thread. */
export async function taskForEvent(eventId: string, tiefe = 0): Promise<string | null> {
  const mapped = await store.taskByEvent(eventId);
  if (mapped) return mapped.taskId;
  const [byRoot] = await sql`SELECT id FROM swarm.tasks WHERE thread_root = ${eventId} LIMIT 1`;
  if (byRoot) return byRoot.id as string;
  if (tiefe >= 3) return null;
  const [zeile] = await sql`SELECT content FROM swarm.inbox WHERE event_id = ${eventId}`;
  const rel = (zeile?.content as Record<string, unknown> | undefined)?.['m.relates_to'] as
    | { rel_type?: string; event_id?: string }
    | undefined;
  if (rel?.rel_type === 'm.thread' && rel.event_id) return taskForEvent(rel.event_id, tiefe + 1);
  return null;
}

/** Ein Gift-Event blockiert nichts: Log-Raum und ntfy, der Rest läuft weiter (§10.1, 6). */
async function deadLetter(ctx: Ctx, row: InboxRow, meldung: string): Promise<void> {
  const [logRoom] = await roomsByKind('log');
  if (logRoom?.roomId) {
    await enqueue(
      sql,
      [
        {
          kind: 'message',
          roomId: logRoom.roomId,
          payload: {
            type: 'm.room.message',
            content: notice(
              `Dead Letter: Event ${row.event_id} (${row.type}) in ${row.room_id} nach 3 Versuchen aufgegeben.\n` +
                `Letzter Fehler: ${meldung.slice(0, 300)}`
            ),
          },
        },
      ],
      ctx.hub
    );
  }
  await notify(
    {
      title: 'Schwarm: Dead Letter',
      text: `${row.type} ${row.event_id}: ${meldung.slice(0, 200)}`,
      priority: 4,
      tags: ['warning'],
    },
    ctx.log
  );
}

async function behandeln(ctx: Ctx, tx: Db, row: InboxRow, vorab: Vorab): Promise<void> {
  const content = row.content ?? {};

  // Eigene Events lösen nichts aus — sie tragen nur `sent_event_id` nach (§10.1, 4).
  if (row.sender === ctx.hub || isPuppet(row.sender)) {
    const marker = outMarker(content);
    if (marker) await adoptOwnEvent(tx, marker.id, row.event_id);
    return;
  }

  // §7.2: Power-Levels schützen Event-Typen, nicht Felder im Inhalt. Wer nicht
  // der Hub oder eines seiner Puppets ist, kann `ch.zwaetschge.swarm.*` zwar
  // schreiben — gelesen wird es nicht, aber es wird protokolliert (§11.9, Test 3).
  const gefaelscht = Object.keys(content).filter((k) => k.startsWith('ch.zwaetschge.swarm.'));
  if (gefaelscht.length) {
    ctx.log.warn(
      { sender: row.sender, room: row.room_id, event: row.event_id, felder: gefaelscht },
      'Schwarm-Feld von einem fremden Absender — ignoriert'
    );
    await audit(row.sender, 'inbox.fremdes_schwarm_feld', row.event_id, { felder: gefaelscht });
  }

  // Vorlesen aus der App (App 2.2): eigener Event-Typ, keine Nachricht.
  if (row.type === VORLESEN_EVENT) return vorlesenAnfrage(ctx, tx, row);
  if (row.type === 'm.reaction') return reactionBehandeln(ctx, tx, row, vorab);
  if (row.type === 'm.room.message') return nachrichtBehandeln(ctx, tx, row, vorab);
  if (row.type === 'm.room.member') return mitgliedschaftPruefen(ctx, tx, row, vorab);
  // Redaktionen, State-Events: bewusst kein Aufwand.
}

/**
 * Arbeitsräume brauchen drei Mitglieder (§6.1, §4.3, 8). Fällt einer auf zwei,
 * gilt er bei Hermes als DM: `MATRIX_ALLOWED_ROOMS` und die Erwähnungspflicht
 * greifen dort nicht, und Brian antwortet auf alles. Der Hub friert den Raum
 * ein, bis wieder drei Mitglieder drin sind.
 */
async function mitgliedschaftPruefen(ctx: Ctx, tx: Db, row: InboxRow, vorab: Vorab): Promise<void> {
  const raum = await roomByRoomId(row.room_id, tx);
  if (!raum || raum.kind !== 'work') return;
  // Die DM-Gefahr gibt es nur bei Bots mit eigenem Konto (Hermes). Im Raum
  // eines Workers schreibt nur der Hub als Puppet; zwei Mitglieder sind dort normal.
  const zustaendig = raum.agent ? await agentById(raum.agent, tx) : null;
  if (zustaendig && zustaendig.mode !== 'native') return;
  const anzahl = vorab.mitglieder?.length ?? 0;
  if (anzahl === 0) return; // der Stub oder Synapse antwortet gerade nicht — kein Befund
  const flag = `raum:${row.room_id}`;

  if (anzahl < 3) {
    const bestand = await getFlag<{ mitglieder?: number }>(flag, tx);
    if (bestand?.mitglieder === anzahl) return;
    await setFlag(flag, { mitglieder: anzahl, seit: row.event_id }, 'hub', tx);
    const grund =
      `⚠️ ${raum.alias} hat nur noch ${anzahl} Mitglieder — Hermes behandelt den Raum damit als DM ` +
      `(§6.1): Allowlist und Erwähnungspflicht greifen dort nicht. Der Hub legt keine Aufträge mehr ` +
      `für den Raum an, bis wieder drei Mitglieder drin sind.`;
    ctx.log.warn({ room: row.room_id, anzahl }, 'Arbeitsraum unter drei Mitglieder');
    const [logRoom] = await roomsByKind('log', tx);
    if (logRoom?.roomId) {
      await enqueue(
        tx,
        [
          {
            kind: 'message',
            roomId: logRoom.roomId,
            payload: { type: 'm.room.message', content: notice(grund) },
          },
        ],
        ctx.hub
      );
    }
    await notify(
      {
        title: 'Schwarm: Arbeitsraum eingefroren',
        text: grund,
        priority: 5,
        tags: ['rotating_light'],
      },
      ctx.log
    );
    return;
  }

  if (await getFlag(flag, tx)) {
    await clearFlag(flag, tx);
    ctx.log.info({ room: row.room_id, anzahl }, 'Arbeitsraum hat wieder drei Mitglieder');
  }
}

/**
 * Das eigene Event kommt per Transaktion zurück (§10.2). `sent_event_id` steht
 * dann meist schon (der Sender war schneller als Synapse), also ist der Nachtrag
 * der Rollen der eigentliche Zweck: Thread-Root und Board-Event.
 */
async function adoptOwnEvent(tx: Db, outboxId: number, eventId: string): Promise<void> {
  const [zeile] = await tx`
    SELECT task_id, payload, sent_event_id FROM swarm.outbox WHERE id = ${outboxId}`;
  if (!zeile) return;
  if (!zeile.sent_event_id) await adoptEvent(outboxId, eventId, tx);
  const taskId = zeile.task_id as string | null;
  const role = (zeile.payload as { role?: string } | null)?.role;
  if (!taskId || !role) return;
  if (
    role === 'karte' &&
    !imThread((zeile.payload as { content?: Record<string, unknown> } | null)?.content)
  ) {
    await store.setThreadRoot(taskId, eventId, tx);
  }
  if (role === 'board') await store.setBoardEvent(taskId, eventId, tx);
}

async function nachrichtBehandeln(ctx: Ctx, tx: Db, row: InboxRow, vorab: Vorab): Promise<void> {
  const content = row.content;
  // Brians Antwort auf `/model … --global` aus `!modell` (App 2.2).
  if (await modellBestaetigung(ctx, tx, row)) return;
  if (content.msgtype === 'm.notice') return; // Regel 2: niemand antwortet auf Notices
  const body = String(content.body ?? '').trim();
  if (!body) return;
  const rel = content['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
  const thread = rel?.rel_type === 'm.thread' ? (rel.event_id ?? null) : null;

  if (row.sender === ctx.owner) {
    if (body.startsWith('!')) {
      await runCommand(ctx, tx, {
        body,
        roomId: row.room_id,
        eventId: row.event_id,
        thread,
        plumTask: content['ch.zwaetschge.plum.task'],
      });
      return;
    }
    // Regel 1: ein `m.text` mit Erwähnung ist ein Auftrag.
    const mentions = (content['m.mentions'] as { user_ids?: string[] } | undefined)?.user_ids ?? [];
    for (const mxid of mentions) {
      const agent = await agentByMxid(mxid);
      if (!agent) continue;
      // Im Arbeitsraum sprichst du direkt mit dem Bot; der Hub würde denselben
      // Auftrag noch einmal anlegen (§4.3, 9).
      if (agent.roomId === row.room_id) return;
      await auftragAusErwaehnung(ctx, tx, row, agent.id, body, thread);
      return;
    }
    // Worker haben kein Matrix-Konto: Vales Antwort im Thread ihres Auftrags geht über den
    // Worker-Kanal an sie (ADR-002 §4.36). Native Bots lesen den Thread selbst.
    if (thread) await anWorkerWeiterleiten(ctx, tx, row, vorab, body, thread);
    return;
  }

  // Sofort-Benachrichtigungen (App 2.5): Erwähnt ein Bot Vale (etwa Brian in seinem Raum), weckt der Hub die App.
  const erwaehnt = (content['m.mentions'] as { user_ids?: string[] } | undefined)?.user_ids ?? [];
  if (erwaehnt.includes(ctx.owner) && row.sender !== ctx.hub)
    wecken(ctx, `Erwähnung von ${row.sender}`);

  // Gäste (matrix/PLAN-weiter.md, Punkt 16): eigene Befehle, eigene Agenten, eigenes Budget.
  if (
    await gastNachricht(ctx, tx, row, body, thread, {
      befehl: (eingabe) => runCommand(ctx, tx, eingabe),
      anWorker,
      taskVonEvent: taskForEvent,
    })
  )
    return;

  // Befehle gibt es nur von Vale (§8.6). Ein Bot, der `!stop` schreibt, wird
  // ignoriert — und das steht im Protokoll und im Audit (§11.9, Test 2).
  if (body.startsWith('!')) {
    ctx.log.warn(
      { sender: row.sender, room: row.room_id, body: body.slice(0, 60) },
      'Befehl von einem Bot — ignoriert'
    );
    await audit(row.sender, 'inbox.befehl_ignoriert', row.event_id, { body: body.slice(0, 60) });
    return;
  }

  const agent = await agentByMxid(row.sender);
  if (!agent) return; // unbekannter Absender: keine Wirkung (§7.2, Allowlist des Bots)
  await touchSeen(agent.id, tx);
  if (agent.status !== 'online') await setStatus(agent.id, 'online', tx);
  await circuitBreaker(ctx, tx, agent.id, row.sender);

  if (!thread) return;
  const taskId = vorab.taskId ?? (await taskForEvent(thread));
  if (!taskId) return;
  const task = await store.getTask(taskId, tx);
  if (!task) return;
  const zustaendig = agent.id === task.assignee;

  // Bremsleiter Stufe 1: „⚡ Stopped" bestätigt den Abbruch (§12.5, §4.1).
  if (zustaendig && task.state === 'canceled' && istStopBestaetigung(body)) {
    await stopBestaetigt(ctx, task.id);
    return;
  }
  const offen = ['submitted', 'working', 'input-required'].includes(task.state);

  // (1) Nachlieferung aus dem Zustell-Ledger: Nach einem Ausfall von Synapse ist
  // genau diese Nachricht das Ergebnis, und das ✅ fehlt (§4.1, §4.3).
  if (zustaendig && offen && istWiederherstellung(body)) {
    await zustandUndMeldung(ctx, tx, task.id, 'completed', {
      actor: row.sender,
      result: ergebnisVonWiederherstellung(body),
      note: 'Antwort nach einem Ausfall nachgeliefert',
    });
    return;
  }

  // (6) Jede Nachricht des Zuständigen im Thread ist ein Lebenszeichen — auch
  // eine Werkzeugzeile. Sonst erinnert der Watchdog einen Bot, der längst
  // arbeitet, und lenkt seinen Lauf um (§4.3, 6).
  if (zustaendig && task.state === 'submitted') {
    await zustandUndMeldung(ctx, tx, task.id, 'working', {});
    return;
  }
  if (istFortschritt(body)) return; // Zwischenstände sind kein Ergebnis (§10.4)
  if (zustaendig && task.state === 'input-required') {
    await zustandUndMeldung(ctx, tx, task.id, 'working', {});
  }
}

/**
 * Vales Text im Thread eines laufenden Worker-Auftrags an den Worker geben (Frame `nachricht`).
 * Wartet der Auftrag auf Vale (input-required), läuft er damit weiter. Ist der Worker nicht da,
 * sagt der Hub es im Thread, statt die Antwort still zu verlieren.
 */
async function anWorkerWeiterleiten(
  ctx: Ctx,
  tx: Db,
  row: InboxRow,
  vorab: Vorab,
  body: string,
  thread: string
): Promise<void> {
  const taskId = vorab.taskId ?? (await taskForEvent(thread));
  if (!taskId) return;
  const task = await store.getTask(taskId, tx);
  if (!task?.assignee || !['working', 'input-required'].includes(task.state)) return;
  const agent = await agentById(task.assignee, tx);
  if (agent?.mode !== 'worker') return;
  const name = agent.displayName ?? agent.id;
  const zustellung = anWorker(agent.id, task.id, body, row.event_id);
  if (zustellung !== 'zugestellt') {
    await reply(
      ctx,
      tx,
      row.room_id,
      thread,
      zustellung === 'liest-keine'
        ? `📭 ${name} liest keine Nachrichten im Thread. Für eine Ergänzung: !stop ${task.id} und ein neuer Auftrag.`
        : `📭 Nicht zugestellt: ${name} führt ${task.id} gerade nicht (offline oder neu verbunden). Schreib es nochmal, sobald er wieder da ist.`
    );
    auditMerken(row.sender, 'worker.nachricht_offen', task.id, { grund: zustellung });
    return;
  }
  if (task.state === 'input-required') await zustandUndMeldung(ctx, tx, task.id, 'working', {});
  // Vormerken statt schreiben: Nach dem Zustandswechsel hält diese Transaktion das Schloss der Kette.
  auditMerken(row.sender, 'worker.nachricht', task.id, { zeichen: body.length });
}

async function auftragAusErwaehnung(
  ctx: Ctx,
  tx: Db,
  row: InboxRow,
  assignee: string,
  body: string,
  thread: string | null
): Promise<void> {
  const ziel = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/@[_a-z0-9-]+:[a-z0-9.-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const ergebnis = await createTaskFlow(
    ctx,
    {
      goal: ziel || body,
      assignee,
      from: row.sender,
      originRoom: row.room_id,
      originThread: thread,
      idempotencyKey: row.event_id,
    },
    tx
  );
  if (!ergebnis.ok) {
    await reply(ctx, tx, row.room_id, thread, `Abgelehnt (${ergebnis.code}): ${ergebnis.reason}`);
  }
}

async function reactionBehandeln(ctx: Ctx, tx: Db, row: InboxRow, vorab: Vorab): Promise<void> {
  const rel = row.content['m.relates_to'] as
    | { rel_type?: string; key?: string; event_id?: string }
    | undefined;
  if (rel?.rel_type !== 'm.annotation' || !rel.event_id) return; // geschwärzte Reaktion
  // Alarme: ✅ schliesst, 🔕 schaltet stumm, 🔔 wieder laut — nur Vale (ADR-003 R4).
  if (await alarmReaktion(ctx, tx, row, rel.event_id, rel.key)) return;
  // ✅/❌ auf ein 🚦-Tor eines Ablaufs (matrix/PLAN-weiter.md, Punkt 11).
  if (await torReaktion(ctx, tx, row, rel.event_id, rel.key)) return;
  // ✅/❌ auf die ❓-Notice einer Worker-Rückfrage (Plan zuerst): Antwort „ja“/„nein“ an den Worker.
  if (await frageReaktion(ctx, tx, row, rel.event_id, rel.key, taskForEvent)) return;
  // 👍/👎 auf Karte oder Rückmeldung: Bewertung fürs Agentenprofil (matrix/PLAN-weiter.md, Punkt 14).
  if (await bewertungReaktion(ctx, tx, row, rel.event_id, rel.key, taskForEvent)) return;
  const signal = reactionSignal(rel.key);
  if (!signal) return;
  // Freigaben entscheidet nur Vale, per Reaktion auf die Notice des Hubs (ADR-003 R1).
  if (await freigabeReaktion(ctx, tx, row, rel.event_id, rel.key)) return;
  const taskId = vorab.taskId ?? (await taskForEvent(rel.event_id));
  if (!taskId) return;
  const task = await store.getTask(taskId, tx);
  if (!task) return;
  const agent = await agentById(task.assignee, tx);

  const fromAssignee = !!agent && row.sender === agent.mxid;
  const fromOwner = row.sender === ctx.owner;
  // Bedien-Reaktionen von Bots zählen nicht, Bot-Signale von anderen auch nicht (§8.1).
  if ((BOT_SIGNALS as readonly string[]).includes(signal) && !fromAssignee) return;
  if ((HUMAN_SIGNALS as readonly string[]).includes(signal) && !fromOwner) return;
  // (7) 👀 ✅ ❌ wertet der Hub nur auf seinen eigenen Nachrichten: Auf
  // Freigabe-Nachrichten setzt Hermes dieselben Reaktionen selbst (§4.3, 7).
  if (
    (BOT_SIGNALS as readonly string[]).includes(signal) &&
    !(await zielVomHub(tx, rel.event_id))
  ) {
    ctx.log.debug(
      { task: task.id, signal, ziel: rel.event_id },
      'Bot-Signal auf einer fremden Nachricht — ignoriert'
    );
    return;
  }

  const ergebnis = applySignal(signal, {
    state: task.state as TaskState,
    attempts: task.attempts,
    openSubtasks: (await store.openSubtasks(task.id, tx)).length,
    fromAssignee,
    fromOwner,
  });

  if (ergebnis.kind === 'ignored') {
    ctx.log.debug({ task: task.id, signal, grund: ergebnis.reason }, 'Reaktion ohne Wirkung');
    return;
  }
  if (ergebnis.kind === 'priority') {
    await store.setPriority(task.id, ergebnis.value, tx);
    await boardHinweis(ctx, tx, task.id, 'Priorität hoch');
    return;
  }

  // ✅ oder ❌ bedeuten: der Lauf des Bots ist zu Ende — eine wartende
  // Rückmeldung darf jetzt raus (§10.3). Das gilt auch, wenn der Auftrag selbst
  // `working` bleibt oder das ✅ gar keine Antwort hatte: Sonst wartet sie auf
  // ein Signal, das nicht mehr kommt.
  if (signal === 'done' || signal === 'fail') {
    const freigegeben = await releaseHeldRueckmeldungen(task.id, tx);
    if (freigegeben) ctx.log.info({ task: task.id, freigegeben }, 'Rückmeldungen freigegeben');
  }

  const antworten = vorab.threadMessages;
  const result =
    ergebnis.to === 'completed' && antworten && agent
      ? ergebnisAusThread(antworten, agent.mxid) || null
      : undefined;

  // (2) ✅ ohne Antwort ist kein Erfolg: Hermes setzt 👀 und ✅ auch für Absender,
  // die nicht in MATRIX_ALLOWED_USERS stehen, und antwortet ihnen nicht (§4.3, 2).
  if (ergebnis.to === 'completed' && antworten && result === null) {
    await zustandUndMeldung(ctx, tx, task.id, 'failed', {
      actor: row.sender,
      failReason: '✅ ohne Antwort — steht @schwarm in MATRIX_ALLOWED_USERS?',
      triggerEvent: rel.event_id,
    });
    return;
  }

  await zustandUndMeldung(ctx, tx, task.id, ergebnis.to, {
    actor: row.sender,
    ...(result !== undefined ? { result } : {}),
    ...(ergebnis.to === 'failed' ? { failReason: '❌ vom Agenten' } : {}),
    ...(ergebnis.retry ? { retry: true } : {}),
    ...(ergebnis.note ? { note: ergebnis.note } : {}),
    triggerEvent: rel.event_id,
  });
}

/** Gehört das Ziel-Event dem Hub (Karte, Rückmeldung, Erinnerung)? */
async function zielVomHub(tx: Db, eventId: string): Promise<boolean> {
  const [map] = await tx`SELECT role FROM swarm.matrix_map WHERE event_id = ${eventId}`;
  if (map) return true;
  const [zeile] = await tx`SELECT sender FROM swarm.inbox WHERE event_id = ${eventId}`;
  return zeile
    ? isPuppet(String(zeile.sender)) || String(zeile.sender).startsWith('@schwarm')
    : false;
}

/** Circuit-Breaker (§12.1): zu viele Nachrichten eines Agenten in 5 min → einfrieren. */
/**
 * Circuit-Breaker (§12.1, §4.3, 3): Er zählt nur Nachrichten, die niemand
 * bestellt hat. Reaktionen, Schwärzungen, Edits, Werkzeugzeilen, Fortschritt und
 * Antworten in einem Auftrags-Thread zählen nicht — sonst wäre Brian nach etwa
 * fünf kurzen Aufträgen eingefroren.
 */
function zaehltFrei(type: string, content: Record<string, unknown>): boolean {
  if (type !== 'm.room.message') return false;
  const rel = content['m.relates_to'] as { rel_type?: string } | undefined;
  if (rel?.rel_type === 'm.replace' || rel?.rel_type === 'm.thread') return false;
  const body = String(content.body ?? '');
  return !istFortschritt(body) && !istWerkzeugZeile(body);
}

async function circuitBreaker(ctx: Ctx, tx: Db, agentId: string, mxid: string): Promise<void> {
  const rows = await tx`
    SELECT type, content, extract(epoch FROM received_at) * 1000 AS ms FROM swarm.inbox
    WHERE sender = ${mxid} AND received_at > now() - interval '5 minutes'`;
  const [agent] = await tx`SELECT frozen FROM swarm.agents WHERE id = ${agentId}`;
  if (agent?.frozen) return;
  const stampel = (
    rows as unknown as { type: string; content: Record<string, unknown>; ms: number }[]
  )
    .filter((r) => zaehltFrei(r.type, r.content ?? {}))
    .map((r) => Number(r.ms));
  if (!breakerTripped(stampel, Date.now())) return;

  await setFrozen(agentId, true, tx);
  const grund =
    `${agentId} hat ${stampel.length} Nachrichten in 5 min geschrieben — eingefroren ` +
    `(Circuit-Breaker, §12.1). Weiter mit !weiter @${agentId}.`;
  const [logRoom] = await roomsByKind('log', tx);
  if (logRoom?.roomId) {
    await enqueue(
      tx,
      [
        {
          kind: 'message',
          roomId: logRoom.roomId,
          payload: { type: 'm.room.message', content: notice(grund) },
        },
      ],
      ctx.hub
    );
  }
  await notify(
    { title: 'Schwarm: Circuit-Breaker', text: grund, priority: 5, tags: ['warning'] },
    ctx.log
  );
}
