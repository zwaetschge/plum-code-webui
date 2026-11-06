/**
 * Tageslauf (§10.4, §10.5): nächtlicher Abgleich um 03:45 (nach der Sicherung
 * des Rats um 03:15) und der Kanarienvogel um 07:25, kurz vor der
 * Tagesübersicht um 07:30. Beide merken sich den Tag in `swarm.flags`, also
 * laufen sie genau einmal — und erst, wenn sie vollständig durchgelaufen sind.
 */
import { getFlag, setFlag } from './db/audit.js';
import { listAgents, roomsByKind } from './agents/store.js';
import { notify } from './notify.js';
import type { Ctx } from './context.js';
import { createTaskFlow } from './tasks/create.js';
import { reconcile } from './reconcile.js';
import { sql } from './db/index.js';
import { enqueue } from './outbox.js';
import { notice } from './appservice/messages.js';
import { uebersichtDaten, uebersichtText } from './tagesuebersicht.js';
import { verbundeneWorker } from './worker/server.js';
import { tuersteherZeile } from './tuersteher.js';

/**
 * Das Präfix „Selbsttest:“ ist ein Vertrag: `transition.ts` misst daran die Durchlaufzeit, und das
 * Backend des Hermes Phone unterdrückt daran seine Benachrichtigungen (Phone-Session, 2026-09-26).
 * Ändert es sich, summt Vales Phone jeden Morgen um 07:25. Der Unit-Test hält es fest.
 */
export const SELBSTTEST_ZIEL = 'Selbsttest: antworte nur mit OK';

/** Datum in Europa/Zürich — der Tag, an dem Vance die Übersicht liest. */
function heute(): string {
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .split('.')
    .reverse()
    .join('-');
}

function stundeMinute(): { stunde: number; minute: number } {
  const teile = new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date())
    .split(':');
  return { stunde: Number(teile[0]), minute: Number(teile[1] ?? 0) };
}

async function schonGelaufen(name: string): Promise<boolean> {
  const flag = await getFlag<{ tag?: string }>(name);
  return flag?.tag === heute();
}

export async function runSchedule(ctx: Ctx): Promise<void> {
  const { stunde, minute } = stundeMinute();

  // Nächtlicher Abgleich ab 03:45 (§10.4).
  if (stunde >= 3 && !(await schonGelaufen('abgleich-tag'))) {
    try {
      const r = await reconcile(ctx);
      await setFlag('abgleich-tag', { tag: heute(), ...r }, 'hub');
    } catch (err) {
      ctx.log.error({ err }, 'Abgleich fehlgeschlagen — nächster Takt versucht es erneut');
    }
  }

  // Kanarienvogel ab 07:25 (§10.5): ein Testauftrag pro erreichbarem Agenten.
  if ((stunde > 7 || (stunde === 7 && minute >= 25)) && !(await schonGelaufen('kanari'))) {
    try {
      const r = await canary(ctx);
      await setFlag('kanari', { tag: heute(), ...r }, 'hub');
      if (r.fehlgeschlagen > 0) {
        await notify(
          {
            title: 'Schwarm: Kanarienvogel fehlgeschlagen',
            text: `${r.fehlgeschlagen} von ${r.gestartet} Testaufträgen kamen nicht durch: ${r.nichtGestartet.join(', ') || '—'}`,
            priority: 4,
            tags: ['rotating_light'],
          },
          ctx.log
        );
      }
    } catch (err) {
      ctx.log.error({ err }, 'Kanarienvogel fehlgeschlagen — nächster Takt versucht es erneut');
    }
  }

  // Tagesübersicht ab 07:30 (§9.1), nach dem Kanarienvogel. Nach 12:00 lohnt sie sich
  // nicht mehr; startet der Hub erst am Nachmittag, fällt sie für diesen Tag aus.
  if (
    (stunde > 7 || (stunde === 7 && minute >= 30)) &&
    stunde < 12 &&
    !(await schonGelaufen('uebersicht'))
  ) {
    try {
      const [lobby] = await roomsByKind('lobby');
      if (lobby?.roomId) {
        await enqueue(
          sql,
          [
            {
              kind: 'message',
              roomId: lobby.roomId,
              // Die Türsteher-Zeile (matrix/PLAN-weiter.md, Punkt 4) hängt unten an, wenn der Stand lesbar ist.
              payload: {
                type: 'm.room.message',
                content: notice(
                  [uebersichtText(await uebersichtDaten(), heute()), await tuersteherZeile()]
                    .filter(Boolean)
                    .join('\n')
                ),
              },
            },
          ],
          ctx.hub
        );
      }
      await setFlag('uebersicht', { tag: heute() }, 'hub');
    } catch (err) {
      ctx.log.error({ err }, 'Tagesübersicht fehlgeschlagen — nächster Takt versucht es erneut');
    }
  }
}

/**
 * Wer am Kanarienvogel teilnimmt (§10.5). Melder (L0/`notify`) nehmen nie
 * Aufträge an und haben keinen Arbeitsraum — sie mitzuprüfen gäbe jeden Morgen
 * einen Fehlalarm. Ebenso Agenten ohne Raum und eingefrorene.
 *
 * Seit ADR-003 auch nicht: der Rat (`council`), der nur über `!rat` tagt, und
 * Worker ohne offene Verbindung (mit `verbunden`). Nie verbundene warten auf
 * eine Anmeldung, weggefallene meldet der Hub selbst (`worker-weg:<agent>`).
 */
export function kanariKandidaten<
  T extends {
    id?: string;
    level: string;
    mode: string;
    status: string;
    frozen: boolean;
    roomId: string | null;
  },
>(agenten: T[], verbunden?: Set<string>): T[] {
  return agenten.filter(
    (a) =>
      a.mode !== 'notify' &&
      a.mode !== 'council' &&
      a.level !== 'L0' &&
      a.status !== 'offline' &&
      !a.frozen &&
      Boolean(a.roomId) &&
      (a.mode !== 'worker' || !verbunden || verbunden.has(String(a.id)))
  );
}

/**
 * Was ein Selbsttest an den Agenten schickt. Der Betrieb nimmt nur geprüfte Aktionen an
 * (ADR-003 R2); „antworte mit OK“ lehnte er ab, und das gäbe jeden Morgen einen Fehlschlag.
 * Er bekommt deshalb eine grüne Aktion, die den ganzen Weg bis zum Docker-Proxy prüft.
 */
export function selbsttestAuftrag(agentId: string): {
  goal: string;
  deliverable: string;
  betriebSpec?: string;
} {
  if (agentId === 'betrieb') {
    return {
      goal: 'Selbsttest: docker.list council-matrix',
      deliverable: 'Containerliste',
      betriebSpec: JSON.stringify({
        capability: 'docker.list',
        target: 'council-matrix',
        args: {},
      }),
    };
  }
  return { goal: SELBSTTEST_ZIEL, deliverable: 'das Wort OK, sonst nichts' };
}

/** Ein `!selbsttest` für alle erreichbaren Agenten (§10.5). */
export async function canary(
  ctx: Ctx
): Promise<{ gestartet: number; fehlgeschlagen: number; nichtGestartet: string[] }> {
  const [lobby] = await roomsByKind('lobby');
  const agenten = kanariKandidaten(await listAgents(), verbundeneWorker());
  const nichtGestartet: string[] = [];
  let gestartet = 0;
  if (agenten.length === 0) {
    ctx.log.info('Kanarienvogel: kein Agent kann gerade Aufträge annehmen');
    return { gestartet: 0, fehlgeschlagen: 0, nichtGestartet: [] };
  }

  for (const a of agenten) {
    const ergebnis = await createTaskFlow(ctx, {
      ...selbsttestAuftrag(a.id),
      assignee: a.id,
      from: ctx.owner,
      originRoom: lobby?.roomId ?? '',
      idempotencyKey: `kanari-${heute()}-${a.id}`,
      budgetUsd: 0.05,
      budgetMinutes: 5,
    });
    if (ergebnis.ok) gestartet++;
    else nichtGestartet.push(`${a.id} (${ergebnis.code})`);
  }
  ctx.log.info({ gestartet, nichtGestartet }, 'Kanarienvogel');
  return { gestartet, fehlgeschlagen: nichtGestartet.length, nichtGestartet };
}
