import { parsePlumTaskRequest } from '../protocol/plumTask.js';
/**
 * Befehle (§8.6) — nur von dir. Der Hub führt sie aus, bevor er irgendetwas
 * anderes mit der Nachricht tut. `!` statt `/`, weil Element `/` selbst abfängt.
 *
 * Namen nach ADR-002 §4.1: `!stand` statt `!status` und `!pruefen` statt
 * `!review`, sonst kollidiert der Hub in Brians Raum mit Hermes' eigenen
 * Befehlen. `!stop` meint in beiden Welten dasselbe und bleibt doppelt.
 */
import type { TaskState } from '../protocol/index.js';
import type { Db } from '../db/index.js';
import { agentById, listAgents, setFrozen } from '../agents/store.js';
import {
  FROZEN_FLAG,
  clearFlag,
  getFlag,
  isSwarmFrozen,
  setFlag,
  verifyAudit,
} from '../db/audit.js';
import { queueHalt } from '../council/halt.js';
import { reply } from '../reply.js';
import type { Ctx } from '../context.js';
import { createTaskFlow } from '../tasks/create.js';
import { parseRat, startRat } from '../council/rat.js';
import { parseRatNativ, ratStarten } from '../rat/lauf.js';
import { zustandUndMeldung } from '../tasks/transition.js';
import * as store from '../tasks/store.js';
import { alarmListe } from '../alarme.js';
import { cmdAktion } from '../betrieb/aktion.js';
import { kanariKandidaten, selbsttestAuftrag } from '../schedule.js';
import { verbundeneWorker, workerStand } from '../worker/server.js';
import { absprachenText } from '../absprachen.js';
import { releaseInfo, releaseText } from '../release.js';
import { cmdEntsperren, sperrenText } from '../tuersteher.js';
import { tokensText } from '../tokenpflege.js';
import { aboText } from '../kontingente.js';
import { cmdRoutine } from '../routinen.js';
import { pauseAufheben, profilText } from '../profil.js';
import { cmdAlarm } from '../lernen.js';
import { cmdGeraet } from '../notaus.js';
import { cmdPatch } from '../patches.js';
import { erinnernText, cmdMerken } from '../gedaechtnis.js';
import { cmdRuhe } from '../ruhe.js';
import { liteStand, llmText } from '../litellm.js';
import { cmdAblauf } from '../ablaeufe.js';
import { berichtText, kennzahlen } from '../kennzahlen.js';
import { cmdModell } from '../modelle.js';
import { cmdStimme } from '../stimmen.js';
import { cmdTagesbericht } from '../tagesbericht.js';

export interface CommandInput {
  body: string;
  roomId: string;
  eventId: string;
  thread: string | null;
  plumTask?: unknown;
}

export interface Command {
  name: string;
  args: string[];
  /** Roher Text hinter dem Befehl, für Aufträge. */
  rest: string;
}

export const BEFEHLE = [
  '!auftrag @agent <ziel> (kurz !a) — neuer Auftrag; @plum/<sitzung> für eine bestimmte Plum-Sitzung',
  '!stand [T-…] — Zustand eines Auftrags, ohne Argument die Übersicht',
  '!board [agent] — offene Aufträge',
  '!agenten — wer ist da, was darf er, was läuft',
  '!stop — Kill-Switch: Schwarm einfrieren, auch Betrieb und Rat',
  '!stop T-0142 | !stop @agent — einen Auftrag bzw. einen Agenten stoppen',
  '!weiter [@agent] — auftauen',
  '!budget [agent] — Verbrauch heute',
  '!selbsttest [agent] — Testauftrag „antworte mit OK"',
  '!pruefen T-0142 @agent — ein anderer Agent prüft das Ergebnis (Cross-Model-Review)',
  '!rat [debatte|broadcast|vote|lead <rolle>|staffel|still <rolle>] <frage> — der Rat berät (claude, codex, brian, plum)',
  '!audit — Hash-Kette der Audit-Tabelle prüfen',
  '!alarme — offene Alarme; auf der Notice ✅ quittieren, 🔕 24 h stumm, 🔔 wieder laut',
  '!aktion [fähigkeit ziel [grund]] — Betrieb: Docker, Unraid, Pi-hole (ohne Argument: Liste)',
  '!plum — die Plum-Sitzungen mit Zustand; Auftrag an eine Sitzung: !auftrag @plum/<name> <ziel>',
  '!absprachen — wer gerade an welchen Dateien arbeitet (Sitzungen und Agenten)',
  '!sperren — was der Türsteher gesperrt hat; !entsperren <ip> [grund] hebt eine Sperre auf',
  '!release — welcher Hub-Stand läuft, mit Basis, Tests und Rückweg',
  '!tokens — Schwarm-Tokens mit Alter und letzter Nutzung (nie die Tokens selbst)',
  '!abo — Kontingente von Claude, Codex und Z.AI; bei 95 % gehen Code-Aufträge an die Rückfallebene',
  '!routine [neu <name> <zeitplan> @agent <ziel> | pause|weiter|jetzt|weg <name>] — wiederkehrende Aufträge',
  '!profil [@agent] — Erfolgsquote, Dauer, Kosten und 👍/👎 je Agent (30 Tage)',
  '!alarm stumm|still|laut <fingerabdruck> [dauer] — Alarme länger stumm oder nur noch still',
  '!geraet [neu <name> <schlüssel> | weg <id>] — Geräte für den Not-Aus ohne Matrix',
  '!patch T-0042 pruefen|anwenden|zusammenfuehren — Patch eines Code-Auftrags über den Worker git',
  '!erinnern <frage> — im Schwarm-Gedächtnis nach früheren Aufträgen suchen',
  '!merken [@agent] <text> — eine Notiz ins Gedächtnis (erste Zeile ist der Titel); Brian findet sie mit nachschlagen',
  '!ablauf [<name> <ziel> | stop <nr>] — mehrstufige Abläufe mit Toren (code-aenderung, code-patch, recherche, zweitmeinung)',
  '!kennzahlen — Wochenbericht: Aufträge, Quote, Kosten, Freigaben, Alarme',
  '!tagesbericht — der Tag in Zahlen: Aufträge, Offenes, Kosten, Abo, Alarme (kommt sonst um 21:00)',
  '!modell [@agent <modell> [fallback a,b|keiner] [aufwand stufe|standard]] — Modelle je Agent; @agent standard stellt zurück',
  '!stimme [@agent|@hub <stimme>|standard] — Stimme je Agent beim Vorlesen (Vocarium)',
  '!ruhe [HH:MM-HH:MM|an|aus] — Ruhezeit: nachts wecken nur 🚨, ⬆️, 🔐 und ⛔',
  '!llm — LiteLLM: Brians Modelle ausserhalb von Z.AI, Ausgaben und Budget',
  '!hilfe — diese Liste',
] as const;

/** `!a @brian tu was` → { name: 'auftrag', args: ['brian'], rest: 'tu was' } */
export function parseCommand(body: string): Command | null {
  const text = body.trim();
  if (!text.startsWith('!')) return null;
  const [kopf, ...rest] = text.slice(1).split(/\s+/);
  const name = (kopf ?? '').toLowerCase();
  if (!name) return null;
  const alias = name === 'a' ? 'auftrag' : name;
  const args: string[] = [];
  let i = 0;
  for (const teil of rest) {
    if (teil.startsWith('@') || /^T-?\d+$/i.test(teil)) {
      args.push(normalizeArg(teil));
      i++;
      continue;
    }
    break;
  }
  return { name: alias, args, rest: rest.slice(i).join(' ').trim() };
}

/** `@brian:domain` → `brian`, `@_sw_codex-host` → `codex-host`, `142` → `T-0142`. */
export function normalizeArg(teil: string): string {
  if (teil.startsWith('@')) {
    const local = teil.slice(1).split(':')[0]!;
    return local.startsWith('_sw_') ? local.slice(4) : local;
  }
  if (/^T-?\d+$/i.test(teil)) return `T-${teil.replace(/^T-?/i, '').padStart(4, '0')}`;
  return teil;
}

export async function runCommand(ctx: Ctx, tx: Db, input: CommandInput): Promise<void> {
  const cmd = parseCommand(input.body);
  if (!cmd) return;
  const antwort = (text: string): Promise<void> => reply(ctx, tx, input.roomId, input.thread, text);
  const imThread = (text: string): Promise<void> =>
    reply(ctx, tx, input.roomId, input.thread ?? input.eventId, text);

  switch (cmd.name) {
    case 'auftrag':
      return cmdAuftrag(ctx, tx, cmd, input, antwort);
    case 'stand':
      return antwort(await cmdStand(cmd.args[0]));
    case 'board':
      return antwort(await cmdBoard(cmd.args[0]));
    case 'agenten':
      return antwort(await cmdAgenten());
    case 'budget':
      return antwort(await cmdBudget(cmd.args[0]));
    case 'stop':
      return cmdStop(ctx, tx, cmd, input, antwort);
    case 'weiter':
      return cmdWeiter(ctx, tx, cmd, antwort);
    case 'selbsttest':
      return cmdSelbsttest(ctx, tx, cmd, input, antwort);
    case 'pruefen':
      return cmdPruefen(ctx, tx, cmd, input, antwort);
    case 'rat':
      return cmdRat(ctx, input, antwort);
    case 'audit': {
      const prüfung = await verifyAudit();
      return antwort(
        prüfung.ok
          ? `Audit-Kette stimmt: ${prüfung.rows} Zeilen, kein Bruch.`
          : `⚠️ Audit-Kette gebrochen bei Zeile ${prüfung.brokenAt} von ${prüfung.rows}.`
      );
    }
    case 'alarme':
      return antwort(await alarmListe());
    case 'aktion':
      return cmdAktion(ctx, input, antwort);
    case 'plum':
    case 'sitzungen':
      return antwort(plumSitzungen());
    case 'absprachen':
      return antwort(await absprachenText());
    case 'sperren':
      return antwort(await sperrenText());
    case 'entsperren':
      return cmdEntsperren(ctx, input, antwort);
    case 'release':
      return antwort(releaseText(await releaseInfo()));
    case 'tokens':
      return antwort(await tokensText());
    case 'abo':
    case 'kontingent':
      return antwort(aboText());
    case 'routine':
    case 'routinen':
      return cmdRoutine(ctx, tx, input, antwort);
    case 'profil':
      return antwort(await profilText(cmd.args[0]));
    case 'alarm':
      return cmdAlarm(ctx, tx, input, antwort);
    case 'geraet':
    case 'gerät':
      return cmdGeraet(ctx, tx, input, antwort);
    case 'patch':
      return cmdPatch(ctx, tx, input, antwort);
    case 'erinnern':
      return antwort(await erinnernText(input.body.trim().replace(/^!erinnern\s*/i, '')));
    case 'ablauf':
    case 'ablaeufe':
      return cmdAblauf(ctx, tx, input, antwort);
    // Die App wartet auf die Antwort im Thread ihres Befehls (App 2.2/2.3). Ohne eigenen Thread wäre sie eine
    // lose Notice, die sich keinem Befehl zuordnen lässt; also antworten diese beiden im Thread des Befehls.
    case 'modell':
    case 'modelle':
      return cmdModell(ctx, tx, input, imThread);
    case 'stimme':
    case 'stimmen':
      return cmdStimme(ctx, tx, input, imThread);
    case 'tagesbericht':
      return cmdTagesbericht(ctx, imThread);
    case 'ruhe':
    case 'ruhezeit':
      return cmdRuhe(ctx, input, imThread);
    case 'llm':
    case 'litellm':
      return imThread(llmText(liteStand()));
    case 'merken':
      return cmdMerken(input, imThread);
    case 'kennzahlen':
      return antwort(berichtText(await kennzahlen(7)));
    case 'hilfe':
      return antwort(['Befehle (nur von dir):', ...BEFEHLE].join('\n'));
    default:
      return antwort(`Unbekannter Befehl „!${cmd.name}". !hilfe zeigt die Liste.`);
  }
}

/** `!plum`: der letzte Stand, den die Plum-Brücke über ihre Sitzungen gemeldet hat (ADR-002 §4.36). */
export function plumSitzungen(jetzt = Date.now()): string {
  const verbunden = verbundeneWorker().has('plum');
  const letzter = workerStand('plum');
  if (!letzter) {
    return verbunden
      ? 'Die Plum-Brücke ist verbunden, hat aber noch keine Sitzungsliste geschickt.'
      : 'Die Plum-Brücke ist nicht verbunden; eine Sitzungsliste gibt es erst mit ihr.';
  }
  const minuten = Math.max(0, Math.round((jetzt - letzter.at) / 60_000));
  const kopf =
    `Plum-Sitzungen: ${letzter.eintraege.length}, Stand vor ${minuten} min` +
    (verbunden ? '' : ' (Brücke gerade nicht verbunden)');
  if (!letzter.eintraege.length) return `${kopf}. Keine offenen Sitzungen.`;
  const zeilen = letzter.eintraege.map(
    (e) =>
      `• ${e.name} — ${e.zustand}${e.text ? `: ${e.text}` : ''}${e.link ? `\n  ${e.link}` : ''}`
  );
  return [
    `${kopf}:`,
    ...zeilen,
    '',
    'Auftrag an eine Sitzung: !auftrag @plum/<name> <ziel>. Antworten im Thread der Karte gehen direkt in die Sitzung.',
  ].join('\n');
}

async function cmdAuftrag(
  ctx: Ctx,
  tx: Db,
  cmd: Command,
  input: CommandInput,
  antwort: (t: string) => Promise<void>
): Promise<void> {
  // `@plum/voxtral` spricht eine Einheit eines Workers ausdrücklich an (ADR-002 §4.36): Der Worker
  // bekommt `@voxtral: …`. Gibt es die Sitzung nicht (mehr), scheitert der Auftrag, statt woanders
  // zu landen.
  const [agentId, einheit] = (cmd.args[0] ?? '').split('/', 2);
  if (!agentId) {
    await antwort('An wen? `!auftrag @brian <ziel>`');
    return;
  }
  let request: ReturnType<typeof parsePlumTaskRequest>;
  try {
    request = parsePlumTaskRequest(input.plumTask, [agentId, einheit].filter(Boolean).join('/'));
  } catch {
    await antwort('Plum-Auftragsdaten sind ungültig oder passen nicht zum gewählten Agenten.');
    return;
  }
  const text = request?.goal ?? (cmd.rest || cmd.args.slice(1).join(' '));
  const ziel = einheit && text ? `@${einheit}: ${text}` : text;
  if (!ziel) {
    await antwort('Ohne Ziel kein Auftrag: `!auftrag @brian <ziel>`');
    return;
  }
  const ergebnis = await createTaskFlow(
    ctx,
    {
      goal: ziel,
      ...(request
        ? {
            context: request.context,
            deliverable: request.deliverables.length ? request.deliverables.join('; ') : undefined,
            budgetUsd: request.budgetUsd,
            deadline: request.deadline,
          }
        : {}),
      assignee: agentId,
      from: ctx.owner,
      originRoom: input.roomId,
      originThread: input.thread,
      idempotencyKey: input.eventId,
    },
    tx
  );
  if (!ergebnis.ok) {
    await antwort(`🚫 Abgelehnt (${ergebnis.code}): ${ergebnis.reason}`);
    return;
  }
  if (ergebnis.queued && ergebnis.note) await antwort(ergebnis.note);
}

async function cmdStand(taskArg?: string): Promise<string> {
  if (!taskArg) {
    const offen = await store.listOpen();
    if (!offen.length) return 'Keine offenen Aufträge.';
    const zeilen = offen
      .slice(0, 12)
      .map((t) => `${zustandsZeichen(t.state)} ${t.id} · ${t.assignee} · ${t.goal.slice(0, 60)}`);
    return [`Offen: ${offen.length}`, ...zeilen].join('\n');
  }
  const task = await store.getTask(normalizeArg(taskArg));
  if (!task) return `Kein Auftrag ${taskArg}.`;
  const agent = await agentById(task.assignee);
  return [
    `${zustandsZeichen(task.state)} ${task.id} · ${task.state}`,
    `Ziel: ${task.goal}`,
    `Agent: ${agent?.displayName ?? task.assignee} (${agent?.status ?? '?'}, ${agent?.trust ?? '?'})`,
    `Hop ${task.hop} · Tiefe ${task.depth} · Versuche ${task.attempts} · Priorität ${task.priority}`,
    `Budget: ${task.budgetUsd ?? '–'} USD / ${task.budgetMinutes ?? '–'} min · Frist: ${task.deadline ?? 'keine'}`,
    task.result ? `Ergebnis: ${task.result.slice(0, 500)}` : '',
    task.failReason ? `Grund: ${task.failReason}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function zustandsZeichen(state: TaskState): string {
  return {
    submitted: '📥',
    working: '⚙️',
    'input-required': '❓',
    'auth-required': '🔐',
    completed: '✅',
    failed: '❌',
    canceled: '🛑',
    rejected: '🚫',
  }[state];
}

async function cmdBoard(agentArg?: string): Promise<string> {
  const offen = await store.listOpen();
  const gefiltert = agentArg ? offen.filter((t) => t.assignee === agentArg) : offen;
  if (!gefiltert.length)
    return agentArg ? `Keine offenen Aufträge für ${agentArg}.` : 'Board ist leer.';
  return [
    `Board — ${gefiltert.length} offen${agentArg ? ` (${agentArg})` : ''}`,
    ...gefiltert.map(
      (t) =>
        `${zustandsZeichen(t.state)} ${t.id} ${t.assignee} · ${t.goal.slice(0, 50)} · Hop ${t.hop} · ${t.priority}`
    ),
  ].join('\n');
}

async function cmdAgenten(): Promise<string> {
  const agenten = await listAgents();
  if (!agenten.length) return 'Keine Agenten eingetragen (agents.swarm.yaml).';
  const zeilen = [];
  for (const a of agenten) {
    const kosten = await store.dailyCost(a.id);
    const laufend = await store.runningCount(a.id);
    zeilen.push(
      `${a.status === 'online' ? '🟢' : a.status === 'unresponsive' ? '🟡' : '⚪'} ${a.id} · ${a.level}/${a.trust} · ${a.mode}` +
        `${a.frozen ? ' · ❄️ eingefroren' : ''} · ${laufend} laufend · ${kosten.toFixed(2)} USD heute` +
        `${a.budgetUsdDay !== null ? `/${Number(a.budgetUsdDay).toFixed(2)}` : ''}` +
        einheitenZeile(a.id)
    );
  }
  return zeilen.join('\n');
}

/** „· 7 Sitzungen (2 arbeiten, 1 wartet auf dich)“ für Worker, die ihre Einheiten melden (ADR-002 §4.36). */
function einheitenZeile(agent: string): string {
  const letzter = workerStand(agent);
  if (!letzter) return '';
  const zaehle = (z: string): number => letzter.eintraege.filter((e) => e.zustand === z).length;
  const teile = [
    zaehle('arbeitet') && `${zaehle('arbeitet')} arbeiten`,
    zaehle('wartet auf dich') && `${zaehle('wartet auf dich')} wartet auf dich`,
    zaehle('Fehler') && `${zaehle('Fehler')} mit Fehler`,
  ].filter(Boolean);
  const name = agent === 'plum' ? 'Sitzungen' : 'Einheiten';
  return ` · ${letzter.eintraege.length} ${name}${teile.length ? ` (${teile.join(', ')})` : ''}`;
}

async function cmdBudget(agentArg?: string): Promise<string> {
  const agenten = agentArg
    ? [await agentById(agentArg)].filter((a): a is NonNullable<typeof a> => a !== null)
    : await listAgents();
  if (!agenten.length)
    return agentArg ? `Agent ${agentArg} ist nicht eingetragen.` : 'Keine Agenten.';
  const zeilen = [];
  for (const a of agenten) {
    const kosten = await store.dailyCost(a.id);
    const limit = a.budgetUsdDay === null ? null : Number(a.budgetUsdDay);
    const anteil = limit ? `${((kosten / limit) * 100).toFixed(0)} %` : '–';
    zeilen.push(
      `${a.id}: ${kosten.toFixed(2)} USD heute${limit ? ` von ${limit.toFixed(2)} (${anteil})` : ' (kein Limit)'}`
    );
  }
  return zeilen.join('\n');
}

async function cmdStop(
  ctx: Ctx,
  tx: Db,
  cmd: Command,
  input: CommandInput,
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const ziel = cmd.args[0];

  if (!ziel) {
    // Kill-Switch: zuerst sich selbst, dann der Rat (§9.7).
    await setFlag(FROZEN_FLAG, { by: ctx.owner, event: input.eventId }, ctx.owner, tx);
    await queueHalt(tx, { sender: ctx.owner, eventId: input.eventId });
    await antwort(
      '⛔ Schwarm eingefroren. Keine neuen Aufträge, keine Übergaben. Rat-Not-Aus ist unterwegs. Weiter mit !weiter — den Rat setzt nur die Rat-UI fort.'
    );
    return;
  }

  if (ziel.startsWith('T-')) {
    const task = await store.getTask(ziel, tx);
    if (!task) {
      await antwort(`Kein Auftrag ${ziel}.`);
      return;
    }
    await zustandUndMeldung(ctx, tx, task.id, 'canceled', {
      failReason: '!stop',
      triggerEvent: input.eventId,
      actor: ctx.owner,
    });
    await antwort(
      `🛑 ${task.id} abgebrochen${task.roomId && task.threadRoot ? ', /stop ist an den Bot unterwegs' : ''}.`
    );
    return;
  }

  const agent = await agentById(ziel, tx);
  if (!agent) {
    await antwort(`Weder Auftrag noch Agent: ${ziel}`);
    return;
  }
  await setFrozen(agent.id, true, tx);
  const offen = await store.listOpen();
  let abgebrochen = 0;
  for (const t of offen.filter((x) => x.assignee === agent.id)) {
    await zustandUndMeldung(ctx, tx, t.id, 'canceled', {
      failReason: `!stop @${agent.id}`,
      actor: ctx.owner,
    });
    abgebrochen++;
  }
  await antwort(
    `❄️ ${agent.id} eingefroren, ${abgebrochen} Auftrag/Aufträge abgebrochen. Weiter mit !weiter @${agent.id}.`
  );
}

async function cmdWeiter(
  ctx: Ctx,
  tx: Db,
  cmd: Command,
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const ziel = cmd.args[0];
  if (ziel) {
    const agent = await agentById(ziel, tx);
    if (!agent) {
      await antwort(`Agent ${ziel} ist nicht eingetragen.`);
      return;
    }
    await setFrozen(agent.id, false, tx);
    // Auch eine Pause nach Fehlschlägen (Agentenprofil) ist damit vorbei.
    const warPausiert = await pauseAufheben(agent.id, tx);
    await antwort(`▶️ ${agent.id} läuft wieder${warPausiert ? ' (Pause aufgehoben)' : ''}.`);
    return;
  }
  const frozen = await getFlag<{ by?: string }>(FROZEN_FLAG, tx);
  await clearFlag(FROZEN_FLAG, tx);
  await antwort(
    frozen
      ? '▶️ Schwarm läuft wieder. Der Rat ist möglicherweise weiter angehalten — das löst nur die Rat-UI (§10.6).'
      : 'Der Schwarm war nicht eingefroren.'
  );
}

async function cmdSelbsttest(
  ctx: Ctx,
  tx: Db,
  cmd: Command,
  input: CommandInput,
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const agenten = cmd.args[0]
    ? [await agentById(cmd.args[0], tx)].filter((a): a is NonNullable<typeof a> => a !== null)
    : kanariKandidaten(await listAgents(tx), verbundeneWorker());
  if (!agenten.length) {
    await antwort('Kein Agent für den Selbsttest erreichbar.');
    return;
  }
  const ids: string[] = [];
  for (const a of agenten) {
    const ergebnis = await createTaskFlow(
      ctx,
      {
        ...selbsttestAuftrag(a.id),
        assignee: a.id,
        from: ctx.owner,
        originRoom: input.roomId,
        originThread: input.thread,
        idempotencyKey: `${input.eventId}:${a.id}`,
        budgetUsd: 0.05,
        budgetMinutes: 5,
      },
      tx
    );
    if (ergebnis.ok) ids.push(ergebnis.taskId);
  }
  await antwort(
    ids.length
      ? `🧪 Selbsttest gestartet: ${ids.join(', ')}`
      : '🧪 Selbsttest: nichts angelegt (Policy).'
  );
}

/**
 * Cross-Model-Review (§8.6): Ein anderer Agent prüft ein fertiges Ergebnis.
 * `!review` gehört Hermes (ADR-002 §4.1), deshalb heisst der Befehl `!pruefen`.
 * Das geprüfte Ergebnis geht als markiertes Material mit (§11.4) — nie der ganze
 * Thread des Auftraggebers.
 */
async function cmdPruefen(
  ctx: Ctx,
  tx: Db,
  cmd: Command,
  input: CommandInput,
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const taskId = cmd.args.find((x) => x.startsWith('T-'));
  const pruefer = cmd.args.find((x) => !x.startsWith('T-'));
  if (!taskId || !pruefer) {
    await antwort('Aufruf: `!pruefen T-0142 @agent`');
    return;
  }
  const original = await store.getTask(taskId, tx);
  if (!original) {
    await antwort(`Kein Auftrag ${taskId}.`);
    return;
  }
  if (!original.result) {
    await antwort(
      `${taskId} hat noch kein Ergebnis (Zustand ${original.state}) — es gibt nichts zu prüfen.`
    );
    return;
  }
  if (original.assignee === pruefer) {
    await antwort(
      `${pruefer} hat ${taskId} selbst bearbeitet — ein Review soll von einem anderen kommen.`
    );
    return;
  }
  const ergebnis = await createTaskFlow(
    ctx,
    {
      goal: `Ergebnis von ${original.id} prüfen: ${original.goal}`,
      deliverable:
        'Kurze Bewertung: stimmt das Ergebnis, was fehlt, welches Risiko. Maximal 10 Zeilen.',
      constraints: ['nur lesen', 'keine Neustarts'],
      context: original.result,
      assignee: pruefer,
      from: ctx.owner,
      originRoom: input.roomId,
      originThread: input.thread,
      idempotencyKey: input.eventId,
      budgetUsd: 0.2,
      budgetMinutes: 10,
    },
    tx
  );
  if (!ergebnis.ok) {
    await antwort(`🚫 Review abgelehnt (${ergebnis.code}): ${ergebnis.reason}`);
    return;
  }
  await antwort(`🔎 Review ${ergebnis.taskId} geht an ${pruefer} (prüft ${original.id}).`);
}

/**
 * `!rat …` (§9.4): Die Grammatik ist die des Rats, der Hub reicht sie als
 * `POST /api/council/tasks` weiter und spiegelt den Verlauf nach `#ag-rat`.
 */
async function cmdRat(
  ctx: Ctx,
  input: CommandInput,
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const eingabe = input.body.replace(/^!rat\s*/i, '');
  // ADR-003 R3: Der Rat tagt im Schwarm, mit echten Agenten statt über den alten Rat.
  if (process.env.RAT_NATIV === '1') return cmdRatNativ(ctx, input, eingabe, antwort);
  const cmd = parseRat(eingabe);
  if (!cmd) {
    await antwort(
      'Aufruf: `!rat <frage>` oder `!rat debatte|vote|staffel <frage>` bzw. `!rat lead|still <rolle> <frage>` ' +
        '(Rollen: claude, codex, glm, qwen).'
    );
    return;
  }
  const resultat = await startRat(ctx, {
    cmd,
    originRoom: input.roomId,
    originThread: input.thread,
    eventId: input.eventId,
  });
  if (!resultat.ok) {
    await antwort(`🚫 Rat nicht gestartet (${resultat.code}): ${resultat.reason}`);
    return;
  }
  await antwort(
    `⚖️ ${resultat.task} geht an den Rat (${cmd.modus}, ${cmd.rollen.join('/')}) — ` +
      `Rat-Auftrag ${resultat.councilTask}. Der Verlauf kommt nach #ag-rat.`
  );
}

async function cmdRatNativ(
  ctx: Ctx,
  input: CommandInput,
  eingabe: string,
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const cmd = parseRatNativ(eingabe);
  if (!cmd) {
    await antwort(
      'Aufruf: `!rat <frage>` oder `!rat debatte|broadcast|vote|staffel <frage>` bzw. ' +
        '`!rat lead|still <rolle> <frage>` (Rollen: claude, codex, brian, plum).'
    );
    return;
  }
  const r = await ratStarten(ctx, {
    cmd,
    originRoom: input.roomId,
    originThread: input.thread,
    eventId: input.eventId,
  });
  if (!r.ok) {
    await antwort(`🚫 Rat nicht einberufen (${r.code}): ${r.reason}`);
    return;
  }
  const namen = async (ids: string[]) =>
    (await Promise.all(ids.map(async (id) => (await agentById(id))?.displayName ?? id))).join(', ');
  await antwort(
    `⚖️ ${r.task}: Der Rat tagt (${cmd.modus}) mit ${await namen(r.mitglieder)}` +
      (r.moderator ? ` · Moderation ${await namen([r.moderator])}` : '') +
      (r.fehlen.length ? ` · nicht erreichbar: ${await namen(r.fehlen)}` : '') +
      (r.wartet ? ' · wartet, bis ein laufender Rat fertig ist' : '') +
      '. Der Verlauf kommt nach #ag-rat.'
  );
}

/** Für /health und die Tagesübersicht. */
export async function swarmLage(): Promise<{ frozen: boolean; open: number; agents: number }> {
  const [offen, agenten] = await Promise.all([store.listOpen(), listAgents()]);
  return { frozen: await isSwarmFrozen(), open: offen.length, agents: agenten.length };
}
