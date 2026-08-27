import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

import { get as pgGet, run as pgRun } from './pg.js';

/**
 * First-boot bootstrapping, lifted out of the migration block it used to live
 * in.
 *
 * It was sitting between two thousand lines of CREATE TABLE, which is why it
 * ran on every start rather than once: it is not a migration, it is startup
 * reconciliation. Both steps below are deliberately idempotent and re-read
 * their environment every time, so changing SEED_ADMIN_EMAIL and redeploying
 * takes effect without anyone writing SQL by hand.
 */

/**
 * Guarantees the system has a reachable admin.
 *
 * `SEED_ADMIN_EMAIL` promotes a named account. Without it, and only when no
 * admin exists at all, the earliest-created user is promoted — otherwise a
 * deployment whose only admin was deleted would lock everyone out of the admin
 * routes with no way back in short of editing the database.
 */
export async function bootstrapAdmin(): Promise<void> {
  try {
    const seedAdmin = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();

    if (seedAdmin) {
      const promoted = await pgRun(
        `UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP
          WHERE LOWER(email) = ? AND role != 'admin'`,
        seedAdmin
      );
      if (promoted.changes > 0) {
        console.log(`[DB] Promoted ${seedAdmin} to admin (SEED_ADMIN_EMAIL).`);
      }
      return;
    }

    const adminCount = (await pgGet(
      `SELECT COUNT(*) as c FROM users WHERE role = 'admin'`
    )) as unknown as { c: number };
    if (Number(adminCount.c) > 0) return;

    const first = (await pgGet(`SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1`)) as
      | { id: string; email: string }
      | undefined;
    if (!first) return;

    await pgRun(
      `UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      first.id
    );
    console.log(`[DB] No admin found — promoted ${first.email} (earliest user) to admin.`);
  } catch (error) {
    // A failure here must not stop the server: it would take down a working
    // deployment over a bootstrap concern that only matters on a fresh one.
    console.error('[DB] Admin bootstrap failed:', error);
  }
}

/**
 * Creates a login from SEED_USER_* for local development and first boot.
 *
 * The password is read from the environment and never written anywhere but the
 * bcrypt hash.
 */
export async function seedUserFromEnv(): Promise<void> {
  const seedEmail = process.env.SEED_USER_EMAIL?.trim();
  const seedPassword = process.env.SEED_USER_PASSWORD;
  const seedName = process.env.SEED_USER_NAME?.trim() || seedEmail?.split('@')[0];
  if (!seedEmail || !seedPassword || !seedName) return;

  try {
    const existing = await pgGet('SELECT id FROM users WHERE email = ?', seedEmail);
    if (existing) return;

    const userId = nanoid();
    const passwordHash = bcrypt.hashSync(seedPassword, 10);
    await pgRun(
      `INSERT INTO users (id, email, name, avatar_url, provider, provider_id, password_hash)
       VALUES (?, ?, ?, ?, 'cli', ?, ?)`,
      userId,
      seedEmail,
      seedName,
      null,
      `local-cli-${seedName}`,
      passwordHash
    );
    await pgRun(
      `INSERT INTO user_settings (user_id, theme, allowed_tools)
       VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')
       ON CONFLICT (user_id) DO NOTHING`,
      userId
    );
    console.log(`[DB] Seeded user ${seedEmail} from SEED_USER_* env vars.`);
  } catch (error) {
    console.error('[DB] Failed to seed user from env:', error);
  }
}
