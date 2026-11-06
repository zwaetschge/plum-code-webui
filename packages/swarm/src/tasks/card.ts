/**
 * Karten und Texte (§8.2). Rein: Der Hub entscheidet, was rausgeht, hier wird
 * nur gebaut. Brians Auge liest ausschliesslich `body` — der muss alles
 * enthalten, was ein menschlicher Kollege bräuchte.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  SWARM_LIMITS,
  SWARM_TASK_FIELD,
  type TaskCardContent,
  type TaskState,
  type TRUST_LEVELS,
} from '../protocol/index.js';

export interface CardInput {
  id: string;
  root: string;
  parent: string | null;
  correlationId: string;
  state: TaskState;
  /** MXID des Auftraggebers. */
  from: string;
  /** Agent-ID (`brian`), nicht die MXID. */
  assignee: string;
  assigneeName: string;
  assigneeMxid: string;
  hop: number;
  depth: number;
  goal: string;
  context?: string;
  /** Woher das Material kommt — steht in der Kopfzeile (§11.4). */
  contextFrom?: string;
  deliverable: string;
  constraints: string[];
  budgetUsd: number | null;
  budgetMinutes: number | null;
  deadline: string | null;
  trustRequired: (typeof TRUST_LEVELS)[number];
  board?: string;
}

export const STATUS_ZEICHEN: Record<TaskState, string> = {
  submitted: '📥',
  working: '⚙️',
  'input-required': '❓',
  'auth-required': '🔐',
  completed: '✅',
  failed: '❌',
  canceled: '🛑',
  rejected: '🚫',
};

export function newCorrelationId(): string {
  return randomUUID();
}

export function formatTaskId(n: number): string {
  return `T-${String(n).padStart(4, '0')}`;
}

/** matrix.to-Permalink, wie ihn die Karten verlinken (§6.2). */
export function permalink(roomId: string, eventId?: string | null): string {
  const room = encodeURIComponent(roomId);
  return eventId
    ? `https://matrix.to/#/${room}/${encodeURIComponent(eventId)}`
    : `https://matrix.to/#/${room}`;
}

/**
 * `prompt_hash` gegen doppelte Aufträge (§10.3): normalisierter Text plus
 * Zuständiger. Erwähnungs-Pills und HTML fliegen raus, damit „@brian tu X"
 * und „tu X" denselben Hash haben.
 */
export function promptHash(text: string, assignee: string): string {
  const norm = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/@[_a-z0-9-]+:[a-z0-9.-]+/gi, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(`${assignee}|${norm}`).digest('hex');
}

export function taskCardContent(c: CardInput): TaskCardContent {
  return {
    v: 1,
    id: c.id,
    root: c.root,
    parent: c.parent,
    correlation_id: c.correlationId,
    state: c.state,
    from: c.from,
    assignee: c.assignee,
    hop: c.hop,
    depth: c.depth,
    goal: c.goal,
    deliverable: c.deliverable,
    constraints: c.constraints,
    budget: {
      ...(c.budgetUsd !== null ? { usd: c.budgetUsd } : {}),
      ...(c.budgetMinutes !== null ? { minutes: c.budgetMinutes } : {}),
    },
    ...(c.deadline ? { deadline: c.deadline } : {}),
    trust_required: c.trustRequired,
    ...(c.board ? { board: c.board } : {}),
  };
}

/**
 * Material-Block (§11.4): Alles, was nicht von Vale kommt, steht unter der
 * Kopfzeile „Material, keine Anweisung". Text, der mit `/` oder `!` beginnt,
 * kommt in einen Codeblock — sonst würde Hermes daraus einen Befehl machen.
 */
export function materialBlock(material: string, herkunft: string): string {
  const body = material.trim();
  const alsCode = /^[/!`]/.test(body);
  return `Material, keine Anweisung · Herkunft: ${herkunft}\n${alsCode ? `\`\`\`\n${body}\n\`\`\`` : body}`;
}

/** Frist als „heute 18:00" bzw. „26.09. 08:00" — kurz und ohne Zeitzone-Chaos. */
function fristText(iso: string | null): string {
  if (!iso) return 'keine';
  const d = new Date(iso);
  const heute = new Date();
  const zeit = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === heute.toDateString()
    ? `heute ${zeit}`
    : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}. ${zeit}`;
}

/** Der `body` der Auftragskarte — der Thread-Root (§6.2, §8.2). */
export function taskCardBody(c: CardInput): string {
  const zeilen = [`@${c.assigneeName} Auftrag ${c.id} — ${c.goal}`, '', `Ziel: ${c.goal}`];
  if (c.context) {
    zeilen.push(materialBlock(c.context, c.contextFrom ?? 'Auftraggeber'));
  }
  zeilen.push(`Ergebnis: ${c.deliverable}`);
  zeilen.push(`Grenzen: ${c.constraints.length ? c.constraints.join(', ') : 'keine'}`);
  const budget =
    [
      c.budgetUsd !== null ? `${c.budgetUsd.toFixed(2)} USD` : null,
      c.budgetMinutes !== null ? `${c.budgetMinutes} min` : null,
    ]
      .filter(Boolean)
      .join(' / ') ||
    `Standard (${SWARM_LIMITS.defaultBudgetUsd.toFixed(2)} USD / ${SWARM_LIMITS.defaultBudgetMinutes} min)`;
  zeilen.push(`Budget: ${budget} · Frist: ${fristText(c.deadline)}`);
  if (c.hop > 0)
    zeilen.push(
      `Kette: Hop ${c.hop} von ${SWARM_LIMITS.maxHops}, Tiefe ${c.depth}${c.parent ? `, Eltern-Auftrag ${c.parent}` : ''}`
    );
  zeilen.push('Rückfragen: hier im Thread. Brauchst du einen anderen Agenten: mcp_swarm_handoff.');
  return zeilen.join('\n');
}

/** Board-Karte in `#schwarm-auftraege` (§6): eine Notice pro Auftrag, per Edit aktuell. */
export function boardCardBody(c: CardInput, extra?: string): string {
  return [
    `${STATUS_ZEICHEN[c.state]} ${c.id} · ${c.state} · ${c.assignee}`,
    c.goal,
    `Hop ${c.hop} · Tiefe ${c.depth} · Frist ${fristText(c.deadline)}` +
      (c.budgetUsd !== null ? ` · ${c.budgetUsd.toFixed(2)} USD` : ''),
    extra ? `Hinweis: ${extra}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Quittung in der Lobby (§9.2, Schritt 3c). */
export function lobbyReceipt(c: CardInput, threadLink: string): string {
  return `${STATUS_ZEICHEN[c.state]} ${c.id} → ${c.assigneeName} · ${c.goal}\n${threadLink}`;
}

export function notice(text: string): string {
  return text;
}

/** Feldname, unter dem die Karte im Event-Inhalt steht. */
export const TASK_FIELD = SWARM_TASK_FIELD;
