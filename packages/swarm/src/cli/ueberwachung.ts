/**
 * Überwachung von Hand (§10.5, §11.8, N1) — dieselben drei Prüfungen wie die
 * Schleife im Hub, für die Prüfung und nach einem Vorfall:
 *
 *   pnpm --filter @council/matrix build
 *   docker run --rm --network council-net --env-file .env -v "$PWD:/app" -w /app \
 *     node:22-alpine node packages/matrix/dist/cli/ueberwachung.js [--audit] [--stunde <schlüssel>]
 *
 * `--audit` rechnet die Hash-Kette nach (sonst nur zwischen 03:00 und 04:00 UTC).
 * `--stunde` setzt den Drosselungsschlüssel: dieselbe Stunde meldet nur einmal.
 */
import Fastify from 'fastify';
import { sql } from '../db/index.js';
import { MatrixClient } from '../appservice/client.js';
import { env, HUB_MXID } from '../env.js';
import { runUeberwachung } from '../ueberwachung.js';
import type { Ctx } from '../context.js';

const log = Fastify({ logger: false }).log;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const stunde = argv.includes('--stunde') ? argv[argv.indexOf('--stunde') + 1] : undefined;
  const ctx: Ctx = { matrix: new MatrixClient(), log, owner: env.ownerMxid, hub: HUB_MXID };
  const r = await runUeberwachung(ctx, {
    ...(stunde ? { stunde } : {}),
    auditPfad: argv.includes('--audit'),
  });
  const meldungen = [
    r.inbox ? 'Inbox hängt' : null,
    r.outbox ? 'Outbox-Rückstand' : null,
    r.audit === false ? 'Audit-Kette gebrochen' : null,
  ].filter(Boolean);
  console.log(
    meldungen.length
      ? `⚠ ${meldungen.join(' · ')} — gemeldet (Log-Raum und ntfy)`
      : `✓ alles ruhig${r.audit === true ? ', Audit-Kette stimmt' : ''}`
  );
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error('Überwachung fehlgeschlagen:', err instanceof Error ? err.message : err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
