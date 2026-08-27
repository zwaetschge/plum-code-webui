import { estimateModelCost } from '@plum-code-webui/shared';

import { insertUsageHistoryTurn } from '../db/index.js';
import {
  getSubagentUpstreamsForUser,
  getZaiApiConfigForUser,
  type SubagentUpstream,
} from '../routes/settings.js';
import { createLogger } from '../utils/logger.js';
import {
  createModelRouter,
  isZaiModel,
  matchUpstreamModel,
  normalizeZaiModel,
  type ResolvedUpstream,
} from './modelRouter.js';

const log = createLogger('model-router');

/**
 * Booking slug for a user-defined upstream. usage_history.provider is TEXT and
 * the analytics label falls back to the model's own family when the provider
 * string is unknown, so a readable slug groups cleanly without touching the
 * CLIProvider union.
 */
function providerSlug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'upstream'
  );
}

/**
 * Settings are read per routed request, which for a busy subagent means every
 * few seconds — a short cache keeps that off the database without making a
 * settings change feel ignored. 30s is shorter than anyone edits and saves.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map<
  string,
  { at: number; upstreams: SubagentUpstream[]; zai: { baseUrl: string; authToken: string } | null }
>();

async function loadUserRouting(userId: string) {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;
  const [upstreams, zaiConfig] = await Promise.all([
    getSubagentUpstreamsForUser(userId),
    getZaiApiConfigForUser(userId),
  ]);
  const entry = {
    at: Date.now(),
    upstreams,
    zai: zaiConfig ? { baseUrl: zaiConfig.baseUrl, authToken: zaiConfig.authToken } : null,
  };
  cache.set(userId, entry);
  return entry;
}

/**
 * Custom upstreams first, in their configured order, then the built-in Z.AI
 * fallback for glm-*. The order matters: a user who lists glm-4.7 under a
 * custom entry is saying "this one goes there", and the fallback must not
 * override it.
 */
export async function resolveSubagentUpstream(
  userId: string,
  model: string
): Promise<ResolvedUpstream | null> {
  const routing = await loadUserRouting(userId);

  for (const upstream of routing.upstreams) {
    if (matchUpstreamModel(upstream.models, model) || matchUpstreamModel(upstream.models, normalizeZaiModel(model))) {
      return {
        baseUrl: upstream.baseUrl,
        authToken: upstream.authToken,
        model: normalizeZaiModel(model),
        provider: providerSlug(upstream.label),
      };
    }
  }

  if (isZaiModel(model) && routing.zai) {
    return {
      baseUrl: routing.zai.baseUrl,
      authToken: routing.zai.authToken,
      model: normalizeZaiModel(model),
      provider: 'zai',
    };
  }

  return null;
}

/** True when a claude session should be spawned through the router at all. */
export async function userHasSubagentRouting(userId: string): Promise<boolean> {
  const routing = await loadUserRouting(userId);
  return routing.zai !== null || routing.upstreams.length > 0;
}

export const modelRouter = createModelRouter({
  resolveUpstream: resolveSubagentUpstream,
  onRoutedUsage(event) {
    const totalTokens =
      event.inputTokens + event.outputTokens + event.cacheReadTokens + event.cacheCreationTokens;
    if (totalTokens <= 0) return;
    void insertUsageHistoryTurn({
      userId: event.userId,
      sessionId: event.sessionId,
      provider: event.provider,
      // One row per routed request. Subagents do not have turn ids of their
      // own; the request id is stable and unique, which is all idempotent
      // booking needs.
      turnId: `subagent-${event.requestId}`,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cacheReadTokens: event.cacheReadTokens,
      cacheCreationTokens: event.cacheCreationTokens,
      totalTokens,
      costUsd: estimateModelCost(event.model, {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens,
        cacheCreationTokens: event.cacheCreationTokens,
      }).cost,
      model: event.model,
    }).catch((error) => log.warn('Failed to book routed subagent usage', { error: String(error) }));
  },
  onError(message, error) {
    log.warn(message, { error: String(error) });
  },
});
