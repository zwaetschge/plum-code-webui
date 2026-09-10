import type { PendingQuestion } from '@plum-code-webui/shared';

/**
 * The questions agents are currently blocked on, per user.
 *
 * Approvals already have a registry in `routes/permissions.ts`, which is what
 * lets the gateway overview, the widget and the watch see a blocked session
 * without holding a socket open. Questions had no equivalent: they existed only
 * as a `session:question_request` frame, so a client that was not connected and
 * subscribed at the moment the agent asked never learned about it — and a
 * background surface like a home-screen widget never is.
 *
 * Entries are keyed by request id, which is what both answer endpoints take.
 */
export interface PendingQuestionRecord extends PendingQuestion {
  userId: string;
  createdAt: number;
}

const pendingQuestions = new Map<string, PendingQuestionRecord>();

/** Record a question the agent is now waiting on. */
export function registerPendingQuestion(record: Omit<PendingQuestionRecord, 'createdAt'>): void {
  pendingQuestions.set(record.requestId, { ...record, createdAt: Date.now() });
}

/** Forget one, once it has been answered, rejected, or superseded. */
export function clearPendingQuestion(requestId: string): void {
  pendingQuestions.delete(requestId);
}

/** Forget every question of a session — it ended, so nothing is waiting. */
export function clearPendingQuestionsForSession(sessionId: string): void {
  for (const [requestId, record] of pendingQuestions.entries()) {
    if (record.sessionId === sessionId) pendingQuestions.delete(requestId);
  }
}

/** Everything this user's agents are blocked on, oldest first. */
export function listPendingQuestionsForUser(
  userId: string
): Array<Omit<PendingQuestionRecord, 'userId'>> {
  const pending: Array<Omit<PendingQuestionRecord, 'userId'>> = [];
  for (const record of pendingQuestions.values()) {
    if (record.userId !== userId) continue;
    const { userId: _ignored, ...rest } = record;
    pending.push(rest);
  }
  return pending.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Questions expire far more slowly than approvals (three minutes there).
 * An agent waiting on a question stays waiting until someone answers, so a
 * short sweep would erase a still-live prompt from every background surface
 * while the session is genuinely stuck on it.
 */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

const questionCleanupTimer = setInterval(
  () => {
    const now = Date.now();
    for (const [requestId, record] of pendingQuestions.entries()) {
      if (now - record.createdAt > MAX_AGE_MS) pendingQuestions.delete(requestId);
    }
  },
  10 * 60 * 1000
);
questionCleanupTimer.unref();
