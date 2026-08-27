import { get as pgGet, run as pgRun } from '../db/pg.js';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { getAppConfig, setAppConfig } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { AppError } from '../middleware/errorHandler.js';
import { generateUserToken } from '../utils/authTokens.js';
import { findUserForBasicAuth } from '../utils/cliUser.js';
import { stampLogin, auditFromRequest } from '../utils/auditLog.js';
import { isEmailAllowed } from '../auth/passport.js';

const router = Router();

// Login schema
const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// Fixed hash used only to equalize timing when the username doesn't match any
// user — prevents username enumeration via response-time side channel.
// `bcrypt.compareSync` against a real hash costs ~80-120ms; matching that
// against an arbitrary value keeps the attacker from distinguishing
// "user not found" from "bad password". The plaintext is irrelevant.
const TIMING_SAFE_DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8T3oB5Ec6sTh6bN1/FphR6dXy.cLLG';

// Change credentials schema
const changeCredentialsSchema = z.object({
  currentPassword: z.string().min(1),
  newUsername: z.string().min(3).optional(),
  newPassword: z.string().min(6).optional(),
});

// Check if basic auth is enabled
router.get('/status', (_req, res) => {
  const enabled = getAppConfig('basic_auth_enabled');
  res.json({
    success: true,
    data: {
      enabled: enabled === 'true',
    },
  });
});

// Login with username/password — rate limited to prevent brute-force
router.post('/login', rateLimiters.strict, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { username, password } = parsed.data;

  // Check if basic auth is enabled
  const enabled = getAppConfig('basic_auth_enabled');
  if (enabled !== 'true') {
    throw new AppError('Basic authentication is disabled', 403, 'AUTH_DISABLED');
  }

  // Multi-user lookup: match by email OR name, then verify password.
  // When the user doesn't exist, still run bcrypt against a dummy hash so the
  // response time doesn't reveal whether the username was valid.
  const lookup = await findUserForBasicAuth(username);
  if (!lookup) {
    bcrypt.compareSync(password, TIMING_SAFE_DUMMY_HASH);
    await auditFromRequest(req, 'auth.login.failure', {
      metadata: { method: 'basic', username, reason: 'user_not_found' },
    });
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  const passwordValid = bcrypt.compareSync(password, lookup.passwordHash);
  if (!passwordValid) {
    await auditFromRequest(req, 'auth.login.failure', {
      resourceType: 'user',
      resourceId: lookup.user.id,
      metadata: { method: 'basic', username, reason: 'bad_password' },
    });
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  const { user } = lookup;
  // Even if a basic-auth row exists in the local DB (e.g. legacy seed, or a
  // user the operator hasn't removed yet), enforce the allowlist as the
  // single source of truth so revoking access is just an env-var change.
  if (!isEmailAllowed(user.email)) {
    await auditFromRequest(req, 'auth.login.failure', {
      resourceType: 'user',
      resourceId: user.id,
      metadata: { method: 'basic', username, reason: 'email_not_allowed' },
    });
    throw new AppError('Account not permitted on this instance', 403, 'EMAIL_NOT_ALLOWED');
  }

  await stampLogin(user.id, 'basic', req);
  const token = generateUserToken(user.id, { basicAuth: true, expiresIn: '30d' });

  // Also establish a Passport session so cookie-only requests (e.g. <img> tags
  // hitting /generated/*.png) can authenticate without an Authorization header.
  await new Promise<void>((resolve, reject) => {
    req.login(user, (err) => (err ? reject(err) : resolve()));
  });

  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        provider: user.provider,
        providerId: user.providerId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    },
  });
});

// Verify basic auth token
router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.json({ success: true, data: { valid: false } });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { basicAuth?: boolean };
    if (decoded.basicAuth) {
      return res.json({ success: true, data: { valid: true } });
    }
  } catch {
    // Token invalid or expired
  }

  res.json({ success: true, data: { valid: false } });
});

// Logout (just returns success, client should clear token)
router.post('/logout', (_req, res) => {
  res.json({ success: true });
});

// Get current credentials info (not the actual password)
router.get('/credentials', requireAuth, async (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;

  const row = (await pgGet('SELECT name FROM users WHERE id = ?', userId)) as unknown as
    | { name: string | null }
    | undefined;
  const enabled = getAppConfig('basic_auth_enabled');

  res.json({
    success: true,
    data: {
      username: row?.name || 'admin',
      enabled: enabled === 'true',
    },
  });
});

// Change credentials for the currently authenticated user
router.put('/credentials', requireAuth, async (req, res) => {
  const parsed = changeCredentialsSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { currentPassword, newUsername, newPassword } = parsed.data;
  const userId = (req as unknown as { userId: string }).userId;

  const userRow = (await pgGet(
    'SELECT name, password_hash FROM users WHERE id = ?',
    userId
  )) as unknown as { name: string | null; password_hash: string | null } | undefined;

  if (!userRow || !userRow.password_hash) {
    throw new AppError('User has no password set', 500, 'AUTH_NOT_CONFIGURED');
  }

  const passwordValid = bcrypt.compareSync(currentPassword, userRow.password_hash);
  if (!passwordValid) {
    throw new AppError('Current password is incorrect', 401, 'INVALID_PASSWORD');
  }

  if (newUsername) {
    await pgRun(
      'UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      newUsername,
      userId
    );
    // Keep legacy app_config in sync for the admin account so the single-credential initializer stays consistent
    if (getAppConfig('basic_auth_username') === userRow.name) {
      setAppConfig('basic_auth_username', newUsername);
    }
  }

  if (newPassword) {
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await pgRun(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      hashedPassword,
      userId
    );
    if (getAppConfig('basic_auth_username') === (newUsername || userRow.name)) {
      setAppConfig('basic_auth_password', hashedPassword);
    }
  }

  const updatedRow = (await pgGet('SELECT name FROM users WHERE id = ?', userId)) as unknown as
    | { name: string | null }
    | undefined;

  res.json({
    success: true,
    data: {
      username: updatedRow?.name,
      message: 'Credentials updated successfully',
    },
  });
});

// Toggle basic auth enabled/disabled
router.put('/toggle', requireAuth, requireAdmin, (req, res) => {
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    throw new AppError('Invalid input: enabled must be a boolean', 400, 'VALIDATION_ERROR');
  }

  setAppConfig('basic_auth_enabled', enabled ? 'true' : 'false');

  res.json({
    success: true,
    data: {
      enabled,
      message: enabled ? 'Basic auth enabled' : 'Basic auth disabled',
    },
  });
});

export default router;
