import { get as pgGet, run as pgRun } from '../db/pg.js';
import { nanoid } from 'nanoid';
import type { User } from '@plum-code-webui/shared';
import { ensureBootstrapAdmin } from './adminBootstrap.js';

const USER_SELECT = `
  id,
  email,
  name,
  avatar_url as avatarUrl,
  provider,
  provider_id as providerId,
  role,
  status,
  strftime('%Y-%m-%dT%H:%M:%fZ', last_login_at) as lastLoginAt,
  strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
  strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
`;

async function ensureUserSettings(userId: string): Promise<void> {
  await pgRun(
    `INSERT INTO user_settings (user_id, theme, allowed_tools)
     VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')
     ON CONFLICT (user_id) DO NOTHING`,
    userId
  );
}

async function upsertProxyUserInDatabase(
  email: string,
  name?: string | null,
  username?: string | null
): Promise<User> {
  const normalizedEmail = email.trim().toLowerCase();
  const fallbackName = normalizedEmail.split('@')[0] || normalizedEmail;
  const displayName = name?.trim() || username?.trim() || fallbackName;
  const providerId = normalizedEmail;

  const existingProxyUser = (await pgGet(
    `SELECT ${USER_SELECT} FROM users WHERE provider = 'proxy' AND provider_id = ?`,
    providerId
  )) as unknown as User | undefined;

  if (existingProxyUser) {
    await pgRun(
      `UPDATE users
       SET email = ?, name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      normalizedEmail,
      displayName,
      existingProxyUser.id
    );
    await ensureUserSettings(existingProxyUser.id);
    await ensureBootstrapAdmin(existingProxyUser.id, normalizedEmail);
    return {
      ...existingProxyUser,
      email: normalizedEmail,
      name: displayName,
    };
  }

  const existingEmailUser = (await pgGet(
    `SELECT ${USER_SELECT} FROM users WHERE LOWER(email) = LOWER(?)`,
    normalizedEmail
  )) as unknown as User | undefined;

  if (existingEmailUser) {
    await pgRun(
      `UPDATE users
       SET name = COALESCE(?, name), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      displayName,
      existingEmailUser.id
    );
    await ensureUserSettings(existingEmailUser.id);
    await ensureBootstrapAdmin(existingEmailUser.id, normalizedEmail);
    return {
      ...existingEmailUser,
      name: displayName || existingEmailUser.name,
    };
  }

  const legacySharedCliUser = (await pgGet(
    `SELECT ${USER_SELECT} FROM users WHERE provider = 'cli' AND provider_id = 'local-cli'`
  )) as unknown as User | undefined;

  if (legacySharedCliUser) {
    await pgRun(
      `UPDATE users
       SET email = ?, name = ?, provider = 'proxy', provider_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      normalizedEmail,
      displayName,
      providerId,
      legacySharedCliUser.id
    );
    await ensureUserSettings(legacySharedCliUser.id);
    await ensureBootstrapAdmin(legacySharedCliUser.id, normalizedEmail);
    return {
      ...legacySharedCliUser,
      email: normalizedEmail,
      name: displayName,
      provider: 'proxy',
      providerId,
    };
  }

  const userId = nanoid();
  await pgRun(
    `INSERT INTO users (id, email, name, avatar_url, provider, provider_id)
     VALUES (?, ?, ?, NULL, 'proxy', ?)`,
    userId,
    normalizedEmail,
    displayName,
    providerId
  );
  await ensureUserSettings(userId);
  await ensureBootstrapAdmin(userId, normalizedEmail);

  const createdUser = (await pgGet(
    `SELECT ${USER_SELECT} FROM users WHERE id = ?`,
    userId
  )) as unknown as User | undefined;

  if (!createdUser) {
    throw new Error('Proxy user was not created');
  }

  return createdUser;
}

export function upsertProxyUser(
  email: string,
  name?: string | null,
  username?: string | null
): Promise<User> {
  return upsertProxyUserInDatabase(email, name, username);
}
