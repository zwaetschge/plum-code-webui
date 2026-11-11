/**
 * Pure helpers for the analytics "Subagents" card: what a group is called,
 * ordering, provider scoping and the header figures.
 *
 * Mirrors the shape of `GET /api/analytics/subagents`. A response without
 * `groups` (an older backend) is "no data", never an error.
 */

export type SubagentKind = 'agent' | 'worker' | 'routed';

export interface SubagentGroup {
  kind: SubagentKind;
  provider: string;
  providerLabel: string;
  agentType: string;
  model: string;
  runs: number;
  sessions: number;
  totalTokens: number;
  costUsd: number;
}

export interface SubagentResponse {
  groups?: SubagentGroup[];
  totals?: {
    totalTokens: number;
    costUsd: number;
    runs: number;
    windowTotalTokens: number;
    sharePercent: number;
  };
}

export interface SubagentFigures {
  tokens: number;
  costUsd: number;
  runs: number;
  /** Subagents' part of everything booked; null when it cannot be told honestly. */
  sharePercent: number | null;
}

const KIND_LABEL: Record<SubagentKind, string> = {
  agent: 'Agent',
  worker: 'CLI run',
  routed: 'Routed',
};

/** Groups from a response; tolerant of the older backend shape. */
export function readGroups(data: SubagentResponse | null | undefined): SubagentGroup[] {
  return Array.isArray(data?.groups) ? data.groups : [];
}

/** Keep only one provider's groups; no filter keeps all. */
export function scopeGroups(
  groups: SubagentGroup[],
  providerLabel: string | null
): SubagentGroup[] {
  return providerLabel ? groups.filter((group) => group.providerLabel === providerLabel) : groups;
}

/** Largest first by tokens, then cost; does not mutate. */
export function sortGroups(groups: SubagentGroup[]): SubagentGroup[] {
  return [...groups].sort((a, b) => b.totalTokens - a.totalTokens || b.costUsd - a.costUsd);
}

/**
 * "Agent · Explore", "CLI run · Pi", "Routed · Z.AI".
 *
 * Only agents have a type, and not all of them: Codex names each spawned
 * thread instead, so the server reports those without one. Whatever has no
 * type is named after the harness that ran it.
 */
export function groupTitle(group: SubagentGroup): string {
  const detail = (group.kind === 'agent' && group.agentType) || group.providerLabel;
  return detail ? `${KIND_LABEL[group.kind]} · ${detail}` : KIND_LABEL[group.kind];
}

/** Routed rows count single calls, everything else counts runs. */
export function runsLabel(group: Pick<SubagentGroup, 'kind' | 'runs'>): string {
  const unit =
    group.kind === 'routed'
      ? group.runs === 1
        ? 'call'
        : 'calls'
      : group.runs === 1
        ? 'run'
        : 'runs';
  return `${group.runs.toLocaleString('en-US')} ${unit}`;
}

/**
 * Header figures. Unfiltered, the server's totals (and share) are used. The
 * share is relative to everything booked in the period, so for a provider
 * filter there is no matching denominator and it is left out.
 */
export function figures(
  data: SubagentResponse | null | undefined,
  scoped: SubagentGroup[],
  filtered: boolean
): SubagentFigures {
  const sum = {
    tokens: scoped.reduce((total, group) => total + group.totalTokens, 0),
    costUsd: scoped.reduce((total, group) => total + group.costUsd, 0),
    runs: scoped.reduce((total, group) => total + group.runs, 0),
  };
  const totals = data?.totals;
  if (filtered || !totals || !Number.isFinite(totals.sharePercent)) {
    return { ...sum, sharePercent: null };
  }
  return { ...sum, sharePercent: totals.sharePercent };
}

export function formatShare(percent: number): string {
  if (percent > 0 && percent < 0.1) return '<0.1';
  return percent >= 10 ? percent.toFixed(0) : percent.toFixed(1);
}
