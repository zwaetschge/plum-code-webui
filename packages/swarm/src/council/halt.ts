/**
 * Kill-Switch zum Rat (§9.7, §10.6). Zwei Schritte, in dieser Reihenfolge:
 *  1. Der Hub friert sich selbst ein — das wirkt sofort und braucht niemanden.
 *  2. `POST /api/council/kill` an den Rat (Token mit `council:halt`). Klappt das
 *     nicht, bleibt der Aufruf in `swarm.council_queue` und wird wiederholt, bis
 *     er durchgeht.
 *
 * Fortsetzen kann der Hub nie: `/council/resume` bleibt Menschen vorbehalten.
 */
import { sql, type Db } from '../db/index.js';
import { env } from '../env.js';
import type { Ctx } from '../context.js';

export async function queueHalt(tx: Db, via: { sender: string; eventId: string }): Promise<void> {
  // Lieber einmal zu viel eingereiht als ein verlorener Not-Aus: Ein doppelter
  // Eintrag ruft den Rat zweimal an, was `freeze()` nichts ausmacht.
  const [offen] = await tx`
    SELECT id FROM swarm.council_queue WHERE kind = 'halt' AND done_at IS NULL LIMIT 1`;
  if (offen) return;
  await tx`
    INSERT INTO swarm.council_queue (kind, payload)
    VALUES ('halt', ${tx.json({ via: 'schwarm', sender: via.sender, event_id: via.eventId })})`;
}

export async function drainCouncilQueue(
  ctx: Ctx,
  limit = 5
): Promise<{ done: number; failed: number }> {
  if (!env.councilUrl || !env.councilToken) return { done: 0, failed: 0 };
  const rows = await sql`
    SELECT id, kind, payload, attempts FROM swarm.council_queue
    WHERE done_at IS NULL AND next_try <= now()
    ORDER BY id LIMIT ${limit}
    FOR UPDATE SKIP LOCKED`;

  let done = 0;
  let failed = 0;
  for (const row of rows as unknown as {
    id: number;
    kind: string;
    payload: unknown;
    attempts: number;
  }[]) {
    const pfad = row.kind === 'halt' ? '/api/council/kill' : null;
    if (!pfad) {
      await sql`UPDATE swarm.council_queue SET done_at = now(), last_error = 'unbekannte Art' WHERE id = ${row.id}`;
      done++;
      continue;
    }
    try {
      const res = await fetch(`${env.councilUrl.replace(/\/$/, '')}${pfad}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.councilToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(row.payload ?? {}),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await sql`UPDATE swarm.council_queue SET done_at = now(), attempts = attempts + 1 WHERE id = ${row.id}`;
        done++;
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      const meldung = err instanceof Error ? err.message : String(err);
      // Backoff bis 10 min; aufgeben tut die Warteschlange nicht — ein Not-Aus
      // muss durchkommen, sobald der Rat wieder da ist (§10.6).
      await sql`
        UPDATE swarm.council_queue
        SET attempts = attempts + 1, last_error = ${meldung},
            next_try = now() + LEAST(interval '10 minutes', interval '5 seconds' * power(2, attempts))
        WHERE id = ${row.id}`;
      failed++;
      ctx.log.warn(
        { err: meldung, art: row.kind },
        'Rat-Aufruf fehlgeschlagen, bleibt in der Warteschlange'
      );
    }
  }
  return { done, failed };
}
