export type SessionStatus = 'running' | 'stopped' | 'error';
export type SessionSurface = 'code' | 'task';

export type CLIProvider = 'claude' | 'zai' | 'codex' | 'opencode' | 'pi' | 'kimi';
export type CodexServiceTier = 'fast';
export type SessionIconSource = 'upload' | 'project' | 'generated';

export type SubagentRunStatus = 'started' | 'completed' | 'error';

export interface UsageSnapshot {
  sessionId: string;
  // Token usage
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  // Context window
  contextWindow: number;
  contextUsedPercent: number;
  contextUsedPercentRaw?: number;
  contextExceeded?: boolean;
  // Cost
  totalCostUsd: number;
  // Model info
  model: string;
  // Snapshot timestamp. Used to avoid stale socket usage overriding newer API telemetry.
  recordedAt?: string;
}

export interface SubagentRun {
  id: string;
  agentType: string;
  description?: string;
  status: SubagentRunStatus;
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  toolId?: string;
  externalAgentId?: string;
  provider?: CLIProvider;
  /** Detached run (Agent tool default): outlives the turn, must not hold busy. */
  background?: boolean;
}

export interface SessionTelemetry {
  usage: UsageSnapshot | null;
  contextSnapshots: number;
  compactEvents: number;
}

export interface SessionRuntime {
  running: boolean;
  provider: CLIProvider | null;
  mode: string | null;
  model: string | null;
  workingDirectory: string | null;
  claudeSessionId: string | null;
  busy: boolean;
  streaming: boolean;
  currentToolName: string | null;
  currentAgentType: string | null;
  currentAgentDescription: string | null;
  subagents: SubagentRun[];
  activitySummary: string | null;
  queueDepth: number;
  queueItems: Array<{
    id: string;
    preview: string;
    createdAt: string;
    attachments?: number;
  }>;
  lastActivityAt: string | null;
  disconnectedAt: string | null;
}

export interface Session {
  id: string;
  userId: string;
  name: string;
  workingDirectory: string;
  claudeSessionId: string | null;
  status: SessionStatus;
  lastMessage: string | null;
  projectDescription?: string | null;
  lastActivity?: string | null;
  unreadCount?: number;
  iconUrl: string | null;
  iconSource: SessionIconSource | null;
  starred: boolean;
  cliProvider: CLIProvider;
  cliModel: string | null;
  cliReasoning: string | null;
  cliServiceTier: CodexServiceTier | null;
  /** Model forced onto this session's subagents (CLAUDE_CODE_SUBAGENT_MODEL); null = agent definitions decide. */
  subagentModel?: string | null;
  category: string | null;
  mode: string | null;
  surface: SessionSurface;
  designStyleSkill: string | null;
  writingStyleSkill: string | null;
  androidDeviceSerial: string | null;
  homeAssistantEntityId: string | null;
  runtime?: SessionRuntime;
  telemetry?: SessionTelemetry;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  name: string;
  workingDirectory?: string;
  cliProvider?: CLIProvider;
  cliModel?: string | null;
  cliReasoning?: string | null;
  cliServiceTier?: CodexServiceTier | null;
  mode?: string;
  surface?: SessionSurface;
  initialMessage?: string;
}

export interface UpdateSessionInput {
  name?: string;
  workingDirectory?: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
}

export interface CreateCategoryInput {
  name: string;
  color?: string;
  icon?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  color?: string;
  icon?: string;
  sort_order?: number;
}
