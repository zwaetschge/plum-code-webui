/**
 * /health (§10.5): meldet 503, sobald etwas klemmt — Datenbank, Ping zu Synapse,
 * Outbox-Stau, liegengebliebene Inbox. Der Docker-Healthcheck hängt daran.
 */
import { sql } from './db/index.js';
import { backlog } from './outbox.js';
import { inboxLag, lastTransactionAge } from './appservice/transactions.js';
import { auditRueckstand, getFlag, isSwarmFrozen } from './db/audit.js';
import { listAgents } from './agents/store.js';
import { verbundeneWorker } from './worker/server.js';
import { env } from './env.js';

export interface PingState {
  ok: boolean;
  ms: number;
  at: number;
  failures: number;
}

let ping: PingState = { ok: false, ms: 0, at: 0, failures: 0 };

export function setPingState(next: PingState): void {
  ping = next;
}

export function getPingState(): PingState {
  return ping;
}

export interface HealthReport {
  ok: boolean;
  code: 200 | 503;
  body: Record<string, unknown>;
}

export async function healthReport(): Promise<HealthReport> {
  const probleme: string[] = [];

  let db = false;
  try {
    await sql`SELECT 1`;
    db = true;
  } catch {
    probleme.push('datenbank');
  }

  if (ping.failures >= 3) probleme.push('synapse-ping');

  let outbox = { pending: 0, dead: 0, oldestMinutes: null as number | null };
  let inbox = { pending: 0, dead: 0, oldestMinutes: null as number | null };
  let letzteTransaktion: number | null = null;
  let frozen = false;
  let offeneAuftraege = 0;

  if (db) {
    outbox = await backlog();
    inbox = await inboxLag();
    letzteTransaktion = await lastTransactionAge();
    frozen = await isSwarmFrozen();
    const [row] = await sql`
      SELECT count(*)::int AS n FROM swarm.tasks
      WHERE state IN ('submitted','working','input-required','auth-required')`;
    offeneAuftraege = Number(row?.n ?? 0);
    if (outbox.pending > env.outboxAlarm) probleme.push('outbox-rueckstand');
    if (outbox.dead > 0) probleme.push('dead-letter-outbox');
    if (inbox.dead > 0) probleme.push('dead-letter-inbox');
    if (inbox.oldestMinutes !== null && inbox.oldestMinutes > env.inboxAlarmMinutes)
      probleme.push('inbox-lag');
  }

  // Betriebszahlen für Brians Tagesstand und den Wächter (§4.40): was wartet,
  // wer fehlt, was der Tag kostet. Read-only und in einem eigenen try —
  // /health muss auch antworten, wenn hier etwas klemmt.
  let betrieb: Record<string, unknown> = {};
  if (db) {
    try {
      const [frei] = await sql`
        SELECT count(*)::int AS n,
               min(extract(epoch FROM (now() - updated_at)) / 60)::int AS aelteste
        FROM swarm.tasks WHERE state = 'auth-required'`;
      const agenten = await listAgents();
      const verbunden = verbundeneWorker();
      const worker = agenten.filter((a) => a.mode === 'worker');
      const [kosten] = await sql`
        SELECT coalesce(sum(cost_usd), 0)::float8 AS heute FROM swarm.tasks
        WHERE created_at >= date_trunc('day', now())`;
      const jeAgent = await sql`
        SELECT assignee, coalesce(sum(cost_usd), 0)::float8 AS heute FROM swarm.tasks
        WHERE created_at >= date_trunc('day', now()) GROUP BY assignee`;
      const verbraucht = Object.fromEntries(
        jeAgent.map((z) => [String(z.assignee), Number(z.heute)])
      );
      const kanari = await getFlag<{
        tag?: string;
        gestartet?: number;
        fehlgeschlagen?: number;
        nichtGestartet?: string[];
      }>('kanari');
      // Was in den letzten 24 h gescheitert ist — Brians Wächter meldet es in Vales
      // DM-Raum (§4.42). Ohne das erfährt niemand von einem Auftrag, der verhungert ist.
      const fehl = await sql`
        SELECT id, state, left(coalesce(fail_reason, ''), 160) AS grund, updated_at, room_id, thread_root
        FROM swarm.tasks
        WHERE state IN ('failed', 'canceled', 'rejected')
          AND updated_at >= now() - interval '24 hours'
        ORDER BY updated_at DESC LIMIT 5`;
      // Offene Freigaben mit Alter und Thread, damit eine Erinnerung einen Permalink
      // bauen kann — eine Zahl allein nützt Vale nichts, wenn er den Raum nicht offen hat.
      const offeneFreigaben = await sql`
        SELECT t.id, t.goal, t.room_id, t.thread_root,
               (SELECT max(m.created_at) FROM swarm.matrix_map m WHERE m.task_id = t.id AND m.role = 'freigabe') AS gesendet
        FROM swarm.tasks t WHERE t.state = 'auth-required'
        ORDER BY t.created_at LIMIT 3`;
      betrieb = {
        freigaben: {
          pending: Number(frei?.n ?? 0),
          oldest_minutes: frei?.aelteste ?? null,
          offen: offeneFreigaben.map((z) => ({
            task: String(z.id),
            ziel: String(z.goal ?? '').slice(0, 90),
            minuten: z.gesendet
              ? Math.round((Date.now() - new Date(z.gesendet as string).getTime()) / 60_000)
              : null,
            raum: z.room_id ?? null,
            thread: z.thread_root ?? null,
          })),
        },
        fehlschlaege: fehl.map((z) => ({
          task: String(z.id),
          state: String(z.state),
          grund: String(z.grund ?? ''),
          at: new Date(z.updated_at as string).toISOString(),
          raum: z.room_id ?? null,
          thread: z.thread_root ?? null,
        })),
        worker: {
          verbunden: worker.filter((a) => a.id && verbunden.has(a.id)).map((a) => a.id),
          offline: worker.filter((a) => !verbunden.has(a.id)).map((a) => a.id),
        },
        kanari: kanari
          ? {
              tag: kanari.tag ?? null,
              gestartet: kanari.gestartet ?? 0,
              fehlgeschlagen: kanari.fehlgeschlagen ?? 0,
              nicht_gestartet: kanari.nichtGestartet ?? [],
            }
          : null,
        kosten_heute_usd: Math.round(Number(kosten?.heute ?? 0) * 10000) / 10000,
        // Je Agent, nicht als Summe: Eine Gesamtzahl über alle Budgets ist irreführend —
        // blockiert wird pro Agent (policy.ts:94), und genau das soll man sehen.
        budget: agenten
          .filter((a) => a.budgetUsdDay !== null)
          .map((a) => {
            const heute = Math.round((verbraucht[a.id] ?? 0) * 10000) / 10000;
            const limit = Number(a.budgetUsdDay);
            return {
              agent: a.id,
              heute,
              limit,
              prozent: limit > 0 ? Math.round((heute / limit) * 100) : 0,
            };
          }),
      };
    } catch {
      /* /health antwortet auch ohne Betriebszahlen */
    }
  }

  // Räume mit ihren IDs: Brian prüft damit seine eigene Allowlist (ADR-002 §4.33).
  // MATRIX_ALLOWED_ROOMS wird bei Hermes nur beim Start gelesen — driftet sie,
  // ignoriert er Karten still. Kein Geheimnis: Raum-IDs stehen in Matrix, und /health ist nur im Cluster erreichbar.
  let raeume: Record<string, string> = {};
  try {
    const zeilen =
      await sql`SELECT alias, room_id FROM swarm.rooms WHERE room_id IS NOT NULL ORDER BY alias`;
    raeume = Object.fromEntries(zeilen.map((z) => [String(z.alias), String(z.room_id)]));
  } catch {
    /* /health antwortet auch ohne Räume */
  }

  const body = {
    ok: probleme.length === 0,
    db,
    synapse: {
      ok: ping.ok,
      ping_ms: ping.ms,
      failures: ping.failures,
      age_seconds: ping.at ? Math.round((Date.now() - ping.at) / 1000) : null,
    },
    outbox,
    inbox,
    last_transaction_seconds: letzteTransaktion,
    frozen,
    open_tasks: offeneAuftraege,
    audit_pending: auditRueckstand(),
    ...(Object.keys(betrieb).length ? { betrieb } : {}),
    rooms: raeume,
    ...(probleme.length ? { problems: probleme } : {}),
  };
  return { ok: probleme.length === 0, code: probleme.length === 0 ? 200 : 503, body };
}
