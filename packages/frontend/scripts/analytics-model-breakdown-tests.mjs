import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const page = read('../src/pages/AnalyticsPage.tsx');
const usage = read('../src/components/analytics/UsageOverTimeCard.tsx');
const models = read('../src/components/analytics/TopModelsCard.tsx');
const kpi = read('../src/components/analytics/KpiCard.tsx');
const sessions = read('../src/components/analytics/TopSessionsTable.tsx');
const limits = read('../src/components/analytics/limitsModel.ts');
const limitsCard = read('../src/components/analytics/ProviderLimitsCard.tsx');
const providers = read('../src/lib/providers.ts');

// Model breakdown: every model per provider, ordered by tokens.
assert.match(
  models,
  /models: entry\.models\.sort\(\(a, b\) => b\.tokens - a\.tokens\)/,
  'provider model breakdown must be ordered by token volume without a top-three truncation'
);
assert.match(
  models,
  /\{formatNumber\(model\.tokens\)\} tokens/,
  'each provider model chip must display its own token count'
);
assert.doesNotMatch(
  models,
  /entry\.models\.sort\([\s\S]{0,100}\.slice\(0, 3\)/,
  'provider model breakdown must not hide models after the first three'
);

// Usage chart: total area plus provider lines; quota curves are an opt-in overlay.
assert.match(usage, /title="Usage Over Time"/, 'the usage panel keeps its title');
assert.match(
  usage,
  /aria-pressed=\{showLimits\}[\s\S]{0,120}onClick=\{onToggleLimits\}/,
  'provider limits must be an explicit toggle on the usage chart'
);
assert.match(
  usage,
  /limitsAvailable && \(/,
  'the limits toggle must not depend on history that only loads once it is on'
);
assert.match(
  usage,
  /limitSeries\.map\(\(series\) => \([\s\S]{0,220}dataKey=\{series\.key\}/,
  'the overlay must render every available provider limit series'
);
assert.match(
  usage,
  /<Area[\s\S]{0,180}type="monotone"/,
  'usage must retain the smooth area curve on the complete time grid'
);
assert.match(
  usage,
  /<Line[\s\S]{0,180}type="monotone"[\s\S]{0,120}dataKey=\{series\.key\}/,
  'provider and limit lines must use smooth curves'
);
assert.match(
  page,
  /enabled: showLimits && historyTrackers\.length > 0/,
  'quota history must only be fetched while the overlay is on'
);
assert.doesNotMatch(page, /<ProviderLimitHistory\b/, 'no second standalone limit-history chart');

// Quota resampling onto the usage buckets.
assert.match(
  page,
  /return sortedBuckets\.map\(\(bucket, index\)/,
  'quota history must be resampled onto the existing usage buckets'
);
assert.match(
  page,
  /isCurrentBucket \? samplesInBucket\.at\(-1\) : samplesInBucket\[0\]/,
  'completed buckets must use their opening quota while the current bucket uses the latest sample'
);
assert.match(
  page,
  /lowerBound\(series\.times, bucketStart\)/,
  'bucket samples must be found by binary search, not by filtering every sample per bucket'
);
assert.match(
  page,
  /events\.length <= MAX_RESET_MARKERS \? events : \[\]/,
  'reset markers must be capped: hundreds of labelled lines freeze the page for seconds'
);
assert.doesNotMatch(
  page,
  /overlayPoints\.forEach\([\s\S]{0,500}buckets\.set/,
  'quota samples must not create sparse zero-token buckets in the usage chart'
);

// Hourly grid for 24h.
assert.match(page, /const timelineGranularity = period === '24h' \? 'hour' : 'day'/);
assert.match(page, /granularity=\$\{timelineGranularity\}/);
assert.match(page, /period === '24h' && analyticsWindow\?\.startsAt && analyticsWindow\?\.endsAt/);
assert.match(page, /timestamp \+= 60 \* 60 \* 1000/);

// Provider filter scopes the whole dashboard.
assert.match(
  page,
  /activeFilter && USAGE_TRACKER_ANALYTICS_LABEL\[point\.provider\] !== activeFilter/,
  'the provider filter must also scope the quota overlay'
);
assert.match(
  page,
  /\(activeFilter \? \[\] : scopedProviders\)/,
  'a filtered chart must not draw a provider line on top of an identical total'
);
assert.match(
  page,
  /summary\.comparison\.byProvider\.filter\(\(provider\) => provider\.provider === activeFilter\)/,
  'deltas must compare the same provider in the previous window'
);

// KPI deltas: spend falling is good; volume carries no judgement.
assert.match(kpi, /delta\?\.neutral \? 'is-neutral'/);
assert.match(page, /delta\(current\.cost, previous\?\.cost, 'lower-better'\)/);
assert.match(page, /delta\(current\.tokens, previous\?\.tokens, 'neutral'\)/);

// Sessions table: sortable columns, rows link to their session.
assert.match(
  sessions,
  /aria-sort=\{active \? \(sort\.desc \? 'descending' : 'ascending'\) : 'none'\}/
);
assert.match(sessions, /to=\{`\/session\/\$\{session\.session_id\}`\}/);

// Vibe is its own tracked plan: the Vibe Code allowance of the Mistral plan,
// with its own budget endpoint, colour and analytics family label.
assert.match(providers, /ACCOUNT_USAGE_LIMIT_PROVIDERS = \[[\s\S]{0,240}'vibe',/);
assert.match(limits, /USAGE_TRACKER_ANALYTICS_LABEL[\s\S]{0,400}vibe: 'Vibe',/);
assert.match(limits, /USAGE_PROVIDER_LOGO[\s\S]{0,400}vibe: 'vibe',/);
// No upstream quota API for either Mistral allowance, so neither has history.
assert.match(limits, /HISTORY_PROVIDERS[\s\S]{0,240}provider !== 'vibe'/);
// A stored tracker choice must not hide a provider that joined later.
assert.match(limits, /USAGE_TRACKERS_STORAGE_KEY = 'plum:analytics:usage-limit-trackers:v5'/);
assert.match(limits, /ADDED_SINCE_V4: UsageLimitTracker\[\] = \['vibe'\]/);
assert.match(limitsCard, /api\/usage\/plan\/vibe/);
assert.match(limitsCard, /provider === 'vibe' \? 'vibe' : undefined/);
assert.match(sessions, /Vibe: 'vibe',/);

console.log('Analytics model breakdown regression tests passed.');
