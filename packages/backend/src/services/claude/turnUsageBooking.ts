/**
 * Which part of a running turn's tokens still has to be written.
 *
 * A turn used to be one row, written at its result and keyed by the id of the
 * message that started it. But Claude Code can report several results for one
 * message: when a background task or agent finishes, it carries on by itself
 * and ends with a result of its own. Those came in under the same id, were
 * taken for a repeat of the first, and dropped — everything a session did
 * after its first background task was missing from the analytics.
 *
 * Now each result books what the counters hold beyond the last booking, under
 * an id of its own. Booking the same state twice still writes nothing, which
 * is what the shutdown flush and retries rely on.
 */

import { NO_TOKENS, tokensBeyond, totalTokens, type TokenCounters } from './claudeSubagentUsage.js';

export interface TurnBookingState {
  /** The turn id the last booking was made for. */
  usageBookedBaseId?: string;
  /** Bookings written for that turn so far. */
  usageBookedCount?: number;
  /** What of the running turn's counters the ledger already holds. */
  turnBookedTokens?: TokenCounters;
}

/** The row to write for the counters as they stand, or null if nothing is new. */
export function planTurnBooking(
  state: TurnBookingState,
  baseId: string,
  turn: TokenCounters
): { turnId: string; tokens: TokenCounters } | null {
  const tokens = tokensBeyond(turn, state.turnBookedTokens ?? NO_TOKENS);
  if (totalTokens(tokens) === 0) return null;
  const earlier = state.usageBookedBaseId === baseId ? (state.usageBookedCount ?? 0) : 0;
  return { turnId: earlier > 0 ? `${baseId}:c${earlier}` : baseId, tokens };
}

/** Remember that the counters, as they stand, are in the ledger. */
export function recordTurnBooking(
  state: TurnBookingState,
  baseId: string,
  turn: TokenCounters
): void {
  state.usageBookedCount =
    state.usageBookedBaseId === baseId ? (state.usageBookedCount ?? 0) + 1 : 1;
  state.usageBookedBaseId = baseId;
  state.turnBookedTokens = { ...turn };
}
