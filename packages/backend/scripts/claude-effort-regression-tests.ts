import assert from 'node:assert/strict';
import { CLAUDE_CODE_EFFORT_OPTIONS, CLI_FORWARDED_COMMANDS } from '@plum-code-webui/shared';
import { normalizeReasoningLevel } from '../src/utils/reasoningLevel.js';
import { getCLIArgs } from '../src/services/cli-providers.js';
import { commandService } from '../src/services/commands.js';

for (const provider of ['claude', 'zai'] as const) {
  for (const { value } of CLAUDE_CODE_EFFORT_OPTIONS) {
    const normalized = normalizeReasoningLevel(provider, ` ${value.toUpperCase()} `);
    assert.equal(normalized, value, `${provider} must preserve ${value}`);
    for (const resumeSessionId of [undefined, 'native-session']) {
      const args = getCLIArgs(provider, {
        reasoningLevel: normalized!,
        mode: 'danger',
        resumeSessionId,
      });
      assert.equal(args[args.indexOf('--effort') + 1], value);
      if (resumeSessionId) assert.equal(args[args.indexOf('--resume') + 1], resumeSessionId);
    }
  }
  assert.equal(normalizeReasoningLevel(provider, 'ultra'), null);
  assert.equal(normalizeReasoningLevel(provider, null), null);
  assert.equal(normalizeReasoningLevel(provider, 'unsupported'), null);
  const parsed = commandService.parseCommand('/effort ultracode')!;
  assert.deepEqual(await commandService.executeCommand(parsed, { provider }), {
    success: true,
    action: 'forward_to_cli',
    response: '/effort ultracode',
  });
}
for (const command of CLI_FORWARDED_COMMANDS) {
  const parsed = commandService.parseCommand(`/${command}`)!;
  assert.deepEqual(
    await commandService.executeCommand(parsed, { provider: 'zai' }),
    await commandService.executeCommand(parsed, { provider: 'claude' }),
    `Z.AI must expose the same /${command} command as Claude Code`
  );
}
assert.equal(normalizeReasoningLevel('codex', 'ultra'), 'ultra');
// Ultracode is Pi's workflow effort; every other harness must reject it so no
// session offers an effort its CLI does not understand.
assert.equal(normalizeReasoningLevel('pi', 'ultracode'), 'ultracode');
for (const provider of ['codex', 'opencode', 'kimi', 'claude', 'zai', 'vibe'] as const) {
  assert.equal(normalizeReasoningLevel(provider, 'ultracode'), null);
}
console.log('PASS: Claude/Z.AI effort, launch/resume arguments and native command parity');
