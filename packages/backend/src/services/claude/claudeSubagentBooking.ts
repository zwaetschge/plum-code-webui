/**
 * Books what a Claude Code session's subagents spent.
 *
 * The figures come from the agents' transcripts (claudeSubagentUsage.ts); what
 * has been booked already comes from the database. The difference is written,
 * so the same call is safe at the end of every turn, after a crash, and over a
 * session that ended long ago — it never books a token twice and never needs
 * to remember where it stopped.
 */

import { estimateModelCost } from '@plum-code-webui/shared';

import {
  bookSubagentUsage,
  bookedSubagentTokens,
  type SubagentUsageBooking,
} from '../../db/index.js';
import { all as pgAll } from '../../db/pg.js';
import path from 'path';

import { resolveConfigHome } from '../../utils/configPaths.js';
import { claudeProjectSlug } from '../../utils/projectMemory.js';
import { isAnthropicModel } from '../modelRouter.js';
import {
  NO_TOKENS,
  indexClaudeSubagentDirs,
  readClaudeSubagentUsage,
  tokensBeyond,
  totalTokens,
  type ClaudeAgentUsage,
} from './claudeSubagentUsage.js';

export interface ClaudeSubagentBookingInput {
  sessionId: string;
  userId: string;
  /** `claude`, or `zai` for the Claude CLI on the Z.AI endpoint. */
  provider: 'claude' | 'zai';
  claudeSessionId: string;
  workingDirectory?: string | null;
  /** Names this booking; the same agent is booked at most once under it. */
  bookingId: string;
  /**
   * Stamp each row with the agent's last model call instead of now. For usage
   * that is found after the fact, so that it lands on the day it was spent.
   */
  atCallTime?: boolean;
  configHome?: string;
  /** Where the agents' transcripts are, if the caller has looked already. */
  directory?: string;
  /** Only agents whose transcript changed since then (ms since epoch). */
  modifiedSince?: number;
  /**
   * Book only if the session has turns in the ledger from around the time the
   * agents worked. For transcripts attributed by their project directory alone.
   */
  onlyWithTurnsNearby?: boolean;
}

/**
 * Which of an agent's calls this booking counts.
 *
 * A `claude` session reaches other vendors' models only through the model
 * router, and the router writes that usage itself as each response completes.
 * A `zai` session talks to one endpoint for everything; nothing else books it.
 */
export function countsForProvider(provider: 'claude' | 'zai'): (model: string) => boolean {
  return provider === 'claude' ? (model) => isAnthropicModel(model) : () => true;
}

/** Rows for whatever the transcripts show beyond what the database holds. */
export function unbookedSubagentRows(
  input: ClaudeSubagentBookingInput,
  agents: ClaudeAgentUsage[],
  booked: Map<string, typeof NO_TOKENS>
): SubagentUsageBooking[] {
  const rows: SubagentUsageBooking[] = [];
  for (const agent of agents) {
    const open = tokensBeyond(agent.usage, booked.get(agent.agentId) ?? NO_TOKENS);
    const total = totalTokens(open);
    if (total === 0) continue;
    rows.push({
      userId: input.userId,
      sessionId: input.sessionId,
      provider: input.provider,
      turnId: input.bookingId,
      agentId: agent.agentId,
      parentAgentId: null,
      agentType: agent.agentType,
      model: agent.model,
      ...open,
      totalTokens: total,
      costUsd: estimateModelCost(agent.model ?? '', open, null).cost,
      spentAt: input.atCallTime ? agent.lastCallAt : null,
    });
  }
  return rows;
}

/** One booking at a time per session: two at once would both see the same gap. */
const inFlight = new Map<string, Promise<unknown>>();

export function bookClaudeSubagentUsage(input: ClaudeSubagentBookingInput): Promise<number> {
  const previous = inFlight.get(input.sessionId) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const agents = await readClaudeSubagentUsage(
        input.configHome ?? resolveConfigHome(input.provider),
        input.claudeSessionId,
        {
          workingDirectory: input.workingDirectory,
          countsModel: countsForProvider(input.provider),
          directory: input.directory,
          modifiedSince: input.modifiedSince,
        }
      );
      if (agents.length === 0) return 0;
      if (input.onlyWithTurnsNearby && !(await hasTurnsNear(input.sessionId, agents))) return 0;
      const booked = await bookedSubagentTokens(input.sessionId, input.provider);
      return bookSubagentUsage(unbookedSubagentRows(input, agents, booked));
    });
  inFlight.set(input.sessionId, run);
  void run
    .catch(() => undefined)
    .finally(() => {
      if (inFlight.get(input.sessionId) === run) inFlight.delete(input.sessionId);
    });
  return run;
}

const ledgerTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** Whether the session booked a turn of its own within a day of the agents' work. */
async function hasTurnsNear(sessionId: string, agents: ClaudeAgentUsage[]): Promise<boolean> {
  const times = agents
    .map((agent) => Date.parse(agent.lastCallAt ?? ''))
    .filter((time) => Number.isFinite(time));
  if (times.length === 0) return false;
  const rows = await pgAll(
    `SELECT 1 FROM usage_history
      WHERE session_id = ? AND turn_id NOT LIKE 'agent:%'
        AND created_at >= ? AND created_at <= ?
      LIMIT 1`,
    sessionId,
    ledgerTime(Math.min(...times) - 86_400_000),
    ledgerTime(Math.max(...times) + 86_400_000)
  );
  return rows.length > 0;
}

/**
 * Books what agents spent and no turn booked: agents that kept working after
 * their turn's result, and runs a restart cut off.
 *
 * Runs at boot over the transcripts that changed in the last `days`. Reading
 * is the expensive part — the transcripts on disk run to gigabytes — so the
 * window stays short there; a one-off pass with a large `days` books whatever
 * older sessions spent before agents were counted at all.
 *
 * A session does not keep one Claude Code session for life: it starts a new
 * one after a context handoff, among other things, and Plum remembers only the
 * current id. Most transcripts on disk therefore belong to ids no session
 * points to any more. Those are attributed by their project directory — but
 * only where that directory has exactly one session, and that session booked
 * turns of its own around the time the agents worked.
 */
export async function reconcileClaudeSubagentUsage(
  options: { days?: number; configHome?: string } = {}
): Promise<{ sessions: number; rows: number }> {
  const modifiedSince = Date.now() - (options.days ?? 3) * 86_400_000;
  const sessions = (await pgAll(
    `SELECT id, user_id, cli_provider, claude_session_id, working_directory FROM sessions`
  )) as unknown as Array<{
    id: string;
    user_id: string;
    cli_provider: string | null;
    claude_session_id: string | null;
    working_directory: string | null;
  }>;
  // A session's chats each run a Claude Code session of their own.
  const chats = (await pgAll(
    `SELECT session_id, provider_session_id FROM session_chats
      WHERE provider_session_id IS NOT NULL`
  )) as unknown as Array<{ session_id: string; provider_session_id: string }>;

  const byId = new Map(sessions.map((session) => [session.id, session]));
  const current = new Map<string, string>(); // Claude session id -> Plum session id
  for (const session of sessions) {
    if (session.claude_session_id) current.set(session.claude_session_id, session.id);
  }
  for (const chat of chats) current.set(chat.provider_session_id, chat.session_id);
  const inProject = new Map<string, string[]>(); // project directory name -> Plum session ids
  for (const session of sessions) {
    if (!session.working_directory) continue;
    const project = claudeProjectSlug(session.working_directory);
    inProject.set(project, [...(inProject.get(project) ?? []), session.id]);
  }

  const bookingId = `reconcile:${new Date().toISOString().slice(0, 19)}`;
  const configHome = options.configHome ?? resolveConfigHome('claude');
  const touched = new Set<string>();
  let rows = 0;
  for (const [claudeSessionId, directory] of await indexClaudeSubagentDirs(configHome)) {
    let owner = byId.get(current.get(claudeSessionId) ?? '');
    let former = false;
    if (!owner) {
      // <config home>/projects/<project>/<session id>/subagents
      const project = path.basename(path.dirname(path.dirname(directory)));
      const candidates = inProject.get(project) ?? [];
      if (candidates.length !== 1) continue; // nobody, or not clear who
      owner = byId.get(candidates[0] ?? '');
      former = true;
    }
    if (!owner) continue;
    // A former id is from the session's time on Claude, whatever it runs now.
    const provider =
      !former && owner.cli_provider === 'zai'
        ? 'zai'
        : former || owner.cli_provider === 'claude'
          ? 'claude'
          : null;
    if (!provider) continue;
    try {
      const written = await bookClaudeSubagentUsage({
        sessionId: owner.id,
        userId: owner.user_id,
        provider,
        claudeSessionId,
        workingDirectory: owner.working_directory,
        bookingId,
        atCallTime: true,
        configHome,
        directory,
        modifiedSince,
        onlyWithTurnsNearby: former,
      });
      if (written > 0) {
        touched.add(owner.id);
        rows += written;
      }
    } catch (error) {
      console.warn(`[USAGE] Subagent reconcile failed for session ${owner.id}:`, error);
    }
  }
  return { sessions: touched.size, rows };
}
