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
import { resolveConfigHome } from '../../utils/configPaths.js';
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

/**
 * Books what agents spent and no turn booked: agents that kept working after
 * their turn's result, and runs a restart cut off.
 *
 * Runs at boot over the transcripts that changed in the last `days`. Reading
 * is the expensive part — the transcripts on disk run to gigabytes — so the
 * window stays short there; a one-off pass with a large `days` books whatever
 * older sessions spent before agents were counted at all.
 */
export async function reconcileClaudeSubagentUsage(
  options: { days?: number; configHome?: string } = {}
): Promise<{ sessions: number; rows: number }> {
  const modifiedSince = Date.now() - (options.days ?? 3) * 86_400_000;
  // A session's chats each run a Claude Code session of their own.
  const sessions = (await pgAll(
    `SELECT s.id, s.user_id, s.cli_provider, ids.claude_session_id, s.working_directory
       FROM sessions s
       JOIN (
         SELECT id AS session_id, claude_session_id FROM sessions
          WHERE claude_session_id IS NOT NULL
         UNION
         SELECT session_id, provider_session_id FROM session_chats
          WHERE provider_session_id IS NOT NULL
       ) ids ON ids.session_id = s.id
      WHERE s.cli_provider IN ('claude', 'zai')`
  )) as unknown as Array<{
    id: string;
    user_id: string;
    cli_provider: 'claude' | 'zai';
    claude_session_id: string;
    working_directory: string | null;
  }>;
  const bookingId = `reconcile:${new Date().toISOString().slice(0, 19)}`;
  const configHome = options.configHome ?? resolveConfigHome('claude');
  const directories = await indexClaudeSubagentDirs(configHome);
  let touched = 0;
  let rows = 0;
  for (const session of sessions) {
    const directory = directories.get(session.claude_session_id);
    if (!directory) continue; // never started an agent
    try {
      const written = await bookClaudeSubagentUsage({
        sessionId: session.id,
        userId: session.user_id,
        provider: session.cli_provider,
        claudeSessionId: session.claude_session_id,
        workingDirectory: session.working_directory,
        bookingId,
        atCallTime: true,
        configHome,
        directory,
        modifiedSince,
      });
      if (written > 0) {
        touched += 1;
        rows += written;
      }
    } catch (error) {
      console.warn(`[USAGE] Subagent reconcile failed for session ${session.id}:`, error);
    }
  }
  return { sessions: touched, rows };
}
