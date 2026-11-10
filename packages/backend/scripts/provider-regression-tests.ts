import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CODEX_MODEL } from '../../shared/src/types/cli-providers.js';
import { getPiRun, setPiRunJournalPath } from '../src/services/claude/piRunJournal.js';
import { fileURLToPath } from 'node:url';
import {
  CLI_PROVIDERS,
  getCLIArgs,
  getCliModels,
  getModelDisplayLabels,
  getProviderCapabilities,
  parseClaudeCliModelCatalog,
  withClaude1mVariants,
  claudeContextWindowEnv,
  resetDiscovery,
  resolveCliProviderSelectedModel,
  resolveConfiguredModel,
} from '../src/services/cli-providers.js';
import {
  classifyAttachment,
  extensionForAttachment,
  sanitizeAttachmentDisplayName,
  sanitizeAttachmentFilename,
} from '../src/services/attachments.js';
import { getModelProviderCredentialEnvVars } from '../src/utils/modelProviderKeys.js';
import {
  buildPiModelCatalog,
  readPiNativeModelIds,
  buildPiProviderConfig,
  isPiRunnableModel,
} from '../src/utils/piConfig.js';
import {
  ensureDefaultClaudeMcpServers,
  sanitizeClaudeSettingsProviderEnv,
} from '../src/utils/mcpDefaults.js';
import { sanitizeClaudeResumeTranscript } from '../src/utils/claudeResumeTranscript.js';
import { mapCodexUsage } from '../src/utils/codexUsage.js';
import { parseModelsCache } from '../src/utils/modelCatalog.js';
import { mapZaiAccountUsage, mapZaiUsage } from '../src/routes/usage.js';
import {
  createSessionSchema,
  readProjectIconCandidate,
  updateProviderSchema,
} from '../src/routes/sessions.js';
import { resolveMemoryDirectory } from '../src/routes/memories.js';
import {
  buildCodexSessionIconCommand,
  generateSessionIconImage,
  buildSessionIconImagePrompt,
} from '../src/services/sessionIconGenerator.js';
import {
  buildClaudeApiEnv,
  getClaudeApiEndpointKind,
  getClaudeApiModelLabels,
  stripDeviceAppearanceSettings,
  updateSettingsSchema,
} from '../src/routes/settings.js';
import { upsertProxyUserInDatabase } from '../src/utils/proxyUser.js';

import { createTestSchema, dropTestSchema, useTestSchema } from '../src/db/testing.js';

useTestSchema();
const { all: pgAllRows, get: pgGet, run: pgRun } = await import('../src/db/pg.js');
await createTestSchema();
import { syncCodexConfig } from '../src/utils/codexConfigSync.js';
import {
  claudeCliContextWindow,
  lookupContextWindow,
  resolveContextWindow,
} from '../src/utils/contextWindow.js';
import {
  hasExactManagedPlaceholderSequence,
  resolveMemoryOptimizerMemoryDir,
} from '../src/services/memoryOptimizer.js';
import {
  CODEX_ROLLOUT_TAIL_MAX_BYTES,
  ClaudeProcessManager,
  applyClaudeResultUsage,
  appliesModeOnNextTurnWithoutRestart,
  accumulateClaudeMessageDeltaUsage,
  accumulateClaudeMessageStartUsage,
  buildClaudeTransportProcessEnv,
  extractExplicitWorkspaceChatMedia,
  extractCodexSessionId,
  findCodexExecRootThreadId,
  readCodexDescendantUsageDetail,
  formatCodexSharedContextForTest,
  acpModeForSessionMode as _acpModeForSessionMode,
  resolveSessionStartMode,
  shouldRecoverInterruptedAcpTurn,
  isCodexNativeSlashCommand,
  readCodexDescendantUsage,
  readCodexRolloutTail,
  readCodexThreadCumulativeUsage,
  readLatestCodexContextSnapshot,
  readCodexThreadState,
  shouldInjectSessionStyleContext,
  shouldInjectCodexStaticBootstrap,
  shouldRecordProviderUserMessage,
} from '../src/services/claude/ClaudeProcessManager.js';
import { commandService, resolveAllowedCommandPath } from '../src/services/commands.js';
import { getCliUpdateCommand } from '../src/services/cli-updates.js';
import { buildSessionCookieOptions } from '../src/utils/sessionCookie.js';
import { normalizeUsageSnapshot } from '../../shared/src/index.js';
import {
  getProviderLabelForModel,
  getProviderLabelForUsage,
} from '../../shared/src/types/cli-providers.js';
import { estimateModelCost, resolveModelPricing } from '../../shared/src/types/llm-pricing.js';

type ClaudeProcessManagerIo = ConstructorParameters<typeof ClaudeProcessManager>[0];

function createTestEventSequenceAllocator(): (sessionId: string) => number {
  let sequence = 0;
  return () => ++sequence;
}

type EmittedSocketEvent = {
  event: string;
  data: unknown;
};

type UsageProcessStub = {
  outputBuffer: { push: (...args: unknown[]) => void };
  lastActivityAt: number;
  cliProvider: 'claude' | 'codex';
  turnInputTokens: number;
  turnCacheReadTokens: number;
  turnCacheCreationTokens: number;
  turnOutputTokens: number;
  contextInputTokens?: number;
  contextCacheReadTokens?: number;
  contextCacheCreationTokens?: number;
  contextOutputTokens?: number;
  contextWindow: number;
  totalCostUsd: number;
  model: string;
};

type UsageHarness = {
  processes: Map<string, UsageProcessStub>;
  recordContextSnapshot: (sessionId: string, proc: UsageProcessStub) => void;
  emitUsage: (sessionId: string, proc: UsageProcessStub) => void;
};

type DisconnectProcessStub = {
  disconnectedAt: number | null;
};

type CodexQueueTurnStub = {
  queueId: string;
  queuedAt: string;
  originalMessage: string;
  messageForClaude: string;
  updateLastMessage: boolean;
  codexImagePaths: string[];
  codexNativeSlashCommand: boolean;
};

type CodexQueueProcessStub = {
  cliProvider: 'codex';
  codexIdle: boolean;
  codexQueuedTurns: CodexQueueTurnStub[];
  codexSteerDraining: boolean;
  codexPreemptingForSteer: boolean;
};

type AcpQueueProcessStub = {
  cliProvider: 'vibe';
  acpIdle: boolean;
  acpQueueDraining: boolean;
  acpQueuedTurns: CodexQueueTurnStub[];
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');

function asUsageHarness(manager: ClaudeProcessManager): UsageHarness {
  return manager as unknown as UsageHarness;
}

function asProcessStore<T>(manager: ClaudeProcessManager): { processes: Map<string, T> } {
  return manager as unknown as { processes: Map<string, T> };
}

function testProviderLabels() {
  assert.equal(getProviderLabelForModel('gpt-5.5'), 'Codex');
  assert.equal(getProviderLabelForModel('claude-sonnet-4-20250514'), 'Claude');
  assert.equal(getProviderLabelForModel('z-ai/glm-5.1'), 'OpenCode');
  assert.equal(getProviderLabelForModel('glm-4.7'), 'OpenCode');
  assert.equal(getProviderLabelForModel('mistral-vibe-cli-latest'), 'Vibe');
  assert.equal(getProviderLabelForModel('unknown-model'), 'Other');
  assert.equal(getProviderLabelForUsage('claude', 'opus'), 'Claude');
  assert.equal(getProviderLabelForUsage('zai', 'glm-5.2'), 'Z.AI');
}

function testProviderTurnUsageAggregation() {
  const claudeUsage = {
    turnInputTokens: 0,
    turnOutputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
  };
  accumulateClaudeMessageStartUsage(claudeUsage, 'response-1', {
    input_tokens: 100,
    cache_read_input_tokens: 900,
  });
  accumulateClaudeMessageDeltaUsage(claudeUsage, { output_tokens: 40 });
  // Replayed fragments for one response must not be billed again.
  accumulateClaudeMessageStartUsage(claudeUsage, 'response-1', {
    input_tokens: 100,
    cache_read_input_tokens: 900,
  });
  accumulateClaudeMessageDeltaUsage(claudeUsage, { output_tokens: 40 });
  accumulateClaudeMessageStartUsage(claudeUsage, 'response-2', {
    input_tokens: 25,
    cache_read_input_tokens: 1_975,
  });
  accumulateClaudeMessageDeltaUsage(claudeUsage, { output_tokens: 60 });
  assert.deepEqual(
    {
      input: claudeUsage.turnInputTokens,
      output: claudeUsage.turnOutputTokens,
      cacheRead: claudeUsage.turnCacheReadTokens,
      contextInput: claudeUsage.contextInputTokens,
      contextCacheRead: claudeUsage.contextCacheReadTokens,
      contextOutput: claudeUsage.contextOutputTokens,
    },
    {
      input: 125,
      output: 100,
      cacheRead: 2_875,
      contextInput: 25,
      contextCacheRead: 1_975,
      contextOutput: 60,
    },
    'Claude billing must sum tool-loop responses while context reflects only the latest request'
  );

  // Z.AI's partial stream can carry output deltas but omit input/cache usage.
  // The final Claude result must restore the missing billed buckets without
  // double-counting richer per-response telemetry gathered above.
  const zaiSparseStreamUsage = {
    turnInputTokens: 0,
    turnOutputTokens: 98_288,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
  };
  applyClaudeResultUsage(zaiSparseStreamUsage, {
    input_tokens: 413_954,
    output_tokens: 98_288,
    cache_read_input_tokens: 19_415_296,
  });
  assert.deepEqual(zaiSparseStreamUsage, {
    turnInputTokens: 413_954,
    turnOutputTokens: 98_288,
    turnCacheReadTokens: 19_415_296,
    turnCacheCreationTokens: 0,
  });
  applyClaudeResultUsage(claudeUsage, {
    input_tokens: 100,
    output_tokens: 80,
    cache_read_input_tokens: 2_000,
  });
  assert.equal(claudeUsage.turnInputTokens, 125);
  assert.equal(claudeUsage.turnOutputTokens, 100);
  assert.equal(claudeUsage.turnCacheReadTokens, 2_875);
}

function testContextWindowFallbacks() {
  assert.equal(resolveContextWindow('claude-fable-5'), 1_000_000);
  assert.equal(resolveContextWindow('claude-opus-5'), 1_000_000);
  assert.equal(resolveContextWindow('claude-sonnet-5'), 1_000_000);
  assert.equal(resolveContextWindow('claude-haiku-4-5'), 200_000);
  assert.equal(resolveContextWindow('claude-haiku-5-5'), 1_000_000);
  assert.equal(resolveContextWindow('claude-opus-5-5'), 1_000_000);
  assert.equal(resolveContextWindow('gpt-5.5'), 256_000);
  assert.equal(resolveContextWindow('gpt-5.5-pro'), 256_000);
  assert.equal(resolveContextWindow('gpt-6-astra'), 1_100_000);
  assert.equal(resolveContextWindow('gpt-5.6-sol'), 1_050_000);
  assert.equal(resolveContextWindow('gpt-5.6-terra'), 1_050_000);
  assert.equal(resolveContextWindow('gpt-5.4'), 196_000);
  assert.equal(resolveContextWindow('gpt-5.4-mini'), 128_000);
  assert.equal(resolveContextWindow('gpt-5.3-codex'), 400_000);
  // Pi ids carry the provider prefix; the family must still match.
  assert.equal(resolveContextWindow('openai/gpt-5.5'), 256_000);
  assert.equal(resolveContextWindow('antigravity/gemini-3.7-flash'), 1_000_000);
  assert.equal(resolveContextWindow('z-ai/glm-5.1'), 200_000);
  assert.equal(resolveContextWindow('z-ai/glm-4.7'), 200_000);
  assert.equal(resolveContextWindow('z-ai/glm-4.5-air'), 128_000);
  assert.equal(resolveContextWindow('kimi-for-coding/k2p5'), 256_000);
  assert.equal(resolveContextWindow('groq/gpt-oss-120b'), 128_000);
  // Unknown families: display falls back to the default, config writers get null.
  assert.equal(resolveContextWindow('alibaba-token-plan/qwen3.8-max-preview'), 200_000);
  assert.equal(lookupContextWindow('alibaba-token-plan/qwen3.8-max-preview'), null);
  assert.equal(lookupContextWindow('z-ai/glm-5.2'), 200_000);
}

function testUsageWindowNormalization() {
  const staleCodexUsage = normalizeUsageSnapshot({
    sessionId: 'session-1',
    inputTokens: 5_764,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 5_764,
    contextWindow: 256_000,
    contextUsedPercent: 2,
    contextUsedPercentRaw: 2,
    contextExceeded: false,
    totalCostUsd: 0,
    model: 'gpt-5.5',
  });

  assert.equal(staleCodexUsage?.contextWindow, 256_000);
  assert.equal(staleCodexUsage?.contextUsedPercent, 2);
  assert.equal(staleCodexUsage?.contextUsedPercentRaw, 2);
  assert.equal(staleCodexUsage?.contextExceeded, false);

  const unknownUsage = normalizeUsageSnapshot({
    sessionId: 'session-2',
    inputTokens: 1_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 1_000,
    contextWindow: 256_000,
    contextUsedPercent: 0,
    totalCostUsd: 0,
    model: 'custom-model',
  });

  assert.equal(unknownUsage?.contextWindow, 256_000);

  const overWindowUsage = normalizeUsageSnapshot({
    sessionId: 'session-3',
    inputTokens: 309_100,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 309_100,
    contextWindow: 256_000,
    contextUsedPercent: 100,
    contextUsedPercentRaw: 121,
    contextExceeded: true,
    totalCostUsd: 0,
    model: 'gpt-5.5',
  });

  assert.equal(overWindowUsage?.totalTokens, 256_000);
  assert.equal(overWindowUsage?.contextUsedPercent, 100);
  assert.equal(overWindowUsage?.contextUsedPercentRaw, 100);
  assert.equal(overWindowUsage?.contextExceeded, false);
}

async function testContextUsageIncludesAssistantOutput() {
  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo, () => 1);
  const harness = asUsageHarness(manager);
  const sessionId = 'session-context';
  const proc: UsageProcessStub = {
    outputBuffer: { push: () => undefined },
    lastActivityAt: 0,
    cliProvider: 'claude',
    turnInputTokens: 1_000,
    turnCacheReadTokens: 50,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 250,
    contextInputTokens: undefined,
    contextCacheReadTokens: undefined,
    contextCacheCreationTokens: undefined,
    contextWindow: 2_000,
    totalCostUsd: 0.5,
    model: 'custom-model',
  };

  harness.processes.set(sessionId, proc);
  harness.recordContextSnapshot = () => undefined;

  await harness.emitUsage(sessionId, proc);

  const usageEvent = emitted.find((entry) => entry.event === 'session:usage');
  const usage = usageEvent?.data as
    | { totalTokens?: number; contextUsedPercent?: number }
    | undefined;

  assert.equal(usage?.totalTokens, 1_300);
  assert.equal(usage?.contextUsedPercent, 65);
}

async function testCodexUsageUsesNormalizedContextWindow() {
  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo, () => 1);
  const harness = asUsageHarness(manager);
  const sessionId = 'session-codex-context';
  const proc: UsageProcessStub = {
    outputBuffer: { push: () => undefined },
    lastActivityAt: 0,
    cliProvider: 'codex',
    turnInputTokens: 3_000,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    contextInputTokens: 3_000,
    contextCacheReadTokens: 0,
    contextCacheCreationTokens: 0,
    contextWindow: 258_400,
    totalCostUsd: 0.5,
    model: 'gpt-5.5',
  };

  harness.processes.set(sessionId, proc);
  harness.recordContextSnapshot = () => undefined;

  await harness.emitUsage(sessionId, proc);

  const usageEvent = emitted.find((entry) => entry.event === 'session:usage');
  const usage = usageEvent?.data as
    | { contextWindow?: number; contextUsedPercent?: number }
    | undefined;

  assert.equal(usage?.contextWindow, 256_000);
  assert.equal(usage?.contextUsedPercent, 1);
}

async function testContextUsageCapsAtWindow() {
  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(ioStub as unknown as ClaudeProcessManagerIo, () => 1);
  const harness = asUsageHarness(manager);
  const sessionId = 'session-context-cap';
  const proc: UsageProcessStub = {
    outputBuffer: { push: () => undefined },
    lastActivityAt: 0,
    cliProvider: 'codex',
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    contextInputTokens: 309_100,
    contextCacheReadTokens: 0,
    contextCacheCreationTokens: 0,
    contextOutputTokens: 0,
    contextWindow: 256_000,
    totalCostUsd: 0.5,
    model: 'gpt-5.5',
  };

  harness.processes.set(sessionId, proc);
  harness.recordContextSnapshot = () => undefined;

  await harness.emitUsage(sessionId, proc);

  const usageEvent = emitted.find((entry) => entry.event === 'session:usage');
  const usage = usageEvent?.data as
    | {
        totalTokens?: number;
        contextUsedPercent?: number;
        contextUsedPercentRaw?: number;
        contextExceeded?: boolean;
      }
    | undefined;

  assert.equal(usage?.totalTokens, 256_000);
  assert.equal(usage?.contextUsedPercent, 100);
  assert.equal(usage?.contextUsedPercentRaw, 100);
  assert.equal(usage?.contextExceeded, false);
}

async function testCodexFreshExecUsageDoesNotDelta() {
  const ioStub = {
    to: () => ({
      emit: () => undefined,
    }),
  };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitUsage: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitUsage = () => undefined;

  const sessionId = 'session-codex-fresh-exec';
  managerPrivate.processes.set(sessionId, {
    cliProvider: 'codex',
    model: 'gpt-5.5',
    contextWindow: 256_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: false,
    codexLastReportedTokens: { input: 1_000, cached: 100, output: 50 },
    codexSawTokenCountThisTurn: true,
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
  });

  const translated = (await managerPrivate.translateCodexMessage(sessionId, {
    type: 'turn.completed',
    usage: {
      input_tokens: 2_000,
      cached_input_tokens: 500,
      output_tokens: 100,
      reasoning_output_tokens: 25,
    },
  })) as { usage?: Record<string, number> } | null;

  assert.equal(translated?.usage?.input_tokens, 1_500);
  assert.equal(translated?.usage?.cache_read_input_tokens, 500);
  assert.equal(translated?.usage?.output_tokens, 125);
}

async function testCodexUsageClampsEachLargeTurnField() {
  const ioStub = {
    to: () => ({
      emit: () => undefined,
    }),
  };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitUsage: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitUsage = () => undefined;

  const sessionId = 'session-codex-large-agentic-turn';
  managerPrivate.processes.set(sessionId, {
    cliProvider: 'codex',
    model: 'gpt-5.6-sol',
    contextWindow: 1_050_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: false,
    codexSawTokenCountThisTurn: true,
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
  });

  const translated = (await managerPrivate.translateCodexMessage(sessionId, {
    type: 'turn.completed',
    usage: {
      input_tokens: 24_000_000,
      cached_input_tokens: 22_500_000,
      output_tokens: 420_000,
      reasoning_output_tokens: 80_000,
    },
  })) as { usage?: Record<string, number> } | null;

  // Fresh input/output clamp at 5M; cache reads repeat the cached prefix on
  // every model call in the turn, so 22.5M is a legitimate value that must
  // survive (the old shared 1M cap truncated ~37% of real turns).
  assert.equal(translated?.usage?.input_tokens, 1_500_000);
  assert.equal(translated?.usage?.cache_read_input_tokens, 22_500_000);
  assert.equal(translated?.usage?.output_tokens, 500_000);
}

async function testCodexContextEstimateDoesNotPinToWindow() {
  const ioStub = {
    to: () => ({
      emit: () => undefined,
    }),
  };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    recordContextSnapshot: (...args: unknown[]) => void;
    buildUsageSnapshot: (
      sessionId: string,
      proc: unknown
    ) => { totalTokens: number; contextUsedPercent: number };
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.recordContextSnapshot = () => undefined;

  const sessionId = 'session-codex-estimate-no-thread-state';
  const proc: Record<string, unknown> = {
    cliProvider: 'codex',
    userId: 'user-1',
    workingDirectory: '/nonexistent/estimate-only',
    model: 'gpt-5.6-sol',
    contextWindow: 1_050_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: false,
    codexSawTokenCountThisTurn: false,
    codexLastPromptEstimateTokens: 9_000,
    // Last real context observation (token_count or thread state) from an
    // earlier turn: 180K in context.
    codexLastObservedContextUsage: { input: 180_000, cached: 0, output: 0 },
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
  };
  managerPrivate.processes.set(sessionId, proc);

  // Heavy agentic turn: billing counters far above the context window. The
  // old estimator fed them into the context meter and pinned it at 100%.
  await managerPrivate.translateCodexMessage(sessionId, {
    type: 'turn.completed',
    usage: {
      input_tokens: 3_200_000,
      cached_input_tokens: 2_900_000,
      output_tokens: 40_000,
      reasoning_output_tokens: 0,
    },
  });

  const snapshot = managerPrivate.buildUsageSnapshot(sessionId, proc);
  // Estimate = max(promptEstimate, last observed context) + turn output.
  assert.equal(snapshot.totalTokens, 220_000);
  assert.equal(snapshot.contextUsedPercent, 21);
}

async function testCodexUsageIncludesDescendantThreadDelta() {
  const ioStub = {
    to: () => ({
      emit: () => undefined,
    }),
  };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitUsage: (...args: unknown[]) => void;
    readCodexDescendantUsage: (...args: unknown[]) => {
      input: number;
      cached: number;
      output: number;
    };
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitUsage = () => undefined;
  managerPrivate.readCodexDescendantUsage = () => ({
    input: 4_000,
    cached: 3_000,
    output: 500,
  });

  const sessionId = 'session-codex-descendant-usage';
  managerPrivate.processes.set(sessionId, {
    cliProvider: 'codex',
    model: 'gpt-5.6-sol',
    contextWindow: 1_050_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexSessionId: 'root-thread',
    codexCurrentExecUsedResume: false,
    codexSawTokenCountThisTurn: true,
    codexDescendantUsageBaseline: {
      input: 1_000,
      cached: 800,
      output: 100,
    },
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
  });

  const translated = (await managerPrivate.translateCodexMessage(sessionId, {
    type: 'turn.completed',
    usage: {
      input_tokens: 2_000,
      cached_input_tokens: 500,
      output_tokens: 100,
      reasoning_output_tokens: 25,
    },
  })) as { usage?: Record<string, number> } | null;

  assert.equal(translated?.usage?.input_tokens, 2_300);
  assert.equal(translated?.usage?.cache_read_input_tokens, 2_700);
  assert.equal(translated?.usage?.output_tokens, 525);
}

async function createCodexStateFixture(opts: {
  cwd: string;
  threadId: string;
  tokensUsed: number;
  prompt: string;
  updatedAtMs?: number;
}): Promise<string> {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-state-fixture-'));
  const dbPath = path.join(codexHome, 'state_5.sqlite');
  const db = new Database(dbPath);
  const updatedAtMs = opts.updatedAtMs ?? Date.now();
  const updatedAt = Math.floor(updatedAtMs / 1000);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      sandbox_policy TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      has_user_event INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_at INTEGER,
      git_sha TEXT,
      git_branch TEXT,
      git_origin_url TEXT,
      cli_version TEXT NOT NULL DEFAULT '',
      first_user_message TEXT NOT NULL DEFAULT '',
      agent_nickname TEXT,
      agent_role TEXT,
      memory_mode TEXT NOT NULL DEFAULT 'enabled',
      model TEXT,
      reasoning_effort TEXT,
      agent_path TEXT,
      created_at_ms INTEGER,
      updated_at_ms INTEGER,
      thread_source TEXT,
      preview TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare(
    `
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      sandbox_policy, approval_mode, tokens_used, has_user_event, archived,
      cli_version, first_user_message, memory_mode, model, created_at_ms,
      updated_at_ms, preview
    ) VALUES (?, ?, ?, ?, 'exec', 'openai', ?, ?, 'workspace-write', 'on-request', ?, 0, 0,
      '0.130.0', ?, 'enabled', 'gpt-5.5', ?, ?, ?)
  `
  ).run(
    opts.threadId,
    path.join(codexHome, 'sessions', `${opts.threadId}.jsonl`),
    updatedAt,
    updatedAt,
    opts.cwd,
    opts.prompt,
    opts.tokensUsed,
    opts.prompt,
    updatedAtMs,
    updatedAtMs,
    opts.prompt
  );
  db.close();
  return codexHome;
}

async function testCodexThreadStateReaderMatchesPrompt() {
  const prompt = '[Prior conversation context]\nUser asks about context window';
  const codexHome = await createCodexStateFixture({
    cwd: '/workspace/plum',
    threadId: 'thread-state-reader',
    tokensUsed: 251_634,
    prompt,
  });

  try {
    const state = await readCodexThreadState(codexHome, {
      cwd: '/workspace/plum',
      sinceMs: Date.now() - 1_000,
      promptPrefix: prompt.slice(0, 80),
    });

    assert.equal(state?.id, 'thread-state-reader');
    assert.equal(state?.tokensUsed, 251_634);
    assert.equal(state?.match, 'prompt');
  } finally {
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

async function testCodexContextSnapshotReadsRolloutTokenCount() {
  const threadId = 'thread-context-rollout';
  const codexHome = await createCodexStateFixture({
    cwd: '/workspace/plum',
    threadId,
    tokensUsed: 5_000_000,
    prompt: '[Prior conversation context]\nRollout token counts',
  });
  const rolloutPath = path.join(codexHome, 'sessions', `${threadId}.jsonl`);

  try {
    await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
    await fs.writeFile(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: '2026-06-17T20:20:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 207_620,
                cached_input_tokens: 189_824,
                output_tokens: 720,
              },
              model_context_window: 258_400,
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-06-17T20:21:00.000Z',
          type: 'compacted',
          payload: { message: '', replacement_history: [] },
        }),
        JSON.stringify({
          timestamp: '2026-06-17T20:21:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 0,
                cached_input_tokens: 0,
                output_tokens: 0,
              },
              model_context_window: 258_400,
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-06-17T20:22:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: {
                input_tokens: 9_000_000,
                cached_input_tokens: 8_500_000,
                output_tokens: 300_000,
                reasoning_output_tokens: 50_000,
              },
              last_token_usage: {
                input_tokens: 72_000,
                cached_input_tokens: 30_000,
                output_tokens: 1_000,
              },
              model_context_window: 258_400,
            },
          },
        }),
      ].join('\n'),
      'utf8'
    );

    const snapshot = await readLatestCodexContextSnapshot(codexHome, {
      threadId,
      cwd: '/workspace/plum',
    });

    assert.equal(snapshot?.threadId, threadId);
    assert.equal(snapshot?.counters.input, 72_000);
    assert.equal(snapshot?.counters.cached, 30_000);
    assert.equal(snapshot?.counters.output, 1_000);
    assert.equal(snapshot?.contextWindow, 256_000);
    assert.equal(snapshot?.recordedAt, '2026-06-17T20:22:00.000Z');
    assert.deepEqual(await readCodexThreadCumulativeUsage(codexHome, threadId), {
      input: 9_000_000,
      cached: 8_500_000,
      output: 300_000,
    });
  } finally {
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

async function testCodexContextSnapshotReadsOnlyBoundedTail() {
  const threadId = 'thread-context-bounded-tail';
  const codexHome = await createCodexStateFixture({
    cwd: '/workspace/plum',
    threadId,
    tokensUsed: 90_000,
    prompt: 'Bounded rollout tail',
  });
  const rolloutPath = path.join(codexHome, 'sessions', `${threadId}.jsonl`);
  const tokenCount = JSON.stringify({
    timestamp: '2026-07-14T05:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: 88_000,
          cached_input_tokens: 70_000,
          output_tokens: 2_000,
        },
        model_context_window: 256_000,
      },
    },
  });

  try {
    await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
    await fs.writeFile(rolloutPath, '', 'utf8');
    // Sparse prefix models a multi-hundred-MiB rollout without allocating it in
    // the test process. The newest complete token_count remains in the tail.
    await fs.truncate(rolloutPath, CODEX_ROLLOUT_TAIL_MAX_BYTES * 4);
    await fs.appendFile(rolloutPath, `\n${tokenCount}\n{"partial":`, 'utf8');

    const stat = await fs.stat(rolloutPath);
    const tail = readCodexRolloutTail(rolloutPath);
    assert.ok(stat.size > CODEX_ROLLOUT_TAIL_MAX_BYTES);
    assert.equal(tail?.truncated, true);
    assert.equal(tail?.bytesRead, CODEX_ROLLOUT_TAIL_MAX_BYTES);

    const snapshot = await readLatestCodexContextSnapshot(codexHome, {
      threadId,
      cwd: '/workspace/plum',
    });
    assert.deepEqual(snapshot?.counters, {
      input: 88_000,
      cached: 70_000,
      output: 2_000,
    });
    assert.equal(snapshot?.recordedAt, '2026-07-14T05:00:00.000Z');
  } finally {
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

/**
 * Fixture: one exec root plus a subagent child in the same cwd, both with a
 * rollout carrying a single token_count. Mirrors what Codex writes when a turn
 * spawns subagents.
 */
async function createCodexExecTreeFixture(opts: {
  cwd: string;
  rootThreadId: string;
  rootCreatedAtMs: number;
  childUsage: { input: number; cached: number; output: number };
  rootUsage: { input: number; cached: number; output: number };
  extraRoot?: { id: string; createdAtMs: number };
}): Promise<string> {
  const codexHome = await createCodexStateFixture({
    cwd: opts.cwd,
    threadId: opts.rootThreadId,
    tokensUsed: 10_000,
    prompt: 'Root prompt',
    updatedAtMs: opts.rootCreatedAtMs,
  });
  await fs.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
  const db = new Database(path.join(codexHome, 'state_5.sqlite'));
  const tokenCount = (counters: { input: number; cached: number; output: number }) =>
    `${JSON.stringify({
      timestamp: '2026-07-30T11:20:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: counters.input,
            cached_input_tokens: counters.cached,
            output_tokens: counters.output,
          },
        },
      },
    })}\n`;

  const insertThread = db.prepare(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      sandbox_policy, approval_mode, tokens_used, has_user_event, archived,
      cli_version, first_user_message, memory_mode, model, created_at_ms,
      updated_at_ms, preview
    ) VALUES (?, ?, ?, ?, ?, 'openai', ?, ?, 'workspace-write',
      'on-request', 1, 0, 0, '0.144.0', '', 'enabled', 'gpt-5.6-sol', ?, ?, '')
  `);

  const rootRollout = path.join(codexHome, 'sessions', `${opts.rootThreadId}.jsonl`);
  db.prepare(
    'UPDATE threads SET rollout_path = ?, created_at_ms = ?, created_at = ? WHERE id = ?'
  ).run(
    rootRollout,
    opts.rootCreatedAtMs,
    Math.floor(opts.rootCreatedAtMs / 1000),
    opts.rootThreadId
  );
  await fs.writeFile(rootRollout, tokenCount(opts.rootUsage), 'utf8');

  const childId = `${opts.rootThreadId}-child`;
  const childRollout = path.join(codexHome, 'sessions', `${childId}.jsonl`);
  const childCreatedAtMs = opts.rootCreatedAtMs + 60_000;
  insertThread.run(
    childId,
    childRollout,
    Math.floor(childCreatedAtMs / 1000),
    Math.floor(childCreatedAtMs / 1000),
    JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: opts.rootThreadId } } }),
    opts.cwd,
    childId,
    childCreatedAtMs,
    childCreatedAtMs
  );
  await fs.writeFile(childRollout, tokenCount(opts.childUsage), 'utf8');

  if (opts.extraRoot) {
    const extraRollout = path.join(codexHome, 'sessions', `${opts.extraRoot.id}.jsonl`);
    insertThread.run(
      opts.extraRoot.id,
      extraRollout,
      Math.floor(opts.extraRoot.createdAtMs / 1000),
      Math.floor(opts.extraRoot.createdAtMs / 1000),
      'exec',
      opts.cwd,
      opts.extraRoot.id,
      opts.extraRoot.createdAtMs,
      opts.extraRoot.createdAtMs
    );
    await fs.writeFile(extraRollout, tokenCount({ input: 1, cached: 0, output: 1 }), 'utf8');
  }

  db.close();
  return codexHome;
}

/**
 * Regression: subagent threads share the parent's cwd, and a second WebUI
 * session can start its own exec in the same directory. The lookup must skip
 * spawned children and take the exec started by *this* turn, not the newest one.
 */
async function testCodexExecRootLookupSkipsSubagentsAndForeignExecs() {
  const execStartedAtMs = Date.parse('2026-07-30T11:18:14.000Z');
  const codexHome = await createCodexExecTreeFixture({
    cwd: '/workspace/plum-exec-root',
    rootThreadId: 'exec-root',
    rootCreatedAtMs: execStartedAtMs + 500,
    rootUsage: { input: 99_000, cached: 95_000, output: 900 },
    childUsage: { input: 48_000, cached: 46_000, output: 400 },
    extraRoot: { id: 'foreign-exec-root', createdAtMs: execStartedAtMs + 300_000 },
  });

  try {
    assert.equal(
      await findCodexExecRootThreadId(codexHome, {
        cwd: '/workspace/plum-exec-root',
        sinceMs: execStartedAtMs,
      }),
      'exec-root'
    );
    assert.equal(
      await findCodexExecRootThreadId(codexHome, { cwd: '/nope', sinceMs: execStartedAtMs }),
      null
    );
    assert.deepEqual(await readCodexDescendantUsage(codexHome, 'exec-root'), {
      input: 48_000,
      cached: 46_000,
      output: 400,
    });
  } finally {
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

function makeCodexProcFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cliProvider: 'codex',
    userId: 'user-1',
    workingDirectory: '/workspace/plum-exec-root',
    model: 'gpt-5.6-sol',
    contextWindow: 258_400,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: false,
    codexSawTokenCountThisTurn: true,
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
    ...overrides,
  };
}

/**
 * Regression: the thread id used to be resolved *after* the descendant lookup,
 * so a turn whose session_meta carried no id charged its subagents against
 * `null` and silently dropped them.
 */
async function testCodexTurnCompletedRollsUpDescendantsWithoutKnownThreadId() {
  const execStartedAtMs = Date.parse('2026-07-30T11:18:14.000Z');
  const codexHome = await createCodexExecTreeFixture({
    cwd: '/workspace/plum-exec-root',
    rootThreadId: 'exec-root',
    rootCreatedAtMs: execStartedAtMs + 500,
    rootUsage: { input: 99_000, cached: 95_000, output: 900 },
    childUsage: { input: 48_000, cached: 46_000, output: 400 },
  });
  const originalCredentialsPath = CLI_PROVIDERS.codex.credentialsPath;
  const ioStub = { to: () => ({ emit: () => undefined }) };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitUsage: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitUsage = () => undefined;

  const sessionId = 'session-codex-root-resolution';
  // No codexSessionId/claudeSessionId: exactly the state that lost the subagents.
  const proc = makeCodexProcFixture({ codexExecStartedAtMs: execStartedAtMs });

  try {
    CLI_PROVIDERS.codex.credentialsPath = codexHome;
    managerPrivate.processes.set(sessionId, proc);
    const translated = (await managerPrivate.translateCodexMessage(sessionId, {
      type: 'turn.completed',
      usage: {
        input_tokens: 99_000,
        cached_input_tokens: 95_000,
        output_tokens: 700,
        reasoning_output_tokens: 200,
      },
    })) as { usage?: Record<string, number> } | null;

    // Root non-cached 4_000 + child non-cached 2_000; caches and output summed.
    assert.equal(translated?.usage?.input_tokens, 6_000);
    assert.equal(translated?.usage?.cache_read_input_tokens, 141_000);
    assert.equal(translated?.usage?.output_tokens, 1_300);
    assert.equal(proc.codexSessionId, 'exec-root');
  } finally {
    CLI_PROVIDERS.codex.credentialsPath = originalCredentialsPath;
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

/** Regression: `turn.failed` carries no usage, so the turn used to cost nothing. */
async function testCodexTurnFailedBooksUsageFromThreadState() {
  const execStartedAtMs = Date.parse('2026-07-30T11:18:14.000Z');
  const codexHome = await createCodexExecTreeFixture({
    cwd: '/workspace/plum-exec-root',
    rootThreadId: 'exec-root',
    rootCreatedAtMs: execStartedAtMs + 500,
    rootUsage: { input: 99_000, cached: 95_000, output: 900 },
    childUsage: { input: 48_000, cached: 46_000, output: 400 },
  });
  const originalCredentialsPath = CLI_PROVIDERS.codex.credentialsPath;
  const ioStub = { to: () => ({ emit: () => undefined }) };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const saved: Array<Record<string, unknown>> = [];
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitUsage: (...args: unknown[]) => void;
    saveUsageToDatabase: (sessionId: string, proc: Record<string, unknown>) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitUsage = () => undefined;
  managerPrivate.saveUsageToDatabase = (_sessionId, savedProc) => {
    saved.push({
      input: savedProc.turnInputTokens,
      cached: savedProc.turnCacheReadTokens,
      output: savedProc.turnOutputTokens,
    });
  };

  const sessionId = 'session-codex-turn-failed';
  const proc = makeCodexProcFixture({ codexExecStartedAtMs: execStartedAtMs });

  try {
    CLI_PROVIDERS.codex.credentialsPath = codexHome;
    managerPrivate.processes.set(sessionId, proc);
    const translated = await managerPrivate.translateCodexMessage(sessionId, {
      type: 'turn.failed',
      message: 'rate limit',
    });

    // A failed turn must not synthesize a successful result...
    assert.equal(translated, null);
    // ...but its spend still has to land in usage_history.
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], { input: 6_000, cached: 141_000, output: 1_300 });
  } finally {
    CLI_PROVIDERS.codex.credentialsPath = originalCredentialsPath;
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

function makePiManagerFixture(sessionId: string, overrides: Record<string, unknown> = {}) {
  // Never the real data directory: dispatch and settle write the run journal.
  setPiRunJournalPath(path.join(os.tmpdir(), `plum-pi-journal-${process.pid}.json`));
  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    emitCompact: (...args: unknown[]) => void;
    resetCurrentContextUsage: (...args: unknown[]) => void;
    emitUsage: (...args: unknown[]) => Promise<void>;
    emitLifecycle: (...args: unknown[]) => Promise<void>;
    saveUsageToDatabase: (...args: unknown[]) => Promise<void>;
    saveAssistantMessage: (sessionId: string, content: string) => Promise<void>;
    dispatchPiTurn: (sessionId: string, proc: unknown, turn: unknown) => void;
    translatePiMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.emitCompact = () => undefined;
  managerPrivate.resetCurrentContextUsage = () => undefined;
  managerPrivate.emitUsage = async () => undefined;
  managerPrivate.emitLifecycle = async () => undefined;
  const bookedUsage: Array<Record<string, number>> = [];
  const savedMessages: string[] = [];

  const written: string[] = [];
  const proc: Record<string, unknown> = {
    cliProvider: 'pi',
    userId: 'user-1',
    model: 'alibaba-token-plan/qwen3.8-max-preview',
    streamingText: '',
    isStreaming: true,
    turnInputTokens: 0,
    turnOutputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalCostUsd: 0,
    piTurnInFlight: true,
    pendingToolResults: new Map(),
    subagentRuns: new Map(),
    process: { stdin: { write: (chunk: string) => written.push(chunk), writable: true } },
    ...overrides,
  };
  managerPrivate.processes.set(sessionId, proc);
  managerPrivate.saveUsageToDatabase = async (_sessionId: unknown, booked: unknown) => {
    const p = booked as Record<string, number>;
    bookedUsage.push({
      input: p.turnInputTokens,
      output: p.turnOutputTokens,
      cacheRead: p.turnCacheReadTokens,
    });
  };
  managerPrivate.saveAssistantMessage = async (_sessionId: string, content: string) => {
    savedMessages.push(content);
  };
  return { managerPrivate, proc, written, emitted, bookedUsage, savedMessages };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Regression: threshold compaction consumed the turn and Pi never picked the
 * work back up, leaving the request unfinished with the thinking indicator on.
 */
async function testPiResumesTurnAfterThresholdCompaction() {
  const sessionId = 'session-pi-compact-resume';
  const { managerPrivate, proc, written } = makePiManagerFixture(sessionId);

  await managerPrivate.translatePiMessage(sessionId, {
    type: 'compaction_end',
    reason: 'threshold',
    aborted: false,
    willRetry: false,
    result: { summary: 'ok', tokensBefore: 120_000 },
  });

  assert.equal(written.length, 0, 'nudge must not fire synchronously');
  await sleep(6_400);

  assert.equal(written.length, 1);
  const sent = JSON.parse(written[0]) as { type: string; message: string };
  assert.equal(sent.type, 'prompt');
  assert.match(sent.message, /Continue the task from the compaction summary/);
  assert.equal(proc.piCompactContinuations, 1);
}

/** Pi retries the aborted turn itself on overflow — a nudge would duplicate it. */
async function testPiDoesNotResumeWhenPiWillRetry() {
  const sessionId = 'session-pi-compact-will-retry';
  const { managerPrivate, written } = makePiManagerFixture(sessionId);

  await managerPrivate.translatePiMessage(sessionId, {
    type: 'compaction_end',
    reason: 'overflow',
    aborted: false,
    willRetry: true,
  });

  await sleep(6_400);
  assert.equal(written.length, 0);
}

/** Any sign of progress cancels the pending nudge. */
async function testPiProgressCancelsScheduledCompactionResume() {
  const sessionId = 'session-pi-compact-progress';
  const { managerPrivate, written } = makePiManagerFixture(sessionId);

  await managerPrivate.translatePiMessage(sessionId, {
    type: 'compaction_end',
    reason: 'threshold',
    aborted: false,
    willRetry: false,
    result: { summary: 'ok', tokensBefore: 120_000 },
  });
  await managerPrivate.translatePiMessage(sessionId, {
    type: 'message_start',
    message: { role: 'assistant' },
  });

  await sleep(6_400);
  assert.equal(written.length, 0);
}

/**
 * Regression: Pi runs threshold compaction only after `agent_end`, and
 * `turn_end` fires after every LLM round. The old handler cleared the in-flight
 * flag at `turn_end`, so a real post-turn compaction looked like a manual
 * `/compact` and the task waited for a typed "continue".
 */
async function testPiResumesAfterPostTurnThresholdCompaction() {
  const sessionId = 'session-pi-compact-post-turn';
  const { managerPrivate, proc, written } = makePiManagerFixture(sessionId);

  await managerPrivate.translatePiMessage(sessionId, {
    type: 'turn_end',
    message: { role: 'assistant', usage: { input: 10, output: 5 } },
    toolResults: [{ role: 'toolResult' }],
  });
  assert.equal(proc.piTurnInFlight, true, 'a tool round must not end the prompt');
  await managerPrivate.translatePiMessage(sessionId, {
    type: 'turn_end',
    message: { role: 'assistant', usage: { input: 10, output: 5 } },
    toolResults: [],
  });
  await managerPrivate.translatePiMessage(sessionId, { type: 'agent_end', messages: [] });
  assert.equal(proc.piTurnInFlight, true, 'agent_end is not the end of the run either');

  await managerPrivate.translatePiMessage(sessionId, {
    type: 'compaction_end',
    reason: 'threshold',
    aborted: false,
    willRetry: false,
    result: { summary: 'ok', tokensBefore: 120_000 },
  });
  await sleep(6_400);

  assert.equal(written.length, 1, 'post-turn threshold compaction must be resumed');
  const sent = JSON.parse(written[0]) as { type: string; message: string };
  assert.equal(sent.type, 'prompt');
  assert.match(sent.message, /Continue the task from the compaction summary/);
  assert.equal(proc.piTurnInFlight, true);
}

/**
 * The continuation budget refills only after a run the model finished itself.
 * A `length` end at the hard limit must keep counting, otherwise a session that
 * can still squeeze out one tool call per round loops forever.
 */
async function testPiCompactionBudgetRefillsOnlyAfterCleanStop() {
  const sessionId = 'session-pi-compact-budget';
  const { managerPrivate, proc } = makePiManagerFixture(sessionId, {
    piCompactContinuations: 2,
  });

  await managerPrivate.translatePiMessage(sessionId, {
    type: 'turn_end',
    message: { role: 'assistant', stopReason: 'length', usage: { input: 1, output: 1 } },
    toolResults: [],
  });
  await managerPrivate.translatePiMessage(sessionId, { type: 'agent_end', messages: [] });
  assert.equal(proc.piCompactContinuations, 2, 'length end keeps the count');

  await managerPrivate.translatePiMessage(sessionId, {
    type: 'turn_end',
    message: { role: 'assistant', stopReason: 'stop', usage: { input: 1, output: 1 } },
    toolResults: [],
  });
  await managerPrivate.translatePiMessage(sessionId, { type: 'agent_end', messages: [] });
  assert.equal(proc.piCompactContinuations, 0, 'clean stop refills');
}

/**
 * Regression: a failed compaction (no result, errorMessage set) was treated as
 * success and nudged. The context was still full, so every nudge cost one
 * full-window request and ended in `length` again — the "Context compacted"
 * marker after every single tool call in the chat.
 */
async function testPiFailedCompactionDoesNotResume() {
  const sessionId = 'session-pi-compact-failed';
  const { managerPrivate, proc, written, emitted } = makePiManagerFixture(sessionId);
  const compactEvents: Array<Record<string, unknown>> = [];
  managerPrivate.emitCompact = (_sessionId: unknown, data: unknown) => {
    compactEvents.push(data as Record<string, unknown>);
  };

  await managerPrivate.translatePiMessage(sessionId, {
    type: 'compaction_end',
    reason: 'overflow',
    aborted: false,
    willRetry: false,
    result: undefined,
    errorMessage: 'Context overflow recovery failed after one compact-and-retry attempt.',
  });
  await sleep(6_400);

  assert.equal(written.length, 0, 'no nudge after a failed compaction');
  const settled = await managerPrivate.translatePiMessage(sessionId, {
    type: 'agent_settled',
    aborted: false,
  });
  assert.deepEqual(settled, { type: 'result' });
  assert.equal(proc.piTurnInFlight, false);
  assert.equal(compactEvents.length, 1);
  assert.match(String(compactEvents[0]?.error), /overflow recovery failed/);
  assert.equal(compactEvents[0]?.reason, 'context-limit');
  assert.ok(
    emitted.some(
      (entry) =>
        entry.event === 'session:thinking' &&
        (entry.data as { isThinking?: boolean }).isThinking === false
    ),
    'thinking indicator is switched off'
  );
}

/**
 * Regression: every model round (`turn_end`) was reported as a finished turn.
 * The spinner vanished between tool rounds, "done" notifications fired and
 * parked setting restarts killed the running task. Only `agent_settled` ends a
 * run, and the run's usage is booked once with every round in it.
 */
async function testPiRunEndsAtAgentSettledAndBooksAllRounds() {
  const sessionId = 'session-pi-run-settled';
  const { managerPrivate, proc, bookedUsage } = makePiManagerFixture(sessionId);

  for (const input of [100, 200, 300]) {
    const round = await managerPrivate.translatePiMessage(sessionId, {
      type: 'turn_end',
      message: {
        role: 'assistant',
        stopReason: 'toolUse',
        usage: { input, output: 10, cacheRead: 5 },
      },
      toolResults: [],
    });
    assert.equal(round, null, 'a round is not a result');
  }
  assert.equal(
    await managerPrivate.translatePiMessage(sessionId, { type: 'agent_end', messages: [] }),
    null
  );
  assert.equal(proc.piTurnInFlight, true);
  assert.equal(bookedUsage.length, 0, 'nothing booked before the run settles');

  const settled = await managerPrivate.translatePiMessage(sessionId, {
    type: 'agent_settled',
    aborted: false,
  });
  assert.deepEqual(settled, { type: 'result' });
  assert.equal(proc.piTurnInFlight, false);
  assert.deepEqual(bookedUsage, [{ input: 600, output: 30, cacheRead: 15 }]);
  assert.equal(proc.turnInputTokens, 300, 'the live readout keeps the last request');
}

/** A provider error that outlived Pi's retries is said in the chat, not swallowed. */
async function testPiProviderErrorIsSurfaced() {
  const sessionId = 'session-pi-error';
  const { managerPrivate, proc, emitted, savedMessages } = makePiManagerFixture(sessionId);

  await managerPrivate.translatePiMessage(sessionId, {
    type: 'auto_retry_start',
    attempt: 1,
    maxAttempts: 8,
    delayMs: 3_000,
    errorMessage: '529 overloaded',
  });
  assert.match(String(proc.currentActivitySummary), /Erneuter Versuch 1\/8 in 3 s: 529 overloaded/);
  await managerPrivate.translatePiMessage(sessionId, {
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'error', errorMessage: 'credit balance is too low' },
  });
  await managerPrivate.translatePiMessage(sessionId, {
    type: 'auto_retry_end',
    success: false,
    attempt: 8,
    finalError: 'credit balance is too low',
  });
  await managerPrivate.translatePiMessage(sessionId, { type: 'agent_settled', aborted: false });

  assert.equal(savedMessages.length, 1);
  assert.match(savedMessages[0]!, /Pi-Fehler:\*\* credit balance is too low/);
  assert.ok(
    emitted.some(
      (entry) =>
        entry.event === 'session:error' &&
        /credit balance/.test(String((entry.data as { error?: string }).error))
    )
  );
}

/** A later round that gets through clears an earlier error; an abort says nothing. */
async function testPiRecoveredOrAbortedRunStaysQuiet() {
  const sessionId = 'session-pi-error-recovered';
  const { managerPrivate, savedMessages } = makePiManagerFixture(sessionId);
  await managerPrivate.translatePiMessage(sessionId, {
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'error', errorMessage: 'timeout' },
  });
  await managerPrivate.translatePiMessage(sessionId, {
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'stop' },
  });
  await managerPrivate.translatePiMessage(sessionId, { type: 'agent_settled', aborted: false });
  assert.equal(savedMessages.length, 0);

  const aborted = 'session-pi-error-aborted';
  const second = makePiManagerFixture(aborted);
  await second.managerPrivate.translatePiMessage(aborted, {
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'error', errorMessage: 'timeout' },
  });
  await second.managerPrivate.translatePiMessage(aborted, { type: 'agent_settled', aborted: true });
  assert.equal(second.savedMessages.length, 0);
}

/** Threshold compaction after a finished task must not start new work. */
async function testPiNoContinueAfterCleanStop() {
  const sessionId = 'session-pi-compact-after-stop';
  const { managerPrivate, written } = makePiManagerFixture(sessionId);
  await managerPrivate.translatePiMessage(sessionId, {
    type: 'turn_end',
    message: { role: 'assistant', stopReason: 'stop', usage: { input: 1, output: 1 } },
    toolResults: [],
  });
  await managerPrivate.translatePiMessage(sessionId, { type: 'agent_end', messages: [] });
  await managerPrivate.translatePiMessage(sessionId, {
    type: 'compaction_end',
    reason: 'threshold',
    aborted: false,
    willRetry: false,
    result: { summary: 'ok', tokensBefore: 120_000 },
  });
  const settled = await managerPrivate.translatePiMessage(sessionId, {
    type: 'agent_settled',
    aborted: false,
  });
  assert.deepEqual(settled, { type: 'result' });
  await sleep(6_400);
  assert.equal(written.length, 0);
}

/** A prompt Pi refuses while compacting returns to the head of Plum's queue. */
async function testPiRejectedPromptIsRequeued() {
  const sessionId = 'session-pi-rejected';
  const { managerPrivate, proc, written } = makePiManagerFixture(sessionId, {
    piTurnInFlight: false,
  });
  const turn = {
    queueId: 'm1',
    chatId: null,
    queuedAt: new Date().toISOString(),
    originalMessage: 'weiter',
    messageForClaude: 'weiter',
    updateLastMessage: true,
  };
  managerPrivate.dispatchPiTurn(sessionId, proc, turn);
  assert.equal(written.length, 1);
  assert.equal((JSON.parse(written[0]!) as { type: string }).type, 'prompt');
  assert.equal(proc.piTurnInFlight, true);

  await managerPrivate.translatePiMessage(sessionId, {
    type: 'response',
    command: 'prompt',
    success: false,
    error: 'Cannot submit a prompt while compaction is in progress',
  });
  assert.equal(proc.piTurnInFlight, false);
  assert.equal(proc.piCompacting, true);
  assert.deepEqual(
    (proc.piQueuedTurns as Array<{ queueId: string }>).map((queued) => queued.queueId),
    ['m1']
  );
}

/**
 * A run is journalled from dispatch to settle, with the running tool and the
 * queued messages, so a crash or a backend restart can resume it.
 */
async function testPiRunIsJournalledUntilItSettles() {
  const sessionId = 'session-pi-journal';
  const { managerPrivate, proc } = makePiManagerFixture(sessionId, { piTurnInFlight: false });
  managerPrivate.dispatchPiTurn(sessionId, proc, {
    queueId: 'm1',
    chatId: 'chat-1',
    queuedAt: new Date().toISOString(),
    originalMessage: 'baue das feature',
    messageForClaude: 'baue das feature',
    updateLastMessage: true,
  });
  assert.equal(getPiRun(sessionId)?.chatId, 'chat-1');

  await managerPrivate.translatePiMessage(sessionId, {
    type: 'tool_execution_start',
    toolCallId: 't1',
    toolName: 'bash',
    args: { command: 'npm test --   --watch=false' },
  });
  assert.deepEqual(getPiRun(sessionId)?.tool, { name: 'bash', input: 'npm test -- --watch=false' });

  proc.piQueuedTurns = [
    {
      queueId: 'm2',
      chatId: 'chat-1',
      queuedAt: '',
      originalMessage: 'und dann deploy',
      messageForClaude: '',
    },
  ];
  (
    managerPrivate as unknown as { emitQueueState: (id: string, p: unknown) => void }
  ).emitQueueState(sessionId, proc);
  assert.deepEqual(getPiRun(sessionId)?.queued, [{ message: 'und dann deploy', chatId: 'chat-1' }]);

  await managerPrivate.translatePiMessage(sessionId, { type: 'agent_settled', aborted: false });
  assert.equal(getPiRun(sessionId), null, 'a settled run leaves nothing to resume');
}

/**
 * Claude turns use the same journal as Pi runs, so a Plum restart resumes them:
 * written at dispatch with the provider, the running tool and the queue kept
 * current, gone when the user stops the turn.
 */
async function testClaudeTurnIsJournalledForResume() {
  const sessionId = 'session-claude-journal';
  const { managerPrivate, proc } = makePiManagerFixture(sessionId, {
    cliProvider: 'claude',
    piTurnInFlight: false,
    claudeIdle: true,
    outputBuffer: { push: () => undefined },
  });
  const claudePrivate = managerPrivate as unknown as {
    dispatchClaudeTurn: (sessionId: string, proc: unknown, turn: unknown) => void;
    processStreamMessage: (sessionId: string, msg: unknown) => Promise<void>;
    emitQueueState: (id: string, p: unknown) => void;
    interrupt: (sessionId: string, userId: string) => Promise<void>;
  };
  claudePrivate.dispatchClaudeTurn(sessionId, proc, {
    queueId: 'c1',
    chatId: 'chat-c',
    queuedAt: new Date().toISOString(),
    originalMessage: 'refactor das modul',
    messageForClaude: 'refactor das modul',
    updateLastMessage: true,
  });
  assert.equal(getPiRun(sessionId)?.provider, 'claude');
  assert.equal(getPiRun(sessionId)?.chatId, 'chat-c');

  Object.assign(proc, {
    currentToolName: 'Bash',
    currentToolId: 'tool-1',
    currentToolInput: JSON.stringify({ command: 'pnpm   build' }),
  });
  await claudePrivate.processStreamMessage(sessionId, {
    type: 'stream_event',
    event: { type: 'content_block_stop', index: 0 },
  });
  assert.deepEqual(getPiRun(sessionId)?.tool, { name: 'Bash', input: 'pnpm build' });

  proc.claudeQueuedTurns = [
    {
      queueId: 'c2',
      chatId: 'chat-c',
      queuedAt: '',
      originalMessage: 'danach tests',
      messageForClaude: '',
    },
  ];
  claudePrivate.emitQueueState(sessionId, proc);
  assert.deepEqual(getPiRun(sessionId)?.queued, [{ message: 'danach tests', chatId: 'chat-c' }]);

  proc.process = { stdin: { write: () => true, writable: true }, kill: () => true };
  await claudePrivate.interrupt(sessionId, 'user-1');
  assert.equal(getPiRun(sessionId), null, 'a stopped turn leaves nothing to resume');
}

/**
 * A resumed CLI reports a background task from before the restart with a
 * `task_notification` and an empty `result`, and only then reads the prompt.
 * That report must not end the turn: the run stays journalled and busy.
 */
async function testClaudeStaleTaskNotificationKeepsTurnJournalled() {
  const sessionId = 'session-claude-stale-task';
  const { managerPrivate, proc } = makePiManagerFixture(sessionId, {
    cliProvider: 'claude',
    piTurnInFlight: false,
    claudeIdle: true,
    outputBuffer: { push: () => undefined },
  });
  const claudePrivate = managerPrivate as unknown as {
    dispatchClaudeTurn: (sessionId: string, proc: unknown, turn: unknown) => void;
    processStreamMessage: (sessionId: string, msg: unknown) => Promise<void>;
  };
  claudePrivate.dispatchClaudeTurn(sessionId, proc, {
    queueId: 'r1',
    chatId: 'chat-r',
    queuedAt: new Date().toISOString(),
    originalMessage: 'weiter nach dem Neustart',
    messageForClaude: 'weiter nach dem Neustart',
    updateLastMessage: false,
  });
  assert.equal(proc.claudeIdle, false);

  await claudePrivate.processStreamMessage(sessionId, {
    type: 'system',
    subtype: 'task_notification',
    task_id: 'task-from-before',
    status: 'stopped',
  });
  await claudePrivate.processStreamMessage(sessionId, {
    type: 'result',
    subtype: 'success',
    num_turns: 0,
    duration_api_ms: 0,
    result: '',
  });

  assert.equal(getPiRun(sessionId)?.chatId, 'chat-r', 'the run is still journalled');
  assert.equal(proc.claudeIdle, false, 'the dispatched turn is still running');
  assert.equal(proc.taskNotificationPending, false, 'the report is consumed once');
}

/**
 * What a Claude turn puts into the ledger, through the real stream handling
 * and the real database.
 *
 * Until 2026-11-10 a turn was one row under the id of its message. Claude
 * carries on by itself when a background task or agent finishes and ends with
 * a result of its own; that second result arrived under the same id and was
 * dropped as a duplicate, so sessions working with background agents booked a
 * tenth of what they spent. Tokens the model router had booked for agents were
 * subtracted from the turn as well, although the turn never contained them.
 */
async function testClaudeBooksEveryResultOfATurn() {
  const sessionId = 'session-claude-results';
  await pgRun(
    `INSERT INTO users (id, email, name, provider, provider_id)
     VALUES ('user-results', 'results@example.test', 'R', 'local', 'user-results')`
  );
  await pgRun(
    `INSERT INTO sessions (id, user_id, name, working_directory, cli_provider)
     VALUES (?, 'user-results', 'Results', '/tmp', 'claude')`,
    sessionId
  );
  const { managerPrivate, proc } = makePiManagerFixture(sessionId, {
    cliProvider: 'claude',
    userId: 'user-results',
    model: 'claude-fable-5-2',
    piTurnInFlight: false,
    claudeIdle: true,
    isStreaming: false,
    outputBuffer: { push: () => undefined },
  });
  // The fixture replaces these two; this test is about the real ones.
  const own = managerPrivate as unknown as Record<string, unknown>;
  delete own.saveUsageToDatabase;
  delete own.resetCurrentContextUsage;
  const claudePrivate = managerPrivate as unknown as {
    dispatchClaudeTurn: (sessionId: string, proc: unknown, turn: unknown) => void;
    processStreamMessage: (sessionId: string, msg: unknown) => Promise<void>;
    saveUsageToDatabase: (sessionId: string, proc: unknown) => Promise<void>;
    reportCliSubagent: (sessionId: string, input: unknown) => void;
  };
  const turn = (queueId: string) => ({
    queueId,
    chatId: null,
    queuedAt: new Date().toISOString(),
    originalMessage: 'go',
    messageForClaude: 'go',
    updateLastMessage: false,
  });
  const response = async (
    id: string,
    model: string,
    usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
  ) => {
    await claudePrivate.processStreamMessage(sessionId, {
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: {
          id,
          model,
          usage: {
            input_tokens: usage.input,
            output_tokens: 1,
            cache_read_input_tokens: usage.cacheRead,
            cache_creation_input_tokens: usage.cacheWrite,
          },
        },
      },
    });
    await claudePrivate.processStreamMessage(sessionId, {
      type: 'stream_event',
      event: { type: 'message_delta', usage: { output_tokens: usage.output }, delta: {} },
    });
  };
  const result = (usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  }) =>
    claudePrivate.processStreamMessage(sessionId, {
      type: 'result',
      subtype: 'success',
      num_turns: 1,
      duration_api_ms: 5,
      result: 'done',
      usage: {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_read_input_tokens: usage.cacheRead,
        cache_creation_input_tokens: usage.cacheWrite,
      },
    });
  const ledger = async () =>
    (
      (await pgAllRows(
        `SELECT turn_id, total_tokens::int AS total, model FROM usage_history
          WHERE session_id = ? ORDER BY id`,
        sessionId
      )) as Array<{ turn_id: string; total: number; model: string }>
    ).map((row) => [row.turn_id, row.total, row.model]);

  // A worker of the CLI-subagent bridge, started from a background shell. The
  // parent writing on and its turn ending say nothing about it.
  claudePrivate.dispatchClaudeTurn(sessionId, proc, turn('q1'));
  claudePrivate.reportCliSubagent(sessionId, { id: 'w-1', provider: 'pi', status: 'started' });
  const worker = () =>
    (proc.subagentRuns as Map<string, { status: string; lifecycle?: string }>).get('cli-w-1');

  const first = { input: 10, output: 200, cacheRead: 5000, cacheWrite: 300 };
  await response('m1', 'claude-fable-5-2', first);
  await claudePrivate.processStreamMessage(sessionId, {
    type: 'stream_event',
    event: { type: 'content_block_start', content_block: { type: 'text' } },
  });
  assert.equal(worker()?.status, 'started', 'text from the parent does not end a worker');
  await result(first);
  assert.equal(worker()?.status, 'started', 'nor does the end of the turn');
  assert.deepEqual(await ledger(), [['q1', 5510, 'claude-fable-5-2']]);

  // A background task finished; Claude carries on without a new message.
  const second = { input: 4, output: 60, cacheRead: 4000, cacheWrite: 0 };
  await response('m2', 'claude-fable-5-2', second);
  await result(second);
  assert.deepEqual(await ledger(), [
    ['q1', 5510, 'claude-fable-5-2'],
    ['q1:c1', 4064, 'claude-fable-5-2'],
  ]);

  // The same state booked again, as the shutdown flush does: nothing new.
  await claudePrivate.saveUsageToDatabase(sessionId, proc);
  assert.equal((await ledger()).length, 2);

  // The worker reports its own end.
  claudePrivate.reportCliSubagent(sessionId, { id: 'w-1', provider: 'pi', status: 'completed' });
  assert.equal(worker()?.status, 'completed');

  // Next message. One of its calls goes to a routed model, which the router
  // books itself; the other is the turn's own and must be booked in full.
  claudePrivate.dispatchClaudeTurn(sessionId, proc, turn('q2'));
  await response('m3', 'glm-5.3', { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
  const own2 = { input: 7, output: 9, cacheRead: 100, cacheWrite: 0 };
  await response('m4', 'claude-fable-5-2', own2);
  await result({ input: 107, output: 59, cacheRead: 100, cacheWrite: 0 });
  assert.deepEqual((await ledger()).slice(2), [['q2', 116, 'claude-fable-5-2']]);

  // Later tests count the rows of these tables.
  await pgRun('DELETE FROM usage_history WHERE session_id = ?', sessionId);
  await pgRun('DELETE FROM sessions WHERE id = ?', sessionId);
  await pgRun(`DELETE FROM users WHERE id = 'user-results'`);
}

/** A manual /compact between turns must not inject a continuation. */
async function testPiManualCompactWithoutTurnDoesNotResume() {
  const sessionId = 'session-pi-compact-manual';
  const { managerPrivate, written } = makePiManagerFixture(sessionId, { piTurnInFlight: false });

  await managerPrivate.translatePiMessage(sessionId, {
    type: 'compaction_end',
    reason: 'manual',
    aborted: false,
    willRetry: false,
    result: { summary: 'ok', tokensBefore: 120_000 },
  });

  await sleep(6_400);
  assert.equal(written.length, 0);
}

/**
 * Subagent detail must strip the parent history Codex replays into each spawned
 * thread, otherwise the breakdown inflates with every extra child.
 */
async function testCodexSubagentDetailStripsInheritedHistory() {
  const codexHome = await createCodexStateFixture({
    cwd: '/workspace/plum-subagents',
    threadId: 'detail-root',
    tokensUsed: 10_000,
    prompt: 'Root prompt',
  });
  const db = new Database(path.join(codexHome, 'state_5.sqlite'));
  await fs.mkdir(path.join(codexHome, 'sessions'), { recursive: true });

  const tokenCount = (
    timestamp: string,
    counters: { input: number; cached: number; output: number }
  ) =>
    JSON.stringify({
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: counters.input,
            cached_input_tokens: counters.cached,
            output_tokens: counters.output,
          },
        },
      },
    });

  const childId = 'detail-child';
  const childRollout = path.join(codexHome, 'sessions', `${childId}.jsonl`);
  const childCreatedAtMs = Date.parse('2026-07-12T10:00:00.000Z');
  db.prepare(
    `INSERT INTO threads (
       id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
       sandbox_policy, approval_mode, tokens_used, has_user_event, archived,
       cli_version, first_user_message, memory_mode, model, created_at_ms,
       updated_at_ms, preview, agent_nickname
     ) VALUES (?, ?, ?, ?, ?, 'openai', '/workspace/plum-subagents', ?, 'workspace-write',
       'on-request', 1, 0, 0, '0.144.0', '', 'enabled', 'gpt-5.6-terra', ?, ?, '', ?)`
  ).run(
    childId,
    childRollout,
    Math.floor(childCreatedAtMs / 1000),
    Math.floor(childCreatedAtMs / 1000),
    JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: 'detail-root' } } }),
    childId,
    childCreatedAtMs,
    childCreatedAtMs,
    'playtester'
  );
  db.close();

  // Replayed parent history carries the fork timestamp; the child's own spend
  // is only what lands after it.
  await fs.writeFile(
    childRollout,
    [
      tokenCount('2026-07-12T10:00:00.000Z', { input: 78_000, cached: 76_000, output: 900 }),
      tokenCount('2026-07-12T10:05:00.000Z', { input: 80_000, cached: 77_000, output: 1_100 }),
    ].join('\n') + '\n',
    'utf8'
  );

  try {
    const detail = await readCodexDescendantUsageDetail(codexHome, 'detail-root');
    assert.equal(detail.length, 1);
    assert.equal(detail[0].threadId, childId);
    assert.equal(detail[0].parentThreadId, 'detail-root');
    assert.equal(detail[0].agentType, 'playtester');
    assert.equal(detail[0].model, 'gpt-5.6-terra');
    assert.deepEqual(detail[0].usage, { input: 2_000, cached: 1_000, output: 200 });
    // The aggregate helper must stay consistent with the detail it sums.
    assert.deepEqual(await readCodexDescendantUsage(codexHome, 'detail-root'), {
      input: 2_000,
      cached: 1_000,
      output: 200,
    });
  } finally {
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

async function testCodexDescendantUsageReadsRecursiveRolloutTotals() {
  const codexHome = await createCodexStateFixture({
    cwd: '/workspace/plum',
    threadId: 'root-thread',
    tokensUsed: 10_000,
    prompt: 'Root prompt',
  });
  const db = new Database(path.join(codexHome, 'state_5.sqlite'));
  const insertChild = db.prepare(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      sandbox_policy, approval_mode, tokens_used, has_user_event, archived,
      cli_version, first_user_message, memory_mode, model, created_at_ms,
      updated_at_ms, preview
    ) VALUES (?, ?, 1, 1, ?, 'openai', '/workspace/plum', ?, 'workspace-write',
      'on-request', 1, 0, 0, '0.144.0', '', 'enabled', 'gpt-5.6-sol', 1000, 1000, '')
  `);
  const writeChild = async (
    id: string,
    parentId: string,
    usage: { input: number; cached: number; output: number },
    inheritedUsage?: { input: number; cached: number; output: number }
  ) => {
    const rolloutPath = path.join(codexHome, 'sessions', `${id}.jsonl`);
    insertChild.run(
      id,
      rolloutPath,
      JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: parentId } } }),
      id
    );
    if (inheritedUsage) {
      db.prepare('UPDATE threads SET created_at_ms = ? WHERE id = ?').run(
        Date.parse('2026-07-12T10:00:00.000Z'),
        id
      );
    }
    const tokenCount = (
      timestamp: string,
      counters: { input: number; cached: number; output: number }
    ) =>
      JSON.stringify({
        timestamp,
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: counters.input,
              cached_input_tokens: counters.cached,
              output_tokens: counters.output,
            },
          },
        },
      });
    const lines = inheritedUsage
      ? [
          tokenCount('2026-07-12T10:00:00.000Z', {
            input: Math.floor(inheritedUsage.input / 2),
            cached: Math.floor(inheritedUsage.cached / 2),
            output: Math.floor(inheritedUsage.output / 2),
          }),
          tokenCount('2026-07-12T10:00:00.001Z', inheritedUsage),
          tokenCount('2026-07-12T10:00:02.000Z', usage),
        ]
      : [tokenCount('2026-07-12T10:00:02.000Z', usage)];
    await fs.writeFile(rolloutPath, `${lines.join('\n')}\n`, 'utf8');
  };

  try {
    await fs.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
    await writeChild('child-a', 'root-thread', { input: 5_000, cached: 4_000, output: 500 });
    await writeChild('grandchild-a', 'child-a', {
      input: 7_000,
      cached: 6_000,
      output: 700,
    });
    await writeChild(
      'child-with-inherited-history',
      'root-thread',
      { input: 12_600, cached: 10_500, output: 1_300 },
      { input: 12_000, cached: 10_000, output: 1_200 }
    );
    await writeChild('unrelated-child', 'other-root', {
      input: 99_000,
      cached: 98_000,
      output: 9_000,
    });
    db.close();

    assert.deepEqual(await readCodexDescendantUsage(codexHome, 'root-thread'), {
      input: 12_600,
      cached: 10_500,
      output: 1_300,
    });
  } finally {
    if (db.open) db.close();
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

async function testCodexContextFallbackUsesThreadState() {
  const prompt = '[Prior conversation context]\nLong WebUI turn';
  const codexHome = await createCodexStateFixture({
    cwd: '/workspace/plum-code',
    threadId: 'thread-context-fallback',
    tokensUsed: 251_634,
    prompt,
  });
  const originalCredentialsPath = CLI_PROVIDERS.codex.credentialsPath;

  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitCompact: (...args: unknown[]) => void;
    recordContextSnapshot: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitCompact = () => undefined;
  managerPrivate.recordContextSnapshot = () => undefined;

  const sessionId = 'session-codex-thread-state-fallback';
  const proc: Record<string, unknown> = {
    cliProvider: 'codex',
    userId: 'user-1',
    workingDirectory: '/workspace/plum-code',
    model: 'gpt-5.5',
    contextWindow: 256_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: false,
    codexSawTokenCountThisTurn: false,
    codexLastPromptEstimateTokens: 8_422,
    codexLastPromptPrefix: prompt,
    codexExecStartedAtMs: Date.now() - 1_000,
    codexSessionId: 'thread-context-fallback',
    claudeSessionId: 'thread-context-fallback',
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
  };

  try {
    CLI_PROVIDERS.codex.credentialsPath = codexHome;
    managerPrivate.processes.set(sessionId, proc);
    await managerPrivate.translateCodexMessage(sessionId, {
      type: 'turn.completed',
      usage: {
        input_tokens: 348_027,
        cached_input_tokens: 264_704,
        output_tokens: 5_029,
        reasoning_output_tokens: 0,
      },
    });

    const usageEvent = emitted.find((entry) => entry.event === 'session:usage');
    const usage = usageEvent?.data as { totalTokens?: number; contextUsedPercent?: number };

    assert.equal(proc.codexSessionId, 'thread-context-fallback');
    assert.equal(usage?.totalTokens, 251_634);
    assert.equal(usage?.contextUsedPercent, 98);
  } finally {
    CLI_PROVIDERS.codex.credentialsPath = originalCredentialsPath;
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

async function testCodexContextFallbackCapsThreadStateAtWindow() {
  const prompt = '[Prior conversation context]\nOver-window WebUI turn';
  const codexHome = await createCodexStateFixture({
    cwd: '/workspace/plum-code',
    threadId: 'thread-context-over-window',
    tokensUsed: 309_100,
    prompt,
  });
  const originalCredentialsPath = CLI_PROVIDERS.codex.credentialsPath;

  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitCompact: (...args: unknown[]) => void;
    recordContextSnapshot: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitCompact = () => undefined;
  managerPrivate.recordContextSnapshot = () => undefined;

  const sessionId = 'session-codex-thread-state-cap';
  managerPrivate.processes.set(sessionId, {
    cliProvider: 'codex',
    userId: 'user-1',
    workingDirectory: '/workspace/plum-code',
    model: 'gpt-5.5',
    contextWindow: 256_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: false,
    codexSawTokenCountThisTurn: false,
    codexLastPromptEstimateTokens: 8_422,
    codexLastPromptPrefix: prompt,
    codexExecStartedAtMs: Date.now() - 1_000,
    codexSessionId: 'thread-context-over-window',
    claudeSessionId: 'thread-context-over-window',
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
  });

  try {
    CLI_PROVIDERS.codex.credentialsPath = codexHome;
    await managerPrivate.translateCodexMessage(sessionId, {
      type: 'turn.completed',
      usage: {
        input_tokens: 348_027,
        cached_input_tokens: 264_704,
        output_tokens: 5_029,
        reasoning_output_tokens: 0,
      },
    });

    const usageEvent = emitted.find((entry) => entry.event === 'session:usage');
    const usage = usageEvent?.data as {
      totalTokens?: number;
      contextUsedPercent?: number;
      contextUsedPercentRaw?: number;
      contextExceeded?: boolean;
    };

    assert.equal(usage?.totalTokens, 256_000);
    assert.equal(usage?.contextUsedPercent, 100);
    assert.equal(usage?.contextUsedPercentRaw, 100);
    assert.equal(usage?.contextExceeded, false);
  } finally {
    CLI_PROVIDERS.codex.credentialsPath = originalCredentialsPath;
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

async function testCodexCompactEventRetainsCompactedContext() {
  const emitted: EmittedSocketEvent[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitCompact: (...args: unknown[]) => void;
    recordContextSnapshot: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitCompact = () => undefined;
  managerPrivate.recordContextSnapshot = () => undefined;

  const sessionId = 'session-codex-compact-retained';
  managerPrivate.processes.set(sessionId, {
    cliProvider: 'codex',
    userId: 'user-1',
    workingDirectory: '/workspace/plum-code',
    model: 'gpt-5.5',
    contextWindow: 256_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: false,
    codexSawTokenCountThisTurn: false,
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
  });

  await managerPrivate.translateCodexMessage(sessionId, {
    type: 'context.compacted',
    usage: {
      input_tokens: 40_000,
      cached_input_tokens: 10_000,
      output_tokens: 2_000,
    },
  });
  await managerPrivate.translateCodexMessage(sessionId, {
    type: 'turn.completed',
    usage: {
      input_tokens: 309_100,
      cached_input_tokens: 0,
      output_tokens: 1_000,
      reasoning_output_tokens: 0,
    },
  });

  const usageEvents = emitted.filter((entry) => entry.event === 'session:usage');
  const latest = usageEvents.at(-1)?.data as
    | {
        inputTokens?: number;
        cacheReadTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        contextUsedPercent?: number;
        contextExceeded?: boolean;
      }
    | undefined;

  assert.equal(latest?.inputTokens, 30_000);
  assert.equal(latest?.cacheReadTokens, 10_000);
  assert.equal(latest?.outputTokens, 2_000);
  assert.equal(latest?.totalTokens, 42_000);
  assert.equal(latest?.contextUsedPercent, 16);
  assert.equal(latest?.contextExceeded, false);
}

async function testCodexImplicitCompactDetectedFromContextDrop() {
  const emitted: EmittedSocketEvent[] = [];
  const compactEvents: unknown[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitCompact: (...args: unknown[]) => void;
    recordContextSnapshot: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitCompact = (...args: unknown[]) => {
    compactEvents.push(args[1]);
  };
  managerPrivate.recordContextSnapshot = () => undefined;

  const sessionId = 'session-codex-implicit-compact';
  managerPrivate.processes.set(sessionId, {
    cliProvider: 'codex',
    userId: 'user-1',
    workingDirectory: '/workspace/plum-code',
    model: 'gpt-5.5',
    contextWindow: 256_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: true,
    codexSawTokenCountThisTurn: false,
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
  });

  await managerPrivate.translateCodexMessage(sessionId, {
    type: 'turn_context',
    summary: 'auto',
    model: 'gpt-5.5',
  });
  assert.equal(compactEvents.length, 0);

  await managerPrivate.translateCodexMessage(sessionId, {
    type: 'token_count',
    info: {
      model_context_window: 256_000,
      last_token_usage: {
        input_tokens: 244_000,
        cached_input_tokens: 200_000,
        output_tokens: 2_000,
      },
    },
  });
  assert.equal(compactEvents.length, 0);

  await managerPrivate.translateCodexMessage(sessionId, {
    type: 'token_count',
    info: {
      model_context_window: 256_000,
      last_token_usage: {
        input_tokens: 72_000,
        cached_input_tokens: 30_000,
        output_tokens: 1_000,
      },
    },
  });

  assert.equal(compactEvents.length, 1);
  assert.match((compactEvents[0] as { message?: string }).message || '', /compacted prior context/);

  const usageEvents = emitted.filter((entry) => entry.event === 'session:usage');
  const latest = usageEvents.at(-1)?.data as
    | {
        inputTokens?: number;
        cacheReadTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        contextUsedPercent?: number;
      }
    | undefined;

  assert.equal(latest?.inputTokens, 42_000);
  assert.equal(latest?.cacheReadTokens, 30_000);
  assert.equal(latest?.outputTokens, 1_000);
  assert.equal(latest?.totalTokens, 73_000);
  assert.equal(latest?.contextUsedPercent, 29);
}

async function testCodexImplicitCompactDetectedFromMidWindowReset() {
  const emitted: EmittedSocketEvent[] = [];
  const compactEvents: unknown[] = [];
  const ioStub = {
    to: () => ({
      emit: (event: string, data: unknown) => {
        emitted.push({ event, data });
      },
    }),
  };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    completeActiveSubagents: (...args: unknown[]) => void;
    emitCompact: (...args: unknown[]) => void;
    recordContextSnapshot: (...args: unknown[]) => void;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  managerPrivate.completeActiveSubagents = () => undefined;
  managerPrivate.emitCompact = (...args: unknown[]) => {
    compactEvents.push(args[1]);
  };
  managerPrivate.recordContextSnapshot = () => undefined;

  const sessionId = 'session-codex-implicit-compact-mid-window';
  managerPrivate.processes.set(sessionId, {
    cliProvider: 'codex',
    userId: 'user-1',
    workingDirectory: '/workspace/plum-code',
    model: 'gpt-5.5',
    contextWindow: 256_000,
    totalCostUsd: 0,
    previousTotalCostUsd: 0,
    turnInputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheCreationTokens: 0,
    turnOutputTokens: 0,
    codexCurrentExecUsedResume: true,
    codexSawTokenCountThisTurn: false,
    currentToolName: null,
    currentToolId: null,
    currentAgentType: null,
    currentAgentDescription: null,
    currentActivitySummary: null,
    subagentRuns: new Map(),
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
  });

  await managerPrivate.translateCodexMessage(sessionId, {
    type: 'token_count',
    info: {
      model_context_window: 256_000,
      last_token_usage: {
        input_tokens: 206_000,
        cached_input_tokens: 180_000,
        output_tokens: 2_000,
      },
    },
  });
  assert.equal(compactEvents.length, 0);

  await managerPrivate.translateCodexMessage(sessionId, {
    type: 'token_count',
    info: {
      model_context_window: 256_000,
      last_token_usage: {
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
      },
    },
  });

  assert.equal(compactEvents.length, 1);
  assert.match((compactEvents[0] as { message?: string }).message || '', /compacted prior context/);

  const usageEvents = emitted.filter((entry) => entry.event === 'session:usage');
  const latest = usageEvents.at(-1)?.data as
    | {
        inputTokens?: number;
        cacheReadTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        contextUsedPercent?: number;
      }
    | undefined;

  assert.equal(latest?.inputTokens, 0);
  assert.equal(latest?.cacheReadTokens, 0);
  assert.equal(latest?.outputTokens, 0);
  assert.equal(latest?.totalTokens, 0);
  assert.equal(latest?.contextUsedPercent, 0);
}

function testProviderCapabilities() {
  for (const provider of Object.values(CLI_PROVIDERS)) {
    const caps = getProviderCapabilities(provider.id);
    assert.equal(caps.streaming, provider.supportsStreamJson, provider.id);
    assert.equal(caps.resume, provider.supportsResume, provider.id);
    assert.equal(caps.modes, provider.supportsModes, provider.id);
  }
  assert.equal(getProviderCapabilities('codex').nativeVision, true);
  assert.equal(Object.hasOwn(CLI_PROVIDERS, 'opencode'), false, 'OpenCode was removed');
}

function testClaudeCurrentModelCatalog() {
  const catalog = parseClaudeCliModelCatalog(
    [
      'claude-opus-4-8',
      'Claude Opus 4.8',
      'claude-fable-5',
      'Claude Fable 5',
      'claude-opus-5',
      'Claude Opus 5',
      'claude-sonnet-4-6',
      'Claude Sonnet 4.6',
      'claude-sonnet-5',
      'Claude Sonnet 5',
      'claude-haiku-4-5',
      'Claude Haiku 4.5',
      'claude-opus-4-5-20251101',
    ].join('\n')
  );

  assert.deepEqual(catalog.models, [
    'claude-fable-5',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-haiku-4-5',
  ]);
  assert.equal(
    CLI_PROVIDERS.claude.defaultModel,
    process.env.CLI_PROVIDER_CLAUDE_DEFAULT_MODEL || 'sonnet'
  );
  assert.equal(catalog.labels['claude-fable-5'], 'Fable 5');
  assert.equal(catalog.labels['claude-opus-5'], 'Opus 5');
  assert.equal(catalog.labels['claude-sonnet-5'], 'Sonnet 5');
  assert.equal(catalog.labels['claude-haiku-4-5'], 'Haiku 4.5');
  assert.equal(catalog.labels.sonnet, 'Sonnet 5');

  // Claude Code 2.1.318: IDs live in bundled JS arrays, display names in a
  // separate block. IDs without a display name (legacy, unreleased) never win.
  const native = parseClaudeCliModelCatalog(
    [
      'var _=[["claude-sonnet-5-5","VERTEX_REGION_CLAUDE_5_5_SONNET"],["claude-fable-5-1","X"],["claude-haiku-5-5","X"],["claude-opus-5-5","X"],["claude-opus-6","X"],["claude-haiku-3-55","X"],["claude-opus-4-5-20251101","X"]];',
      'claude-opus-5',
      'claude-haiku-4-5-20251001',
      'Claude Opus 4.1',
      'the latest Opus',
      'Claude Fable 5.1',
      'Claude Mythos 5.1',
      'Claude Fable 5',
      'Claude Opus 5.5',
      'Claude Opus 5',
      'Claude Sonnet 5.5',
      'Claude Haiku 5.5',
      'Claude Sonnet 5',
      'Claude Haiku 3.5',
    ].join('\n')
  );
  assert.deepEqual(native.models, [
    'claude-fable-5-1',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
  ]);
  assert.equal(native.labels['claude-opus-5-5'], 'Opus 5.5');
  assert.equal(native.labels.haiku, 'Haiku 5.5');
  assert.equal(native.labels.fable, 'Fable 5.1');

  // JavaScript CLI (one minified line, no standalone display names).
  const js = parseClaudeCliModelCatalog(
    'const m={firstParty:"claude-opus-4-8"},n="claude-sonnet-4-6",o="claude-haiku-4-5-20251001";'
  );
  assert.deepEqual(js.models, ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']);
  assert.equal(js.labels['claude-opus-4-8'], 'Opus 4.8');
}

function testClaudeContextWindowVariants() {
  // Every 1M-capable model is offered with and without the 1M window.
  assert.deepEqual(
    withClaude1mVariants(['claude-fable-5', 'claude-opus-5-5', 'claude-haiku-4-5', 'sonnet']),
    [
      'claude-fable-5[1m]',
      'claude-fable-5',
      'claude-opus-5-5[1m]',
      'claude-opus-5-5',
      'claude-haiku-4-5',
      'sonnet',
    ]
  );
  assert.deepEqual(withClaude1mVariants(['claude-opus-5[1m]']), ['claude-opus-5[1m]']);

  // Plain ids disable the 1M window; `[1m]` ids must clear an inherited flag.
  assert.deepEqual(claudeContextWindowEnv('claude-opus-5-5'), {
    CLAUDE_CODE_DISABLE_1M_CONTEXT: '1',
  });
  const oneM = claudeContextWindowEnv('claude-opus-5-5[1m]');
  assert.equal('CLAUDE_CODE_DISABLE_1M_CONTEXT' in oneM, true);
  assert.equal(oneM.CLAUDE_CODE_DISABLE_1M_CONTEXT, undefined);
  assert.deepEqual(claudeContextWindowEnv('claude-haiku-4-5'), {});
  assert.deepEqual(claudeContextWindowEnv('sonnet'), {});
  assert.deepEqual(claudeContextWindowEnv(null), {});

  assert.equal(claudeCliContextWindow('claude-opus-5-5[1m]'), 1_000_000);
  assert.equal(claudeCliContextWindow('claude-opus-5-5'), 200_000);
  assert.equal(claudeCliContextWindow('claude-sonnet-5'), 200_000);
  assert.equal(claudeCliContextWindow('claude-haiku-4-5'), null);
  assert.equal(claudeCliContextWindow('sonnet'), null);
  assert.equal(lookupContextWindow('claude-opus-5-5[1m]'), 1_000_000);
  // Other providers (Pi) keep the native 1M window for bare ids.
  assert.equal(lookupContextWindow('anthropic/claude-opus-5'), 1_000_000);

  const pinned = normalizeUsageSnapshot({
    sessionId: 's',
    inputTokens: 150_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 150_000,
    contextWindow: 200_000,
    contextUsedPercent: 75,
    contextWindowPinned: true,
    totalCostUsd: 0,
    model: 'claude-opus-5-5',
  });
  assert.equal(pinned?.contextWindow, 200_000);
  assert.equal(pinned?.contextUsedPercent, 75);
}

function testCodexFastTierArgs() {
  // Fallback list (cli-providers.ts): gpt-6.1-sol is the default since codex 0.162.
  assert.deepEqual(CLI_PROVIDERS.codex.models.slice(0, 6), [
    'gpt-6.1-sol',
    'gpt-6-astra',
    'gpt-5.5',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
  ]);

  const fastXhigh = getCLIArgs('codex', {
    serviceTier: 'fast',
    reasoningLevel: 'xhigh',
  });
  assert.equal(fastXhigh.includes('--profile'), false);
  assert.equal(fastXhigh.includes('--model'), false);
  assert.equal(fastXhigh.includes('gpt-5.4'), false);
  assert.ok(fastXhigh.includes('service_tier="fast"'));
  assert.ok(fastXhigh.includes('model_reasoning_effort="xhigh"'));

  const explicitModel = getCLIArgs('codex', {
    model: 'gpt-5.5',
    serviceTier: 'fast',
    reasoningLevel: 'xhigh',
  });
  assert.ok(explicitModel.includes('gpt-5.5'));
  assert.equal(explicitModel.includes('gpt-5.4'), false);
  assert.ok(explicitModel.includes('service_tier="fast"'));
  assert.ok(explicitModel.includes('model_reasoning_effort="xhigh"'));

  const maxEffort = getCLIArgs('codex', {
    model: 'gpt-5.6-luna',
    reasoningLevel: 'max',
  });
  assert.ok(maxEffort.includes('gpt-5.6-luna'));
  assert.ok(maxEffort.includes('model_reasoning_effort="max"'));
  assert.equal(maxEffort.includes('model_reasoning_effort="xhigh"'), false);

  const ultraEffort = getCLIArgs('codex', {
    model: 'gpt-5.6-sol',
    reasoningLevel: 'ultra',
  });
  assert.ok(ultraEffort.includes('model_reasoning_effort="ultra"'));
  assert.equal(ultraEffort.includes('model_reasoning_effort="max"'), false);

  const legacyAlias = getCLIArgs('codex', {
    reasoningLevel: 'very_high',
  });
  assert.ok(legacyAlias.includes('model_reasoning_effort="xhigh"'));
}

function testSolUsesSingleAgentPolicyUnlessParallelismIsExplicit() {
  const solXhigh = getCLIArgs('codex', {
    model: 'gpt-5.6-sol',
    reasoningLevel: 'xhigh',
  });
  assert.ok(solXhigh.includes('agents.max_depth=1'));
  assert.ok(solXhigh.includes('agents.max_threads=1'));

  const resumedSolXhigh = getCLIArgs('codex', {
    model: 'gpt-5.6-sol',
    reasoningLevel: 'xhigh',
    resumeSessionId: 'thread-123',
  });
  assert.ok(resumedSolXhigh.includes('agents.max_depth=1'));
  assert.ok(resumedSolXhigh.includes('agents.max_threads=1'));

  const solUltra = getCLIArgs('codex', {
    model: 'gpt-5.6-sol',
    reasoningLevel: 'ultra',
  });
  assert.equal(solUltra.includes('agents.max_depth=1'), false);

  const gpt55Xhigh = getCLIArgs('codex', {
    model: 'gpt-5.5',
    reasoningLevel: 'xhigh',
  });
  assert.equal(gpt55Xhigh.includes('agents.max_depth=1'), false);
}

function testNativeCodexResumeDoesNotRepeatStaticBootstrap() {
  assert.equal(shouldInjectCodexStaticBootstrap(undefined), true);
  assert.equal(shouldInjectCodexStaticBootstrap(''), true);
  assert.equal(shouldInjectCodexStaticBootstrap('native-codex-thread'), false);
}

function testCodexSharedRegistryDoesNotRepeatLongDescriptions() {
  const context = formatCodexSharedContextForTest({
    skills: [{ name: 'debugging-playbook', description: 'A deliberately long skill description.' }],
    agents: [{ name: 'backend-dev', description: 'A deliberately long agent description.' }],
    plugins: [{ name: 'github', description: 'A deliberately long plugin description.' }],
  });

  assert.match(context || '', /Active core skills \(1\): debugging-playbook/);
  assert.match(context || '', /capability-catalog\.mjs search/);
  assert.doesNotMatch(context || '', /Agents \(1\): backend-dev/);
  assert.doesNotMatch(context || '', /Plugins \(1\): github/);
  assert.doesNotMatch(context || '', /deliberately long/);
}

function testSessionStyleContextIsSentOnlyWhenItChanges() {
  assert.equal(shouldInjectSessionStyleContext(undefined, 'style-a'), true);
  assert.equal(shouldInjectSessionStyleContext('style-a', 'style-a'), false);
  assert.equal(shouldInjectSessionStyleContext('style-a', 'style-b'), true);
  assert.equal(shouldInjectSessionStyleContext('style-a', null), true);
}

async function testCodexModelsCacheChangeInvalidatesDiscovery() {
  const originalCredentialsPath = CLI_PROVIDERS.codex.credentialsPath;
  const originalEnvModels = process.env.CLI_PROVIDER_CODEX_MODELS;
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-model-cache-'));
  const cachePath = path.join(codexHome, 'models_cache.json');

  async function writeCache(
    models: Array<{ slug: string; displayName: string; priority: number }>
  ) {
    await fs.writeFile(
      cachePath,
      JSON.stringify(
        {
          fetched_at: new Date().toISOString(),
          client_version: '0.144.0',
          models: models.map((model) => ({
            slug: model.slug,
            display_name: model.displayName,
            visibility: 'list',
            priority: model.priority,
          })),
        },
        null,
        2
      )
    );
  }

  try {
    CLI_PROVIDERS.codex.credentialsPath = codexHome;
    delete process.env.CLI_PROVIDER_CODEX_MODELS;
    resetDiscovery();

    await writeCache([
      { slug: 'gpt-5.5', displayName: 'GPT-5.5', priority: 0 },
      { slug: 'gpt-5.4', displayName: 'GPT-5.4', priority: 10 },
    ]);

    assert.deepEqual(getCliModels('codex'), ['gpt-5.5', 'gpt-5.4']);

    await writeCache([
      { slug: 'gpt-5.5', displayName: 'GPT-5.5', priority: 0 },
      { slug: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', priority: 1 },
      { slug: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', priority: 2 },
      { slug: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', priority: 3 },
    ]);
    await fs.utimes(cachePath, new Date(), new Date(Date.now() + 1000));

    assert.deepEqual(getCliModels('codex'), [
      'gpt-5.5',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
    assert.equal(getModelDisplayLabels()['gpt-5.6-sol'], 'GPT 5.6 Sol');
  } finally {
    CLI_PROVIDERS.codex.credentialsPath = originalCredentialsPath;
    if (originalEnvModels === undefined) {
      delete process.env.CLI_PROVIDER_CODEX_MODELS;
    } else {
      process.env.CLI_PROVIDER_CODEX_MODELS = originalEnvModels;
    }
    resetDiscovery();
    await fs.rm(codexHome, { recursive: true, force: true });
  }
}

async function testCodexReasoningUiListsExposeFullEffortRange() {
  const expected = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const { getConversationReasoningOptions } = await import('../../frontend/src/lib/providers.js');
  const actual = getConversationReasoningOptions('codex').map((option) => option.value);
  for (const value of expected) assert(actual.includes(value), `Codex picker lacks ${value}`);
  const sessionPage = await fs.readFile(
    path.join(repoRoot, 'packages/frontend/src/pages/SessionPage.tsx'),
    'utf8'
  );
  assert.match(sessionPage, /getConversationReasoningOptions\(/);
  const dashboard = await fs.readFile(
    path.join(repoRoot, 'packages/frontend/src/pages/DashboardPage.tsx'),
    'utf8'
  );
  for (const value of expected) assert.match(dashboard, new RegExp(`value: '${value}'`));
}

function testConfiguredModelAllowList() {
  assert.equal(
    resolveConfiguredModel('z-ai/glm-5.1', ['z-ai/glm-5.1', 'openai/gpt-5.2']),
    'z-ai/glm-5.1'
  );
  assert.equal(
    resolveConfiguredModel('ollama/qwopus', ['z-ai/glm-5.1', 'openai/gpt-5.2']),
    'z-ai/glm-5.1'
  );
  assert.equal(resolveConfiguredModel('ollama/qwopus', []), 'ollama/qwopus');
  assert.equal(resolveConfiguredModel(null, ['openai/gpt-5.2']), 'openai/gpt-5.2');
}

function testModelProviderZaiCredentialAliases() {
  const envVars = getModelProviderCredentialEnvVars('z-ai', {
    'z-ai': {
      name: 'Z-AI',
      models: ['glm-5.1'],
      description: 'test',
      env: ['ZAI_API_KEY'],
      source: 'fallback',
    },
  });

  assert.ok(envVars.includes('ZAI_API_KEY'));
  assert.ok(envVars.includes('ZHIPU_API_KEY'));
  assert.ok(envVars.includes('Z_AI_API_KEY'));
}

function testPiSessionModelSelection() {
  const configured = ['z-ai/glm-5.1', 'openai/gpt-5.2', 'moonshot/kimi-k2'];

  assert.equal(
    resolveCliProviderSelectedModel('pi', 'z-ai/glm-5.1', configured, null),
    'z-ai/glm-5.1'
  );
  assert.equal(
    resolveCliProviderSelectedModel('pi', 'z-ai/glm-5.1', configured, 'unknown/model'),
    'z-ai/glm-5.1'
  );
  assert.equal(
    resolveCliProviderSelectedModel('codex', 'gpt-5.5', ['gpt-5.4'], 'gpt-5.4'),
    'gpt-5.4'
  );
  assert.equal(
    resolveCliProviderSelectedModel('pi', 'z-ai/glm-5.1', configured, 'openai/gpt-5.2'),
    'openai/gpt-5.2'
  );
}

function testPiProviderConfigDoesNotPersistSecrets() {
  const entry = buildPiProviderConfig(
    {
      id: 'z-ai',
      name: 'Z.AI',
      apiKey: 'encrypted-secret-that-must-not-be-copied',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      'z-ai': {
        name: 'Z.AI',
        models: ['glm-5.1', 'glm-5.2'],
        description: 'test',
        env: ['Z_AI_API_KEY'],
        api: 'https://api.z.ai/api/coding/paas/v4',
        source: 'config',
      },
    }
  );

  assert.ok(entry);
  assert.equal(entry?.api, 'openai-completions');
  assert.equal(entry?.apiKey, '$Z_AI_API_KEY');
  assert.equal(JSON.stringify(entry).includes('encrypted-secret-that-must-not-be-copied'), false);
  assert.equal(Array.isArray(entry?.models), true);
  assert.equal((entry?.models as unknown[]).length, 2);
}

/**
 * Regression: models.json carried no `contextWindow`, so Pi fell back to its
 * 128k default for every WebUI-provisioned model — the tracker read 128k
 * regardless of model and threshold compaction kicked in at ~112k.
 */
function testPiModelsCarryContextWindow() {
  const provider = {
    id: 'z-ai',
    name: 'Z.AI',
    apiKey: 'secret',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const fromTable = buildPiProviderConfig(provider, {
    'z-ai': {
      name: 'Z.AI',
      models: ['glm-5.1', 'totally-unknown-model'],
      description: 'test',
      env: ['Z_AI_API_KEY'],
      api: 'https://api.z.ai/api/coding/paas/v4',
      source: 'config',
    },
  });
  const tableModels = fromTable?.models as Array<Record<string, unknown>>;
  assert.equal(tableModels.find((m) => m.id === 'glm-5.1')?.contextWindow, 200_000);
  assert.equal(
    'contextWindow' in (tableModels.find((m) => m.id === 'totally-unknown-model') ?? {}),
    false,
    'unknown families must not get a guessed window'
  );

  // A models.dev limit beats the family table, and its output cap becomes maxTokens.
  const fromCatalog = buildPiProviderConfig(provider, {
    'z-ai': {
      name: 'Z.AI',
      models: ['glm-5.1'],
      modelLimits: { 'glm-5.1': { context: 204_800, output: 131_072 } },
      description: 'test',
      env: ['Z_AI_API_KEY'],
      api: 'https://api.z.ai/api/coding/paas/v4',
      source: 'models.dev',
    },
  });
  const catalogModel = (fromCatalog?.models as Array<Record<string, unknown>>)[0];
  assert.equal(catalogModel?.contextWindow, 204_800);
  assert.equal(catalogModel?.maxTokens, 32_768, 'output ceiling is capped for the request budget');

  const parsed = parseModelsCache(
    JSON.stringify({
      'z-ai': {
        id: 'z-ai',
        name: 'Z.AI',
        env: ['Z_AI_API_KEY'],
        api: 'https://api.z.ai/api/coding/paas/v4',
        models: {
          'glm-5.1': { id: 'glm-5.1', limit: { context: 204800, output: 131072 } },
          'glm-4.5v': { id: 'glm-4.5v' },
        },
      },
    })
  );
  assert.deepEqual(parsed['z-ai']?.modelLimits, {
    'glm-5.1': { context: 204_800, output: 131_072 },
  });
}

function testPiUsesOnlyEnabledUserProviderModels() {
  const configured: Record<string, string[]> = {
    'llama-local': ['Qwopus3.6-35B-A3B-v1-Q4_K_M.gguf'],
    'z-ai': ['glm-5.2', 'glm-5.1'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    'alibaba-token-plan': [
      'qwen3.8-max-preview',
      'qwen3.7-plus',
      'qwen-image-2.0',
      'wan2.7-image-pro',
      'happyhorse-1.1-t2v',
    ],
  };
  const provider = (
    id: string,
    enabled = true
  ): Parameters<typeof buildPiModelCatalog>[0][number] => ({
    id,
    name: id,
    apiKey: 'encrypted',
    baseUrl: `https://${id}.example/v1`,
    enabled,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const result = buildPiModelCatalog(
    [
      provider('z-ai'),
      provider('deepseek'),
      provider('alibaba-token-plan'),
      provider('llama-local', false),
    ],
    {},
    configured
  );

  assert.deepEqual(result.models, [
    'z-ai/glm-5.2',
    'z-ai/glm-5.1',
    'deepseek/deepseek-chat',
    'deepseek/deepseek-reasoner',
    'alibaba-token-plan/qwen3.8-max-preview',
    'alibaba-token-plan/qwen3.7-plus',
  ]);
  assert.equal(
    result.models.some((model) => /qwopus/i.test(model)),
    false
  );
  assert.equal(
    result.models.some((model) => /qwen-image|wan2|happyhorse/i.test(model)),
    false
  );
  assert.deepEqual(Object.keys(result.piProviders), ['z-ai', 'deepseek', 'alibaba-token-plan']);
  assert.equal(isPiRunnableModel('qwen3.8-max-preview'), true);
  assert.equal(isPiRunnableModel('glm-4.5v'), true);
  assert.equal(isPiRunnableModel('qwen-image-2.0-pro'), false);
}

function testPiMergesModelSources() {
  const provider = (
    id: string,
    models?: string[]
  ): Parameters<typeof buildPiModelCatalog>[0][number] => ({
    id,
    name: id,
    apiKey: 'encrypted',
    baseUrl: `https://${id}.example/v1`,
    enabled: true,
    ...(models ? { models } : {}),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  // A model known only to the catalog and one known only to the configured list
  // must both survive: taking one source and ignoring the other used to hide
  // every model the winning source had never heard of.
  const merged = buildPiModelCatalog(
    [provider('z-ai')],
    {
      'z-ai': {
        name: 'Z.AI',
        models: ['glm-5.1', 'glm-5.2'],
        description: 'test',
        env: ['Z_AI_API_KEY'],
        api: 'https://api.z.ai/api/coding/paas/v4',
        source: 'config',
      },
    },
    { 'z-ai': ['glm-4.7'] }
  );
  assert.deepEqual(merged.models, ['z-ai/glm-4.7', 'z-ai/glm-5.1', 'z-ai/glm-5.2']);

  // The registry alone is enough: no catalog entry, no configured list. This is
  // what keeps a self-hosted endpoint working.
  const registryOnly = buildPiModelCatalog(
    [provider('alibaba-token-plan', ['qwen3.8-max-preview', 'qwen-image-2.0'])],
    {},
    {}
  );
  assert.deepEqual(registryOnly.models, ['alibaba-token-plan/qwen3.8-max-preview']);
  assert.deepEqual(Object.keys(registryOnly.piProviders), ['alibaba-token-plan']);
}

function testPiUsesNativeMistralProvider() {
  const mistral = (baseUrl?: string): Parameters<typeof buildPiModelCatalog>[0][number] => ({
    id: 'mistral',
    name: 'Mistral',
    apiKey: 'encrypted',
    ...(baseUrl ? { baseUrl } : {}),
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const catalog = {
    mistral: {
      name: 'Mistral',
      models: ['mistral-medium-latest'],
      description: 'test',
      env: ['MISTRAL_API_KEY'],
      source: 'config' as const,
    },
  };
  const nativeIds = (id: string) =>
    id === 'mistral' ? ['devstral-latest', 'mistral-medium-3.5'] : [];

  // No base URL anywhere for Mistral: Pi's own provider serves it, and only
  // its models reach the picker (no models.json override).
  const native = buildPiModelCatalog([mistral()], catalog, {}, nativeIds);
  assert.deepEqual(native.models, ['mistral/devstral-latest', 'mistral/mistral-medium-3.5']);
  assert.deepEqual(Object.keys(native.piProviders), [], 'no models.json override for Mistral');

  // An explicit base URL (proxy, self-hosted) keeps the generic provider.
  const proxied = buildPiModelCatalog(
    [mistral('https://mistral-proxy.example/v1')],
    catalog,
    {},
    nativeIds
  );
  assert.deepEqual(Object.keys(proxied.piProviders), ['mistral']);
  assert.deepEqual(proxied.models, ['mistral/mistral-medium-latest']);

  // Against the catalog shipped with Pi: the curated chat and code models only.
  const shipped = readPiNativeModelIds('mistral');
  if (shipped.length > 0) {
    assert.ok(shipped.includes('devstral-latest'), 'Pi offers Devstral 2');
    assert.ok(shipped.includes('zai-glm-5-3'), 'Mistral serves GLM-5.3; Pi offers it');
    // Curated models plus the DeepSeek models Mistral hosts, which are offered
    // so that route can be chosen on purpose next to DeepSeek's own API.
    const hosted = shipped.filter((id) => /^deepseek-/.test(id));
    assert.ok(shipped.length - hosted.length <= 8, 'curated, not the whole Mistral catalog');
    assert.ok(hosted.length >= 1, 'the DeepSeek model hosted by Mistral is selectable');
    assert.equal(
      shipped.some((id) => /^(voxtral|open-|ministral)/.test(id)),
      false
    );
  }
}

function testAttachmentNormalization() {
  assert.equal(classifyAttachment('image/png', 'shot.png'), 'image');
  assert.equal(classifyAttachment('application/pdf', 'paper.pdf'), 'pdf');
  assert.equal(classifyAttachment('application/octet-stream', 'README.md'), 'text');
  assert.equal(extensionForAttachment('image/jpeg'), 'jpg');
  assert.equal(sanitizeAttachmentFilename('../bad name?.png'), '.._bad_name_.png');
  assert.equal(sanitizeAttachmentDisplayName('../Überblick 2026.pdf'), 'Überblick 2026.pdf');
}

function testDangerModeProvidesAutonomousExecutionContract() {
  const ioStub = { to: () => ({ emit: () => undefined }) };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const prompt = (
    manager as unknown as { getModePrompt: (mode: 'danger') => string | null }
  ).getModePrompt('danger');

  assert.ok(prompt, 'YOLO/danger mode needs behavioral guidance, not only permission flags');
  assert.match(prompt, /supervisor/i);
  assert.match(prompt, /real blocker/i);
  assert.match(prompt, /product goal/i);
  assert.match(prompt, /visible|screenshot/i);
  assert.match(prompt, /Vale decision proxy/i);
  assert.match(prompt, /reversible/i);
  assert.match(prompt, /silently choose/i);
  assert.match(prompt, /local image or QR code/i);
  assert.match(prompt, /absolute PNG, JPEG, WebP, or GIF path inside the current workspace/i);
  assert.match(prompt, /Never claim.*visible or sent/i);
}

async function testExplicitWorkspaceImagesBecomePathFreePendingMedia() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-workspace-media-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-outside-media-'));
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const qrPath = path.join(workspace, 'tuya-qr.png');
  const outsidePath = path.join(outside, 'private.png');
  try {
    await fs.writeFile(qrPath, png);
    await fs.writeFile(outsidePath, png);
    const extracted = extractExplicitWorkspaceChatMedia(
      [
        `Scan this: ![Tuya QR](<${qrPath}>)`,
        `Do not expose this: [private image](<${outsidePath}>)`,
        'Remote images remain Markdown: ![remote](https://example.com/reference.png)',
      ].join('\n'),
      workspace
    );

    assert.equal(extracted.media.length, 1);
    assert.equal(extracted.media[0]?.source, 'workspace');
    assert.equal(extracted.media[0]?.kind, 'file');
    assert.match(extracted.content, /\[Image attached: Tuya QR\]/);
    assert.match(extracted.content, /\[Local image could not be attached\]/);
    assert.doesNotMatch(extracted.content, /\[Image attached: private image\]/);
    assert.match(extracted.content, /https:\/\/example\.com\/reference\.png/);
    assert.doesNotMatch(
      extracted.content,
      new RegExp(qrPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
    assert.doesNotMatch(
      extracted.content,
      new RegExp(outsidePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
}

async function testCodexImageGenerationEventQueuesOnlyManagedOutput() {
  const ioStub = { to: () => ({ emit: () => undefined }) };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const managerPrivate = manager as unknown as {
    processes: Map<string, Record<string, unknown>>;
    translateCodexMessage: (sessionId: string, raw: unknown) => unknown;
  };
  const codexHome = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
  const generatedRoot = path.join(codexHome, 'generated_images');
  await fs.mkdir(generatedRoot, { recursive: true });
  const fixtureDir = await fs.mkdtemp(path.join(generatedRoot, 'provider-media-fixture-'));
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-media-outside-'));
  const managedPath = path.join(fixtureDir, 'exec-image.png');
  const outsidePath = path.join(outsideDir, 'host-image.png');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const sessionId = 'session-codex-generated-media';
  const proc: Record<string, unknown> = {
    cliProvider: 'codex',
    pendingChatMedia: [],
    codexEmittedTools: new Set(),
    currentToolName: null,
    currentToolId: null,
    currentActivitySummary: null,
    currentAgentType: null,
    outputBuffer: { push: () => undefined },
    lastActivityAt: Date.now(),
  };
  managerPrivate.processes.set(sessionId, proc);

  const imageEvent = (status: string, savedPath: string, callId: string) => ({
    type: 'event_msg',
    payload: {
      type: 'image_generation_end',
      status,
      call_id: callId,
      saved_path: savedPath,
      revised_prompt: 'A scannable Tuya QR code',
    },
  });

  try {
    await fs.writeFile(managedPath, png);
    await fs.writeFile(outsidePath, png);
    await managerPrivate.translateCodexMessage(
      sessionId,
      imageEvent('failed', managedPath, 'exec-failed')
    );
    await managerPrivate.translateCodexMessage(
      sessionId,
      imageEvent('completed', outsidePath, 'exec-outside')
    );
    assert.equal((proc.pendingChatMedia as unknown[]).length, 0);

    await managerPrivate.translateCodexMessage(
      sessionId,
      imageEvent('completed', managedPath, 'exec-managed')
    );
    await managerPrivate.translateCodexMessage(
      sessionId,
      imageEvent('completed', managedPath, 'exec-managed')
    );
    assert.equal((proc.pendingChatMedia as unknown[]).length, 1);
    assert.equal(
      ((proc.pendingChatMedia as Array<Record<string, unknown>>)[0] || {}).source,
      'provider'
    );
    assert.equal(
      ((proc.pendingChatMedia as Array<Record<string, unknown>>)[0] || {}).sourceId,
      'exec-managed'
    );

    await managerPrivate.translateCodexMessage(sessionId, {
      type: 'item.completed',
      item: { id: 'image-input', type: 'imageView', path: managedPath },
    });
    await managerPrivate.translateCodexMessage(sessionId, {
      type: 'custom_tool_call_output',
      output: [{ type: 'input_image', image_url: 'data:image/png;base64,redacted' }],
    });
    assert.equal((proc.pendingChatMedia as unknown[]).length, 1);
  } finally {
    managerPrivate.processes.delete(sessionId);
    await fs.rm(fixtureDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
}

function testModelsCacheParsing() {
  const catalog = parseModelsCache(
    JSON.stringify({
      openai: {
        id: 'openai',
        name: 'OpenAI',
        env: ['OPENAI_API_KEY'],
        api: 'https://api.openai.com/v1',
        models: {
          'gpt-5.2': { id: 'gpt-5.2', name: 'GPT 5.2' },
          'gpt-4o': { name: 'GPT-4o' },
        },
      },
      upstage: {
        id: 'upstage',
        name: 'Upstage',
        env: ['UPSTAGE_API_KEY'],
        models: {
          'solar-pro3': { id: 'solar-pro3' },
        },
      },
      // models.dev lists the OpenCode gateways; the registry must not offer them.
      opencode: { id: 'opencode', name: 'OpenCode Zen', models: { 'kimi-k2.7': {} } },
      'opencode-go': { id: 'opencode-go', name: 'OpenCode Go', models: { 'glm-5.1': {} } },
    })
  );

  assert.equal(catalog.opencode, undefined);
  assert.equal(catalog['opencode-go'], undefined);

  assert.deepEqual(catalog.openai?.models, ['gpt-5.2', 'gpt-4o']);
  assert.equal(catalog.openai?.env?.[0], 'OPENAI_API_KEY');
  assert.equal(catalog.openai?.source, 'models.dev');
  assert.ok(Object.keys(catalog).indexOf('openai') < Object.keys(catalog).indexOf('upstage'));
}

function testSettingsThemeSchemaAcceptsEink() {
  const parsed = updateSettingsSchema.safeParse({ theme: 'eink' });
  assert.equal(parsed.success, true);
}

/**
 * `vibe` used to be a removed legacy provider; it is now the Mistral Vibe ACP
 * harness, so the removal assertions are inverted. Its own contract (modes,
 * thinking levels, VIBE_HOME, the separate Mistral allowance) lives in
 * scripts/vibe-provider-regression-tests.ts. The Pi half of this function is
 * unchanged and only shares the "a provider registry entry exists" shape.
 */
function testVibeProviderIsRegistered() {
  assert.equal(Object.hasOwn(CLI_PROVIDERS, 'vibe'), true);
  assert.equal(CLI_PROVIDERS.vibe.name, 'Mistral Vibe');
  assert.equal(Object.hasOwn(CLI_PROVIDERS, 'pi'), true);
  assert.equal(updateSettingsSchema.safeParse({ defaultCliProvider: 'pi' }).success, true);

  const args = getCLIArgs('pi', {
    model: 'z-ai/glm-5.1',
    reasoningLevel: 'extra_high',
    resumeSessionId: 'pi-session-123',
  });
  assert.deepEqual(args.slice(0, 3), ['--mode', 'rpc', '--approve']);
  assert.ok(args.includes('z-ai/glm-5.1'));
  assert.ok(args.includes('xhigh'));
  assert.ok(args.includes('pi-session-123'));
  assert.equal(
    CLI_PROVIDERS.pi.defaultModel,
    process.env.CLI_PROVIDER_PI_DEFAULT_MODEL || 'z-ai/glm-5.1'
  );
}

function testSessionSchemasAcceptVibe() {
  const created = createSessionSchema.safeParse({
    name: 'Vibe session',
    workingDirectory: '/workspace/project',
    cliProvider: 'vibe',
    cliModel: 'mistral-medium-3.5',
    mode: 'auto-accept',
    surface: 'code',
    initialMessage: 'Reply only OK',
  });
  assert.equal(created.success, true);
  assert.equal(updateProviderSchema.safeParse({ cliProvider: 'vibe' }).success, true);
}

function testAcpRestartRecoveryContract() {
  assert.equal(shouldRecoverInterruptedAcpTurn('vibe', 'stopped', 'user'), true);
  assert.equal(shouldRecoverInterruptedAcpTurn('vibe', 'stopped', 'assistant'), false);
  assert.equal(shouldRecoverInterruptedAcpTurn('vibe', 'running', 'user'), false);
  assert.equal(shouldRecoverInterruptedAcpTurn('codex', 'stopped', 'user'), false);

  assert.equal(resolveSessionStartMode(undefined, undefined, 'danger'), 'danger');
  assert.equal(resolveSessionStartMode(undefined, 'manual', 'danger'), 'manual');
  assert.equal(resolveSessionStartMode('planning', 'manual', 'danger'), 'planning');
  assert.equal(resolveSessionStartMode(), 'auto-accept');
}

function testPerTurnModeChangesDoNotRestartActiveChildren() {
  assert.equal(appliesModeOnNextTurnWithoutRestart('vibe'), true);
  assert.equal(appliesModeOnNextTurnWithoutRestart('codex'), true);
  assert.equal(appliesModeOnNextTurnWithoutRestart('claude'), false);
  assert.equal(appliesModeOnNextTurnWithoutRestart('pi'), false);
}

function testClaudeApiEnvironmentMapping() {
  assert.deepEqual(
    buildClaudeApiEnv({
      baseUrl: 'https://api.z.ai/api/anthropic',
      authToken: 'redacted-test-token',
      opusModel: 'glm-5.2',
      sonnetModel: 'glm-5.2',
      haikuModel: 'glm-4.5-air',
      apiTimeoutMs: 3_000_000,
    }),
    {
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'redacted-test-token',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.2',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.2',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air',
      API_TIMEOUT_MS: '3000000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      ENABLE_TOOL_SEARCH: 'true',
    }
  );
  assert.deepEqual(buildClaudeApiEnv(null), {});

  const zaiConfig = {
    baseUrl: 'https://api.z.ai/api/anthropic',
    authToken: 'redacted-test-token',
    opusModel: 'glm-5.2',
    sonnetModel: 'glm-5.2',
    haikuModel: 'glm-4.5-air',
    apiTimeoutMs: 3_000_000,
  };
  assert.equal(getClaudeApiEndpointKind(zaiConfig), 'z-ai');
  assert.deepEqual(getClaudeApiModelLabels(zaiConfig), {
    opus: 'glm-5.2',
    sonnet: 'glm-5.2',
    haiku: 'glm-4.5-air',
  });
  assert.equal(
    getClaudeApiEndpointKind({ ...zaiConfig, baseUrl: 'https://llm.example.com/anthropic' }),
    'custom'
  );
  assert.equal(getClaudeApiEndpointKind(null), 'anthropic');
}

function testClaudeAndZaiProcessEnvironmentsAreIsolated() {
  const inherited = {
    PATH: '/usr/bin',
    ANTHROPIC_BASE_URL: 'https://global.example.test/anthropic',
    ANTHROPIC_AUTH_TOKEN: 'global-token',
    ANTHROPIC_API_KEY: 'global-api-key',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'global-opus',
  };
  const zaiConfig = {
    baseUrl: 'https://api.z.ai/api/anthropic',
    authToken: 'zai-session-token',
    opusModel: 'glm-5.2',
    sonnetModel: 'glm-5.2',
    apiTimeoutMs: 3_000_000,
  };

  const claudeEnv = buildClaudeTransportProcessEnv('claude', '/home/node/.claude', null, inherited);
  assert.equal(claudeEnv.PATH, '/usr/bin');
  assert.equal(claudeEnv.CLAUDE_CONFIG_HOME, '/home/node/.claude');
  assert.equal(claudeEnv.ANTHROPIC_BASE_URL, undefined);
  assert.equal(claudeEnv.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(claudeEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(claudeEnv.ANTHROPIC_DEFAULT_OPUS_MODEL, undefined);

  const zaiEnv = buildClaudeTransportProcessEnv('zai', '/home/node/.claude', zaiConfig, inherited);
  assert.equal(zaiEnv.ANTHROPIC_BASE_URL, zaiConfig.baseUrl);
  assert.equal(zaiEnv.ANTHROPIC_AUTH_TOKEN, zaiConfig.authToken);
  assert.equal(zaiEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(zaiEnv.ANTHROPIC_DEFAULT_OPUS_MODEL, 'glm-5.2');
  assert.equal(zaiEnv.ANTHROPIC_DEFAULT_SONNET_MODEL, 'glm-5.2');

  assert.equal(
    updateSettingsSchema.safeParse({ enabledCliProviders: ['claude', 'zai'] }).success,
    true
  );
  assert.equal(updateSettingsSchema.safeParse({ enabledCliProviders: [] }).success, false);
}

function testDeviceAppearanceSettingsAreNotAccountPersisted() {
  const accountSettings = stripDeviceAppearanceSettings({
    theme: 'eink',
    backgroundAnimation: 'glass',
    defaultWorkingDir: '/workspace/project',
    defaultCliProvider: 'codex',
  });

  assert.equal('theme' in accountSettings, false);
  assert.equal('backgroundAnimation' in accountSettings, false);
  assert.equal(accountSettings.defaultWorkingDir, '/workspace/project');
  assert.equal(accountSettings.defaultCliProvider, 'codex');
}

function testMemoryDirectoryRejectsWorkingDirectoriesOutsideAllowedBases() {
  assert.throws(
    () => resolveMemoryDirectory('/etc'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      (error as Error & { code?: string }).code === 'FORBIDDEN_PATH'
  );
}

function testSessionCookiePolicyBlocksCrossSiteMutationByDefault() {
  const development = buildSessionCookieOptions(false);
  const production = buildSessionCookieOptions(true);

  assert.equal(development.httpOnly, true);
  assert.equal(development.sameSite, 'lax');
  assert.equal(development.secure, false);
  assert.equal(production.httpOnly, true);
  assert.equal(production.sameSite, 'lax');
  assert.equal(production.secure, true);
  assert.equal(production.maxAge, 7 * 24 * 60 * 60 * 1000);
}

function testCommandFileRootsStayInsideAllowedBasePaths() {
  assert.throws(
    () => resolveAllowedCommandPath('/etc'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      (error as Error & { code?: string }).code === 'FORBIDDEN_PATH'
  );
}

function testSessionIconGenerationUsesProviderIndependentCodexImagegenCommand() {
  const command = buildCodexSessionIconCommand({
    command: '/home/node/.npm-global/bin/codex',
    codexHome: '/home/node/.codex',
    cwd: '/workspace/plum-code-webui',
    prompt: 'Create a square icon, no text.',
    forceChatGptAuth: true,
  });

  assert.equal(command.command, '/home/node/.npm-global/bin/codex');
  assert.deepEqual(command.args.slice(0, 4), [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ephemeral',
  ]);
  assert.equal(command.args[command.args.indexOf('--config') + 1], 'auth_mode="chatgpt"');
  assert.equal(command.args[command.args.indexOf('--cd') + 1], '/workspace/plum-code-webui');
  assert.match(command.args.at(-1) || '', /^\$imagegen\s+/);
  assert.doesNotMatch(command.args.join(' '), /comfyui|z-image|flux|openai-image|OPENAI_API_KEY/i);
}

function testSessionIconPromptIsPlainImagePrompt() {
  const prompt = buildSessionIconImagePrompt(
    {
      name: 'Plum Code',
      workingDirectory: '/workspace/plum-code-webui',
    },
    null,
    {
      framework: 'Vite',
      techStack: ['React', 'TypeScript', 'SQLite', 'Docker', 'Tailwind'],
    }
  );

  assert.match(prompt, /Plum Code/);
  assert.match(prompt, /plum-code-webui/);
  assert.match(prompt, /Framework signal: Vite/);
  assert.match(prompt, /Tech stack: React, TypeScript, SQLite, Docker/);
  assert.doesNotMatch(prompt, /^\$imagegen\s+/);
  assert.doesNotMatch(prompt, /comfyui|z-image|flux/i);
  assert.equal(isCodexNativeSlashCommand(`$imagegen ${prompt}`), true);
}

async function testGoalCommandForwardingIsSilent() {
  const parsed = commandService.parseCommand('/goal Ship the feature')!;
  const result = await commandService.executeCommand(parsed, {
    provider: 'codex',
  });

  assert.equal(result.success, true);
  assert.equal(result.action, 'forward_to_cli');
  assert.equal(result.response, '/goal Ship the feature');
  assert.equal(result.data?.recordMessage, false);
  assert.equal(result.data?.updateLastMessage, false);

  assert.equal(shouldRecordProviderUserMessage('codex', '/goal Ship the feature'), false);
  assert.equal(shouldRecordProviderUserMessage('codex', 'Ship the feature'), true);
  assert.equal(shouldRecordProviderUserMessage('codex', '$imagegen square app icon'), true);
  assert.equal(shouldRecordProviderUserMessage('claude', '/goal Ship the feature'), true);
}

async function testGeneratedSessionIconImageReadsOneShotOutput() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-icon-generator-'));
  const codexHome = path.join(tempDir, 'codex-home');
  const scriptPath = path.join(tempDir, 'codex');
  await fs.writeFile(
    scriptPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'OUT_DIR="$CODEX_HOME/generated_images/test-session"',
      'mkdir -p "$OUT_DIR"',
      'OUTPUT="$OUT_DIR/ig_fake.png"',
      'printf "\\211PNG\\015\\012\\032\\012" > "$OUTPUT"',
      'echo "{\\"type\\":\\"item.completed\\",\\"item\\":{\\"type\\":\\"agent_message\\",\\"text\\":\\"done\\"}}"',
      '',
    ].join('\n'),
    'utf8'
  );
  await fs.chmod(scriptPath, 0o755);

  try {
    const result = await generateSessionIconImage({
      sessionId: 'session-1',
      session: {
        name: 'Plum Code',
        workingDirectory: '/workspace/plum-code-webui',
      },
      command: scriptPath,
      codexHome,
      cwd: tempDir,
      timeoutMs: 5_000,
    });

    assert.equal(result.ext, '.png');
    assert.deepEqual([...result.buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.match(result.outputPath, /generated_images\/test-session\/ig_fake\.png$/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function testLegacySessionIconMessageIsNotUsedForGeneratedIcons() {
  const prompt = buildSessionIconImagePrompt({
    name: 'Plum Code',
    workingDirectory: '/workspace/plum-code-webui',
  });

  assert.doesNotMatch(prompt, /^\$imagegen\s+/);
}

async function testProjectIconCandidateFindsMonorepoDesktopIcon() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-icon-project-'));
  const iconPath = path.join(projectDir, 'packages/desktop/resources/icon.png');
  await fs.mkdir(path.dirname(iconPath), { recursive: true });
  await fs.writeFile(iconPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const icon = await readProjectIconCandidate(projectDir);

  assert.equal(icon?.path, iconPath);
  assert.equal(icon?.ext, '.png');
}

function testZaiUsageTrackerQuotaShape() {
  const mapped = mapZaiUsage(
    {
      limits: [
        {
          type: 'TOKENS_LIMIT',
          unit: 3,
          number: 5,
          currentValue: 120_000,
          usage: 1_000_000,
          percentage: 12,
          nextResetTime: 1_778_000_000_000,
        },
        {
          type: 'TIME_LIMIT',
          currentValue: 2,
          usage: 10,
          percentage: 20,
          nextResetTime: 1_778_010_000_000,
        },
      ],
    },
    [{ productName: 'GLM Coding Pro', status: 'VALID', inCurrentPeriod: true }]
  );

  assert.equal(mapped?.subscriptionType, 'GLM Coding Pro');
  assert.equal(mapped?.fiveHour?.utilization, 12);
  assert.equal(mapped?.fiveHour?.used, 120_000);
  assert.equal(mapped?.fiveHour?.limit, 1_000_000);
  assert.equal(mapped?.fiveHour?.windowSeconds, 18_000);
  assert.equal(mapped?.additional?.[0]?.name, 'Web search');
  assert.equal(mapped?.additional?.[0]?.unit, 'requests');
}

function testCodexUsageWindowsFollowUpstreamDuration() {
  const normal = mapCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 12, limit_window_seconds: 18_000 },
      secondary_window: { used_percent: 34, limit_window_seconds: 604_800 },
    },
  });
  assert.equal(normal.fiveHour?.utilization, 12);
  assert.equal(normal.sevenDay?.utilization, 34);

  const weeklyOnly = mapCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 56, limit_window_seconds: 604_800 },
    },
  });
  assert.equal(weeklyOnly.fiveHour, null, 'a weekly primary window must not be labelled as 5h');
  assert.equal(weeklyOnly.sevenDay?.utilization, 56);
}

function testZaiAccountUsageShape() {
  assert.deepEqual(
    mapZaiAccountUsage(
      {
        x_time: ['2026-06-22', '2026-07-21'],
        totalUsage: {
          totalModelCallCount: 34_832,
          totalTokensUsage: 443_388_365,
          modelSummaryList: [
            { modelName: 'GLM-5.2', totalTokens: 443_283_784 },
            { modelName: 'GLM-4.7', totalTokens: 17_296 },
          ],
        },
      },
      30
    ),
    {
      periodDays: 30,
      totalTokens: 443_388_365,
      totalRequests: 34_832,
      startsAt: '2026-06-22',
      endsAt: '2026-07-21',
      timezone: 'Asia/Shanghai',
      models: [
        { model: 'GLM-5.2', tokens: 443_283_784 },
        { model: 'GLM-4.7', tokens: 17_296 },
      ],
    }
  );
}

async function testProxyUserAdoptsLegacySharedCliUser() {
  await pgRun(
    `INSERT INTO users (id, email, name, provider, provider_id, role)
     VALUES ('legacy-user', 'codex-user@local', 'Codex User', 'cli', 'local-cli', 'admin')`
  );
  await pgRun(
    `INSERT INTO user_settings (user_id, theme, default_working_dir, allowed_tools, settings_json)
     VALUES ('legacy-user', 'system', '/mnt/user/AI/plum-code', '["Bash"]', '{"uiProvider":"plum"}')`
  );
  await pgRun(
    `INSERT INTO sessions (id, user_id, name, working_directory)
     VALUES ('session-1', 'legacy-user', 'Chat', '/tmp')`
  );
  await pgRun(
    `INSERT INTO usage_history (user_id, session_id, turn_id, input_tokens)
     VALUES ('legacy-user', 'session-1', 'turn-1', 123)`
  );

  const user = await upsertProxyUserInDatabase('Valentin@Example.COM', 'Valentin', null);

  assert.equal(user.id, 'legacy-user');
  assert.equal(user.email, 'valentin@example.com');
  assert.equal(user.provider, 'proxy');
  assert.equal(user.providerId, 'valentin@example.com');
  assert.equal(
    ((await pgGet('SELECT COUNT(*) as count FROM users')) as { count: number }).count,
    1
  );
  assert.deepEqual(
    await pgGet(`SELECT email, provider, provider_id, role FROM users WHERE id = 'legacy-user'`),
    {
      email: 'valentin@example.com',
      provider: 'proxy',
      provider_id: 'valentin@example.com',
      role: 'admin',
    }
  );
  assert.equal(
    (
      (await pgGet(
        `SELECT default_working_dir FROM user_settings WHERE user_id = 'legacy-user'`
      )) as { default_working_dir: string }
    ).default_working_dir,
    '/mnt/user/AI/plum-code'
  );
  assert.equal(
    ((await pgGet(`SELECT user_id FROM sessions WHERE id = 'session-1'`)) as { user_id: string })
      .user_id,
    'legacy-user'
  );
  assert.equal(
    (
      (await pgGet(`SELECT user_id FROM usage_history WHERE session_id = 'session-1'`)) as {
        user_id: string;
      }
    ).user_id,
    'legacy-user'
  );
}

function testCodexSessionIdExtraction() {
  assert.equal(
    extractCodexSessionId({
      type: 'session_meta',
      id: '019eb1d8-cda2-7b82-9955-3c1c37e660d0',
    }),
    '019eb1d8-cda2-7b82-9955-3c1c37e660d0'
  );
  assert.equal(
    extractCodexSessionId({
      type: 'session_meta',
      sessionId: '019eb1d8-cda2-7b82-9955-3c1c37e660d1',
    }),
    '019eb1d8-cda2-7b82-9955-3c1c37e660d1'
  );
  assert.equal(
    extractCodexSessionId({
      type: 'session_meta',
      payload: { id: '019eb1d8-cda2-7b82-9955-3c1c37e660d2' },
    }),
    '019eb1d8-cda2-7b82-9955-3c1c37e660d2'
  );
  assert.equal(
    extractCodexSessionId({
      type: 'thread.started',
      thread: { id: 'thread-123' },
    }),
    'thread-123'
  );
  assert.equal(
    extractCodexSessionId({
      type: 'turn_context',
      id: 'ignored',
    }),
    null
  );
}

function testDisconnectedSessionStaysRunning() {
  const ioStub = {
    to: () => ({ emit: () => undefined }),
  };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const harness = asProcessStore<DisconnectProcessStub>(manager);
  const sessionId = 'headless-session';

  harness.processes.set(sessionId, { disconnectedAt: null });

  manager.markSessionDisconnected(sessionId);

  assert.equal(manager.isSessionRunning(sessionId), true);
  assert.notEqual(harness.processes.get(sessionId)?.disconnectedAt, null);
}

function queuedTurn(id: string): CodexQueueTurnStub {
  return {
    queueId: id,
    queuedAt: `2026-08-09T00:00:0${id.length}.000Z`,
    originalMessage: id,
    messageForClaude: id,
    updateLastMessage: true,
    codexImagePaths: [],
    codexNativeSlashCommand: false,
  };
}

function testCodexQueueModeIsFifoAndSteeringPreservesAcceptedTurns() {
  const ioStub = { to: () => ({ emit: () => undefined }) };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const queueHarness = manager as unknown as {
    queueCodexTurn: (
      sessionId: string,
      proc: CodexQueueProcessStub,
      turn: CodexQueueTurnStub,
      mode: 'queue' | 'steer'
    ) => void;
  };
  const proc: CodexQueueProcessStub = {
    cliProvider: 'codex',
    codexIdle: false,
    codexQueuedTurns: [],
    codexSteerDraining: false,
    codexPreemptingForSteer: false,
  };

  queueHarness.queueCodexTurn('codex-queue-session', proc, queuedTurn('queued-1'), 'queue');
  queueHarness.queueCodexTurn('codex-queue-session', proc, queuedTurn('queued-2'), 'queue');
  assert.deepEqual(
    proc.codexQueuedTurns.map((turn) => turn.queueId),
    ['queued-1', 'queued-2'],
    'queue-mode follow-ups must remain FIFO'
  );

  queueHarness.queueCodexTurn('codex-queue-session', proc, queuedTurn('steer-1'), 'steer');
  queueHarness.queueCodexTurn('codex-queue-session', proc, queuedTurn('steer-2'), 'steer');
  assert.deepEqual(
    proc.codexQueuedTurns.map((turn) => turn.queueId),
    ['steer-2', 'steer-1', 'queued-1', 'queued-2'],
    'steering may move ahead but must retain every previously accepted follow-up'
  );
}

async function testAcpQueueDrainsEveryWaitingFollowup() {
  const ioStub = { to: () => ({ emit: () => undefined }) };
  const manager = new ClaudeProcessManager(
    ioStub as unknown as ClaudeProcessManagerIo,
    createTestEventSequenceAllocator()
  );
  const queueHarness = manager as unknown as {
    drainAcpQueuedTurns: (sessionId: string, proc: AcpQueueProcessStub) => Promise<void>;
    dispatchAcpTurn: (
      sessionId: string,
      proc: AcpQueueProcessStub,
      turn: CodexQueueTurnStub
    ) => Promise<void>;
  };
  const proc: AcpQueueProcessStub = {
    cliProvider: 'vibe',
    acpIdle: true,
    acpQueueDraining: false,
    acpQueuedTurns: [queuedTurn('vibe-1'), queuedTurn('vibe-2'), queuedTurn('vibe-3')],
  };
  const dispatched: string[] = [];
  queueHarness.dispatchAcpTurn = async (_sessionId, current, turn) => {
    current.acpIdle = false;
    await Promise.resolve();
    dispatched.push(turn.queueId);
    current.acpIdle = true;
  };

  await queueHarness.drainAcpQueuedTurns('vibe-queue-session', proc);

  assert.deepEqual(dispatched, ['vibe-1', 'vibe-2', 'vibe-3']);
  assert.equal(proc.acpQueuedTurns.length, 0);
  assert.equal(proc.acpQueueDraining, false);
}

function testMemoryOptimizerUsesConfigHomeAndStrictManagedPlaceholders() {
  const configHome = path.join(os.tmpdir(), 'plum-custom-config-home');
  assert.equal(
    resolveMemoryOptimizerMemoryDir('/workspace/demo.project', configHome),
    path.join(configHome, 'projects', '-workspace-demo-project', 'memory')
  );

  const block0 = '<!-- __PLUM_MANAGED_BLOCK_0__ -->';
  const block1 = '<!-- __PLUM_MANAGED_BLOCK_1__ -->';
  assert.equal(hasExactManagedPlaceholderSequence(`${block0}\ntext\n${block1}`, 2), true);
  assert.equal(hasExactManagedPlaceholderSequence(`${block0}\n${block0}\n${block1}`, 2), false);
  assert.equal(hasExactManagedPlaceholderSequence(`${block1}\n${block0}`, 2), false);
  assert.equal(hasExactManagedPlaceholderSequence(block0, 2), false);
}

/**
 * Two context snapshots written in the same second.
 *
 * `created_at` has one-second resolution, so ordering by it alone leaves the
 * pair tied and the "latest" snapshot is whichever the planner happens to
 * return. `seq` — the BIGSERIAL that replaced SQLite's rowid — breaks the tie by
 * insertion order, which is what makes this deterministic.
 */
async function testLatestContextSnapshotOrdering() {
  await pgRun(
    `INSERT INTO users (id, email, name, provider, provider_id)
     VALUES ('ctx-user', 'ctx@example.test', 'C', 'local', 'ctx-user')`
  );
  await pgRun(
    `INSERT INTO sessions (id, user_id, name, working_directory)
     VALUES ('ctx-session', 'ctx-user', 'Ctx', '/tmp')`
  );

  const createdAt = '2026-06-10 19:08:36';
  for (const [id, total, percent] of [
    ['ctx-old', 15, 1],
    ['ctx-new', 28, 2],
  ] as const) {
    await pgRun(
      `INSERT INTO session_events (
         id, user_id, session_id, event_type, provider, model,
         input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
         total_tokens, context_window, context_used_percent, context_exceeded,
         metadata_json, created_at
       ) VALUES (?, ?, ?, 'context_snapshot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      'ctx-user',
      'ctx-session',
      'codex',
      'gpt-5.5',
      total - 5,
      0,
      5,
      0,
      total,
      256_000,
      percent,
      0,
      JSON.stringify({ cappedPercent: percent, totalCostUsd: percent / 10 }),
      createdAt
    );
  }

  const latest = (await pgGet(
    `SELECT id, total_tokens as totalTokens, context_used_percent as contextUsedPercent
       FROM session_events
      WHERE session_id = ? AND user_id = ? AND event_type = 'context_snapshot'
      ORDER BY created_at DESC, seq DESC
      LIMIT 1`,
    'ctx-session',
    'ctx-user'
  )) as { id: string; totalTokens: number; contextUsedPercent: number } | undefined;

  assert.equal(latest?.id, 'ctx-new');
  assert.equal(latest?.totalTokens, 28);
  assert.equal(latest?.contextUsedPercent, 2);
}

async function testCodexConfigSyncIdempotence() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-config-sync-'));
  const claudeDir = path.join(root, '.claude');
  const codexDir = path.join(root, '.codex');
  const claudeSettingsPath = path.join(claudeDir, 'settings.json');
  const configPath = path.join(codexDir, 'config.toml');

  try {
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(
      claudeSettingsPath,
      JSON.stringify(
        {
          mcpServers: {
            demo: {
              command: 'demo-cli',
              args: ['--flag'],
              env: { DEMO_KEY: 'value' },
            },
          },
        },
        null,
        2
      )
    );

    const firstStatus = await syncCodexConfig({ codexHome: codexDir, claudeSettingsPath });
    const firstConfig = await fs.readFile(configPath, 'utf8');
    assert.equal(firstConfig.startsWith('\n'), false);
    assert.match(firstConfig, /\[profiles\.fast\]/);
    // The managed block follows the shared default (gpt-6.1-sol since codex 0.162).
    assert.ok(firstConfig.includes(`model = "${DEFAULT_CODEX_MODEL}"`));
    assert.match(firstConfig, /service_tier = "fast"/);
    assert.match(firstConfig, /\[mcp_servers\.oracle\]/);
    assert.match(firstConfig, /command = "node"/);
    assert.match(firstConfig, /args = \["\/app\/scripts\/mcp-servers\/oracle\.mjs"\]/);
    assert.match(firstConfig, /ORACLE_HOME_DIR = "\/home\/node\/\.codex\/oracle"/);
    assert.match(firstConfig, /\[mcp_servers\.demo\]/);
    assert.match(firstConfig, /command = "demo-cli"/);
    assert.match(firstConfig, /DEMO_KEY = "value"/);

    const secondStatus = await syncCodexConfig({ codexHome: codexDir, claudeSettingsPath });
    const secondConfig = await fs.readFile(configPath, 'utf8');
    assert.equal(secondConfig.startsWith('\n'), false);
    assert.equal(firstConfig, secondConfig);
    assert.match(firstStatus, /updated|unchanged/);
    assert.match(secondStatus, /updated|unchanged/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testDefaultMcpServerSeeding() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-defaults-'));
  const settingsPath = path.join(root, '.claude', 'settings.json');

  try {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify(
        {
          mcpServers: {
            godot: {
              type: 'stdio',
              command: 'custom-godot-wrapper',
              args: ['--keep-me'],
            },
          },
          env: { KEEP: '1' },
        },
        null,
        2
      )
    );

    const first = await ensureDefaultClaudeMcpServers({ settingsPath });
    const parsed = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
      env?: Record<string, string>;
    };

    assert.deepEqual(first.added, ['assistant', 'blender', 'subagents', 'firefox', 'rea']);
    assert.equal(parsed.mcpServers.godot.command, 'custom-godot-wrapper');
    assert.deepEqual(parsed.mcpServers.godot.args, ['--keep-me']);
    assert.equal(parsed.mcpServers.blender.command, 'node');
    assert.deepEqual(parsed.mcpServers.blender.args, ['/app/scripts/mcp-servers/blender.mjs']);
    assert.equal(parsed.mcpServers.subagents.command, 'node');
    assert.deepEqual(parsed.mcpServers.subagents.args, ['/app/scripts/mcp-servers/subagents.mjs']);
    assert.deepEqual(parsed.mcpServers.firefox.args, ['/app/scripts/mcp-servers/firefox.mjs']);
    assert.equal(parsed.mcpServers.rea.command, 'npx');
    assert.deepEqual(parsed.mcpServers.rea.args, ['--yes', 'rea-agents@6.7.0', 'mcp']);
    assert.equal(parsed.env?.KEEP, '1');

    const second = await ensureDefaultClaudeMcpServers({ settingsPath });
    assert.equal(second.updated, false);
    assert.deepEqual(second.added, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testClaudeSettingsProviderIsolation() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-provider-isolation-'));
  const settingsPath = path.join(root, '.claude', 'settings.json');

  try {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify(
        {
          mcpServers: {
            demo: {
              type: 'stdio',
              command: 'demo-cli',
            },
          },
          env: {
            KEEP: '1',
            ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
            ANTHROPIC_AUTH_TOKEN: 'must-not-reach-claude',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.2',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-4.7',
            API_TIMEOUT_MS: '3000000',
          },
        },
        null,
        2
      )
    );

    const first = await sanitizeClaudeSettingsProviderEnv({ settingsPath });
    const parsed = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as {
      mcpServers: Record<string, { command: string }>;
      env?: Record<string, string>;
    };

    assert.equal(first.updated, true);
    assert.deepEqual(first.removed, [
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'API_TIMEOUT_MS',
    ]);
    assert.deepEqual(parsed.env, { KEEP: '1' });
    assert.equal(parsed.mcpServers.demo.command, 'demo-cli');

    const second = await sanitizeClaudeSettingsProviderEnv({ settingsPath });
    assert.equal(second.updated, false);
    assert.deepEqual(second.removed, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testClaudeResumeTranscriptProviderIsolation() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-resume-isolation-'));
  const configHome = path.join(root, '.claude');
  const workingDirectory = path.join(root, 'workspace', 'demo');
  const resumeId = '47eb639b-b7ab-46e3-b122-6c2d7b54a749';
  const projectDirectory = path.join(
    configHome,
    'projects',
    path.resolve(workingDirectory).replace(/[^a-zA-Z0-9]/g, '-')
  );
  const transcriptPath = path.join(projectDirectory, `${resumeId}.jsonl`);
  const validBlock = {
    parentUuid: null,
    message: {
      role: 'assistant',
      content: [
        {
          type: 'server_tool_use',
          id: 'srvtoolu_valid_123',
          name: 'web_search',
          input: {},
        },
      ],
      stop_reason: 'tool_use',
    },
  };
  const incompatibleBlock = {
    parentUuid: 'one',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'server_tool_use',
          id: 'call_zai_123',
          name: 'analyze_image',
          input: {},
        },
      ],
      stop_reason: 'tool_use',
    },
  };
  const followingText = {
    parentUuid: 'two',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'The image result remains available.' }],
      stop_reason: 'end_turn',
    },
  };

  try {
    await fs.mkdir(projectDirectory, { recursive: true });
    const original = [validBlock, incompatibleBlock, followingText]
      .map((entry) => JSON.stringify(entry))
      .join('\n');
    await fs.writeFile(transcriptPath, `${original}\n`);

    const first = await sanitizeClaudeResumeTranscript(configHome, workingDirectory, resumeId);
    assert.equal(first.updated, true);
    assert.equal(first.replacements, 1);
    assert.equal(first.backupPath, `${transcriptPath}.pre-anthropic-resume.bak`);
    assert.equal(await fs.readFile(first.backupPath!, 'utf8'), `${original}\n`);

    const lines = (await fs.readFile(transcriptPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)) as Array<{
      message: { content: Array<Record<string, unknown>>; stop_reason: string };
    }>;
    assert.equal(lines[0]?.message.content[0]?.id, 'srvtoolu_valid_123');
    assert.equal(lines[1]?.message.content[0]?.type, 'text');
    assert.match(String(lines[1]?.message.content[0]?.text), /Legacy Z\.AI server tool call/);
    assert.equal(lines[1]?.message.stop_reason, 'end_turn');
    assert.equal(lines[2]?.message.content[0]?.text, 'The image result remains available.');

    const second = await sanitizeClaudeResumeTranscript(configHome, workingDirectory, resumeId);
    assert.equal(second.updated, false);
    assert.equal(second.replacements, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function callMcpScript(
  scriptPath: string,
  request: Record<string, unknown>,
  env: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const child = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`Timed out waiting for MCP response from ${scriptPath}. stderr=${stderr}`)
        );
      }, 5_000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        for (const line of stdout.split('\n').filter((entry) => entry.trim())) {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (parsed.id === request.id) {
            clearTimeout(timer);
            resolve(parsed);
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('exit', (code) => {
        if (code && code !== 0) {
          clearTimeout(timer);
          reject(new Error(`MCP script exited with ${code}. stderr=${stderr}`));
        }
      });

      child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  } finally {
    child.kill('SIGTERM');
  }
}

async function testGodotAndBlenderMcpToolLists() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const godotResponse = await callMcpScript(
    path.join(repoRoot, 'scripts/mcp-servers/godot.mjs'),
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { GODOT_BIN: '/definitely/missing/godot' }
  );
  const blenderResponse = await callMcpScript(
    path.join(repoRoot, 'scripts/mcp-servers/blender.mjs'),
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { BLENDER_BIN: '/definitely/missing/blender' }
  );

  const godotTools = (
    (godotResponse.result as { tools?: Array<{ name?: string }> })?.tools || []
  ).map((tool) => tool.name);
  const blenderTools = (
    (blenderResponse.result as { tools?: Array<{ name?: string }> })?.tools || []
  ).map((tool) => tool.name);

  assert.ok(godotTools.includes('godot_create_project'));
  assert.ok(godotTools.includes('godot_validate_project'));
  assert.ok(blenderTools.includes('blender_create_asset'));
  assert.ok(blenderTools.includes('blender_render_preview'));
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function testOracleMcpPrefersEmbeddedBrowserTarget() {
  const runtimePayload = {
    success: true,
    data: {
      sessionId: 'session-1',
      userId: 'user-1',
      mode: 'profile',
      chatgptUrl: 'https://chatgpt.com/',
      remoteChrome: null,
      chromeProfile: null,
      chromeCookiePath: null,
      manualLoginProfileDir: null,
      embeddedRemoteChrome: '127.0.0.1:34865',
    },
  };
  const server = createServer((req, res) => {
    if (req.url === '/api/oracle/internal/runtime') {
      if (
        req.headers['x-webui-hook-secret'] !== 'test-secret' ||
        req.headers['x-webui-session-id'] !== 'session-1'
      ) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: { message: 'invalid secret' } }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(runtimePayload));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false }));
  });
  const listenAddress = await new Promise<{ port: number }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind test runtime server'));
        return;
      }
      resolve({ port: address.port });
    });
  });
  const oracleHome = await fs.mkdtemp(path.join(os.tmpdir(), 'oracle-mcp-test-'));

  try {
    const oracleScript = path.join(repoRoot, 'scripts/mcp-servers/oracle.mjs');
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'consult',
        arguments: {
          prompt: 'Smoke test prompt',
          files: ['packages/backend/src/routes/oracle.ts'],
          engine: 'browser',
          slug: 'embedded-browser-args',
        },
      },
    };
    const readMcpResponse = async (
      child: ChildProcessWithoutNullStreams
    ): Promise<Record<string, unknown>> => {
      let stdout = '';
      let stderr = '';
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for Oracle MCP response. stderr=${stderr}`));
        }, 5_000);

        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
          const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
          for (const line of lines) {
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(line) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (parsed.id === 1) {
              clearTimeout(timer);
              resolve(parsed);
            }
          }
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('exit', (code) => {
          if (code && code !== 0) {
            clearTimeout(timer);
            reject(new Error(`Oracle MCP exited with ${code}. stderr=${stderr}`));
          }
        });

        child.stdin.write(`${JSON.stringify(request)}\n`);
      });
    };
    const assertConsultResponse = (response: Record<string, unknown>) => {
      const result = response.result as
        | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
        | undefined;
      const text = result?.content?.[0]?.text || '';

      assert.equal(result?.isError, undefined);
      assert.match(text, /--engine browser/);
      assert.match(text, /--browser-model-strategy current/);
      assert.match(text, /--browser-timeout 8m/);
      assert.match(text, /--remote-chrome 127\.0\.0\.1:34865/);
      assert.doesNotMatch(text, /--browser-thinking-time/);
      assert.doesNotMatch(text, /--browser-manual-login/);
      assert.doesNotMatch(text, /--browser-keep-browser/);
    };

    const child = spawn(process.execPath, [oracleScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        WEBUI_BACKEND_URL: `http://127.0.0.1:${listenAddress.port}`,
        WEBUI_HOOK_SECRET: 'test-secret',
        WEBUI_SESSION_ID: 'session-1',
        ORACLE_BIN: '/bin/echo',
        ORACLE_HOME_DIR: oracleHome,
        ORACLE_MCP_TIMEOUT_MS: '5000',
        ORACLE_BROWSER_MODEL_STRATEGY: 'select',
        ORACLE_BROWSER_THINKING_TIME: 'extended',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    assertConsultResponse(await readMcpResponse(child));

    child.kill('SIGTERM');

    const parentScript = `
      import { spawn } from 'node:child_process';

      const request = ${JSON.stringify(JSON.stringify(request))};
      const child = spawn(process.execPath, [process.env.ORACLE_SCRIPT], {
        cwd: process.env.REPO_ROOT,
        env: {
          HOME: process.env.HOME || '',
          PATH: process.env.PATH || '',
          ORACLE_BIN: process.env.ORACLE_BIN,
          ORACLE_HOME_DIR: process.env.ORACLE_HOME_DIR,
          ORACLE_MCP_TIMEOUT_MS: process.env.ORACLE_MCP_TIMEOUT_MS,
          ORACLE_BROWSER_MODEL_STRATEGY: process.env.ORACLE_BROWSER_MODEL_STRATEGY,
          ORACLE_BROWSER_THINKING_TIME: process.env.ORACLE_BROWSER_THINKING_TIME || '',
          npm_config_cache: process.env.npm_config_cache || '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        console.error('Timed out waiting for nested Oracle MCP response. stderr=' + stderr);
        child.kill('SIGTERM');
        process.exit(1);
      }, 5000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        for (const line of stdout.split('\\n').filter((entry) => entry.trim())) {
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          if (parsed.id === 1) {
            clearTimeout(timer);
            console.log(JSON.stringify(parsed));
            child.kill('SIGTERM');
            process.exit(0);
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      });
      child.on('exit', (code) => {
        if (code && code !== 0) {
          clearTimeout(timer);
          console.error('Nested Oracle MCP exited with ' + code + '. stderr=' + stderr);
          process.exit(1);
        }
      });
      child.stdin.write(request + '\\n');
    `;
    const parent = spawn(process.execPath, ['--input-type=module', '-e', parentScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        WEBUI_BACKEND_URL: `http://127.0.0.1:${listenAddress.port}`,
        WEBUI_HOOK_SECRET: 'test-secret',
        WEBUI_SESSION_ID: 'session-1',
        ORACLE_SCRIPT: oracleScript,
        REPO_ROOT: repoRoot,
        ORACLE_BIN: '/bin/echo',
        ORACLE_HOME_DIR: oracleHome,
        ORACLE_MCP_TIMEOUT_MS: '5000',
        ORACLE_BROWSER_MODEL_STRATEGY: 'select',
        ORACLE_BROWSER_THINKING_TIME: 'extended',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    assertConsultResponse(await readMcpResponse(parent));
    parent.kill('SIGTERM');
  } finally {
    await closeServer(server);
    await fs.rm(oracleHome, { recursive: true, force: true });
  }
}

async function testOracleMcpStartsEmbeddedBrowserForManualMode() {
  let startCalled = false;
  const runtimePayload = {
    success: true,
    data: {
      sessionId: 'session-1',
      userId: 'user-1',
      mode: 'manual',
      chatgptUrl: 'https://chatgpt.com/',
      remoteChrome: null,
      chromeProfile: null,
      chromeCookiePath: null,
      manualLoginProfileDir: '/tmp/plum-oracle-profile',
      embeddedRemoteChrome: null,
    },
  };
  const server = createServer((req, res) => {
    const hasAuth =
      req.headers['x-webui-hook-secret'] === 'test-secret' &&
      req.headers['x-webui-session-id'] === 'session-1';

    if (req.url === '/api/oracle/internal/runtime') {
      if (!hasAuth) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: { message: 'invalid secret' } }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(runtimePayload));
      return;
    }

    if (req.url === '/api/oracle/internal/browser/start' && req.method === 'POST') {
      startCalled = true;
      if (!hasAuth) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: { message: 'invalid secret' } }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          data: {
            embeddedRemoteChrome: '127.0.0.1:45678',
            profileDir: '/tmp/plum-oracle-profile',
            status: 'running',
            running: true,
          },
        })
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false }));
  });
  const listenAddress = await new Promise<{ port: number }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind test runtime server'));
        return;
      }
      resolve({ port: address.port });
    });
  });
  const oracleHome = await fs.mkdtemp(path.join(os.tmpdir(), 'oracle-mcp-manual-test-'));

  try {
    const oracleScript = path.join(repoRoot, 'scripts/mcp-servers/oracle.mjs');
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'consult',
        arguments: {
          prompt: 'Smoke test prompt',
          engine: 'browser',
          slug: 'manual-browser-start-args',
        },
      },
    };
    const child = spawn(process.execPath, [oracleScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        WEBUI_BACKEND_URL: `http://127.0.0.1:${listenAddress.port}`,
        WEBUI_HOOK_SECRET: 'test-secret',
        WEBUI_SESSION_ID: 'session-1',
        ORACLE_BIN: '/bin/echo',
        ORACLE_HOME_DIR: oracleHome,
        ORACLE_MCP_TIMEOUT_MS: '5000',
        ORACLE_BROWSER_MODEL_STRATEGY: 'select',
        ORACLE_BROWSER_THINKING_TIME: 'extended',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for Oracle MCP response. stderr=${stderr}`));
      }, 5_000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        for (const line of stdout.split('\n').filter((entry) => entry.trim())) {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (parsed.id === 1) {
            clearTimeout(timer);
            resolve(parsed);
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('exit', (code) => {
        if (code && code !== 0) {
          clearTimeout(timer);
          reject(new Error(`Oracle MCP exited with ${code}. stderr=${stderr}`));
        }
      });

      child.stdin.write(`${JSON.stringify(request)}\n`);
    });

    const result = response.result as
      | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
      | undefined;
    const text = result?.content?.[0]?.text || '';

    assert.equal(startCalled, true);
    assert.equal(result?.isError, undefined);
    assert.match(text, /--engine browser/);
    assert.match(text, /--browser-model-strategy current/);
    assert.match(text, /--browser-timeout 8m/);
    assert.match(text, /--remote-chrome 127\.0\.0\.1:45678/);
    assert.doesNotMatch(text, /--browser-thinking-time/);
    assert.doesNotMatch(text, /--browser-cookie-path/);
    child.kill('SIGTERM');
  } finally {
    await closeServer(server);
    await fs.rm(oracleHome, { recursive: true, force: true });
  }
}

function testPricingTable() {
  assert.deepEqual(resolveModelPricing('gpt-6-astra'), {
    input: 10,
    output: 50,
    cacheRead: 1,
    cacheWrite: 12.5,
    source: 'OpenAI API pricing, 2026-09-04',
    label: 'GPT-6 Astra',
  });
  assert.deepEqual(resolveModelPricing('gpt-6-sol'), {
    input: 2,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2.5,
    source: 'OpenAI API pricing, 2026-09-22',
    label: 'GPT-6 Sol',
  });
  assert.deepEqual(resolveModelPricing('openai/gpt-6-luna'), {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    source: 'OpenAI API pricing, 2026-09-22',
    label: 'GPT-6 Luna',
  });
  assert.deepEqual(resolveModelPricing('gpt-5.6-sol')?.input, 4);
  assert.deepEqual(resolveModelPricing('gpt-5.6-terra'), {
    input: 2,
    output: 12,
    cacheRead: 0.2,
    cacheWrite: 2.5,
    source: 'OpenAI API pricing, 2026-09-04',
    label: 'GPT-5.6 Terra',
  });
  assert.deepEqual(resolveModelPricing('gpt-5.6-luna'), {
    input: 0.2,
    output: 1.2,
    cacheRead: 0.02,
    cacheWrite: 0.25,
    source: 'OpenAI API pricing, 2026-09-04',
    label: 'GPT-5.6 Luna',
  });
  assert.deepEqual(resolveModelPricing('gpt-5.5')?.input, 5);
  assert.deepEqual(resolveModelPricing('gpt-5.4-mini')?.output, 4.5);
  assert.deepEqual(resolveModelPricing('gpt-5.2')?.input, 1.75);
  assert.deepEqual(resolveModelPricing('claude-fable-5-1')?.cacheRead, 0.25);
  assert.deepEqual(resolveModelPricing('claude-opus-5-5')?.input, 4);
  assert.deepEqual(resolveModelPricing('claude-opus-5-5[1m]')?.output, 20);
  assert.deepEqual(resolveModelPricing('claude-sonnet-5-5')?.label, 'Claude Sonnet 5.5');
  assert.deepEqual(resolveModelPricing('claude-haiku-5-5')?.input, 0.1);
  assert.deepEqual(resolveModelPricing('opus')?.label, 'Claude Opus 5.5');
  assert.deepEqual(resolveModelPricing('claude-fable-5')?.output, 50);
  assert.deepEqual(resolveModelPricing('claude-fable-5')?.cacheRead, 1);
  assert.deepEqual(resolveModelPricing('claude-opus-5')?.cacheWrite, 6.25);
  assert.deepEqual(resolveModelPricing('claude-sonnet-5')?.input, 2);
  assert.deepEqual(resolveModelPricing('claude-sonnet-5')?.output, 10);
  assert.deepEqual(resolveModelPricing('claude-opus-4-8')?.input, 5);
  assert.deepEqual(resolveModelPricing('claude-opus-4.7')?.output, 25);
  assert.deepEqual(resolveModelPricing('anthropic/claude-opus-4.5')?.cacheWrite, 6.25);
  assert.deepEqual(resolveModelPricing('claude-opus-4-1-20250805')?.input, 15);
  assert.deepEqual(resolveModelPricing('claude-opus-4.1')?.output, 75);
  assert.deepEqual(resolveModelPricing('claude-sonnet-4.6')?.cacheRead, 0.3);
  assert.deepEqual(resolveModelPricing('anthropic/claude-sonnet-4.5')?.output, 15);
  assert.deepEqual(resolveModelPricing('claude-haiku-4.5')?.cacheWrite, 1.25);
  assert.deepEqual(resolveModelPricing('claude-3.5-haiku-20241022')?.input, 0.8);
  assert.deepEqual(resolveModelPricing('z-ai/glm-5.2')?.output, 4.4);
  assert.deepEqual(resolveModelPricing('z-ai/glm-5.1')?.cacheRead, 0.26);
  assert.deepEqual(resolveModelPricing('glm-4.7')?.output, 2.2);
  assert.deepEqual(resolveModelPricing('opencode-go/kimi-k2.7-code')?.cacheRead, 0.19);
  assert.deepEqual(resolveModelPricing('opencode/kimi-k2.7-code')?.output, 4);
  assert.deepEqual(resolveModelPricing('kimi-code/k3'), {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 0,
    source: 'Kimi K3 API pricing, 2026-07-18',
    label: 'Kimi K3',
  });
  assert.deepEqual(resolveModelPricing('moonshot/kimi-k3')?.input, 3);
  // Peak rates (2026-11); retired Flash names bill as V4.1 Flash.
  assert.deepEqual(resolveModelPricing('deepseek/deepseek-flash')?.input, 0.3);
  assert.deepEqual(resolveModelPricing('deepseek/deepseek-v4-flash')?.cacheRead, 0.006);
  assert.deepEqual(resolveModelPricing('deepseek/deepseek-v4-pro')?.output, 3.96);
  assert.equal(resolveContextWindow('deepseek-flash'), 1_000_000);
  assert.equal(resolveContextWindow('deepseek-v4-pro'), 1_000_000);
  assert.equal(resolveContextWindow('deepseek-r1'), 128_000);
  assert.deepEqual(resolveModelPricing('gemini-3.1-pro-preview')?.cacheRead, 0.2);
  assert.deepEqual(resolveModelPricing('mistral-vibe-cli-latest')?.output, 7.5);
  assert.deepEqual(resolveModelPricing('devstral-small-latest')?.input, 0.1);
  assert.deepEqual(resolveModelPricing('opencode/gpt-5.1')?.output, 8.5);
  assert.deepEqual(resolveModelPricing('opencode/qwen3.6-plus')?.cacheWrite, 0.625);
  assert.deepEqual(resolveModelPricing('opencode/deepseek-v4-flash')?.cacheRead, 0.03);
  assert.deepEqual(resolveModelPricing('opencode/big-pickle')?.input, 0);
  assert.deepEqual(resolveModelPricing('opencode-go/glm-5.1')?.input, 1.4);
  assert.deepEqual(resolveModelPricing('opencode-go/qwen3.7-max')?.output, 7.5);
  assert.deepEqual(resolveModelPricing('alibaba-token-plan/qwen3.8-max-preview'), {
    input: 2,
    output: 6,
    cacheRead: 0.25,
    cacheWrite: 2.5,
    source: 'Alibaba Model Studio Qwen3.8 Max pay-as-you-go pricing, 2026-08-03',
    label: 'Qwen3.8 Max Preview',
  });
  assert.deepEqual(resolveModelPricing('opencode-go/mimo-v2.5-pro')?.input, 1.74);
  assert.deepEqual(resolveModelPricing('opencode-go/mimo-v2.5-pro')?.cacheRead, 0.0145);
  assert.deepEqual(resolveModelPricing('opencode-go/minimax-m3')?.cacheRead, 0.06);
  assert.equal(resolveModelPricing('ollama-cloud/devstral-small-2:24b'), null);
  // Own hardware: a known zero, so it no longer counts as a missing price.
  assert.deepEqual(resolveModelPricing('qwen-local/qwen3.8-flash-next'), {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    source: 'Local inference on own hardware',
    label: 'Local model',
  });
  assert.equal(resolveModelPricing('llama-local/qwopus')?.output, 0);
  assert.equal(resolveModelPricing('kimi-code/kimi-for-coding')?.label, 'Kimi K2.7 Code');

  const estimate = estimateModelCost(
    'gpt-5.5',
    {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 0,
    },
    null
  );
  assert.equal(estimate.known, true);
  assert.equal(estimate.cost, 35.5);

  const unknownEstimate = estimateModelCost('unknown-model', {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });
  assert.equal(unknownEstimate.known, false);
  assert.equal(unknownEstimate.cost, 0);
}

async function readPngDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const buffer = await fs.readFile(filePath);
  assert.equal(buffer.readUInt32BE(0), 0x89504e47);
  assert.equal(buffer.toString('ascii', 12, 16), 'IHDR');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function testPwaInstallAssets() {
  const publicDir = path.join(repoRoot, 'packages/frontend/public');
  const indexHtml = await fs.readFile(path.join(repoRoot, 'packages/frontend/index.html'), 'utf8');
  const manifest = JSON.parse(await fs.readFile(path.join(publicDir, 'manifest.json'), 'utf8')) as {
    start_url?: string;
    scope?: string;
    display?: string;
    icons?: Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>;
  };

  assert.match(
    indexHtml,
    /<link\s+rel="manifest"\s+href="\/manifest\.json"\s+crossorigin="use-credentials"\s*\/?>/,
    'auth-gated deployments need manifest credentials so Chrome can fetch manifest.json'
  );

  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');

  const expectedIcons = new Map([
    ['192x192', { width: 192, height: 192 }],
    ['512x512', { width: 512, height: 512 }],
  ]);

  for (const [size, expected] of expectedIcons) {
    const icon = manifest.icons?.find((candidate) => candidate.sizes === size);
    assert.ok(icon, `missing PWA icon ${size}`);
    assert.equal(icon.type, 'image/png');
    assert.match(icon.purpose || '', /maskable/);
    assert.ok(icon.src?.startsWith('/logos/'));

    const dimensions = await readPngDimensions(path.join(publicDir, icon.src.slice(1)));
    assert.deepEqual(dimensions, expected);
  }

  const serviceWorker = await fs.readFile(path.join(publicDir, 'sw.js'), 'utf8');
  assert.match(serviceWorker, /self\.addEventListener\('fetch'/);
  assert.match(serviceWorker, /self\.clients\.claim/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/assets\/'\)/);
  assert.match(serviceWorker, /cache\.put\(event\.request, response\.clone\(\)\)/);
  assert.doesNotMatch(serviceWorker, /unregister/);

  const legacyServiceWorker = await fs.readFile(path.join(publicDir, 'service-worker.js'), 'utf8');
  assert.match(legacyServiceWorker, /importScripts\('\/sw\.js'\)/);
}

function testCodexCliUpdaterTracksLatest() {
  const command = getCliUpdateCommand('codex') || '';
  assert.match(command, /@openai\/codex@latest/);
  assert.doesNotMatch(command, /@openai\/codex@\d+\.\d+\.\d+/);
}

function testClaudeCliUpdaterPromotesAndExecutesNativeBinary() {
  for (const provider of ['claude', 'zai'] as const) {
    const command = getCliUpdateCommand(provider) || '';
    assert.match(command, /@anthropic-ai\/claude-code@latest/);
    assert.match(command, /@anthropic-ai\/claude-code\/install\.cjs/);
    assert.match(command, /claude --version/);
  }
}

function testPiUpdaterIncludesHarnessAndMcpBridge() {
  const command = getCliUpdateCommand('pi') || '';
  assert.match(command, /@earendil-works\/pi-coding-agent@latest/);
  assert.match(command, /pi-mcp-adapter@latest/);
}

testProviderLabels();
testCodexUsageWindowsFollowUpstreamDuration();
testProviderTurnUsageAggregation();
testZaiAccountUsageShape();
testContextWindowFallbacks();
testUsageWindowNormalization();
await testContextUsageIncludesAssistantOutput();
await testCodexUsageUsesNormalizedContextWindow();
await testContextUsageCapsAtWindow();
await testCodexFreshExecUsageDoesNotDelta();
await testCodexUsageClampsEachLargeTurnField();
await testCodexContextEstimateDoesNotPinToWindow();
await testCodexUsageIncludesDescendantThreadDelta();
await testCodexThreadStateReaderMatchesPrompt();
await testCodexContextSnapshotReadsRolloutTokenCount();
await testCodexContextSnapshotReadsOnlyBoundedTail();
await testCodexDescendantUsageReadsRecursiveRolloutTotals();
await testCodexExecRootLookupSkipsSubagentsAndForeignExecs();
await testCodexTurnCompletedRollsUpDescendantsWithoutKnownThreadId();
await testCodexTurnFailedBooksUsageFromThreadState();
await testCodexSubagentDetailStripsInheritedHistory();
await testPiResumesTurnAfterThresholdCompaction();
await testPiDoesNotResumeWhenPiWillRetry();
await testPiProgressCancelsScheduledCompactionResume();
await testPiManualCompactWithoutTurnDoesNotResume();
await testPiResumesAfterPostTurnThresholdCompaction();
await testPiCompactionBudgetRefillsOnlyAfterCleanStop();
await testPiFailedCompactionDoesNotResume();
await testPiRunEndsAtAgentSettledAndBooksAllRounds();
await testPiProviderErrorIsSurfaced();
await testPiRecoveredOrAbortedRunStaysQuiet();
await testPiNoContinueAfterCleanStop();
await testPiRejectedPromptIsRequeued();
await testPiRunIsJournalledUntilItSettles();
await testClaudeTurnIsJournalledForResume();
await testClaudeStaleTaskNotificationKeepsTurnJournalled();
await testClaudeBooksEveryResultOfATurn();
await testCodexContextFallbackUsesThreadState();
await testCodexContextFallbackCapsThreadStateAtWindow();
await testCodexCompactEventRetainsCompactedContext();
await testCodexImplicitCompactDetectedFromContextDrop();
await testCodexImplicitCompactDetectedFromMidWindowReset();
testProviderCapabilities();
testClaudeCurrentModelCatalog();
testClaudeContextWindowVariants();
testCodexFastTierArgs();
testSolUsesSingleAgentPolicyUnlessParallelismIsExplicit();
testNativeCodexResumeDoesNotRepeatStaticBootstrap();
testCodexSharedRegistryDoesNotRepeatLongDescriptions();
testSessionStyleContextIsSentOnlyWhenItChanges();
await testCodexModelsCacheChangeInvalidatesDiscovery();
await testCodexReasoningUiListsExposeFullEffortRange();
testConfiguredModelAllowList();
testModelProviderZaiCredentialAliases();
testPiSessionModelSelection();
testPiProviderConfigDoesNotPersistSecrets();
testPiModelsCarryContextWindow();
testPiUsesOnlyEnabledUserProviderModels();
testPiMergesModelSources();
testPiUsesNativeMistralProvider();
testAttachmentNormalization();
testDangerModeProvidesAutonomousExecutionContract();
await testExplicitWorkspaceImagesBecomePathFreePendingMedia();
await testCodexImageGenerationEventQueuesOnlyManagedOutput();
testModelsCacheParsing();
testSettingsThemeSchemaAcceptsEink();
testVibeProviderIsRegistered();
testSessionSchemasAcceptVibe();
testAcpRestartRecoveryContract();
testPerTurnModeChangesDoNotRestartActiveChildren();
testClaudeApiEnvironmentMapping();
testClaudeAndZaiProcessEnvironmentsAreIsolated();
testClaudeAndZaiProcessEnvironmentsAreIsolated();
testDeviceAppearanceSettingsAreNotAccountPersisted();
testMemoryDirectoryRejectsWorkingDirectoriesOutsideAllowedBases();
testSessionCookiePolicyBlocksCrossSiteMutationByDefault();
testCommandFileRootsStayInsideAllowedBasePaths();
testSessionIconGenerationUsesProviderIndependentCodexImagegenCommand();
testSessionIconPromptIsPlainImagePrompt();
await testGoalCommandForwardingIsSilent();
await testGeneratedSessionIconImageReadsOneShotOutput();
testLegacySessionIconMessageIsNotUsedForGeneratedIcons();
await testProjectIconCandidateFindsMonorepoDesktopIcon();
testZaiUsageTrackerQuotaShape();
await testProxyUserAdoptsLegacySharedCliUser();
testCodexSessionIdExtraction();
testDisconnectedSessionStaysRunning();
testCodexQueueModeIsFifoAndSteeringPreservesAcceptedTurns();
await testAcpQueueDrainsEveryWaitingFollowup();
testMemoryOptimizerUsesConfigHomeAndStrictManagedPlaceholders();
await testLatestContextSnapshotOrdering();
await testCodexConfigSyncIdempotence();
await testDefaultMcpServerSeeding();
await testClaudeSettingsProviderIsolation();
await testClaudeResumeTranscriptProviderIsolation();
await testGodotAndBlenderMcpToolLists();
await testOracleMcpPrefersEmbeddedBrowserTarget();
await testOracleMcpStartsEmbeddedBrowserForManualMode();
await testPwaInstallAssets();
testCodexCliUpdaterTracksLatest();
testClaudeCliUpdaterPromotesAndExecutesNativeBinary();
testPiUpdaterIncludesHarnessAndMcpBridge();
testPricingTable();

assert.equal(
  Object.hasOwn(CLI_PROVIDERS, 'kimi'),
  false,
  'retired Kimi Code must not be spawnable'
);
assert.equal(
  createSessionSchema.safeParse({ name: 'retired', workingDirectory: '/tmp', cliProvider: 'kimi' })
    .success,
  false
);
assert.equal(updateProviderSchema.safeParse({ cliProvider: 'kimi' }).success, false);

await dropTestSchema();

console.log('provider regression tests passed');
process.exit(0);
