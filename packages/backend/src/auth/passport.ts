import { get as pgGet, run as pgRun } from '../db/pg.js';
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import type { User } from '@plum-code-webui/shared';
import { ensureBootstrapAdmin } from '../utils/adminBootstrap.js';

// Explicit column list excludes password_hash and api_key_encrypted so auth flows never
// accidentally serialize sensitive columns into the session or OAuth profile responses.
const USER_PUBLIC_COLUMNS = `
  id, email, name, avatar_url, provider, provider_id, created_at, updated_at
`;

interface OAuthProfile {
  id: string;
  emails?: Array<{ value: string }>;
  displayName?: string;
  photos?: Array<{ value: string }>;
}

class OAuthEmailCollisionError extends Error {
  constructor(
    public readonly email: string,
    public readonly existingProvider: string,
    public readonly incomingProvider: string
  ) {
    super(
      `Email ${email} is already linked to ${existingProvider}; sign in with that provider first to link accounts`
    );
    this.name = 'OAuthEmailCollisionError';
  }
}

class EmailNotAllowedError extends Error {
  constructor(public readonly email: string) {
    super(`Email ${email} is not on the AUTH_ALLOWED_EMAILS allowlist`);
    this.name = 'EmailNotAllowedError';
  }
}

function isEmailAllowed(email: string): boolean {
  if (config.auth.allowedEmails.length === 0) return true;
  return config.auth.allowedEmails.includes(email.trim().toLowerCase());
}

async function findOrCreateUser(
  provider: 'github' | 'google',
  profile: OAuthProfile
): Promise<User> {
  const profileEmail = profile.emails?.[0]?.value;
  // Use a provider-namespaced synthetic email when the profile has none, so we never
  // collide with another user's real email.
  const email = profileEmail || `${profile.id}@${provider}.local`;

  if (!isEmailAllowed(email)) {
    throw new EmailNotAllowedError(email);
  }

  // Try to find existing user for this (provider, providerId) tuple
  const existingUser = (await pgGet(
    `SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE provider = ? AND provider_id = ?`,
    provider,
    profile.id
  )) as unknown as User | undefined;

  if (existingUser) {
    // Guard: if the profile's current email now matches a DIFFERENT user's email
    // (e.g. email changed at the provider), skip the email update to avoid
    // violating UNIQUE(email). Name/avatar are still refreshed.
    const conflictingEmailOwner = (await pgGet(
      `SELECT id FROM users WHERE email = ? AND id != ?`,
      email,
      existingUser.id
    )) as unknown as { id: string } | undefined;

    if (conflictingEmailOwner) {
      await pgRun(
        `UPDATE users SET
          name = ?,
          avatar_url = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        profile.displayName || null,
        profile.photos?.[0]?.value || null,
        existingUser.id
      );
    } else {
      await pgRun(
        `UPDATE users SET
          name = ?,
          avatar_url = ?,
          email = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        profile.displayName || null,
        profile.photos?.[0]?.value || null,
        email,
        existingUser.id
      );
    }

    await ensureBootstrapAdmin(existingUser.id, email);
    return {
      ...existingUser,
      name: profile.displayName || existingUser.name,
      avatarUrl: profile.photos?.[0]?.value || existingUser.avatarUrl,
    };
  }

  // New signup: fail closed if the email already belongs to a different provider.
  // Silent auto-linking would allow a hostile OAuth provider that returns a victim's
  // email to take over the account.
  const emailOwner = (await pgGet(
    `SELECT id, provider FROM users WHERE email = ?`,
    email
  )) as unknown as { id: string; provider: string } | undefined;

  if (emailOwner) {
    throw new OAuthEmailCollisionError(email, emailOwner.provider, provider);
  }

  // Create new user
  const userId = nanoid();
  try {
    await pgRun(
      `INSERT INTO users (id, email, name, avatar_url, provider, provider_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      userId,
      email,
      profile.displayName || null,
      profile.photos?.[0]?.value || null,
      provider,
      profile.id
    );
  } catch (err) {
    // Defense in depth: race condition between the check above and the insert.
    const errMessage = err instanceof Error ? err.message : String(err);
    if (errMessage.includes('UNIQUE') && errMessage.includes('users.email')) {
      throw new OAuthEmailCollisionError(email, 'unknown', provider);
    }
    throw err;
  }

  // Create default settings
  await pgRun(
    `INSERT INTO user_settings (user_id, theme, allowed_tools)
     VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`,
    userId
  );

  await ensureBootstrapAdmin(userId, email);

  return {
    id: userId,
    email,
    name: profile.displayName || null,
    avatarUrl: profile.photos?.[0]?.value || null,
    provider,
    providerId: profile.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export { OAuthEmailCollisionError, EmailNotAllowedError, isEmailAllowed };

export function setupPassport(): void {
  // Serialize user to session
  passport.serializeUser((user, done) => {
    done(null, (user as User).id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await pgGet(`SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = ?`, id);
      done(null, user || null);
    } catch (err) {
      done(err, null);
    }
  });

  // GitHub Strategy
  if (config.github.clientId && config.github.clientSecret && config.github.callbackUrl) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: config.github.clientId,
          clientSecret: config.github.clientSecret,
          callbackURL: config.github.callbackUrl,
          scope: ['user:email'],
        },
        async (
          _accessToken: string,
          _refreshToken: string,
          profile: OAuthProfile,
          done: (err: Error | null, user?: User) => void
        ) => {
          try {
            const user = await findOrCreateUser('github', profile);
            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        }
      )
    );
  }

  // Google Strategy
  if (config.google.clientId && config.google.clientSecret && config.google.callbackUrl) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.google.clientId,
          clientSecret: config.google.clientSecret,
          callbackURL: config.google.callbackUrl,
          scope: ['profile', 'email'],
        },
        async (
          _accessToken: string,
          _refreshToken: string,
          profile: OAuthProfile,
          done: (err: Error | null, user?: User) => void
        ) => {
          try {
            const user = await findOrCreateUser('google', profile);
            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        }
      )
    );
  }
}
