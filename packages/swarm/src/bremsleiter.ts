/**
 * Bremsleiter, Stufe 1 (§12.5, ADR-002 §4.1): Der Hub schickt `/stop` an den Bot
 * und erwartet „⚡ Stopped." als Bestätigung. Bleibt sie aus, schreibt er einmal
 * deutlich nach — „Abgebrochen, bitte aufhören". Stellt der Bot das nicht ein,
 * kommen die Stufen 2–4 (`!stop @agent`, `brian-restarter`, Container stoppen);
 * die liegen bei dir, nicht beim Hub.
 *
 * Die Nachfass-Nachricht liegt von Anfang an in der Outbox, aber `held`: Sie
 * geht nur raus, wenn die Bestätigung wirklich fehlt. So braucht es keinen
 * zweiten Weg und keine Uhr im Speicher.
 */
import { sql } from './db/index.js';
import { clearFlag, getFlag, setFlag } from './db/audit.js';
import type { Ctx } from './context.js';
import { env } from './env.js';

export function stopFlag(taskId: string): string {
  return `stop-ok:${taskId}`;
}

/** Der Bot hat den Abbruch bestätigt (§4.1: „⚡ Stopped. You can continue this session.“). */
export function istStopBestaetigung(body: string): boolean {
  return body.trim().startsWith('⚡ Stopped');
}

export async function stopBestaetigt(ctx: Ctx, taskId: string): Promise<void> {
  await setFlag(stopFlag(taskId), { at: new Date().toISOString() }, 'hub');
  // Die Nachfass-Nachricht ist überflüssig und wird verworfen.
  await sql`
    UPDATE swarm.outbox SET dead = true, last_error = 'abgebrochen'
    WHERE task_id = ${taskId} AND held AND sent_event_id IS NULL
      AND payload->>'stufe' = '2'`;
  ctx.log.info({ task: taskId }, 'Abbruch vom Bot bestätigt — keine Nachfass-Nachricht');
}

/**
 * Alle paar Sekunden: Nachfass-Nachrichten freigeben, deren Bestätigung aussteht.
 * Ältere Flags räumt er weg, damit `swarm.flags` nicht wächst.
 */
export async function runBremsleiter(ctx: Ctx): Promise<number> {
  const kandidaten = (await sql`
    SELECT id, task_id, created_at FROM swarm.outbox
    WHERE held AND sent_event_id IS NULL AND NOT dead AND payload->>'stufe' = '2'
      AND created_at < now() - make_interval(secs => ${env.stopEscalationSeconds})
    ORDER BY id LIMIT 20`) as unknown as {
    id: number;
    task_id: string | null;
    created_at: string;
  }[];

  let freigaben = 0;
  for (const zeile of kandidaten) {
    if (!zeile.task_id) continue;
    // Nach einem langen Stillstand des Hubs wäre „bitte aufhören" nur Lärm:
    // Nach 10 Minuten ist der Abbruch entweder durch oder erledigt sich anders.
    const alter = (Date.now() - new Date(zeile.created_at).getTime()) / 60_000;
    if (alter > env.stopEscalationMaxMinutes) {
      await sql`UPDATE swarm.outbox SET dead = true, last_error = 'abgebrochen' WHERE id = ${zeile.id}`;
      await clearFlag(stopFlag(zeile.task_id));
      continue;
    }
    const [task] = await sql`SELECT state FROM swarm.tasks WHERE id = ${zeile.task_id}`;
    if (task?.state !== 'canceled') {
      // Der Auftrag lebt wieder (etwa nach 🔁) — die Nachricht wäre falsch.
      await sql`UPDATE swarm.outbox SET dead = true, last_error = 'abgebrochen' WHERE id = ${zeile.id}`;
      continue;
    }
    if (await getFlag(stopFlag(zeile.task_id))) {
      await sql`UPDATE swarm.outbox SET dead = true, last_error = 'abgebrochen' WHERE id = ${zeile.id}`;
      await clearFlag(stopFlag(zeile.task_id));
      continue;
    }
    await sql`UPDATE swarm.outbox SET held = false WHERE id = ${zeile.id}`;
    freigaben++;
    ctx.log.warn(
      { task: zeile.task_id, sekunden: env.stopEscalationSeconds },
      'Abbruch nicht bestätigt — Stufe 1 fasst nach'
    );
  }
  return freigaben;
}
