import type { CLIProvider } from './session.js';

export type AssistantResourceKind =
  | 'profile'
  | 'task'
  | 'project'
  | 'source'
  | 'memory'
  | 'artifact'
  | 'routine'
  | 'collection'
  | 'meeting'
  | 'course'
  | 'connection'
  | 'event-subscription'
  | 'api-chat';

export interface AssistantApiTurn {
  contextReceipt?: import('./chatContextReceipts.js').ChatContextReceipt;
  compaction?: import('./chatCompaction.js').ChatCompaction;
  id: string;
  seq: number;
  prompt: string;
  response: string;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
  error: string | null;
  createdAt: string;
  model: string;
  providerId?: string;
  profileId: string | null;
  profileRevision: number | null;
  sourceVersions: Array<{ id: string; revision: number }>;
  imageAssetIds?: string[];
  documentSourceIds?: string[];
  sources?: Array<{
    id: string;
    revision: number;
    title: string;
    text: string;
    citation: string;
    page: number | null;
    excerptStart: number;
    retrieval?: string;
  }>;
  toolEvents?: Array<{
    id: string;
    name: string;
    status: 'running' | 'waiting' | 'completed' | 'failed';
    arguments?: string;
    result?: string;
    files?: Array<{
      id: string;
      filename: string;
      mimeType: string;
      byteLength: number;
      sha256: string;
      artifactId: string | null;
    }>;
  }>;
  comparisons?: Array<{
    providerId: string;
    model: string;
    response: string;
    status: 'running' | 'completed' | 'failed';
    error?: string;
  }>;
  /**
   * Web sources of this turn (web_search/web_fetch), numbered turn-wide: the
   * same URL keeps its `ref`. Updated while the turn streams; the answer cites
   * them inline as `[ref](url)`.
   */
  webSources?: Array<{
    ref: number;
    url: string;
    title: string;
    /** Hostname without a leading "www.". */
    domain: string;
    /** Plain text, at most 300 characters. */
    excerpt: string;
    publishedAt: string | null;
    /** Page text was fetched (auto-read or web_fetch). */
    read: boolean;
  }>;
  /** All versions of this turn (regenerated or edited in place), oldest first. */
  versions?: string[];
  /** Validated interactive view the model attached to this answer (Dynamic UI v1). */
  ui?: import('../utils/dynamicUi.js').DynamicUiSpec | null;
  /** Why an attached view was rejected; the text answer is shown instead. */
  uiError?: string | null;
  /** The answer is still streaming its interactive view. */
  uiPending?: boolean;
  usage: {
    input: number;
    output: number;
    cached: number;
    cacheWrite: number;
    costUsd: number | null;
  } | null;
}
export type AssistantWebSource = NonNullable<AssistantApiTurn['webSources']>[number];

export interface AssistantApiProvider {
  id: string;
  name: string;
  protocol: 'openai' | 'anthropic' | 'gemini';
  models: string[];
}
export interface AssistantDocumentAccess {
  resource: AssistantResource;
  role: 'owner' | 'editor' | 'viewer';
  ownerId: string;
  ownerEmail: string;
}
export interface AssistantDocumentMember {
  userId: string;
  email: string;
  role: 'editor' | 'viewer';
  grantedRevision: number;
}
export interface AssistantApiImage {
  id: string;
  filename: string;
  mimeType: string;
  byteLength: number;
}
export interface AssistantArtifactImage {
  url: string;
  assetId: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
}
export interface AssistantApiUsage {
  calls: number;
  running: number;
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
  knownCostUsd: number;
  unpriced: number;
  missingUsage: number;
  byModel: Array<{
    providerId: string;
    model: string;
    calls: number;
    tokens: number;
    knownCostUsd: number;
    unpriced: number;
  }>;
}

export interface AssistantResource<T extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  kind: AssistantResourceKind;
  revision: number;
  title: string;
  body: T;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantProfileBody extends Record<string, unknown> {
  instructions: string;
  provider: CLIProvider;
  model?: string | null;
  language: string;
  voice: string;
  memory: 'off' | 'read' | 'read-write';
  projectId?: string;
}

export type AssistantTaskStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export interface AssistantTaskBody extends Record<string, unknown> {
  goal: string;
  status: AssistantTaskStatus;
  provider: CLIProvider;
  sessionId?: string;
  originSessionId?: string;
  parentId?: string;
  agentId?: string;
  priority: number;
  budgetUsd?: number;
  dueAt?: string;
  result?: string;
}

export interface AssistantAgent {
  id: string;
  name: string;
  source: 'cli' | 'matrix';
  provider?: CLIProvider;
  available: boolean;
  capabilities: string[];
  state?: string;
  nativeId?: string;
  nativeRoomId?: string;
  mode?: 'native' | 'worker' | 'notify' | 'unknown';
  model?: string;
  trust?: string;
  retired?: boolean;
  schemaVersion?: number;
}

export interface AssistantOverview {
  counts: Record<string, number>;
  tasks: AssistantResource<AssistantTaskBody>[];
  recent: AssistantResource[];
  agents: AssistantAgent[];
}

export interface AssistantTaskLimits {
  budgetUsd: number | null;
  knownCostUsd: number | null;
  unpricedTurns: number;
  exhausted: boolean;
  deadline: string | null;
  deadlineExpired: boolean;
  scope: 'api-equivalent-completed-turns' | 'native-coordinator';
}
export interface AssistantLibraryHit {
  id: string;
  entryType: 'resource' | 'session' | 'cli-message' | 'api-turn';
  kind: string;
  title: string;
  category: 'library' | 'chats' | 'code';
  revision: number | null;
  updatedAt: string;
  excerpt: string;
  href: string;
}

/** Where an agent belongs in the Schwarm tab. */
export type SwarmAgentGroup = 'swarm' | 'watch' | 'plum' | 'service';
/**
 * What the directory knows about an agent right now. `idle` means ready but
 * not connected all the time (notify agents, CLI providers); `stopped` means
 * its container exists but is not running.
 */
export type SwarmAgentHealth = 'online' | 'idle' | 'offline' | 'stopped' | 'unknown';

export interface SwarmContainerState {
  name: string;
  host?: string;
  hostLabel?: string;
  ownerSessionId?: string;
  ownerSessionName?: string;
  /** Explicitly permitted lifecycle operations; an empty list means read-only. */
  actions?: Array<'start' | 'stop' | 'restart'>;
  state: string;
  status: string;
  running: boolean;
  health: string;
}

export interface SwarmDirectoryAgent {
  id: string;
  name: string;
  group: SwarmAgentGroup;
  kind: 'hub' | 'cli' | 'custom' | 'subagent' | 'service';
  description?: string;
  mode?: string;
  level?: string;
  trust?: string;
  runtime?: string;
  model?: string;
  skills: string[];
  accepts: string[];
  parallel?: number;
  budgetUsdDay?: number;
  spentTodayUsd?: number;
  /** Hub room alias without '#' and server, e.g. `ag-brian`, and its id when the hub reported it. */
  room?: { alias: string; id?: string };
  health: SwarmAgentHealth;
  healthReason: string;
  /** Worker connection reported by the hub; only for `mode: worker`. */
  worker?: 'connected' | 'offline';
  /** Agent card status from the lobby, when the Matrix account is connected. */
  cardStatus?: string;
  /** Runs outside this server (the phone), so there is no container to show. */
  offBox?: boolean;
  puppets?: string[];
  containers: SwarmContainerState[];
  /** Last log line of a worker whose container runs but does not connect. */
  lastLog?: string;
}

export interface SwarmHubState {
  reachable: boolean;
  ok: boolean;
  frozen: boolean;
  problems: string[];
  openTasks: number;
  approvalsPending: number;
  outboxDead: number;
  costTodayUsd: number;
  failures: Array<{ task: string; state: string; reason: string; at: string }>;
  container?: SwarmContainerState;
  error?: string;
}

export interface SwarmDirectory {
  hub: SwarmHubState;
  agents: SwarmDirectoryAgent[];
  matrixConnected: boolean;
  /** Container details and actions need an admin account. */
  containersVisible: boolean;
  containerErrors?: string[];
  checkedAt: string;
}
