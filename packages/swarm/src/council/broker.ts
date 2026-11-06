/**
 * Zugang zum Broker des Rats (§14.3 `council_capability`, E9/§11.4).
 *
 * Brian hat in Matrix-Sitzungen kein Terminal und kein Docker. Infrastruktur
 * läuft deshalb über den Rat: `docker.list`, `docker.inspect`, `docker.logs` und
 * `fs.read` sind grün und kommen sofort zurück; `docker.restart` ist gelb und
 * braucht Vales Freigabe in der Rat-UI. Rote Aktionen sind für Bots tabu
 * (§7.3) — sie brauchen den Bestätigungssatz von einem Menschen.
 *
 * Der Hub reicht nur durch und schwärzt die Ausgabe. Freigabe-Tokens gehen nie
 * über Matrix (§11.4, DoD P3).
 */
import { env } from '../env.js';
import { redact } from '../redact.js';

export interface Aktion {
  id: string;
  capability: string;
  target: string;
  risk: 'green' | 'yellow' | 'red';
  status: string;
  exit_code: number | null;
  output: string | null;
  expires_at: string | null;
}

export interface BrokerAntwort {
  ok: boolean;
  ausgefuehrt: boolean;
  aktion?: Aktion;
  fehler?: string;
  status?: number;
}

function konfiguriert(): string | null {
  if (!env.councilUrl || !env.councilToken)
    return 'Rat nicht konfiguriert (COUNCIL_URL/COUNCIL_TOKEN)';
  return null;
}

function aktionAus(row: Record<string, unknown>): Aktion {
  return {
    id: String(row.id ?? ''),
    capability: String(row.capability ?? ''),
    target: String(row.target ?? ''),
    risk: (row.risk as Aktion['risk']) ?? 'yellow',
    status: String(row.status ?? ''),
    exit_code: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
    output: row.output === null || row.output === undefined ? null : redact(String(row.output)),
    expires_at: (row.expires_at as string | null) ?? null,
  };
}

async function ruf(
  pfad: string,
  init: RequestInit
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${env.councilUrl.replace(/\/$/, '')}${pfad}`, {
    ...init,
    headers: { authorization: `Bearer ${env.councilToken}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

/**
 * Aktion beantragen. Grün kommt sofort mit Ausgabe zurück (200), gelb/rot als
 * `pending` (202) — die Freigabe macht Vale in der Rat-UI.
 */
export async function capabilityAnfragen(o: {
  capability: string;
  target: string;
  args?: Record<string, unknown>;
  reason: string;
  idempotencyKey?: string;
}): Promise<BrokerAntwort> {
  const fehlt = konfiguriert();
  if (fehlt) return { ok: false, ausgefuehrt: false, fehler: fehlt };
  try {
    const { status, body } = await ruf('/api/actions', {
      method: 'POST',
      body: JSON.stringify({
        capability: o.capability,
        target: o.target,
        ...(o.args ? { args: o.args } : {}),
        reason: o.reason,
        ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}),
      }),
    });
    if (status === 200 || status === 202) {
      const action = body.action as Record<string, unknown> | undefined;
      return {
        ok: true,
        ausgefuehrt: Boolean(body.executedNow),
        ...(action ? { aktion: aktionAus(action) } : {}),
        status,
      };
    }
    return {
      ok: false,
      ausgefuehrt: false,
      fehler: redact(String(body.error ?? `Rat lehnte ab (${status})`)),
      status,
    };
  } catch (err) {
    // §10.6: Der Rat ist eine eigene Ausfallstelle — der Hub bleibt brauchbar.
    return {
      ok: false,
      ausgefuehrt: false,
      fehler: `Rat nicht erreichbar: ${(err as Error).message}`,
    };
  }
}

/** Stand einer Freigabe oder einer grünen Aktion nachschlagen. */
export async function aktionHolen(id: string): Promise<BrokerAntwort> {
  const fehlt = konfiguriert();
  if (fehlt) return { ok: false, ausgefuehrt: false, fehler: fehlt };
  try {
    const { status, body } = await ruf(`/api/actions/${encodeURIComponent(id)}`, { method: 'GET' });
    if (status !== 200) {
      return {
        ok: false,
        ausgefuehrt: false,
        fehler: redact(String(body.error ?? `HTTP ${status}`)),
        status,
      };
    }
    const action = body.action as Record<string, unknown> | undefined;
    return {
      ok: true,
      ausgefuehrt: action?.status === 'executed' || action?.status === 'approved',
      ...(action ? { aktion: aktionAus(action) } : {}),
      status,
    };
  } catch (err) {
    return {
      ok: false,
      ausgefuehrt: false,
      fehler: `Rat nicht erreichbar: ${(err as Error).message}`,
    };
  }
}

/** Liste der Fähigkeiten — damit ein Agent nicht raten muss, was es gibt. */
export async function capabilitiesHolen(): Promise<
  { name: string; risk: string; description: string }[]
> {
  const fehlt = konfiguriert();
  if (fehlt) return [];
  try {
    const { status, body } = await ruf('/api/capabilities', { method: 'GET' });
    if (status !== 200) return [];
    const liste = (body.capabilities ?? []) as Record<string, unknown>[];
    return liste.map((c) => ({
      name: String(c.name ?? ''),
      risk: String(c.risk ?? ''),
      description: String(c.description ?? ''),
    }));
  } catch {
    return [];
  }
}
