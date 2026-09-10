import { run as pgRun } from '../db/pg.js';

/**
 * Merge keys into a user's settings blob without losing concurrent writes.
 *
 * `user_settings.settings_json` holds every per-user setting in one TEXT
 * column. The routes this replaces read it, parsed it, changed one key and
 * wrote the whole thing back, so two saves that overlapped — two browser tabs,
 * or a token save racing a provider-key save — ended with whichever committed
 * last, and the other one's field was gone with no error anywhere. Doing the
 * merge inside Postgres makes the read and the write one statement.
 *
 * The upsert matters too: a user who has never saved a setting has no row at
 * all, and a bare UPDATE against them succeeded while storing nothing.
 */
export async function mergeUserSettings(
  userId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await pgRun(
    `INSERT INTO user_settings (user_id, settings_json)
          VALUES (?, ?)
     ON CONFLICT (user_id) DO UPDATE
            SET settings_json = (
                  COALESCE(NULLIF(user_settings.settings_json, '')::jsonb, '{}'::jsonb)
                  || EXCLUDED.settings_json::jsonb
                )::text`,
    userId,
    JSON.stringify(patch)
  );
}

/** Remove keys from a user's settings blob, again without a read-modify-write. */
export async function removeUserSettings(userId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await pgRun(
    `UPDATE user_settings
        SET settings_json = (
              COALESCE(NULLIF(settings_json, '')::jsonb, '{}'::jsonb) - ?::text[]
            )::text
      WHERE user_id = ?`,
    `{${keys.map((key) => `"${key.replace(/"/g, '\\"')}"`).join(',')}}`,
    userId
  );
}
