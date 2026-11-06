/**
 * Watchdog (§10.4): läuft alle 30 s über die offenen Aufträge und meldet, was
 * hängt. Die Schwellen stehen in `tasks/watchdog-rules.ts` und sind dort
 * getestet; hier wird nur ausgeführt — Zustand und Meldung in einer Transaktion.
 */
import { sql } from './db/index.js';
import { agentById, roomsByKind, setStatus } from './agents/store.js';
import { notice, text } from './appservice/messages.js';
import { enqueue } from './outbox.js';
import { notify } from './notify.js';
import type { Ctx } from './context.js';
import { entscheide, type WatchdogAction } from './tasks/watchdog-rules.js';
import { zustandUndMeldung } from './tasks/transition.js';
import * as store from './tasks/store.js';

export interface WatchdogLauf {
  erinnerungen: number;
  stalled: number;
  fristen: number;
  leases: number;
  hinweise: number;
}

export async function runWatchdog(ctx: Ctx): Promise<WatchdogLauf> {
  const lauf: WatchdogLauf = { erinnerungen: 0, stalled: 0, fristen: 0, leases: 0, hinweise: 0 };
  const jetzt = Date.now();

  for (const kandidat of await store.watchdogKandidaten()) {
    const aktion = entscheide(
      {
        ...kandidat,
        budgetMinutes: kandidat.budgetMinutes === null ? null : Number(kandidat.budgetMinutes),
      },
      jetzt
    );
    if (!aktion) continue;
    try {
      await ausfuehren(ctx, kandidat.id, aktion);
      if (aktion.art === 'erinnerung') lauf.erinnerungen++;
      if (aktion.art === 'stalled') lauf.stalled++;
      if (aktion.art === 'frist') lauf.fristen++;
      if (aktion.art === 'lease') lauf.leases++;
      if (aktion.art === 'lange_laufend') lauf.hinweise++;
    } catch (err) {
      ctx.log.error({ err, task: kandidat.id, art: aktion.art }, 'Watchdog-Aktion fehlgeschlagen');
    }
  }
  return lauf;
}

async function ausfuehren(ctx: Ctx, taskId: string, aktion: WatchdogAction): Promise<void> {
  switch (aktion.art) {
    case 'erinnerung': {
      const task = await store.getTask(taskId);
      const agent = task ? await agentById(task.assignee) : null;
      if (!task?.roomId || !task.threadRoot || !agent) return;
      await sql.begin(async (tx) => {
        // Eine neue Erwähnung im Thread — zählt nicht als Hop (§10.4).
        const [id] = await enqueue(
          tx,
          [
            {
              kind: 'message',
              roomId: task.roomId!,
              taskId: task.id,
              payload: {
                type: 'm.room.message',
                role: 'erinnerung',
                content: text(`@${agent.displayName ?? agent.id} ${task.id} wartet: ${task.goal}`, {
                  mentions: [agent.mxid],
                  thread: task.threadRoot!,
                }),
              },
            },
          ],
          ctx.hub
        );
        void id;
        await store.markNotified(task.id, 'reminded_at', tx);
      });
      ctx.log.info({ task: taskId, ...aktion }, 'Watchdog: Erinnerung geschickt');
      return;
    }

    case 'stalled': {
      const task = await store.getTask(taskId);
      if (!task) return;
      await store.markNotified(taskId, 'reminded_at');
      await zustandUndMeldung(ctx, sql, taskId, 'failed', {
        failReason: `stalled — ${aktion.grund}`,
      });
      // Die Agent Card zeigt `unresponsive` (§8.4); State-Event nur bei Änderung.
      const agent = await agentById(task.assignee);
      if (agent && agent.status !== 'unresponsive') {
        await setStatus(agent.id, 'unresponsive');
        await notify(
          {
            title: `Schwarm: ${agent.id} reagiert nicht`,
            text: `${taskId} ohne 👀 (${aktion.grund}). Agent Card steht auf unresponsive.`,
            priority: 4,
            tags: ['rotating_light'],
          },
          ctx.log
        );
      }
      return;
    }

    case 'lease': {
      const task = await store.getTask(taskId);
      if (!task) return;
      // attempts zählt Wiederholungen, nicht Zustellungen: nach dem ersten
      // Abbruch kommt der Auftrag einmal zurück, dann ist er gescheitert (§10.3).
      const neu = task.attempts + 1 < 2;
      await zustandUndMeldung(ctx, sql, taskId, neu ? 'submitted' : 'failed', {
        ...(neu
          ? { retry: true, note: `${aktion.grund} — Worker hat sich nicht gemeldet, neuer Versuch` }
          : {
              failReason: `${aktion.grund} — Worker hat sich nicht gemeldet, kein weiterer Versuch`,
            }),
      });
      return;
    }

    case 'frist': {
      const task = await store.getTask(taskId);
      if (!task) return;
      const [lobby] = await roomsByKind('lobby');
      await sql.begin(async (tx) => {
        await store.setState(taskId, 'input-required', {}, tx);
        if (lobby?.roomId) {
          await enqueue(
            tx,
            [
              {
                kind: 'message',
                roomId: lobby.roomId,
                taskId,
                payload: {
                  type: 'm.room.message',
                  role: 'rueckmeldung',
                  content: notice(
                    `❓ ${taskId} (${task.assignee}): ${aktion.grund}.\n` +
                      `Verlängern, abbrechen oder weiterlaufen lassen? Antwort hier im Thread oder mit ` +
                      `🛑 auf der Karte abbrechen.`
                  ),
                },
              },
            ],
            ctx.hub
          );
        }
        await store.markNotified(taskId, 'deadline_notified_at', tx);
      });
      return;
    }

    case 'lange_laufend': {
      const task = await store.getTask(taskId);
      const [lobby] = await roomsByKind('lobby');
      await sql.begin(async (tx) => {
        if (lobby?.roomId && task) {
          await enqueue(
            tx,
            [
              {
                kind: 'message',
                roomId: lobby.roomId,
                taskId,
                payload: {
                  type: 'm.room.message',
                  role: 'rueckmeldung',
                  content: notice(`⏳ ${task.assignee} ${aktion.grund} an ${taskId}: ${task.goal}`),
                },
              },
            ],
            ctx.hub
          );
        }
        await store.markNotified(taskId, 'long_run_notified_at', tx);
      });
      return;
    }
  }
}
