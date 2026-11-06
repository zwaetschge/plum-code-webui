/**
 * council-matrix — der Schwarm-Hub (§5.1, Variante B).
 *
 * Start: Migrationen, Agenten aus `agents.swarm.yaml`, Räume bootstrappen, dann
 * vier Schleifen: Inbox verarbeiten, Outbox senden, Synapse pingen, Rat-Warteschlange.
 * Der Hub ist von aussen nicht erreichbar (§15.8): keine Traefik-Labels.
 */
import Fastify from 'fastify';
import { env, HUB_MXID, isDev } from './env.js';
import { sql } from './db/index.js';
import { migrate } from './db/migrate.js';
import { auditAbarbeiten, audit } from './db/audit.js';
import { MatrixClient } from './appservice/client.js';
import { appserviceRoutes } from './appservice/routes.js';
import { ensurePuppets } from './appservice/puppets.js';
import { workerRoutes } from './worker/server.js';
import { hookRoutes } from './hooks/notify.js';
import { mcpRoutes } from './mcp/protocol.js';
import { syncAgents } from './agents/config.js';
import { listAgents } from './agents/store.js';
import { bootstrapRooms } from './rooms/bootstrap.js';
import { processInbox } from './inbox.js';
import { sendPending, setRepairContext } from './outbox.js';
import { drainCouncilQueue } from './council/halt.js';
import { runWatchdog } from './watchdog.js';
import { runBremsleiter } from './bremsleiter.js';
import { wartungFaellig, wartungLauf } from './wartung.js';
import { RAT_TAKT_MS, spiegelRat } from './council/rat.js';
import { runUeberwachung, UEBERWACHUNG_TAKT_MS } from './ueberwachung.js';
import { pollFreigaben } from './council/freigabe.js';
import { pruefeWorker } from './alarme.js';
import { ratTakt } from './rat/lauf.js';
import { runSchedule } from './schedule.js';
import { getPingState, healthReport, setPingState } from './health.js';
import { absprachenRoutes } from './absprachen.js';
import { notausRoutes } from './notaus.js';
import { WEITER_TAKT_MS, weiterTakt } from './weiter.js';
import type { Ctx } from './context.js';
import { acquireCoordinator } from './coordinatorGate.js';

const app = Fastify({
  logger: {
    level: env.logLevel,
    transport: isDev ? { target: 'pino-pretty' } : undefined,
    redact: ['req.headers.authorization'],
  },
  bodyLimit: 8 * 1024 * 1024,
});

let stopping = false;
const runningLoops = new Set<Promise<void>>();

/** Eine Schleife darf sich nicht selbst überholen. */
function takt(name: string, ms: number, lauf: () => Promise<void>): NodeJS.Timeout {
  let aktiv = false;
  return setInterval(() => {
    if (aktiv || stopping) return;
    aktiv = true;
    const job = lauf()
      .catch((err) => app.log.error({ err, schleife: name }, `${name} fehlgeschlagen`))
      .finally(() => {
        aktiv = false;
        runningLoops.delete(job);
      });
    runningLoops.add(job);
  }, ms);
}

async function main(): Promise<void> {
  // Explicit takeover only. Importing the package never starts a parallel scheduler by default.
  if (process.env.PLUM_SWARM_COORDINATOR_ENABLED !== 'true') {
    await sql.end({ timeout: 1 });
    return;
  }
  const releaseCoordinator = await acquireCoordinator();
  app.log.info('Migrationen prüfen …');
  await migrate();

  const matrix = new MatrixClient();
  const ctx: Ctx = { matrix, log: app.log, owner: env.ownerMxid, hub: HUB_MXID };
  // Die Outbox repariert M_FORBIDDEN selbst: Puppet einladen und beitreten.
  setRepairContext(ctx);

  const agents = await syncAgents();
  app.log.info(`${Object.keys(agents).length} Agenten aus ${env.agentsFile}`);
  // Puppets zuerst registrieren, sonst läuft eine Einladung beim Anlegen eines
  // neuen Raums ins Leere (§7.1).
  const vorab = await ensurePuppets(ctx, await listAgents());
  if (vorab.ok.length) app.log.info(`${vorab.ok.length} Puppets registriert`);
  const raeume = await bootstrapRooms(ctx, agents);
  app.log.info(
    `Räume: ${raeume.created.length} neu, ${raeume.known.length} vorhanden` +
      (raeume.failed.length
        ? `, ${raeume.failed.length} fehlgeschlagen (${raeume.failed.join(', ')})`
        : '')
  );

  const puppets = await ensurePuppets(ctx, await listAgents());
  if (puppets.failed.length) {
    app.log.warn(
      { failed: puppets.failed },
      'Puppets nicht in ihren Räumen — Worker können dort nicht schreiben'
    );
  }

  await audit('hub', 'start', null, {
    created: raeume.created,
    known: raeume.known,
    failed: raeume.failed,
    agents: Object.keys(agents),
  });

  await app.register(async (inst) => appserviceRoutes(inst, ctx));
  // Worker-Kanal (§14.4) und L0-Webhook (§14.5): eigene Plugin-Kontexte, beide
  // authentifizieren über Agent-Tokens statt über den hs_token.
  await app.register(async (inst) => workerRoutes(inst, ctx));
  await app.register(async (inst) => hookRoutes(inst, ctx));
  // Eigener Plugin-Kontext: Das MCP authentifiziert über Agent-Tokens, nicht
  // über den hs_token des Appservice (Muster wie toolRoutes im Rat).
  await app.register(async (inst) => mcpRoutes(inst, ctx));
  // Absprachen-Register für Sitzungen (matrix/PLAN-weiter.md, Punkt 2): Token-Zweck `absprache`.
  await app.register(async (inst) => absprachenRoutes(inst, ctx));
  // Not-Aus ohne Matrix (Punkt 18): signiert mit einem Geräteschlüssel, von aussen über schwarm-worker-relay.
  await app.register(async (inst) => notausRoutes(inst, ctx));
  app.get('/health', async (_req, reply) => {
    const bericht = await healthReport();
    return reply.code(bericht.code).send(bericht.body);
  });
  app.get('/', async () => ({
    dienst: 'council-matrix',
    appservice: env.appserviceId,
    health: '/health',
  }));

  const inboxLoop = takt('inbox', env.inboxIntervalMs, async () => {
    const r = await processInbox(ctx);
    if (r.processed) app.log.info({ ...r }, 'Inbox verarbeitet');
  });
  const senderLoop = takt('outbox', env.senderIntervalMs, async () => {
    const r = await sendPending(matrix, HUB_MXID);
    if (r.sent || r.dead) app.log.info({ ...r }, 'Outbox gesendet');
    if (r.dead) {
      const { notify } = await import('./notify.js');
      await notify(
        {
          title: 'Schwarm: Dead Letter in der Outbox',
          text: `${r.dead} Ausgabe(n) aufgegeben`,
          priority: 4,
          tags: ['warning'],
        },
        app.log
      );
    }
  });
  const pingLoop = takt('ping', env.pingIntervalMs, async () => {
    const vorher = getPingState();
    const r = await matrix.ping();
    const state = {
      ok: r.ok,
      ms: r.ms,
      at: Date.now(),
      failures: r.ok ? 0 : vorher.failures + 1,
    };
    setPingState(state);
    if (r.ok) {
      if (!vorher.ok && vorher.at) app.log.info({ ms: r.ms }, 'Synapse-Ping wieder ok');
      return;
    }
    app.log.warn({ ...r, failures: state.failures }, 'Synapse-Ping fehlgeschlagen');
    if (state.failures === 3) {
      const { notify } = await import('./notify.js');
      await notify(
        {
          title: 'Schwarm: Synapse nicht erreichbar',
          text: `3 Pings fehlgeschlagen: ${r.message ?? ''}`,
          priority: 5,
          tags: ['rotating_light'],
        },
        app.log
      );
    }
  });
  const watchdogLoop = takt('watchdog', env.watchdogIntervalMs, async () => {
    const r = await runWatchdog(ctx);
    const aktiv = Object.values(r).reduce((a, b) => a + b, 0);
    if (aktiv) app.log.info({ ...r }, 'Watchdog hatte zu tun');
  });
  // Bremsleiter Stufe 1: gibt Nachfass-Nachrichten frei, wenn „⚡ Stopped" fehlt.
  const bremsLoop = takt('bremsleiter', 5_000, async () => {
    const n = await runBremsleiter(ctx);
    if (n) app.log.warn({ n }, 'Abbruch nicht bestätigt — nachgefasst');
  });
  // Freigaben (§7.3, §9.3): erteilt → Auftrag läuft, abgelehnt/abgelaufen → canceled.
  const freigabeLoop = takt('freigaben', 15_000, async () => {
    const r = await pollFreigaben(ctx);
    if (r.erteilt || r.abgelehnt || r.abgelaufen) app.log.info({ ...r }, 'Freigaben entschieden');
  });
  // Überwachen (§10.5, §11.8, N1): Inbox-Lag, Outbox-Rückstand, Audit-Kette.
  const wachLoop = takt('ueberwachung', UEBERWACHUNG_TAKT_MS, async () => {
    const r = await runUeberwachung(ctx);
    if (r.inbox || r.outbox || r.audit === false)
      app.log.warn({ ...r }, 'Überwachung hat gemeldet');
  });
  // Alarme des Hubs selbst (ADR-003 R4): Worker, die seit 15 min weg sind, und ihre Rückkehr.
  const alarmLoop = takt('alarme', Number(process.env.ALARM_TAKT_MS || 60_000), async () => {
    const r = await pruefeWorker(ctx);
    if (r.weg || r.zurueck) app.log.info({ ...r }, 'Worker-Alarme');
  });
  // Vorgemerkte Belege in die Kette schreiben (§4.35) — Einzel-Schreiber, kurz
  // gesperrt, damit keine Transaktion auf sich selbst wartet.
  const auditLoop = takt('audit', Number(process.env.AUDIT_TAKT_MS || 250), async () => {
    const n = await auditAbarbeiten();
    if (n) app.log.debug({ belege: n }, 'Audit-Kette nachgezogen');
  });

  // Retention einmal täglich ab 03:50 (§4.25) — nach dem Abgleich, vor der Sicherung.
  const wartungLoop = takt('wartung', 5 * 60_000, async () => {
    if (!(await wartungFaellig())) return;
    const r = await wartungLauf();
    if (r.inbox || r.outbox || r.artefakte) {
      app.log.info({ ...r }, 'Retention hat aufgeräumt');
    }
  });

  // Rat im Schwarm (ADR-003 R3): Beiträge spiegeln, Runden weiterschalten, Beschluss.
  const ratNativLoop = takt('rat-nativ', Number(process.env.RAT_TAKT_MS || 15_000), async () => {
    const r = await ratTakt(ctx);
    if (r.weiter || r.fertig) app.log.info({ ...r }, 'Rat im Schwarm');
  });
  // Rat-Spiegel (§9.4): neue Ergebnisse der Ratsaufträge nach #ag-rat.
  const ratLoop = takt('rat-spiegel', RAT_TAKT_MS, async () => {
    const r = await spiegelRat(ctx);
    if (r.gespiegelt || r.fertig) app.log.info({ ...r }, 'Rat gespiegelt');
  });
  // Abgleich 03:45 und Kanarienvogel 07:25 (§10.4, §10.5) — einmal pro Tag.
  const scheduleLoop = takt('tageslauf', 5 * 60_000, async () => {
    await runSchedule(ctx);
  });
  // Bausteine aus matrix/PLAN-weiter.md (Release-Notiz, Türsteher, Routinen …), je mit eigenem Rhythmus.
  const weiterLoop = takt('weiter', WEITER_TAKT_MS, async () => {
    await weiterTakt(ctx);
  });
  const councilLoop = takt('council-queue', 15_000, async () => {
    const r = await drainCouncilQueue(ctx);
    if (r.done) app.log.info({ ...r }, 'Rat-Warteschlange abgearbeitet');
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      app.log.info(`${signal} — fahre herunter`);
      clearInterval(inboxLoop);
      clearInterval(senderLoop);
      clearInterval(pingLoop);
      clearInterval(watchdogLoop);
      clearInterval(scheduleLoop);
      clearInterval(bremsLoop);
      clearInterval(ratLoop);
      clearInterval(wachLoop);
      clearInterval(freigabeLoop);
      clearInterval(alarmLoop);
      clearInterval(auditLoop);
      clearInterval(wartungLoop);
      clearInterval(ratNativLoop);
      clearInterval(councilLoop);
      clearInterval(weiterLoop);
      // Erst die vorgemerkten Belege in die Kette, dann schließen (§4.35).
      // Stop inbound requests and await every in-flight writer while still holding the lease.
      // On a stuck shutdown, exit closes the reserved PostgreSQL connection atomically.
      const hardStop = setTimeout(() => process.exit(1), 30_000);
      hardStop.unref();
      void app
        .close()
        .then(() => Promise.allSettled([...runningLoops]))
        .then(() => auditAbarbeiten())
        .then(() => {})
        .then(releaseCoordinator)
        .then(() => sql.end({ timeout: 5 }))
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }

  await app.listen({ host: env.host, port: env.port });
  app.log.info(`council-matrix läuft auf :${env.port} als ${HUB_MXID}`);
  // Erster Ping sofort: Synapse liefert liegengebliebene Transaktionen dann
  // gleich nach, statt den Backoff abzuwarten (§10.1, 7).
  void matrix.ping().then((r) => {
    setPingState({ ok: r.ok, ms: r.ms, at: Date.now(), failures: r.ok ? 0 : 1 });
    if (!r.ok) app.log.warn({ ...r }, 'Erster Synapse-Ping fehlgeschlagen — läuft der Appservice?');
  });
}

main().catch((err) => {
  app.log.error({ err }, 'Start fehlgeschlagen');
  process.exit(1);
});
