import type { NextFunction, Request, Response } from 'express';

import { AppError } from './errorHandler.js';
import type { AuthenticatedRequest } from './auth.js';
import { getRunnerAccessDecision } from '../utils/runnerAccess.js';

/**
 * Gate for the operator surface: the raw filesystem API, git, the preview
 * process launcher, project memory, the Android/device bridge, the GitHub CLI
 * and the Claude spawner. These used to require only authentication, so any of
 * the non-admin accounts could read the server's own secrets through the file
 * API, plant prompt-injection into an admin's memory, or start a process that
 * runs as the backend user.
 *
 * Runner access is admin-only by default (`CLI_RUNNER_ACCESS`), matching the
 * fact that CLI sessions share provider homes and a Unix user. A gateway token
 * (the swarm bridge, an external supervisor) acts for its owner, so the owner's
 * runner access decides; a read-only token is already held to safe methods by
 * `requireAuth`, and secret paths are refused for everyone (`isSensitivePath`).
 * Must run AFTER `requireAuth` so `userId` is set.
 */
export async function requireRunnerAccess(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authed = req as AuthenticatedRequest;
  if (!authed.userId) {
    throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  }
  const decision = await getRunnerAccessDecision(authed.userId);
  if (!decision.allowed) {
    throw new AppError(decision.reason || 'Runner access required', 403, 'RUNNER_ACCESS_REQUIRED');
  }
  next();
}
