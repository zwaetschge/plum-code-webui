/** The Hermes area: every Schwarm agent on the Unraid host, managed from Plum. */

import type { SwarmAgentHealth } from './assistant.js';

export interface HermesPlatformState {
  /** Gateway platform id: telegram, discord, matrix, api_server, … */
  id: string;
  state: string;
  needsAttention: boolean;
  error: string | null;
}

/** A Hermes Agent gateway container (Brian, the trader's Hermes). */
export interface HermesInstance {
  /** Container name. */
  id: string;
  label: string;
  /** Updated from Plum. */
  managed: boolean;
  running: boolean;
  /** Docker health status, null without a healthcheck. */
  health: string | null;
  startedAt: string | null;
  /** Image tag the container runs, e.g. "v2026.9.24" or "v0.22.7". */
  tag: string | null;
  /** First line of `hermes --version`. */
  version: string | null;
  platforms: HermesPlatformState[];
  activeAgents: number | null;
}

export interface HermesAgentContainer {
  name: string;
  host: string | null;
  running: boolean;
  state: string;
  status: string;
  health: string;
  /** Image without registry digest, e.g. "node:22-alpine" or "schwarm-git:local". */
  image: string | null;
  /** Lifecycle operations Plum may run on it. */
  actions: Array<'start' | 'stop' | 'restart'>;
}

export interface HermesAgentUpdate {
  /**
   * hermes: move the Hermes image to `target` (with rollback);
   * rebuild: rebuild and recreate the agent's compose project from its sources.
   */
  kind: 'hermes' | 'rebuild';
  /** Hermes release tag for kind hermes. */
  target: string | null;
  /** kind hermes: a newer release than the running one exists. */
  available: boolean;
  running: boolean;
  /** Tail of the last run started from Plum. */
  log: string[];
}

export interface HermesAgent {
  /** Directory id without the `hub:` prefix, e.g. "brian", "trader", "git". */
  id: string;
  name: string;
  group: string;
  health: SwarmAgentHealth;
  description: string | null;
  /** The agent's own container first, its helpers after it. */
  containers: HermesAgentContainer[];
  /** Set when the agent runs a Hermes Agent gateway. */
  hermes: HermesInstance | null;
  update: HermesAgentUpdate | null;
}

export interface HermesStatus {
  agents: HermesAgent[];
  /** Newest Hermes release tag on Docker Hub; null when the lookup failed. */
  latestTag: string | null;
  /** Brian's daily autoupdate (the only one with a scheduler). */
  autoUpdate: {
    paused: boolean;
    reason: string | null;
  };
  checkedAt: string;
  /** @deprecated app 1.9.13: the Hermes gateways of `agents`. */
  instances: HermesInstance[];
  /** @deprecated app 1.9.13: Brian runs another tag than `latestTag`. */
  updateAvailable: boolean;
  /** @deprecated app 1.9.13: Brian's update run. */
  update: { running: boolean; log: string[] };
}
