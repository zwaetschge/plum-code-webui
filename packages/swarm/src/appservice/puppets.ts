/**
 * Puppets (§7.1): Der Hub tritt als `@_sw_<agent>` auf — für Worker, Melder und
 * Agenten ohne eigenes Matrix-Konto. Synapse lässt einen Appservice aber nur als
 * Nutzer auftreten, die er vorher registriert hat (403 „Application service has
 * not registered this user", `synapse/api/auth/base.py`), und in einen Raum mit
 * `join_rule: invite` kommt auch ein Puppet nur mit Einladung.
 *
 * `ensurePuppet` erledigt beides und ist idempotent: registrieren
 * (`M_USER_IN_USE` zählt als Erfolg), als Hub einladen, als Puppet beitreten.
 * Was einmal geklappt hat, merkt sich der Prozess; nach einem Neustart fragt er
 * Synapse erneut, was dort nichts kostet.
 */
import { env } from '../env.js';
import type { Ctx } from '../context.js';

const registriert = new Set<string>();
const imRaum = new Set<string>();

/** Nur der eigene Namensraum — alles andere gehört nicht dem Hub (§7.1). */
export function istPuppet(mxid: string): boolean {
  return mxid.startsWith('@_sw_') && mxid.endsWith(`:${env.domain}`);
}

export async function registerPuppet(ctx: Ctx, mxid: string): Promise<boolean> {
  if (registriert.has(mxid)) return true;
  if (!istPuppet(mxid)) return false;
  const localpart = mxid.slice(1, mxid.indexOf(':'));
  try {
    const res = await fetch(`${env.homeserverUrl.replace(/\/$/, '')}/_matrix/client/v3/register`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.asToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'm.login.application_service',
        username: localpart,
        inhibit_login: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { errcode?: string };
    if (res.ok || body.errcode === 'M_USER_IN_USE') {
      registriert.add(mxid);
      return true;
    }
    ctx.log.warn(
      { puppet: mxid, status: res.status, errcode: body.errcode },
      'Puppet nicht registriert'
    );
    return false;
  } catch (err) {
    ctx.log.warn({ puppet: mxid, err }, 'Puppet-Registrierung fehlgeschlagen');
    return false;
  }
}

/** Registrieren und, wenn ein Raum genannt ist, dort Mitglied werden. */
export async function ensurePuppet(
  ctx: Ctx,
  mxid: string,
  roomId?: string | null
): Promise<boolean> {
  if (!(await registerPuppet(ctx, mxid))) return false;
  if (!roomId) return true;
  const schluessel = `${mxid}|${roomId}`;
  if (imRaum.has(schluessel)) return true;
  // Die Einladung darf scheitern (schon eingeladen oder schon drin) — der
  // Beitritt entscheidet, und der ist für ein Mitglied ein No-op mit 200.
  await ctx.matrix.invite(roomId, mxid);
  const drin = await ctx.matrix.joinRoom(roomId, mxid);
  if (drin) imRaum.add(schluessel);
  else ctx.log.warn({ puppet: mxid, room: roomId }, 'Puppet konnte dem Raum nicht beitreten');
  return drin;
}

/**
 * Beim Start: jeden Agenten mit Puppet-MXID registrieren und in seinen Raum
 * holen. Vor `bootstrapRooms` aufgerufen, damit die Einladung beim Anlegen
 * eines neuen Raums nicht an einem unbekannten Nutzer scheitert; danach noch
 * einmal mit den Räumen.
 */
export async function ensurePuppets(
  ctx: Ctx,
  agenten: { id: string; mxid: string; roomId: string | null }[]
): Promise<{ ok: string[]; failed: string[] }> {
  const ergebnis = { ok: [] as string[], failed: [] as string[] };
  for (const a of agenten) {
    if (!istPuppet(a.mxid)) continue;
    ((await ensurePuppet(ctx, a.mxid, a.roomId)) ? ergebnis.ok : ergebnis.failed).push(a.id);
  }
  return ergebnis;
}
