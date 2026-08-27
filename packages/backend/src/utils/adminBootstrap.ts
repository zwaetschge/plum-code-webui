import { get as pgGet, run as pgRun } from '../db/pg.js';
import { config } from '../config.js';

export function getBootstrapAdminEmail(): string | null {
  return process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || config.auth.allowedEmails[0] || null;
}

/** Promote only the configured bootstrap identity (or the first user when no
 * identity was configured) and only while the instance has no administrator. */
export async function ensureBootstrapAdmin(userId: string, email: string): Promise<boolean> {
  const admin = await pgGet(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (admin) return false;

  const preferredEmail = getBootstrapAdminEmail();
  if (preferredEmail && preferredEmail !== email.trim().toLowerCase()) return false;

  const result = await pgRun(
    `UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    userId
  );
  return result.changes > 0;
}
