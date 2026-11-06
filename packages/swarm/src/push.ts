/**
 * Sofort-Benachrichtigungen (Verbesserung 1, App 2.5). Bisher schaute die App im Hintergrund alle 15 min nach.
 * Jetzt meldet sie einmal eine UnifiedPush-Adresse an (signiert über den Not-Aus-Kanal, `aktion: push`), und der
 * Hub weckt sie, sobald etwas für Vale ansteht: Freigaben, Rückfragen, Pläne, Tore, Ergebnisse, Alarme,
 * Erwähnungen, Tages- und Morgenbericht.
 *
 * Die Weckmeldung trägt keinen Inhalt („schwarm“), nur den Anstoss. Was neu ist, holt die App selbst über Matrix,
 * mit ihrem bestehenden Hintergrund-Check. So verlässt nichts aus dem Schwarm den Server über den Push-Dienst.
 * Höchstens eine Weckmeldung alle 8 s; kommt in der Zeit mehr, folgt genau eine am Ende.
 *
 * Adressen nur über HTTPS und nur auf erlaubten Hosts (`PUSH_HOSTS`, Standard: der eigene ntfy und ntfy.sh). Auf dem
 * eigenen ntfy (NTFY_URL) schickt der Hub sein Token mit, denn dort gilt „deny-all“. 404 oder 410 heisst: Die
 * Adresse gibt es nicht mehr, der Hub vergisst sie.
 */
import { sql, type Db } from './db/index.js';
import { env } from './env.js';
import type { Ctx } from './context.js';
import { ruheHaelt, ruheTakt } from './ruhe.js';

const ABSTAND_MS = Number(process.env.PUSH_ABSTAND_MS || 8_000);
const HOSTS = (process.env.PUSH_HOSTS || `${hostVon(env.ntfyUrl) ?? ''},ntfy.sh`)
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const HTTP_ERLAUBT = process.env.PUSH_HTTP_ERLAUBT === '1';

function hostVon(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Eine Push-Adresse prüfen; liefert sie zurück oder den Grund der Ablehnung. */
export function adressePruefen(roh: string): { url: string } | { fehler: string } {
  if (roh.length > 1000) return { fehler: 'Adresse zu lang' };
  let u: URL;
  try {
    u = new URL(roh);
  } catch {
    return { fehler: 'keine gültige Adresse' };
  }
  if (u.protocol !== 'https:' && !(HTTP_ERLAUBT && u.protocol === 'http:'))
    return { fehler: 'nur HTTPS' };
  if (u.username || u.password) return { fehler: 'ohne Zugangsdaten in der Adresse' };
  if (!HOSTS.includes(u.hostname.toLowerCase()))
    return { fehler: `Host ${u.hostname} ist nicht erlaubt (erlaubt: ${HOSTS.join(', ')})` };
  return { url: u.toString() };
}

let letzte = 0;
let geplant: NodeJS.Timeout | null = null;

/** Die App wecken, gedrosselt. `grund` steht nur im Log. */
export function wecken(ctx: Ctx, grund: string): void {
  const jetzt = Date.now();
  if (jetzt - letzte >= ABSTAND_MS && !geplant) {
    letzte = jetzt;
    void allenSenden(ctx, grund);
    return;
  }
  if (geplant) return;
  geplant = setTimeout(
    () => {
      geplant = null;
      letzte = Date.now();
      void allenSenden(ctx, `${grund} (gesammelt)`);
    },
    Math.max(0, ABSTAND_MS - (jetzt - letzte))
  );
  geplant.unref?.();
}

async function allenSenden(ctx: Ctx, grund: string): Promise<void> {
  try {
    const geraete =
      await sql`SELECT id, push_endpoint FROM swarm.notaus_geraete WHERE widerrufen IS NULL AND push_endpoint IS NOT NULL`;
    for (const g of geraete) await senden(ctx, String(g.id), String(g.push_endpoint), grund);
  } catch (err) {
    ctx.log.warn({ err }, 'Push: Geräte nicht lesbar');
  }
}

/** Eine Weckmeldung an ein Gerät; hält Erfolg und Fehler am Gerät fest. Liefert den HTTP-Status (0 = kein Netz). */
export async function senden(
  ctx: Ctx,
  geraet: string,
  endpoint: string,
  grund: string,
  db: Db = sql
): Promise<number> {
  const eigen = hostVon(endpoint) !== null && hostVon(endpoint) === hostVon(env.ntfyUrl);
  let status = 0;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ttl: '3600',
        urgency: 'high',
        'content-type': 'text/plain',
        ...(eigen && env.ntfyToken ? { authorization: `Bearer ${env.ntfyToken}` } : {}),
      },
      body: 'schwarm',
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
  } catch (err) {
    ctx.log.warn({ geraet, err: (err as Error).message }, 'Push: Dienst nicht erreicht');
  }
  if (status >= 200 && status < 300) {
    await db`UPDATE swarm.notaus_geraete SET push_ok = now(), push_fehler = NULL WHERE id = ${geraet}`;
  } else if (status === 404 || status === 410) {
    // Die App hat sich beim Push-Dienst abgemeldet oder die Adresse gewechselt.
    await db`UPDATE swarm.notaus_geraete SET push_endpoint = NULL, push_fehler = ${`Adresse weg (${status})`} WHERE id = ${geraet}`;
  } else {
    const text =
      status === 0
        ? 'Push-Dienst nicht erreicht'
        : status === 401 || status === 403
          ? `Push-Dienst verweigert (${status}), auf dem eigenen ntfy fehlt wohl die Freigabe für up*`
          : `Push-Dienst antwortet ${status}`;
    await db`UPDATE swarm.notaus_geraete SET push_fehler = ${text} WHERE id = ${geraet}`;
    ctx.log.warn({ geraet, status, grund }, 'Push: nicht zugestellt');
  }
  return status;
}

/** Was eine Nachricht des Hubs wert ist: Weckt sie die App? Wie `einordnen()` in der App (Hintergrund.kt). */
export function weckt(art: string, body: string, erwaehntVale: boolean): boolean {
  const erste = body.trimStart();
  if (erwaehntVale) return true;
  if (art === 'lobby') return /^(❓|🚦|🔐|✅|❌|↩️|🚫|☀️|🌙|⛔|▶️)/u.test(erste);
  if (art === 'approvals' || art === 'freigaben') return /^🔐/u.test(erste);
  if (art === 'alerts') return /^(🚨|⚠️|⬆️)/u.test(erste);
  return false;
}

let raumCache: { bis: number; arten: Map<string, string> } = { bis: 0, arten: new Map() };

/** Raum-ID → Art (lobby, approvals, alerts, log, agent …), fünf Minuten zwischengespeichert. */
export async function raumArt(roomId: string, db: Db = sql): Promise<string | null> {
  if (Date.now() > raumCache.bis) {
    const zeilen = await db`SELECT room_id, kind FROM swarm.rooms WHERE room_id IS NOT NULL`;
    raumCache = {
      bis: Date.now() + 5 * 60_000,
      arten: new Map(zeilen.map((z) => [String(z.room_id), String(z.kind)])),
    };
  }
  return raumCache.arten.get(roomId) ?? null;
}

/** Nach dem Senden einer Nachricht aus der Outbox. */
export async function nachDemSenden(ctx: Ctx, roomId: string, payload: unknown): Promise<void> {
  const p = payload as { type?: string; content?: Record<string, unknown> } | null;
  if (p?.type !== 'm.room.message') return;
  const body = typeof p.content?.body === 'string' ? p.content.body : '';
  const erwaehnt =
    Array.isArray((p.content?.['m.mentions'] as { user_ids?: unknown } | undefined)?.user_ids) &&
    (p.content?.['m.mentions'] as { user_ids: unknown[] }).user_ids.includes(ctx.owner);
  const art = await raumArt(roomId);
  if (!art || !weckt(art, body, erwaehnt)) return;
  // Ruhezeiten (App 2.9): nachts nur Dringendes, der Rest weckt einmal am Ende der Ruhezeit (pushTakt).
  if (await ruheHaelt(art, body)) return;
  wecken(ctx, `${art}: ${body.slice(0, 40)}`);
}

/** Takt (weiter.ts): Ruhezeit-Event und das Wecken nach der Ruhezeit. */
export async function pushTakt(ctx: Ctx): Promise<boolean> {
  return ruheTakt(ctx, (grund) => wecken(ctx, grund));
}
