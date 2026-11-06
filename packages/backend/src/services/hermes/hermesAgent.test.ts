/**
 * Hermes moved from date tags to semver in October 2026; picking the wrong
 * "latest" would either never offer the update or offer a downgrade. Rebuilds
 * must hit exactly one compose service, never a whole shared project.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hermesScriptJob,
  parseInspect,
  parsePlatforms,
  pickLatestTag,
  rebuildJob,
  rebuildTarget,
  sections,
} from './hermesAgent.js';

test('semver releases win over the retired date tags', () => {
  const tags = [
    'latest',
    'v2026.9.24',
    'v0.22.7',
    'v0.22.10',
    'rc.1-v0.22.7',
    'v0.22.7-desktop',
    'v2026.8.16.2',
  ];
  assert.equal(pickLatestTag(tags), 'v0.22.10');
  assert.equal(pickLatestTag(['v2026.9.24', 'main']), null);
});

test('output splits into sections, keyed ones included, missing ones absent', () => {
  const parts = sections(
    '@@paused\nGrund A\nmehr\n@@brianlock\n@@version:hermes-trader\nHermes Agent v0.20.3\n\n@@log:git\n'
  );
  assert.equal(parts.paused, 'Grund A\nmehr');
  assert.equal(parts.brianlock, '');
  assert.equal(parts['version:hermes-trader'], 'Hermes Agent v0.20.3');
  assert.equal(parts['log:git'], '');
  assert.equal(parts.inspect, undefined);
});

test('gateway platforms keep state, attention flag and error', () => {
  const raw = JSON.stringify({
    active_agents: 2,
    platforms: {
      telegram: { state: 'connected', needs_attention: false, error_message: null },
      discord: { state: 'retrying', needs_attention: true, error_message: 'gateway closed' },
    },
  });
  const { platforms, active } = parsePlatforms(raw);
  assert.equal(active, 2);
  assert.deepEqual(platforms[1], {
    id: 'discord',
    state: 'retrying',
    needsAttention: true,
    error: 'gateway closed',
  });
  assert.deepEqual(parsePlatforms('kaputt'), { platforms: [], active: null });
});

test('rebuilds target one service with a host path, nothing else', () => {
  const rows = parseInspect(
    [
      '/schwarm-git|schwarm-git:local|2026-10-20T10:00:00Z|schwarm-git|/mnt/cache/AI/plum-code/matrix/worker/git/docker-compose.yml|schwarm-git',
      '/codex-bot|codex-bot:local|2026-10-20T10:00:00Z|codex-bot-compose|/work/docker-compose.yml|codex-bot',
      '/hermes-trader|nousresearch/hermes-agent:v2026.8.16.2|2026-10-21T15:42:30Z|||',
      '/schwarm-trader|node:22-alpine@sha256:c610fcdf|2026-10-21T15:42:30Z|schwarm-trader|/mnt/x/../etc/compose.yml|schwarm-trader',
    ].join('\n')
  );
  assert.equal(rows.get('schwarm-trader')?.image, 'node:22-alpine');
  assert.deepEqual(rebuildTarget(rows.get('schwarm-git')), {
    project: 'schwarm-git',
    file: '/mnt/cache/AI/plum-code/matrix/worker/git/docker-compose.yml',
    service: 'schwarm-git',
  });
  assert.equal(rebuildTarget(rows.get('codex-bot')), null);
  assert.equal(rebuildTarget(rows.get('hermes-trader')), null);
  assert.equal(rebuildTarget(rows.get('schwarm-trader')), null);
  const script = rebuildJob('git', rebuildTarget(rows.get('schwarm-git'))!);
  assert.match(script, /up -d --build --force-recreate --no-deps schwarm-git;/);
});

test('the Hermes script job pulls first and rolls back a silent gateway', () => {
  const script = hermesScriptJob(
    'trader',
    'hermes-trader',
    '/mnt/user/appdata/hermes-trader/start.sh',
    'v0.22.7'
  );
  const pull = script.indexOf('docker pull nousresearch/hermes-agent:v0.22.7');
  const edit = script.indexOf('sed -i');
  assert.ok(pull > 0 && edit > pull, 'image is pulled before the script changes');
  assert.match(script, /Rückfall auf \$old/);
  assert.ok(
    !script.slice(script.indexOf("bash -c '") + 9, script.lastIndexOf("' >")).includes("'"),
    'the job body stays inside one single-quoted bash -c'
  );
});
