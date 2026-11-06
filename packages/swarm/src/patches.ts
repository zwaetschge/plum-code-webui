/**
 * Patches annehmen (matrix/PLAN-weiter.md, Punkt 13).
 *
 *  - Ein Code-Worker kann mit `done` einen Patch schicken (`patch`: Unified Diff gegen HEAD, `repo`: Name).
 *    Der Hub legt ihn als `T-….patch` ab (swarm.artifacts, Matrix-Medien) und stellt ihn als `m.file` in den
 *    Thread, mit `ch.zwaetschge.swarm.patch: {task, repo, dateien, plus, minus}` für die Diff-Ansicht der App.
 *    Patches mit Geheimnissen hängt er nicht an, sondern meldet sie.
 *  - `!patch T-0042 pruefen|anwenden|zusammenfuehren` gibt den Patch dem Worker `git`:
 *      pruefen          wendet ihn in einem Wegwerf-Arbeitsbaum auf HEAD an (git apply --check, --stat)
 *      anwenden         legt den Zweig schwarm/T-0042 mit einem Commit an, in einem eigenen Arbeitsbaum
 *      zusammenfuehren  spult den aktuellen Zweig vor (nur fast-forward und nur, wenn der Arbeitsbaum sauber ist)
 *    Vales Befehl ist die Freigabe, wie bei `!aktion`. Welche Repos gehen, steht beim Worker (repos.json).
 */
import { createHash } from 'node:crypto';
import { sql, type Db } from './db/index.js';
import { auditMerken } from './db/audit.js';
import { ablegen, anhangAusgabe } from './artifacts.js';
import { hatGeheimnis } from './redact.js';
import { alarmMelden } from './alarme.js';
import { createTaskFlow } from './tasks/create.js';
import type { NewOutbox } from './outbox.js';
import type { Ctx } from './context.js';

export const PATCH_FELD = 'ch.zwaetschge.swarm.patch';
export const PATCH_MAX = 1_000_000;
const REPO = /^[a-z0-9][a-z0-9._-]{0,60}$/i;

export function patchZahlen(patch: string): { dateien: number; plus: number; minus: number } {
  let dateien = 0;
  let plus = 0;
  let minus = 0;
  for (const z of patch.split('\n')) {
    if (z.startsWith('diff --git ')) dateien++;
    else if (z.startsWith('+') && !z.startsWith('+++')) plus++;
    else if (z.startsWith('-') && !z.startsWith('---')) minus++;
  }
  return { dateien, plus, minus };
}

/** Aus worker/server.ts (fertig): Patch ablegen und als Datei in den Thread. Liefert Outbox-Zeilen oder []. */
export async function patchAusgabe(
  ctx: Ctx,
  o: {
    taskId: string;
    roomId: string;
    thread: string;
    agentId: string;
    asUser?: string;
    f: Record<string, unknown>;
  },
  tx: Db
): Promise<NewOutbox[]> {
  const patch = typeof o.f.patch === 'string' ? o.f.patch : '';
  if (!patch.trim()) return [];
  if (patch.length > PATCH_MAX) {
    auditMerken(o.agentId, 'patch.zu_gross', o.taskId, { zeichen: patch.length });
    return [];
  }
  if (hatGeheimnis(patch)) {
    auditMerken(o.agentId, 'patch.geheimnis', o.taskId, {});
    await alarmMelden(ctx, {
      quelle: 'hub',
      agent: null,
      fingerabdruck: `patch-geheimnis:${o.taskId}`,
      level: 'warn',
      behoben: false,
      titel: `Patch von ${o.agentId} zu ${o.taskId} enthält etwas, das wie ein Geheimnis aussieht`,
      text: 'Er wurde nicht angehängt. Bitte den Auftrag prüfen.',
    });
    return [];
  }
  const repo = typeof o.f.repo === 'string' && REPO.test(o.f.repo) ? o.f.repo : 'unbekannt';
  const name = `${o.taskId}.patch`;
  const abgelegt = await ablegen(
    ctx,
    {
      taskId: o.taskId,
      name,
      text: patch,
      mime: 'text/x-diff',
      createdBy: o.agentId,
      ...(o.asUser ? { asUser: o.asUser } : {}),
    },
    tx
  );
  if (!abgelegt.ok || !abgelegt.mxc) return [];
  const ausgabe = anhangAusgabe({
    roomId: o.roomId,
    taskId: o.taskId,
    thread: o.thread,
    name,
    mime: 'text/x-diff',
    size: abgelegt.size ?? patch.length,
    mxc: abgelegt.mxc,
    ...(o.asUser ? { asUser: o.asUser } : {}),
  });
  ausgabe.payload.content[PATCH_FELD] = { task: o.taskId, repo, ...patchZahlen(patch) };
  auditMerken(o.agentId, 'patch.abgelegt', o.taskId, {
    repo,
    sha256: abgelegt.sha256,
    ...patchZahlen(patch),
  });
  return [ausgabe];
}

/** Neuester Patch eines Auftrags aus der Ablage. */
export async function patchVon(
  taskId: string,
  db: Db = sql
): Promise<{ text: string; repo: string } | null> {
  const [a] = await db`
    SELECT data FROM swarm.artifacts WHERE task_id = ${taskId} AND name LIKE '%.patch' ORDER BY id DESC LIMIT 1`;
  if (!a) return null;
  // Das Repo steht im Patch-Feld der Datei-Nachricht; sie entstand in derselben Transaktion wie die Ablage.
  const [meta] = await db`
    SELECT payload->'content'->${PATCH_FELD}->>'repo' AS repo FROM swarm.outbox
     WHERE task_id = ${taskId} AND payload->'content' ? ${PATCH_FELD} ORDER BY id DESC LIMIT 1`;
  return {
    text: Buffer.from(a.data as Uint8Array).toString('utf8'),
    repo: String(meta?.repo ?? 'unbekannt'),
  };
}

const AKTIONEN = {
  pruefen: 'prüfen',
  anwenden: 'anwenden',
  zusammenfuehren: 'zusammenführen',
} as const;

/** `!patch T-0042 pruefen|anwenden|zusammenfuehren [repo]` */
export async function cmdPatch(
  ctx: Ctx,
  tx: Db,
  input: { body: string; roomId: string; eventId: string; thread: string | null },
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const teile = input.body
    .trim()
    .replace(/^!patch\s*/i, '')
    .split(/\s+/)
    .filter(Boolean);
  const taskRoh = teile.find((t) => /^T-?\d+$/i.test(t));
  const aktion = teile
    .find((t) => t.toLowerCase().replace('ü', 'ue') in AKTIONEN)
    ?.toLowerCase()
    .replace('ü', 'ue') as keyof typeof AKTIONEN | undefined;
  if (!taskRoh || !aktion)
    return antwort('Aufruf: `!patch T-0042 pruefen|anwenden|zusammenfuehren [repo]`');
  const taskId = `T-${taskRoh.replace(/^T-?/i, '').padStart(4, '0')}`;
  const p = await patchVon(taskId, tx);
  if (!p) return antwort(`${taskId} hat keinen Patch.`);
  const repoArg = teile.find(
    (t) => t !== taskRoh && t.toLowerCase().replace('ü', 'ue') !== aktion && REPO.test(t)
  );
  const repo = repoArg ?? p.repo;
  if (repo === 'unbekannt')
    return antwort(`Für ${taskId} ist kein Repo bekannt: \`!patch ${taskId} ${aktion} <repo>\``);
  const sha = createHash('sha256').update(p.text).digest('hex').slice(0, 12);
  const r = await createTaskFlow(
    ctx,
    {
      goal: `patch.${aktion} ${taskId} in ${repo}`,
      deliverable:
        aktion === 'pruefen'
          ? 'passt der Patch auf HEAD, mit Statistik'
          : aktion === 'anwenden'
            ? 'Zweig und Commit'
            : 'neuer Stand des Zweigs',
      budgetMinutes: 10,
      assignee: 'git',
      from: ctx.owner,
      originRoom: input.roomId,
      originThread: input.thread,
      idempotencyKey: input.eventId,
      betriebSpec: JSON.stringify({ aktion, task: taskId, repo, patch: p.text, sha }),
    },
    tx
  );
  if (!r.ok) return antwort(`🚫 ${r.code}: ${r.reason}`);
  auditMerken(ctx.owner, `patch.${aktion}`, taskId, { repo, auftrag: r.taskId, sha });
  return antwort(
    `🧩 ${r.taskId}: ${AKTIONEN[aktion]} von ${taskId} in ${repo} läuft beim Worker git.`
  );
}
