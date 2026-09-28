import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../dist/cli/permission-prompt.js', import.meta.url));
const input = JSON.stringify({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'printf ok' },
  session_id: 'hook-regression-test',
});

for (const [mode, decision] of [
  ['auto-accept', 'allow'],
  ['planning', 'deny'],
]) {
  const result = spawnSync(process.execPath, [hook], {
    encoding: 'utf8',
    input,
    env: { ...process.env, WEBUI_SESSION_ID: 'hook-regression-test', WEBUI_SESSION_MODE: mode },
    timeout: 5000,
  });
  assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.hookSpecificOutput?.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput?.permissionDecision, decision);
}

console.log('PASS: Claude PreToolUse hook returns valid allow and deny decisions');
