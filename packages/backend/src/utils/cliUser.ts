import { get as pgGet } from '../db/pg.js';
import type { User } from '@plum-code-webui/shared';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  provider: User['provider'];
  provider_id: string;
  password_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthLookupResult {
  user: User;
  passwordHash: string;
}

export async function findUserForBasicAuth(
  usernameOrEmail: string
): Promise<AuthLookupResult | null> {
  const lookup = usernameOrEmail.trim();
  if (!lookup) return null;

  const row = (await pgGet(
    `SELECT id, email, name, avatar_url, provider, provider_id, password_hash, created_at, updated_at
     FROM users
     WHERE (LOWER(email) = LOWER(?) OR LOWER(name) = LOWER(?))
       AND password_hash IS NOT NULL AND password_hash <> ''
     LIMIT 1`,
    lookup,
    lookup
  )) as unknown as UserRow | undefined;

  if (!row) return null;

  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatar_url,
      provider: row.provider,
      providerId: row.provider_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    passwordHash: row.password_hash!,
  };
}
