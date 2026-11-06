import { migrate } from '../db/migrate.js';
import { sql } from '../db/index.js';

migrate()
  .then(async (applied) => {
    console.log(applied.length ? `${applied.length} Migration(en) angewandt.` : 'Schema steht.');
    await sql.end({ timeout: 5 });
  })
  .catch(async (err) => {
    console.error('Migration fehlgeschlagen:', err instanceof Error ? err.message : err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
