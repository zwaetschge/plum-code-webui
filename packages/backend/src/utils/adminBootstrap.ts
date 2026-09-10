import { get as pgGet, run as pgRun } from '../db/pg.js';
import { config } from '../config.js';

export function getBootstrapAdminEmail(): string | null {
  return process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || config.auth.allowedEmails[0] || null;
}

/**
 * Promote the configured bootstrap identity, or — on a genuinely fresh
 * instance — the very first account created.
 *
 * The user-count check matters: "no admin exists" alone also becomes true again
 * after the last admin is deleted or demoted, and on an instance with an open
 * AUTH_ALLOWED_EMAILS that handed administrator rights to whoever happened to
 * log in next. Promotion is now only automatic for account number one.
 */
export async function ensureBootstrapAdmin(userId: string, email: string): Promise<boolean> {
  const admin = await pgGet(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (admin) return false;

  const preferredEmail = getBootstrapAdminEmail();
  if (preferredEmail) {
    if (preferredEmail !== email.trim().toLowerCase()) return false;
  } else {
    const row = (await pgGet(`SELECT COUNT(*)::int AS count FROM users`)) as unknown as
      | { count: number }
      | undefined;
    if ((row?.count ?? 0) > 1) {
      console.warn(
        `[admin-bootstrap] Refusing to auto-promote ${email}: this instance has no administrator ` +
          'but is not new. Set SEED_ADMIN_EMAIL (or AUTH_ALLOWED_EMAILS) and restart, or promote ' +
          "the account directly: UPDATE users SET role='admin' WHERE email='…';"
      );
      return false;
    }
  }

  const result = await pgRun(
    `UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    userId
  );
  if (result.changes > 0) {
    console.log(`[admin-bootstrap] Promoted ${email} to administrator.`);
  }
  return result.changes > 0;
}
