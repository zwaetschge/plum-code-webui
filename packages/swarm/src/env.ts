function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return v;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`${name} ist keine Zahl: ${raw}`);
  return v;
}

export const env = {
  /** Verbindung als Rolle `schwarm` — sie sieht nur das Schema `swarm`. */
  databaseUrl: req('DATABASE_URL'),
  host: req('HOST', '0.0.0.0'),
  port: num('PORT', 4700),

  homeserverUrl: req('HOMESERVER_URL', 'http://matrix-synapse:8008'),
  appserviceId: req('APPSERVICE_ID', 'schwarm'),
  /** Damit ruft der Hub die Client-API auf und maskiert Puppets. */
  asToken: req('AS_TOKEN'),
  /** Damit weist er sich gegenüber Synapse aus, wenn Transaktionen kommen. */
  hsToken: req('HS_TOKEN'),
  domain: req('MATRIX_DOMAIN', 'zwaetschge-webui.ch'),
  senderLocalpart: req('SENDER_LOCALPART', 'schwarm'),

  /** Der eine Mensch. Befehle und Bedien-Reaktionen zählen nur von ihm (§8.6). */
  ownerMxid: req('OWNER_MXID', '@vale:zwaetschge-webui.ch'),

  councilUrl: process.env.COUNCIL_URL || '',
  /** Öffentliche Adresse der Rat-UI — für Freigabe-Links, nie mit Token (§9.6). */
  councilPublicUrl: process.env.COUNCIL_PUBLIC_URL || '',
  councilToken: process.env.COUNCIL_TOKEN || '',
  /** Raum des Rats für `!rat`; ohne Angabe sucht der Hub im Space `rat`. */
  councilRoom: process.env.COUNCIL_ROOM || '',

  ntfyUrl: process.env.NTFY_URL || '',
  ntfyTopic: process.env.NTFY_TOPIC || '',
  ntfyToken: process.env.NTFY_TOKEN || '',

  roomsFile: req('ROOMS_FILE', '/app/ops/matrix/rooms.swarm.yaml'),
  agentsFile: req('AGENTS_FILE', '/app/ops/matrix/agents.swarm.yaml'),

  /** Takt des Inbox-Verarbeiters und des Outbox-Senders. */
  inboxIntervalMs: num('INBOX_INTERVAL_MS', 1000),
  inboxBatch: num('INBOX_BATCH', 20),
  senderIntervalMs: num('SENDER_INTERVAL_MS', 1000),
  pingIntervalMs: num('PING_INTERVAL_MS', 60_000),
  /** Bremsleiter Stufe 1: so lange wartet der Hub auf „⚡ Stopped" (§12.5). */
  stopEscalationSeconds: num('STOP_ESCALATION_SECONDS', 10),
  /** Danach ist eine Nachfass-Nachricht zu alt und wird verworfen. */
  stopEscalationMaxMinutes: num('STOP_ESCALATION_MAX_MINUTES', 10),

  /** Watchdog-Schwellen (§10.4). In der e2e klein, im Betrieb die Werte des Plans. */
  watchdogIntervalMs: num('WATCHDOG_INTERVAL_MS', 30_000),
  watchdogReminderMinutes: Number(req('WATCHDOG_REMINDER_MINUTES', '3')),
  watchdogStalledMinutes: Number(req('WATCHDOG_STALLED_MINUTES', '8')),
  watchdogLongRunMinutes: Number(req('WATCHDOG_LONG_RUN_MINUTES', '35')),
  watchdogLeaseGraceSeconds: Number(req('WATCHDOG_LEASE_GRACE_SECONDS', '30')),

  /** Ab so vielen Zeilen Rückstand meldet /health 503 (§10.5). */
  outboxAlarm: num('OUTBOX_ALARM', 50),
  inboxAlarmMinutes: num('INBOX_ALARM_MINUTES', 10),

  logLevel: req('LOG_LEVEL', 'info'),
} as const;

export const HUB_MXID = `@${env.senderLocalpart}:${env.domain}`;
export const isDev = process.env.NODE_ENV !== 'production';

/** Puppets, die der Hub maskieren darf — nur der eigene Namensraum (§7.1). */
export function puppetMxid(id: string): string {
  return `@_sw_${id}:${env.domain}`;
}
