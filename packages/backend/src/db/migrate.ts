/**
 * Standalone migration runner for `pnpm db:migrate`.
 *
 * All schema creation and migrations live inline in initDatabase() (guarded
 * CREATE/ALTER/DROP blocks plus the usage_history rate-card repricing), so
 * "migrating" is simply initializing the database once and exiting. The
 * target file honors WEBUI_DATA_DIR; the default is packages/backend/data.
 */
import { initDatabase, getDataDirectory } from './index.js';

try {
  initDatabase();
  console.log(`[db:migrate] Migrations applied to ${getDataDirectory()}`);
  process.exit(0);
} catch (err) {
  console.error('[db:migrate] Migration failed:', err);
  process.exit(1);
}
