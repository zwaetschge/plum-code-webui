/**
 * L0-Webhook (§14.5): Melder schreiben nicht selbst nach Matrix, sie schicken
 * dem Hub eine Meldung. Der Hub postet sie als Notice in `#schwarm-alarme`, als
 * Puppet der Quelle, und bei `crit` zusätzlich an ntfy.
 *
 *   POST /hooks/notify
 *   Authorization: Bearer <Token mit Zweck notify>
 *   { "level": "info|warn|crit", "title": "…", "text": "…", "link": "https://…" }
 *
 * Die Quelle ist der Agent des Tokens, nicht ein Feld im Körper: Ein Melder kann
 * sich nicht als ein anderer ausgeben. Ein mitgeschicktes `source` muss dazu
 * passen. Grenzen: 30 Meldungen pro Minute und Quelle, dieselbe Meldung binnen
 * 5 min nur einmal. Erreichbar nur intern (kein Traefik-Label, §15.8).
 *
 * Mit `fingerprint` (und `resolved: true` zur Entwarnung) wird die Meldung ein Alarm mit
 * Lebenslauf: einmal melden, Wiederholungen zählen, schlimmer und behoben im Thread (`alarme.ts`).
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyToken, widerrufenVon } from '../tokens.js';
import { agentById, roomByRoomId, roomsByKind } from '../agents/store.js';
import { notice } from '../appservice/messages.js';
import { ensurePuppet, istPuppet } from '../appservice/puppets.js';
import { enqueue } from '../outbox.js';
import { notify } from '../notify.js';
import { audit } from '../db/audit.js';
import { sql } from '../db/index.js';
import { hatGeheimnis, redact } from '../redact.js';
import type { Ctx } from '../context.js';
import { FINGERABDRUCK, alarmMelden } from '../alarme.js';
import { buendeln } from '../lernen.js';

const Meldung = z.object({
  source: z.string().max(64).optional(),
  level: z.enum(['info', 'warn', 'crit']).default('info'),
  title: z.string().trim().min(1).max(200),
  text: z.string().max(4000).default(''),
  link: z.string().url().max(500).optional(),
  /** Mit Fingerabdruck ist die Meldung ein Alarm mit Lebenslauf (ADR-003 R4, `alarme.ts`). */
  fingerprint: z
    .string()
    .regex(FINGERABDRUCK, 'fingerprint: 1–128 Zeichen aus A–Z, a–z, 0–9 und :._/@-')
    .optional(),
  /** Der Alarm mit diesem Fingerabdruck ist vorbei. */
  resolved: z.boolean().default(false),
  /** Ohne Fingerabdruck: `log` schreibt nach #schwarm-log statt #schwarm-alarme (Berichte, Releases),
   *  `agent` in den eigenen Arbeitsraum der Quelle (etwa Tagesbericht und Fills des Traders in #ag-trader). */
  raum: z.enum(['alarme', 'log', 'agent']).default('alarme'),
});

const PRO_MINUTE = 30;
const DOPPELT_MS = 5 * 60_000;
const ZEICHEN = { info: 'ℹ️', warn: '⚠️', crit: '🚨' } as const;

const fenster = new Map<string, number[]>();
const zuletzt = new Map<string, number>();

/** true, wenn die Quelle noch Platz im Minutenfenster hat (und zählt mit). */
export function imTakt(quelle: string, jetzt = Date.now()): boolean {
  const zeiten = (fenster.get(quelle) ?? []).filter((t) => jetzt - t < 60_000);
  if (zeiten.length >= PRO_MINUTE) {
    fenster.set(quelle, zeiten);
    return false;
  }
  zeiten.push(jetzt);
  fenster.set(quelle, zeiten);
  return true;
}

/** true, wenn dieselbe Meldung derselben Quelle in den letzten 5 min schon kam. */
export function doppelt(quelle: string, schluessel: string, jetzt = Date.now()): boolean {
  const k = createHash('sha256').update(`${quelle}|${schluessel}`).digest('hex');
  for (const [alt, t] of zuletzt) if (jetzt - t >= DOPPELT_MS) zuletzt.delete(alt);
  if (zuletzt.has(k)) return true;
  zuletzt.set(k, jetzt);
  return false;
}

export async function hookRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.post('/hooks/notify', async (req, reply) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const identitaet = token ? await verifyToken(token, 'notify') : null;
    if (!identitaet) {
      // Ein widerrufenes Token eines bekannten Melders: Seine Meldungen gingen sonst still verloren.
      const alt = token ? await widerrufenVon(token, 'notify') : null;
      if (alt) {
        await alarmMelden(ctx, {
          quelle: 'hub',
          agent: null,
          fingerabdruck: `melder-token:${alt}`,
          level: 'warn',
          behoben: false,
          titel: `${alt} meldet mit einem widerrufenen Token`,
          text: 'Seine Meldungen kommen nicht an. Ein neues Token legt die Token-CLI an (RUNBOOK, Tokens).',
        });
      }
      return reply.code(401).send({ error: 'Kein gültiges Melder-Token (Zweck notify)' });
    }

    const geprueft = Meldung.safeParse(req.body ?? {});
    if (!geprueft.success) {
      return reply
        .code(400)
        .send({ error: geprueft.error.issues[0]?.message ?? 'ungültige Meldung' });
    }
    const m = geprueft.data;
    const quelle = identitaet.agent;
    if (m.source && m.source !== quelle) {
      await audit(quelle, 'hooks.fremde_quelle', null, { angegeben: m.source });
      return reply.code(403).send({ error: 'source passt nicht zum Token' });
    }
    const agent = await agentById(quelle);
    if (!agent) return reply.code(403).send({ error: `Quelle ${quelle} ist nicht eingetragen` });
    const [tokenAlarm] = await sql`
      SELECT 1 FROM swarm.alarme WHERE quelle = 'hub' AND fingerabdruck = ${`melder-token:${quelle}`} AND zustand = 'offen'`;
    if (tokenAlarm) {
      await alarmMelden(ctx, {
        quelle: 'hub',
        agent: null,
        fingerabdruck: `melder-token:${quelle}`,
        level: 'info',
        behoben: true,
        titel: `${quelle} meldet wieder mit gültigem Token`,
        text: '',
      });
    }
    if (agent.frozen) return reply.code(423).send({ error: `${quelle} ist gesperrt` });
    if (!imTakt(quelle))
      return reply.code(429).send({ error: `Mehr als ${PRO_MINUTE} Meldungen pro Minute` });

    const roh = [m.title, m.text, m.link ?? ''].join('\n');
    if (m.resolved && !m.fingerprint)
      return reply.code(400).send({ error: 'resolved braucht fingerprint' });
    if (m.fingerprint) {
      const r = await alarmMelden(ctx, {
        quelle,
        agent: { displayName: agent.displayName ?? null, mxid: agent.mxid },
        fingerabdruck: m.fingerprint,
        level: m.level,
        titel: m.title,
        text: m.text,
        ...(m.link ? { link: m.link } : {}),
        behoben: m.resolved,
      });
      if (hatGeheimnis(roh)) await audit(quelle, 'hooks.redaktion', null, { level: m.level });
      return reply.code(r.status).send(r.body);
    }
    const titel = redact(m.title);
    const text = redact(m.text).trim();
    const link = m.link ? redact(m.link) : '';
    if (doppelt(quelle, `${m.level}|${titel}|${text}`))
      return reply.code(200).send({ ok: true, doppelt: true });

    // `agent` nur in einen echten Arbeitsraum (kind work): reine Melder führen #schwarm-alarme als Raum.
    const eigener = m.raum === 'agent' && agent.roomId ? await roomByRoomId(agent.roomId) : null;
    const [alarme] =
      m.raum === 'agent'
        ? eigener?.kind === 'work'
          ? [eigener]
          : []
        : await roomsByKind(m.raum === 'log' ? 'log' : 'alerts');
    if (!alarme?.roomId) {
      return reply.code(503).send({
        error:
          m.raum === 'agent'
            ? `${quelle} hat keinen Arbeitsraum`
            : m.raum === 'log'
              ? '#schwarm-log fehlt'
              : '#schwarm-alarme fehlt',
      });
    }
    // Als Puppet der Quelle, sonst als Hub mit Absender im Text.
    const alsPuppet = istPuppet(agent.mxid) && (await ensurePuppet(ctx, agent.mxid, alarme.roomId));
    const body =
      `${ZEICHEN[m.level]} ${alsPuppet ? '' : `${agent.displayName ?? quelle}: `}${titel}` +
      (text ? `\n${text}` : '') +
      (link ? `\n${link}` : '');
    // Lernende Alarme (Punkt 15): Ab der vierten Meldung einer Quelle in 10 min kommt eine Sammel-Notice.
    // Der eigene Raum ist der Kanal des Agenten (ersetzt Telegram): dort wird nicht gebündelt.
    if (
      m.raum !== 'agent' &&
      buendeln(
        ctx,
        m.raum === 'log' ? 'log' : 'alerts',
        quelle,
        m.level,
        `${titel}${text ? ` — ${text}` : ''}`,
        alsPuppet ? agent.mxid : undefined
      )
    ) {
      return reply.code(202).send({ ok: true, gebuendelt: true });
    }
    await enqueue(
      sql,
      [
        {
          kind: 'message',
          roomId: alarme.roomId,
          ...(alsPuppet ? { asUser: agent.mxid } : {}),
          payload: { type: 'm.room.message', content: notice(body) },
        },
      ],
      ctx.hub
    );

    if (hatGeheimnis(roh)) await audit(quelle, 'hooks.redaktion', null, { level: m.level });
    if (m.level !== 'info') await audit(quelle, `hooks.${m.level}`, null, { titel });
    if (m.level === 'crit') {
      await notify(
        {
          title: `${agent.displayName ?? quelle}: ${titel}`,
          text: [text, link].filter(Boolean).join('\n'),
          priority: 5,
          tags: ['rotating_light'],
        },
        ctx.log
      );
    }
    return reply.code(202).send({ ok: true });
  });
}
