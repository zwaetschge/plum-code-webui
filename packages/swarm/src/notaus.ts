/**
 * Not-Aus ohne Matrix (matrix/PLAN-weiter.md, Punkt 18). Fällt Synapse aus oder synchronisiert die App nicht,
 * soll der Kill-Switch trotzdem gehen. Dafür meldet die App einmal einen Geräteschlüssel an (P-256, im
 * Android-Keystore) und schickt im Notfall eine signierte Anfrage über das Relay direkt an den Hub.
 *
 *   !geraet neu <name> <spki-base64url>   → Gerät anmelden (Antwort: Geräte-ID)
 *   !geraet weg <id>                       → abmelden
 *   !geraet                                → Liste
 *
 *   POST /notaus  { geraet, zeit, nonce, aktion: stopp|stand|weiter|push|push-test|push-weg, endpoint?, signatur }
 *   signiert (SHA256withECDSA, DER, base64url) wird der Text `schwarm-notaus|v1|<aktion>|<geraet>|<zeit>|<nonce>`,
 *   bei `push` dazu `|<endpoint>` (die UnifiedPush-Adresse für Sofort-Benachrichtigungen, App 2.5)
 *
 * `stopp` friert den Schwarm ein wie `!stop` und bricht alle offenen Aufträge ab (die Worker bekommen `cancel`).
 * Ist der Hub selbst weg, antwortet das Relay 502: Dann läuft ohnehin nichts Neues an, laufende Worker-Läufe
 * enden an ihrer Zeitgrenze. Antworten: 401 Signatur/Gerät, 409 Nonce doppelt, 425 Uhrzeit weicht über 60 s ab.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql, type Db } from './db/index.js';
import { FROZEN_FLAG, audit, auditMerken, clearFlag, isSwarmFrozen, setFlag } from './db/audit.js';
import { queueHalt } from './council/halt.js';
import { zustandUndMeldung } from './tasks/transition.js';
import { hinweis, lobbyZustand } from './raumhinweis.js';
import { adressePruefen, senden as pushSenden } from './push.js';
import type { Ctx } from './context.js';

export const NOTAUS_EVENT = 'ch.zwaetschge.swarm.notaus';
const URL_AUSSEN = process.env.NOTAUS_URL || 'https://schwarm.zwaetschge-webui.ch/notaus';
const FRIST_MS = 60_000;
const PRO_MINUTE = 10;

export function signierterText(
  aktion: string,
  geraet: string,
  zeit: number,
  nonce: string
): string {
  return `schwarm-notaus|v1|${aktion}|${geraet}|${zeit}|${nonce}`;
}

/** SPKI (DER, base64url) prüfen: nur EC P-256. Liefert Geräte-ID und DER, oder einen Fehler. */
export function spkiPruefen(roh: string): { id: string; der: Buffer } | { fehler: string } {
  if (!/^[A-Za-z0-9_-]{80,400}={0,2}$/.test(roh))
    return { fehler: 'Das ist kein öffentlicher Schlüssel (SPKI, base64url).' };
  const der = Buffer.from(roh, 'base64url');
  try {
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      return { fehler: 'Nur EC-Schlüssel P-256 (prime256v1).' };
    }
  } catch {
    return { fehler: 'Der Schlüssel lässt sich nicht lesen.' };
  }
  return { id: createHash('sha256').update(der).digest('hex').slice(0, 16), der };
}

async function geraeteVeroeffentlichen(ctx: Ctx, db: Db = sql): Promise<void> {
  const liste = await db`
    SELECT id, name, erstellt, push_endpoint, push_ok, push_fehler FROM swarm.notaus_geraete WHERE widerrufen IS NULL ORDER BY erstellt`;
  await lobbyZustand(
    ctx,
    NOTAUS_EVENT,
    '',
    {
      v: 1,
      url: URL_AUSSEN,
      geraete: liste.map((g) => ({
        id: String(g.id),
        name: String(g.name),
        erstellt: new Date(g.erstellt as string).toISOString(),
        // Sofort-Benachrichtigungen (App 2.5): nur der Host, nie die Adresse selbst.
        push: g.push_endpoint
          ? {
              host: new URL(String(g.push_endpoint)).hostname,
              ok: g.push_ok ? new Date(g.push_ok as string).toISOString() : null,
              fehler: g.push_fehler ? String(g.push_fehler) : null,
            }
          : null,
      })),
    },
    db
  );
}

/** `!geraet …` */
export async function cmdGeraet(
  ctx: Ctx,
  tx: Db,
  input: { body: string },
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const teile = input.body
    .trim()
    .replace(/^!ger(ae|ä)t\s*/i, '')
    .split(/\s+/)
    .filter(Boolean);
  const befehl = teile.shift() ?? 'liste';
  if (befehl === 'neu') {
    const spki = teile.pop() ?? '';
    const name =
      teile
        .join(' ')
        .replace(/[^\p{L}\p{N} ._-]/gu, '')
        .trim()
        .slice(0, 40) || 'Gerät';
    const p = spkiPruefen(spki);
    if ('fehler' in p) return antwort(`🚫 ${p.fehler} Aufruf: !geraet neu <name> <spki-base64url>`);
    await tx`
      INSERT INTO swarm.notaus_geraete (id, name, spki) VALUES (${p.id}, ${name}, ${p.der})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, widerrufen = NULL`;
    auditMerken(ctx.owner, 'notaus.geraet_neu', null, { id: p.id, name });
    await geraeteVeroeffentlichen(ctx, tx);
    return antwort(
      `📱 Gerät „${name}“ angemeldet, ID ${p.id}. Der Not-Aus geht jetzt auch ohne Matrix: ${URL_AUSSEN}`
    );
  }
  if (befehl === 'weg') {
    const id = (teile[0] ?? '').toLowerCase();
    const r =
      await tx`UPDATE swarm.notaus_geraete SET widerrufen = now() WHERE id = ${id} AND widerrufen IS NULL RETURNING name`;
    if (!r.length) return antwort(`Kein angemeldetes Gerät ${id}.`);
    auditMerken(ctx.owner, 'notaus.geraet_weg', null, { id });
    await geraeteVeroeffentlichen(ctx, tx);
    return antwort(`🗑 Gerät „${r[0]!.name}“ (${id}) abgemeldet.`);
  }
  const liste =
    await tx`SELECT id, name, erstellt, zuletzt FROM swarm.notaus_geraete WHERE widerrufen IS NULL ORDER BY erstellt`;
  if (!liste.length)
    return antwort(
      'Kein Gerät für den Not-Aus angemeldet. Die App macht das unter „Not-Aus“ (Befehl !geraet neu <name> <schlüssel>).'
    );
  return antwort(
    [
      'Not-Aus-Geräte:',
      ...liste.map(
        (g) =>
          `• ${g.name} · ${g.id}${g.zuletzt ? ` · zuletzt benutzt ${new Date(g.zuletzt as string).toISOString().slice(0, 16)}` : ''}`
      ),
    ].join('\n')
  );
}

async function stand(
  db: Db = sql
): Promise<{ eingefroren: boolean; offen: number; laufend: number }> {
  const [z] = await db`
    SELECT count(*) FILTER (WHERE state IN ('submitted','working','input-required','auth-required'))::int AS offen,
           count(*) FILTER (WHERE state IN ('working','input-required'))::int AS laufend
      FROM swarm.tasks`;
  return {
    eingefroren: await isSwarmFrozen(db),
    offen: Number(z?.offen ?? 0),
    laufend: Number(z?.laufend ?? 0),
  };
}

const Anfrage = z.object({
  geraet: z.string().regex(/^[0-9a-f]{16}$/),
  zeit: z.number().int().positive(),
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  // push, push-test, push-weg: Sofort-Benachrichtigungen (App 2.5), die Adresse ist mitsigniert.
  aktion: z.enum(['stopp', 'stand', 'weiter', 'push', 'push-test', 'push-weg']),
  endpoint: z.string().max(1000).optional(),
  signatur: z.string().regex(/^[A-Za-z0-9_-]{40,200}={0,2}$/),
});

let fenster: number[] = [];

export async function notausRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.post('/notaus', { bodyLimit: 4096 }, async (req, reply) => {
    const jetzt = Date.now();
    fenster = fenster.filter((t) => jetzt - t < 60_000);
    if (fenster.length >= PRO_MINUTE)
      return reply.code(429).send({ ok: false, fehler: 'zu viele Versuche' });
    fenster.push(jetzt);
    const a = Anfrage.safeParse(req.body ?? {});
    if (!a.success) return reply.code(400).send({ ok: false, fehler: 'ungültige Anfrage' });
    const { geraet, zeit, nonce, aktion, signatur, endpoint } = a.data;
    if (aktion === 'push' && !endpoint)
      return reply.code(400).send({ ok: false, fehler: 'Adresse fehlt' });
    const [g] =
      await sql`SELECT name, spki FROM swarm.notaus_geraete WHERE id = ${geraet} AND widerrufen IS NULL`;
    if (!g) {
      await audit('notaus', 'notaus.unbekannt', null, { geraet });
      return reply.code(401).send({ ok: false, fehler: 'Gerät unbekannt' });
    }
    let echt = false;
    try {
      const key = createPublicKey({ key: g.spki as Buffer, format: 'der', type: 'spki' });
      const text =
        signierterText(aktion, geraet, zeit, nonce) + (aktion === 'push' ? `|${endpoint}` : '');
      echt = verify(
        'sha256',
        Buffer.from(text),
        { key, dsaEncoding: 'der' },
        Buffer.from(signatur, 'base64url')
      );
    } catch {
      echt = false;
    }
    if (!echt) {
      await audit('notaus', 'notaus.signatur', null, { geraet });
      return reply.code(401).send({ ok: false, fehler: 'Signatur ungültig' });
    }
    if (Math.abs(jetzt - zeit) > FRIST_MS)
      return reply.code(425).send({ ok: false, fehler: 'Uhrzeit weicht über 60 s ab' });
    const neu =
      await sql`INSERT INTO swarm.notaus_nonces (nonce, geraet) VALUES (${nonce}, ${geraet}) ON CONFLICT DO NOTHING RETURNING nonce`;
    if (!neu.length) return reply.code(409).send({ ok: false, fehler: 'Nonce schon benutzt' });
    void sql`DELETE FROM swarm.notaus_nonces WHERE at < now() - interval '10 minutes'`.catch(
      () => {}
    );
    await sql`UPDATE swarm.notaus_geraete SET zuletzt = now() WHERE id = ${geraet}`;
    const name = String(g.name);

    if (aktion === 'stopp') {
      const abgebrochen = await sql.begin(async (tx) => {
        await setFlag(FROZEN_FLAG, { by: `notaus:${geraet}`, geraet: name }, ctx.owner, tx);
        await queueHalt(tx, { sender: ctx.owner, eventId: `notaus-${nonce}` });
        const offen =
          await tx`SELECT id FROM swarm.tasks WHERE state IN ('submitted','working','input-required','auth-required')`;
        for (const t of offen) {
          await zustandUndMeldung(ctx, tx, String(t.id), 'canceled', {
            failReason: `⛔ Not-Aus (Gerät ${name})`,
            actor: ctx.owner,
          });
        }
        return offen.length;
      });
      auditMerken(ctx.owner, 'notaus.stopp', null, { geraet, abgebrochen });
      await hinweis(
        ctx,
        'lobby',
        `⛔ Not-Aus vom Gerät „${name}“ (ohne Matrix ausgelöst): Schwarm eingefroren, ${abgebrochen} Auftrag/Aufträge abgebrochen. Weiter mit !weiter.`
      );
    } else if (aktion === 'weiter') {
      await clearFlag(FROZEN_FLAG);
      auditMerken(ctx.owner, 'notaus.weiter', null, { geraet });
      await hinweis(
        ctx,
        'lobby',
        `▶️ Schwarm läuft wieder, freigegeben vom Not-Aus-Gerät „${name}“.`
      );
    } else if (aktion === 'push') {
      const geprueft = adressePruefen(endpoint!);
      if ('fehler' in geprueft) return reply.code(422).send({ ok: false, fehler: geprueft.fehler });
      await sql`UPDATE swarm.notaus_geraete SET push_endpoint = ${geprueft.url}, push_seit = now(), push_fehler = NULL WHERE id = ${geraet}`;
      auditMerken(ctx.owner, 'push.angemeldet', null, {
        geraet,
        host: new URL(geprueft.url).hostname,
      });
      await geraeteVeroeffentlichen(ctx);
      return reply
        .code(200)
        .send({ ok: true, aktion, push: { host: new URL(geprueft.url).hostname } });
    } else if (aktion === 'push-test') {
      const [p] = await sql`SELECT push_endpoint FROM swarm.notaus_geraete WHERE id = ${geraet}`;
      if (!p?.push_endpoint)
        return reply
          .code(404)
          .send({ ok: false, fehler: 'Für dieses Gerät ist keine Push-Adresse angemeldet.' });
      const status = await pushSenden(ctx, geraet, String(p.push_endpoint), 'Test');
      await geraeteVeroeffentlichen(ctx);
      return reply.code(200).send({ ok: status >= 200 && status < 300, aktion, push: { status } });
    } else if (aktion === 'push-weg') {
      await sql`UPDATE swarm.notaus_geraete SET push_endpoint = NULL, push_fehler = NULL WHERE id = ${geraet}`;
      auditMerken(ctx.owner, 'push.abgemeldet', null, { geraet });
      await geraeteVeroeffentlichen(ctx);
    }
    return reply.code(200).send({ ok: true, aktion, stand: await stand() });
  });
}
