/**
 * The empty `result` a resumed Claude CLI emits for a background task that was
 * still running when the process was stopped.
 *
 * On start the CLI reports such a task (`system` / `task_notification`) and
 * closes that report with a `result` that carries no turn at all: no turns, no
 * API time, no text. Only then does it read the prompt that is already waiting
 * on stdin. Taking this for the end of the turn marked a working session idle,
 * announced it as finished and removed it from the run journal — so the next
 * restart did not resume it.
 */
export function isEmptyNotificationResult(msg: {
  type?: string;
  num_turns?: number;
  duration_api_ms?: number;
  result?: unknown;
}): boolean {
  return (
    msg.type === 'result' && msg.num_turns === 0 && (msg.duration_api_ms ?? 0) === 0 && !msg.result
  );
}
