/**
 * Standalone migration runner for `pnpm db:migrate`.
 *
 * Applies the baseline schema and every migration not yet recorded, then exits.
 * It is the same work `initDatabase()` does at boot, minus the bootstrapping and
 * reconciliation that only make sense with a server about to start — so running
 * it against a database the server is also using is safe and does nothing twice.
 *
 * The connection comes from PGHOST/PGDATABASE/PGUSER and PGPASSWORD, or
 * POSTGRES_PASSWORD, which is what compose and .env already set.
 */
// For its side effect: config loads .env, where the password lives.
import '../config.js';
import { closePool, readPgConfig } from './pg.js';
import { runPendingMigrations } from './migrations.js';
import { applySchema } from './index.js';

try {
  const config = readPgConfig();
  await applySchema();
  const applied = await runPendingMigrations();
  console.log(
    `[db:migrate] Schema applied to ${config.user}@${config.host}/${config.database}; ` +
      `${applied} migration(s) run`
  );
  await closePool();
  process.exit(0);
} catch (error) {
  console.error('[db:migrate] Migration failed:', error);
  await closePool().catch(() => {});
  process.exit(1);
}
