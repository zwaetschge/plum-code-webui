/** Wait completion only means the wait call returned; inspect each target's reported state. */
export function subagentWaitOutcomes(
  result: unknown
): Record<string, 'completed' | 'failed' | 'cancelled' | 'interrupted'> {
  let value: any = result;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (Array.isArray(value?.content)) {
    for (const block of value.content) {
      if (block.type === 'text') {
        const found = subagentWaitOutcomes(block.text);
        if (Object.keys(found).length) return found;
      }
    }
  }
  const states = value?.agents_states ?? value?.agentsStates ?? value?.status;
  if (!states || typeof states !== 'object') return {};
  const output: Record<string, 'completed' | 'failed' | 'cancelled' | 'interrupted'> = {};
  for (const [id, state] of Object.entries(states)) {
    const status = typeof state === 'string' ? state : (state as any)?.status;
    if (status === 'completed' || (state && typeof state === 'object' && 'completed' in state))
      output[id] = 'completed';
    else if (
      ['failed', 'errored', 'error'].includes(status) ||
      (state && typeof state === 'object' && ('errored' in state || 'error' in state))
    )
      output[id] = 'failed';
    else if (status === 'interrupted') output[id] = 'interrupted';
    else if (['cancelled', 'shutdown', 'closed'].includes(status)) output[id] = 'cancelled';
  }
  return output;
}
