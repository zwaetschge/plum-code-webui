import assert from 'node:assert/strict';

import {
  extractCliDeviceCode,
  extractCliLoginUrl,
  resolveCliLoginInvocation,
  stripCliLoginAnsi,
  extractCliLoginUrlFrom,
} from '../src/utils/cliLoginOutput.js';

const codexOutput = [
  '\u001b[2mWelcome to Codex\u001b[0m',
  'Open this URL in your browser:',
  'https://auth.openai.com/codex/device',
  'Enter this one-time code:',
  'ABCD-1234',
].join('\n');

assert.equal(extractCliLoginUrl(codexOutput), 'https://auth.openai.com/codex/device');
assert.equal(extractCliDeviceCode(codexOutput), 'ABCD-1234');
assert.doesNotMatch(stripCliLoginAnsi(codexOutput), /\u001b/);

const claudeOutput =
  'Open https://claude.ai/oauth/authorize?code=true&state=opaque-value. Then paste the code here.';
assert.equal(
  extractCliLoginUrl(claudeOutput),
  'https://claude.ai/oauth/authorize?code=true&state=opaque-value'
);
assert.equal(extractCliDeviceCode(claudeOutput), null);

assert.equal(extractCliLoginUrl('No browser link yet.'), null);
assert.equal(extractCliDeviceCode('Authorization code: short-code'), null);

assert.deepEqual(resolveCliLoginInvocation('codex'), ['login', '--device-auth']);
assert.deepEqual(resolveCliLoginInvocation('claude'), ['auth', 'login']);
assert.equal(resolveCliLoginInvocation('zai'), null);

console.log('CLI login regression tests passed');

// Pi 1.5 shows its changelog before the prompt; its links are not the login.
{
  const changelog =
    "What's new in 1.5.2\n- Fixed OAuth state mismatch (https://github.com/earendil-works/pi/issues/10265)\n";
  const login =
    '/login antigravity\nOpen this URL to sign in: https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y\n';
  // Before the command is typed nothing counts.
  assert.equal(extractCliLoginUrlFrom(changelog, null), null);
  // After it, only what follows the command.
  assert.equal(
    extractCliLoginUrlFrom(changelog + login, changelog.length),
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y'
  );
  // Logins that are not TUI commands read the whole output, as before.
  assert.equal(
    extractCliLoginUrlFrom('Visit https://auth.openai.com/device to continue', undefined),
    'https://auth.openai.com/device'
  );
}
