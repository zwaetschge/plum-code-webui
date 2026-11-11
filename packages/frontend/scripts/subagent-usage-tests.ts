import assert from 'node:assert/strict';
import {
  figures,
  formatShare,
  groupTitle,
  readGroups,
  runsLabel,
  scopeGroups,
  sortGroups,
  type SubagentGroup,
} from '../src/lib/subagentUsage.ts';

const base = { sessions: 1, model: 'm' };
const groups: SubagentGroup[] = [
  {
    ...base,
    kind: 'agent',
    provider: 'claude',
    providerLabel: 'Claude',
    agentType: 'Explore',
    runs: 3,
    totalTokens: 1000,
    costUsd: 1,
  },
  {
    ...base,
    kind: 'worker',
    provider: 'pi',
    providerLabel: 'Pi',
    agentType: '',
    runs: 1,
    totalTokens: 5000,
    costUsd: 0.5,
  },
  {
    ...base,
    kind: 'routed',
    provider: 'claude',
    providerLabel: 'Claude',
    agentType: 'general-purpose',
    runs: 1,
    totalTokens: 1000,
    costUsd: 2,
  },
];

// An older backend answers without groups: no data, no crash.
assert.deepEqual(readGroups({} as never), []);
assert.deepEqual(readGroups(undefined), []);
assert.deepEqual(readGroups({ agents: [] } as never), []);
assert.equal(readGroups({ groups }).length, 3);

assert.deepEqual(
  sortGroups(groups).map((g) => g.kind),
  ['worker', 'routed', 'agent']
);
assert.equal(groups[0]!.kind, 'agent', 'sorting must not mutate');

assert.equal(scopeGroups(groups, null).length, 3);
assert.deepEqual(
  scopeGroups(groups, 'Claude').map((g) => g.kind),
  ['agent', 'routed']
);
assert.deepEqual(scopeGroups(groups, 'Codex'), []);

assert.equal(groupTitle(groups[0]!), 'Agent · Explore');
assert.equal(groupTitle(groups[1]!), 'CLI run · Pi');
// A routed call has no type of its own: it is named after where it went.
assert.equal(groupTitle(groups[2]!), `Routed · ${groups[2]!.providerLabel}`);
// Codex threads come without a type; the harness names them.
assert.equal(groupTitle({ ...groups[0]!, agentType: '', providerLabel: 'Codex' }), 'Agent · Codex');
assert.equal(groupTitle({ ...groups[0]!, agentType: '', providerLabel: '' }), 'Agent');

assert.equal(runsLabel({ kind: 'agent', runs: 3 }), '3 runs');
assert.equal(runsLabel({ kind: 'worker', runs: 1 }), '1 run');
assert.equal(runsLabel({ kind: 'routed', runs: 1 }), '1 call');
assert.equal(runsLabel({ kind: 'routed', runs: 1200 }), '1,200 calls');

const data = {
  groups,
  totals: { totalTokens: 7000, costUsd: 3.5, runs: 5, windowTotalTokens: 70000, sharePercent: 10 },
};
assert.deepEqual(figures(data, groups, false), {
  tokens: 7000,
  costUsd: 3.5,
  runs: 5,
  sharePercent: 10,
});
// Filtered: sums come from the scoped groups and no share is claimed.
const claude = scopeGroups(groups, 'Claude');
assert.deepEqual(figures(data, claude, true), {
  tokens: 2000,
  costUsd: 3,
  runs: 4,
  sharePercent: null,
});
assert.equal(figures({ groups }, groups, false).sharePercent, null);

assert.equal(formatShare(0.04), '<0.1');
assert.equal(formatShare(0), '0.0');
assert.equal(formatShare(4.26), '4.3');
assert.equal(formatShare(23.4), '23');

console.log('subagent usage tests passed');
