/**
 * Nächtlicher Abgleich von Hand (§10.4) — für die Prüfung und nach einem
 * längeren Ausfall:
 *
 *   pnpm --filter @council/matrix build
 *   docker run --rm --network council-net --env-file .env -v "$PWD:/app" -w /app \
 *     node:22-alpine sh -c 'DATABASE_URL=… node packages/matrix/dist/cli/abgleich.js [stunden]'
 */
import Fastify from 'fastify';
import { sql } from '../db/index.js';
import { MatrixClient } from '../appservice/client.js';
import { env, HUB_MXID } from '../env.js';
import { reconcile } from '../reconcile.js';
import type { Ctx } from '../context.js';

const log = Fastify({ logger: false }).log;

async function main(): Promise<void> {
  const stunden = Number(process.argv[2] ?? 24);
  const ctx: Ctx = { matrix: new MatrixClient(), log, owner: env.ownerMxid, hub: HUB_MXID };
  const r = await reconcile(ctx, Number.isFinite(stunden) ? stunden : 24);
  console.log(
    `Abgleich ${stunden} h: ${r.raeume} Räume, ${r.events} Events, ${r.luecken} Lücke(n) nachgespeist` +
      (r.stale.length ? `, ohne Aktivität seit 24 h: ${r.stale.join(', ')}` : '')
  );
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error('Abgleich fehlgeschlagen:', err instanceof Error ? err.message : err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
