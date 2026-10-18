import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DEFAULT_ANALYTICS_HIDDEN_LIMIT_METRICS } from '@plum-code-webui/shared';
import { parseAnalyticsSettings, updateSettingsSchema } from '../src/routes/settings.js';

assert.deepEqual(DEFAULT_ANALYTICS_HIDDEN_LIMIT_METRICS, {
  codex: ['additional_gpt_5_3_codex_spark'],
  zai: ['additional_web_search'],
});

assert.deepEqual(parseAnalyticsSettings(undefined), {
  hiddenLimitMetrics: DEFAULT_ANALYTICS_HIDDEN_LIMIT_METRICS,
});
assert.deepEqual(parseAnalyticsSettings({ hiddenLimitMetrics: {} }), {
  hiddenLimitMetrics: {},
});
assert.deepEqual(
  parseAnalyticsSettings({
    hiddenLimitMetrics: {
      codex: ['seven_day', 'seven_day'],
      kimi: ['additional_parallel_sessions'],
      invalid: ['ignored'],
    },
  }),
  {
    hiddenLimitMetrics: {
      codex: ['seven_day'],
    },
  }
);

assert.equal(
  updateSettingsSchema.safeParse({
    analytics: { hiddenLimitMetrics: { zai: ['additional_web_search'] } },
  }).success,
  true
);
assert.equal(
  updateSettingsSchema.safeParse({
    analytics: { hiddenLimitMetrics: { zai: ['x'.repeat(161)] } },
  }).success,
  false
);

const currentDir = dirname(fileURLToPath(import.meta.url));
const settingsSource = readFileSync(
  resolve(currentDir, '../../frontend/src/pages/SettingsPage.tsx'),
  'utf8'
);
const analyticsSource = readFileSync(
  resolve(currentDir, '../../frontend/src/pages/AnalyticsPage.tsx'),
  'utf8'
);

assert.match(settingsSource, /value="analytics"/);
assert.match(settingsSource, /Provider limit curves/);
assert.match(settingsSource, /updateAnalyticsLimitMetricVisibility/);
assert.match(settingsSource, /Restore defaults/);
assert.match(
  analyticsSource,
  /hiddenLimitMetrics\[point\.provider\]\?\.includes\(point\.metricKey\)/
);

console.log('Analytics settings regression tests passed.');
