import assert from 'node:assert/strict';

import {
  createSshConnectionSchema,
  defaultAliasFromName,
  isValidJumpHost,
  jumpAliasFor,
  normalizePrivateKey,
  parseJumpHost,
  renderSshConfig,
  sanitizeSshOutput,
  updateSshConnectionSchema,
} from '../src/services/connections/sshConfig.js';

const base = {
  kind: 'ssh',
  name: 'Build-Server',
  alias: 'build',
  host: 'build.example.org',
  user: 'deploy',
  keySource: 'file',
  keyFile: 'id_ed25519',
};

// Valid input, port default.
const ok = createSshConnectionSchema.parse(base);
assert.equal(ok.port, 22);
assert.equal(createSshConnectionSchema.parse({ ...base, port: '2222' }).port, 2222);

// Injection attempts are rejected.
for (const [field, value] of [
  ['host', 'evil.org\n  ProxyCommand sh -c id'],
  ['host', '-oProxyCommand=id'],
  ['host', 'a b'],
  ['user', 'root -i'],
  ['user', '-l'],
  ['alias', 'Build'],
  ['alias', '-x'],
  ['alias', 'a'.repeat(42)],
  ['alias', 'a\nb'],
  ['keyFile', '../etc/passwd'],
  ['keyFile', '.hidden'],
  ['jumpHost', 'user@host -oProxyCommand=id'],
  ['jumpHost', '-J'],
  ['name', 'x\u0000'],
] as const) {
  const result = createSshConnectionSchema.safeParse({ ...base, [field]: value });
  assert.equal(result.success, false, `${field}=${JSON.stringify(value)} must be rejected`);
}
assert.equal(createSshConnectionSchema.safeParse({ ...base, port: 70000 }).success, false);
assert.equal(
  createSshConnectionSchema.safeParse({ ...base, jumpHost: 'ops@bastion:2201' }).success,
  true
);
assert.equal(createSshConnectionSchema.parse({ ...base, jumpHost: '' }).jumpHost, null);
assert.equal(isValidJumpHost('bastion:99999'), false);
assert.equal(updateSshConnectionSchema.safeParse({ clearKey: true }).success, true);
assert.equal(updateSshConnectionSchema.safeParse({ host: 'a;b' }).success, false);

// Jump host parsing.
assert.deepEqual(parseJumpHost('ops@bastion:2201', { user: 'deploy' }), {
  host: 'bastion',
  user: 'ops',
  port: 2201,
});
assert.deepEqual(parseJumpHost('bastion', { user: 'deploy' }), {
  host: 'bastion',
  user: 'deploy',
  port: 22,
});

// Private keys.
const pem =
  '-----BEGIN OPENSSH PRIVATE KEY-----\r\nAAAA\r\nBBBB\r\n-----END OPENSSH PRIVATE KEY-----';
assert.equal(
  normalizePrivateKey(pem),
  '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\nBBBB\n-----END OPENSSH PRIVATE KEY-----\n'
);
assert.equal(normalizePrivateKey('ssh-ed25519 AAAA public'), null);
assert.equal(normalizePrivateKey(''), null);

// Config rendering.
const text = renderSshConfig(
  [
    {
      config: {
        alias: 'build',
        host: 'build.example.org',
        port: 2222,
        user: 'deploy',
        jumpHost: 'ops@bastion',
        tags: [],
        keySource: 'file',
        keyFile: 'id_ed25519',
      },
      keyPath: '/data/ssh/sessions/s1/keys/build',
    },
  ],
  { knownHostsPath: '/data/ssh/known_hosts/u1' }
);
assert.match(text, /^Host build$/m);
assert.match(text, /^ {2}Port 2222$/m);
assert.match(text, new RegExp(`^  ProxyJump ${jumpAliasFor('build')}$`, 'm'));
assert.match(text, new RegExp(`^Host ${jumpAliasFor('build')}$`, 'm'));
assert.match(text, /^ {2}User ops$/m);
assert.match(text, /^ {2}IdentityFile "\/data\/ssh\/sessions\/s1\/keys\/build"$/m);
assert.match(text, /^ {2}BatchMode yes$/m);
assert.match(text, /^ {2}StrictHostKeyChecking accept-new$/m);
assert.throws(() =>
  renderSshConfig(
    [
      {
        config: {
          alias: 'x',
          host: 'a b',
          port: 22,
          user: 'u',
          jumpHost: null,
          tags: [],
          keySource: 'file',
          keyFile: null,
        },
        keyPath: null,
      },
    ],
    { knownHostsPath: '/k' }
  )
);

// Output sanitising.
const cleaned = sanitizeSshOutput(
  'Warning: Permanently added \'h\' (ED25519) to the list of known hosts.\nLoad key "/tmp/plum-ssh-test-abc/keys/build": invalid format\ndeploy@h: Permission denied (publickey).',
  ['/tmp/plum-ssh-test-abc']
);
assert.ok(!cleaned.includes('/tmp/plum-ssh-test-abc'));
assert.ok(!cleaned.includes('Permanently added'));
assert.match(cleaned, /Permission denied/);

// Alias defaults.
assert.equal(defaultAliasFromName('Mein Büro-Server'), 'mein-buro-server');
assert.equal(defaultAliasFromName('!!!'), 'host');

console.log('ssh connection regression tests passed');
