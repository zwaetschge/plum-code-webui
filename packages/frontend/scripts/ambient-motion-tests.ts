import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AMBIENT_MOTION_FPS,
  AURORA_WAVE_MOTIONS,
  GECKO_AMBIENT_MOTION_FPS,
  LOGIN_WAVE_MOTIONS,
  getAmbientTransformAtTime,
} from '../src/lib/ambientMotion.js';

assert.equal(AMBIENT_MOTION_FPS, 30, 'ambient motion must stay capped at 30 visual updates/s');
assert.equal(
  GECKO_AMBIENT_MOTION_FPS,
  20,
  'Gecko must render the same slow wave paths with fewer scene updates'
);
assert.equal(AURORA_WAVE_MOTIONS.length, 3, 'all three Plum waves must remain active');
assert.equal(LOGIN_WAVE_MOTIONS.length, 2, 'both login waves must remain active');

const firstWave = AURORA_WAVE_MOTIONS[0];
assert.equal(
  getAmbientTransformAtTime(firstWave, 0),
  'translate3d(-4.0000vw, -1.2000vh, 0) rotate(-1.2000deg) scaleX(1.03000)'
);
assert.equal(
  getAmbientTransformAtTime(firstWave, firstWave.durationMs * 0.45),
  'translate3d(5.0000vw, 1.4000vh, 0) rotate(1.0000deg) scaleX(1.07000)',
  'the optimized motion must retain the original CSS keyframe path'
);
assert.equal(
  getAmbientTransformAtTime(firstWave, firstWave.durationMs),
  getAmbientTransformAtTime(firstWave, 0),
  'ambient motion must loop without a visual jump'
);

const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
for (const className of [
  'aurora-ribbon-1',
  'aurora-ribbon-2',
  'aurora-ribbon-3',
  'login-galaxy-band-main',
  'login-galaxy-band-cross',
]) {
  const block = css.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`));
  assert.ok(block, `missing ${className} CSS block`);
  assert.doesNotMatch(
    block[1],
    /animation\s*:/,
    `${className} must not restore an unthrottled CSS animation`
  );
}

const optimizedWaveCss = css.slice(css.indexOf('/* Aurora wave background'));
for (const selector of [
  'aurora-ribbon::before',
  'aurora-ribbon::after',
  'login-galaxy-band::before',
  'login-galaxy-band::after',
]) {
  const block = optimizedWaveCss.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`));
  assert.ok(block, `missing ${selector} CSS block`);
  assert.doesNotMatch(block[1], /filter:\s*blur\(/, `${selector} must not restore a live blur`);
  assert.doesNotMatch(
    block[1],
    /mix-blend-mode:/,
    `${selector} must let its completed parent blend only once`
  );
}

const plumBackground = fs.readFileSync(
  new URL('../src/components/effects/PlumBackground.tsx', import.meta.url),
  'utf8'
);
assert.doesNotMatch(
  plumBackground,
  /backdrop-blur|filter:\s*['"]blur\(/,
  'the animated login background must not sit behind another full-screen live blur'
);

// Only the rules that actually target Gecko. Slicing to end-of-file used to be
// equivalent because the Gecko block sat last, so any stylesheet appended after
// it — a search field with its own blur, say — failed a guard about Firefox.
const geckoGuard = css
  .split('}')
  .filter((block) => block.includes('plum-engine-gecko'))
  .join('}\n');
assert.ok(geckoGuard.length > 0, 'the Gecko performance path must still exist');
assert.match(geckoGuard, /backdrop-filter:\s*none\s*!important/);
// One live blur is affordable; a full-screen one is not. The composer bar is
// the single documented exception — every other Gecko rule must stay filterless,
// or Firefox repaints the moving background for that surface on every frame.
const geckoLiveBlurSelectors = css
  .split('}')
  .filter((block) => block.includes('plum-engine-gecko') && /backdrop-filter:\s*blur\(/.test(block))
  .map((block) => block.slice(block.lastIndexOf('*/') + 2, block.indexOf('{')).trim());
assert.deepEqual(
  geckoLiveBlurSelectors,
  ['html.plum-engine-gecko body .chat-composer-form'],
  'only the composer bar may keep a live backdrop blur in Gecko'
);
assert.match(
  geckoGuard,
  /hsl\(var\(--card\)\s*\/\s*0\.(?:24|3|34|36)\)/,
  'Gecko optical glass must remain translucent rather than becoming an opaque fallback'
);
assert.doesNotMatch(
  geckoGuard,
  /hsl\(var\(--card\)\s*\/\s*0\.9[0-9]*\)/,
  'Gecko optical glass must not regress to the old opaque card fallback'
);

console.log('Ambient motion regression tests passed.');
