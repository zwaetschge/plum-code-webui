/**
 * Auftrag anlegen (§9.2): Policy prüfen, Zustand schreiben und die Meldungen
 * dazu in *einer* Transaktion in die Outbox — kein Auftrag ohne Karte, keine
 * Karte ohne Auftrag (§10.2).
 */
import { auditMerken } from '../db/audit.js';
import { SWARM_LIMITS, type TaskState, type TRUST_LEVELS } from '../protocol/index.js';
import { sql, type Db } from '../db/index.js';
import { getFlag, isSwarmFrozen } from '../db/audit.js';
import { FREIGABE_MIN, freigabeBeantragen } from '../council/freigabe.js';
import { agentById, roomsByKind } from '../agents/store.js';
import { notice, text } from '../appservice/messages.js';
import { enqueue, type NewOutbox } from '../outbox.js';
import type { Ctx } from '../context.js';
import {
  boardCardBody,
  lobbyReceipt,
  newCorrelationId,
  permalink,
  promptHash,
  taskCardBody,
  taskCardContent,
} from './card.js';
import { checkPolicy } from './policy.js';
import { umleiten } from '../kontingente.js';
import { pausePruefen } from '../profil.js';
import * as store from './store.js';

export interface TaskRequest {
  goal: string;
  context?: string;
  deliverable?: string;
  constraints?: string[];
  budgetUsd?: number | null;
  budgetMinutes?: number | null;
  deadline?: string | null;
  /** Agent-ID (`brian`), nicht die MXID. */
  assignee: string;
  /** MXID oder Agent-ID dessen, der den Auftrag gibt. */
  from: string;
  /** Raum, in dem der Auftrag ausgelöst wurde — dorthin geht die Quittung. */
  originRoom: string;
  /** Event der auslösenden Nachricht = Idempotenz-Schlüssel (§10.3). */
  idempotencyKey: string;
  /** Thread der auslösenden Nachricht, falls es einen gibt. */
  originThread?: string | null;
  parentTaskId?: string | null;
  trustRequired?: (typeof TRUST_LEVELS)[number];
  isHandoff?: boolean;
  isRueckmeldung?: boolean;
  /** Gelbe Fähigkeit für den Betrieb: wartet auf Vales ✅ (ADR-003 R2). */
  freigabePflicht?: boolean;
  /** Geprüfte Aktion als JSON für den Worker `betrieb`; geht unverändert als `material` raus. */
  betriebSpec?: string;
}

export type CreateOutcome =
  | {
      ok: true;
      taskId: string;
      state: TaskState;
      queued: boolean;
      note?: string;
      roomId: string;
      freigabe?: string;
    }
  | { ok: false; code: string; reason: string };

export async function createTaskFlow(
  ctx: Ctx,
  auftrag: TaskRequest,
  tx?: Db
): Promise<CreateOutcome> {
  // Abo-Stand (matrix/PLAN-weiter.md, Punkt 7): Ist das Kontingent des Ziels fast leer, geht ein Code-Auftrag
  // an die Rückfallebene; der Auslöser erfährt es im Thread.
  const umgeleitet = await umleiten(ctx, auftrag, tx);
  // Agentenprofil (Punkt 14): Ein pausierter Agent gibt an die Rückfallebene ab, sonst lehnt der Hub ab.
  const pause = await pausePruefen(ctx, umgeleitet, tx);
  if ('abgelehnt' in pause) return { ok: false, ...pause.abgelehnt };
  const req = pause.req;
  const agent = await agentById(req.assignee);
  if (!agent) {
    return {
      ok: false,
      code: 'unknown-agent',
      reason: `Agent „${req.assignee}" ist nicht eingetragen (agents.swarm.yaml).`,
    };
  }
  if (!agent.roomId) {
    return { ok: false, code: 'no-room', reason: `${agent.id} hat keinen Arbeitsraum (§6.1).` };
  }

  if (await isSwarmFrozen()) {
    return {
      ok: false,
      code: 'kill-switch',
      reason: 'Der Schwarm ist eingefroren (!stop). Weiter mit !weiter.',
    };
  }
  if (await getFlag(`raum:${agent.roomId}`)) {
    return {
      ok: false,
      code: 'raum-eingefroren',
      reason: `${agent.id}s Arbeitsraum hat weniger als drei Mitglieder (§6.1) — erst wieder einladen.`,
    };
  }

  const parent = req.parentTaskId ? await store.getTask(req.parentTaskId) : null;
  // Der Hop-Zähler der Kette steht auf der Wurzel (§9.3): Übergabe 1,
  // Rückmeldung 2, zweite Übergabe 3, zweite Rückmeldung 4 — dann ist Schluss.
  const wurzel = parent ? await store.getTask(parent.root) : null;
  const kettenHop = wurzel?.hop ?? parent?.hop ?? 0;
  const hop = parent ? kettenHop + 1 : 0;
  const depth = parent ? parent.depth + 1 : 0;
  const root = parent?.root ?? '';

  const goal = req.goal.trim();
  const deliverable = (req.deliverable ?? 'kurze Zusammenfassung').trim();
  const constraints = req.constraints ?? [];
  const budgetUsd = req.budgetUsd ?? SWARM_LIMITS.defaultBudgetUsd;
  const budgetMinutes = req.budgetMinutes ?? SWARM_LIMITS.defaultBudgetMinutes;
  const deadline =
    req.deadline ??
    new Date(Date.now() + SWARM_LIMITS.defaultDeadlineHours * 3600_000).toISOString();
  const trustRequired = req.trustRequired ?? 'T1';
  const hash = promptHash(`${goal} ${req.context ?? ''} ${deliverable}`, agent.id);

  const [board] = await roomsByKind('board');
  const facts = {
    agent: {
      id: agent.id,
      status: agent.status,
      frozen: agent.frozen,
      parallel: agent.parallel,
      trust: agent.trust,
      budgetUsdDay: agent.budgetUsdDay === null ? null : Number(agent.budgetUsdDay),
      dailyCostUsd: await store.dailyCost(agent.id),
    },
    hop,
    depth,
    fanOut: parent ? (await store.openSubtasks(parent.id)).length : 0,
    tasksInRoot: root ? await store.tasksInRoot(root) : 0,
    duplicateTaskId: await store.duplicateWithin(hash, SWARM_LIMITS.duplicateWindowMinutes),
    runningForAssignee: await store.runningCount(agent.id),
    trustRequired,
    swarmFrozen: await isSwarmFrozen(),
    maxHops: SWARM_LIMITS.maxHops,
    isHandoff: req.isHandoff ?? false,
    freigabePflicht: req.freigabePflicht ?? false,
    isRueckmeldung: req.isRueckmeldung ?? false,
  };

  const urteil = checkPolicy(facts);
  if (!urteil.ok) {
    ctx.log.warn({ code: urteil.code, agent: agent.id }, 'Auftrag abgelehnt');
    return { ok: false, code: urteil.code, reason: urteil.reason };
  }

  const id = await store.nextTaskId();
  const correlationId = parent?.correlationId ?? newCorrelationId();
  const card = {
    id,
    root: root || id,
    parent: parent?.id ?? null,
    correlationId,
    state: urteil.state,
    from: req.from,
    assignee: agent.id,
    assigneeName: agent.displayName ?? agent.id,
    assigneeMxid: agent.mxid,
    hop,
    depth,
    goal,
    ...(req.context ? { context: req.context, contextFrom: req.from } : {}),
    deliverable,
    constraints,
    budgetUsd,
    budgetMinutes,
    deadline,
    trustRequired,
    board: board?.roomId ? permalink(board.roomId) : undefined,
  };

  const ausgabe: NewOutbox[] = [];
  if (board?.roomId) {
    ausgabe.push({
      kind: 'message',
      roomId: board.roomId,
      taskId: id,
      payload: {
        type: 'm.room.message',
        role: 'board',
        content: notice(boardCardBody({ ...card, state: urteil.state }, urteil.note)),
      },
    });
  }
  // Die Karte ist der Thread-Root (§6.2) und erwähnt den Zuständigen (§8.1).
  // Sie wartet in der Outbox (`held`), wenn der Agent ausgelastet ist (§12.1)
  // oder wenn der Auftrag erst freigegeben werden muss (§7.3): Ein T2-Operator
  // soll nichts sehen, bevor Vale ja gesagt hat.
  ausgabe.push({
    kind: 'message',
    roomId: agent.roomId,
    taskId: id,
    held: urteil.queued || urteil.state === 'auth-required',
    payload: {
      type: 'm.room.message',
      role: 'karte',
      content: text(taskCardBody({ ...card, state: urteil.state }), {
        mentions: [agent.mxid],
        task: taskCardContent({ ...card, state: urteil.state }),
      }),
    },
  });
  ausgabe.push({
    kind: 'message',
    roomId: req.originRoom,
    taskId: id,
    payload: {
      type: 'm.room.message',
      role: 'quittung',
      content: notice(
        lobbyReceipt({ ...card, state: urteil.state }, permalink(agent.roomId)) +
          (urteil.queued && urteil.note ? `\n${urteil.note}` : ''),
        { thread: req.originThread ?? null }
      ),
    },
  });

  // Zustand und Meldung zusammen (§10.2) — in der Transaktion des Aufrufers,
  // wenn er eine hat, sonst in einer eigenen.
  let angelegt = id;
  const anlegen = async (db: Db): Promise<void> => {
    const { task, created } = await store.createTask(
      {
        id,
        root: root || id,
        parent: parent?.id ?? null,
        correlationId,
        state: urteil.state,
        fromAgent: req.from,
        assignee: agent.id,
        hop,
        depth,
        goal,
        deliverable,
        constraints,
        budgetUsd,
        budgetMinutes,
        deadline,
        trustRequired,
        roomId: agent.roomId,
        idempotencyKey: req.idempotencyKey,
        promptHash: hash,
        chain: parent
          ? [...((parent as unknown as { chain?: string[] }).chain ?? []), req.from]
          : [req.from],
        // Material für Worker: die geprüfte Aktion des Betriebs, sonst der Kontext (§11.4, keine Anweisung).
        provenance: {
          origin_room: req.originRoom,
          handoff: req.isHandoff ?? false,
          ...(req.betriebSpec
            ? { material: req.betriebSpec }
            : req.context
              ? { material: req.context }
              : {}),
        },
      },
      db
    );
    if (!created) {
      // Derselbe Schlüssel kam zweimal: Der Auftrag existiert schon, also keine
      // zweite Karte (§10.3).
      angelegt = task.id;
      return;
    }
    angelegt = task.id;
    // §6.6: Die Geburt eines Auftrags gehört in die Kette, sonst lässt sich ein Lauf
    // erst ab dem ersten Zustandswechsel rekonstruieren.
    auditMerken(String(req.from ?? 'hub'), 'task.angelegt', id, {
      assignee: agent.id,
      state: urteil.state,
      hop,
      parent: parent?.id ?? null,
    });
    await enqueue(db, ausgabe, ctx.hub);
  };
  if (tx) await anlegen(tx);
  else await sql.begin(anlegen);

  // Freigabe anfragen, sobald der Auftrag steht (§9.3, Schritt 3).
  let freigabe: string | undefined;
  if (urteil.state === 'auth-required') {
    const frische = await store.getTask(angelegt);
    if (frische) {
      const res = await freigabeBeantragen(ctx, frische);
      freigabe = res.ok
        ? `Freigabe liegt in #schwarm-freigaben (✅ oder ❌ von Vale, ${FREIGABE_MIN} min) — bis dahin ruht der Auftrag.`
        : `Freigabe nicht angefragt (${res.fehler}) — der Hub versucht es erneut.`;
    }
  }

  ctx.log.info(
    { task: angelegt, agent: agent.id, state: urteil.state, queued: urteil.queued },
    'Auftrag angelegt'
  );
  return {
    ok: true,
    taskId: angelegt,
    state: urteil.state,
    queued: urteil.queued,
    roomId: agent.roomId,
    ...(urteil.note ? { note: urteil.note } : {}),
    ...(freigabe ? { freigabe } : {}),
  };
}

/**
 * Ergebnis aus dem Thread holen (§10.3): Brians Nachrichten seit dem 👀, ohne
 * Werkzeug-Zwischenstände und ohne „⏳ Working"-Fortschritte (ADR-002 §4.1).
 */
/**
 * Was kein Ergebnis ist (§4.1, ADR-002 §4.3): Fortschritts- und Abbruchmeldungen
 * von Hermes. „♻️ Recovered reply" gehört bewusst **nicht** hierher — nach einem
 * Ausfall von Synapse ist genau diese Nachricht das Ergebnis.
 */
export const FORTSCHRITT_PRAEFIXE = [
  '⏳ Working',
  '📚',
  '⚙️',
  '⚠️ Hermes is shutting down',
  '⚠️ Hermes is restarting',
  '⚡ Stopped',
];

/**
 * Werkzeugzeilen: Hermes schreibt sie als `{emoji} {werkzeug}...`,
 * `{emoji} {werkzeug}: "…"` oder `{emoji} {werkzeug}(` (§4.3, 4) — etwa
 * `🧠 memory...`, `📝 skill_manage: "…"`, `❓ clarify(`.
 */
const WERKZEUG_MUSTER = /^\S{1,3} [a-z][a-z0-9_]*(\.\.\.|: "|\()/;

export function istWerkzeugZeile(body: string): boolean {
  return WERKZEUG_MUSTER.test(body.trim());
}

export function istFortschritt(body: string): boolean {
  const text = body.trim();
  return FORTSCHRITT_PRAEFIXE.some((p) => text.startsWith(p)) || istWerkzeugZeile(text);
}

/** Nachlieferung aus dem Zustell-Ledger von Hermes (§4.1). */
export const WIEDERHERSTELLUNG = '♻️ Recovered reply';

export function istWiederherstellung(body: string): boolean {
  return body.trim().startsWith(WIEDERHERSTELLUNG);
}

/**
 * Der Text nach der ersten Leerzeile. Davor steht, warum Hermes nachliefert —
 * das gehört nicht ins Ergebnis. Bei der Ratenlimit-Variante kann ein Teil der
 * Antwort schon früher angekommen sein; die Nachlieferung ist dann trotzdem das,
 * was zählt (§4.3, 1).
 */
export function ergebnisVonWiederherstellung(body: string): string {
  const text = body.trim();
  const trenn = text.search(/\n\s*\n/);
  return (trenn >= 0 ? text.slice(trenn) : text).trim();
}

/**
 * Ergebnis ist Brians **letzte** Nachricht vor dem ✅, dazu die direkt davor
 * gesendeten Teile, falls Hermes eine lange Antwort geteilt hat (§4.1,
 * `MATRIX_MAX_MESSAGE_LENGTH` 16 000). Zwischentexte, Antworten auf frühere
 * Folgefragen und Werkzeugzeilen gehören nicht dazu (§4.3, 4).
 */
export function ergebnisAusThread(
  nachrichten: { sender: string; body: string; ts: number }[],
  assigneeMxid: string,
  maxZeichen = 4000,
  teilGrenze = 15_000
): string {
  const eigene = nachrichten
    .filter((m) => m.sender === assigneeMxid && m.body.trim() && !istFortschritt(m.body))
    .sort((a, b) => a.ts - b.ts);
  if (eigene.length === 0) return '';

  const teile = [eigene[eigene.length - 1]!];
  // Rückwärts anhängen, solange die Teile lang sind: Eine kurze Nachricht davor
  // ist eine eigene Meldung, kein Teil derselben Antwort.
  for (let i = eigene.length - 2; i >= 0; i--) {
    if (eigene[i]!.body.trim().length < teilGrenze) break;
    teile.unshift(eigene[i]!);
  }

  const text = teile
    .map((m) => m.body.trim())
    .join('\n\n')
    .trim();
  if (text.length <= maxZeichen) return text;
  return `${text.slice(0, maxZeichen)}\n… (gekürzt, ${text.length} Zeichen insgesamt)`;
}
