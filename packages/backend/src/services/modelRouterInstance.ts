import { estimateModelCost } from '@plum-code-webui/shared';

import { insertUsageHistoryTurn } from '../db/index.js';
import { getZaiApiConfigForUser } from '../routes/settings.js';
import { createLogger } from '../utils/logger.js';
import { createModelRouter } from './modelRouter.js';

const log = createLogger('model-router');

/**
 * The one router the server mounts and the process manager talks to.
 *
 * Every completed Z.AI request is booked into usage_history as its own
 * `zai` row immediately — the router is the only component that ever sees
 * those responses, since from Claude Code's point of view the subagent ran on
 * "the API". The matching subtraction from the surrounding Claude turn happens
 * in saveUsageToDatabase via drainRoutedUsage.
 */
export const modelRouter = createModelRouter({
  async getZaiConfig(userId) {
    const config = await getZaiApiConfigForUser(userId);
    return config ? { baseUrl: config.baseUrl, authToken: config.authToken } : null;
  },
  onZaiUsage(event) {
    const totalTokens =
      event.inputTokens + event.outputTokens + event.cacheReadTokens + event.cacheCreationTokens;
    if (totalTokens <= 0) return;
    void insertUsageHistoryTurn({
      userId: event.userId,
      sessionId: event.sessionId,
      provider: 'zai',
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
