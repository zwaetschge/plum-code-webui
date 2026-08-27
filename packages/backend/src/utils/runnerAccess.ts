import { get as pgGet } from '../db/pg.js';

export type RunnerAccessMode = 'admin-only' | 'trusted-users';

export interface RunnerAccessDecision {
  allowed: boolean;
  reason?: string;
}

function runnerAccessMode(value = process.env.CLI_RUNNER_ACCESS): RunnerAccessMode {
  return value?.trim().toLowerCase() === 'trusted-users' ? 'trusted-users' : 'admin-only';
}

function explicitlyAllowedEmails(value = process.env.CLI_RUNNER_ALLOWED_EMAILS): Set<string> {
  return new Set(
    (value || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Until CLI processes run in separate OS/container sandboxes, only admins and
 * explicitly trusted users may start them. This prevents a normal WebUI user
 * from reading shared provider homes or broad operator mounts.
 */
export async function getRunnerAccessDecision(userId: string): Promise<RunnerAccessDecision> {
  const user = (await pgGet(
    'SELECT email, role, status FROM users WHERE id = ?',
    userId
  )) as unknown as { email: string; role: string; status: string } | undefined;

  if (!user || user.status !== 'active') {
    return { allowed: false, reason: 'Account unavailable' };
  }
  if (user.role === 'admin') return { allowed: true };
  if (explicitlyAllowedEmails().has(user.email.trim().toLowerCase())) return { allowed: true };
  if (runnerAccessMode() === 'trusted-users') return { allowed: true };

  return {
    allowed: false,
    reason:
      'Runner access is admin-only until per-user process isolation is enabled. Ask an admin to add this account to CLI_RUNNER_ALLOWED_EMAILS.',
  };
}

export async function assertRunnerAccess(userId: string): Promise<void> {
  const decision = await getRunnerAccessDecision(userId);
  if (!decision.allowed) throw new Error(decision.reason || 'Runner access denied');
}
