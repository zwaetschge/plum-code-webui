/** Bounded continuation context: keep instructions ahead of incidental progress. */
export function buildContinuationHandoff(input: {
  original: string | null;
  users: string[];
  recent: Array<{ role: string; content: string }>;
  maxChars: number;
}): string | null {
  const clip = (text: string, max: number) =>
    text.length <= max ? text : text.slice(0, max / 2) + '\n[…]\n' + text.slice(-max / 2);
  const sections: string[] = [];
  if (input.original?.trim())
    sections.push(
      'Original request (later user instructions take precedence):\n' +
        clip(input.original.trim(), Math.min(6000, Math.floor(input.maxChars * 0.15)))
    );
  const substantive = input.users.filter(
    (s) => !/^(?:weiter|continue|resume|done\??|fertig\??|ok|ja|go)[.!?\s]*$/i.test(s.trim())
  );
  const instructions = [...new Set([...substantive.slice(-6), ...input.users.slice(-2)])];
  if (instructions.length)
    sections.push(
      'Latest user instructions and steering:\n' +
        instructions
          .map((s) =>
            clip(
              s.trim(),
              Math.min(2200, Math.floor((input.maxChars * 0.45) / Math.max(1, instructions.length)))
            )
          )
          .join('\n\n')
    );
  const history = input.recent
    .map((row) => `${row.role === 'user' ? 'User' : 'Assistant'}: ${row.content.trim()}`)
    .join('\n\n');
  const header =
    'Continue the unfinished user request from the current state. Completed work stays completed. Use the latest steering; do not ask for reconfirmation of existing authority. Verify the next unfinished step before acting.\n\n';
  const essential = sections.join('\n\n');
  const remaining = Math.max(0, input.maxChars - header.length - essential.length - 40);
  const tail =
    history.length <= remaining
      ? history
      : '[Earlier progress omitted]\n' + (remaining > 27 ? history.slice(-(remaining - 27)) : '');
  const result = header + essential + (tail ? '\n\nMost recent progress:\n' + tail : '');
  return input.original || input.users.length || input.recent.length
    ? result.slice(0, input.maxChars)
    : null;
}

export const CONTEXT_CONTINUATION_PROMPT =
  'Continue the unfinished task using the saved handoff. Apply the latest user instructions, keep completed work, and carry out the next unfinished step. If the requested outcome has already been verified, report it briefly and stop.';
