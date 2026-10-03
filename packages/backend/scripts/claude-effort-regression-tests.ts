import assert from 'node:assert/strict';
import { CLAUDE_CODE_EFFORT_OPTIONS, CLI_FORWARDED_COMMANDS } from '@plum-code-webui/shared';
import { normalizeReasoningLevel } from '../src/utils/reasoningLevel.js';
import {
  claudeEffortLaunch,
  getCLIArgs,
  vibeThinkingLevel,
} from '../src/services/cli-providers.js';
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
      // Ultrathink and Ultracode are Plum choices on top of a real effort.
      const effort = value === 'ultrathink' ? 'max' : value === 'ultracode' ? 'xhigh' : value;
      assert.equal(args[args.indexOf('--effort') + 1], effort);
      const settings = args.includes('--settings')
        ? JSON.parse(args[args.indexOf('--settings') + 1]!)
        : {};
      assert.equal(
        settings.ultracode === true,
        value === 'ultracode',
        `${value} ultracode setting`
      );
      if (value === 'ultracode') assert.equal(settings.enableWorkflows, true);
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
// Ultracode runs workflows: natively in Claude Code (and behind Z.AI), through
// Plum's extension in Pi and Plum's MCP server in Vibe. Harnesses without a
// workflow runner must reject it so no session offers an effort they ignore.
for (const provider of ['pi', 'claude', 'zai', 'vibe'] as const) {
  assert.equal(normalizeReasoningLevel(provider, 'ultracode'), 'ultracode');
}
for (const provider of ['codex', 'opencode', 'kimi'] as const) {
  assert.equal(normalizeReasoningLevel(provider, 'ultracode'), null);
}
// Ultrathink is Claude Code's prompt keyword.
for (const provider of ['codex', 'opencode', 'kimi', 'pi', 'vibe'] as const) {
  assert.equal(normalizeReasoningLevel(provider, 'ultrathink'), null);
}
assert.deepEqual(claudeEffortLaunch('ultrathink'), {
  effort: 'max',
  ultrathink: true,
  ultracode: false,
});
assert.deepEqual(claudeEffortLaunch('high'), {
  effort: 'high',
  ultrathink: false,
  ultracode: false,
});
assert.equal(vibeThinkingLevel('ultracode'), 'high');
assert.equal(vibeThinkingLevel('max'), 'max');
console.log(
  'PASS: Claude/Z.AI effort incl. Ultrathink/Ultracode, launch/resume arguments and native command parity'
);
