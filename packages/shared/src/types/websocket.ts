import type { Message, StreamingMessage } from './message.js';
import type { SessionPresenceSnapshot, SessionSendAck } from './chat-delivery.js';
import type { SessionStatus, SubagentRunStatus, UsageSnapshot } from './session.js';

// Session permission mode
export type SessionMode = 'planning' | 'auto-accept' | 'manual' | 'danger';

// File attachment data for sending to Claude (images, text, pdf, etc.)
export interface FileAttachmentData {
  data: string; // base64 encoded
  mimeType: string;
  filename?: string; // original filename for non-image files
}

// Alias for backwards compatibility
export type ImageAttachmentData = FileAttachmentData;

// Buffered message for reconnection replay
export interface BufferedMessage {
  type:
    | 'output'
    | 'message'
    | 'thinking'
    | 'tool_use'
    | 'usage'
    | 'todos'
    | 'agent'
    | 'image'
    | 'compact'
    | 'question'
    | 'permission_request'
    | 'status'
    | 'mode';
  data: unknown;
  timestamp: number;
  /** Persistent, monotone sequence scoped to the WebUI session. */
  sequence?: number;
}

export interface SessionQueueItem {
  id: string;
  preview: string;
  createdAt: string;
  attachments?: number;
}

export interface SessionQueueData {
  sessionId: string;
  provider: string;
  depth: number;
  items: SessionQueueItem[];
  busy?: boolean;
  preempting?: boolean;
}

export type ActiveFollowupMode = 'queue' | 'steer';

export interface SessionSendPayload {
  sessionId: string;
  /** Explicit target thread. Legacy clients may omit it to use the active thread. */
  chatId?: string | null;
  message: string;
  images?: ImageAttachmentData[];
  activeFollowupMode?: ActiveFollowupMode;
  clientMessageId?: string;
  uploadIds?: string[];
}

export interface ToolActionSummary {
  title: string;
  explanation: string;
  source: 'template' | 'fallback' | 'agent-pending' | 'agent';
  generatedAt: number;
}

// Permission response action type
export type PermissionAction = 'allow_once' | 'allow_project' | 'allow_global' | 'deny';

// Client to Server Events
export interface ClientToServerEvents {
  'session:send': (
    data: SessionSendPayload,
    acknowledge?: (result: SessionSendAck) => void
  ) => void;
  'session:input': (data: { sessionId: string; input: string }) => void;
  'session:subscribe': (sessionId: string) => void;
  'session:subscribe-all': (acknowledge?: (result: { sessionIds: string[] }) => void) => void;
  'session:unsubscribe': (sessionId: string) => void;
  'session:interrupt': (sessionId: string) => void;
  'session:restart': (sessionId: string) => void;
  'session:reconnect': (data: {
    sessionId: string;
    lastTimestamp?: number;
    lastSequence?: number;
  }) => void;
  'session:presence': (data: {
    sessionId: string;
    deviceId: string;
    label?: string;
    state: 'active' | 'idle' | 'leave';
    lastReadMessageId?: string | null;
  }) => void;
  'session:set-mode': (data: { sessionId: string; mode: SessionMode }) => void;
  // Legacy permission events (for simple approve/deny flow)
  'session:approve_permission': (data: {
    sessionId: string;
    toolNames: string[]; // Tools to allow
    originalMessage: string; // The message to resend
  }) => void;
  'session:deny_permission': (data: { sessionId: string }) => void;
  // New hooks-based permission event (for finer control)
  'session:permission_respond': (data: {
    sessionId: string;
    requestId: string;
    action: PermissionAction;
    pattern?: string;
  }) => void;
}

// Usage data from Claude CLI
export type UsageData = UsageSnapshot;

// Todo item from Claude's TodoWrite tool
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Tool execution record for display
export interface ToolExecution {
  toolId: string;
  toolName: string;
  status: 'started' | 'completed' | 'error';
  input?: unknown;
  result?: string;
  error?: string;
  actionSummary?: ToolActionSummary;
  timestamp: number;
  completedAt?: number;
}

// Pending permission request from Claude (hooks-based)
export interface PendingPermission {
  sessionId: string;
  requestId: string;
  providerSessionId?: string;
  toolName: string;
  toolInput: unknown;
  description: string;
  suggestedPattern: string;
  eventSequence?: number;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface PendingQuestionItem {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface PendingQuestion {
  sessionId: string;
  requestId: string;
  providerSessionId?: string;
  questions: PendingQuestionItem[];
  eventSequence?: number;
}

// Generated image data
export interface GeneratedImageData {
  sessionId: string;
  imagePath: string;
  imageBase64?: string;
  mimeType: string;
  prompt: string;
  generator: 'opencode' | 'other';
}

// Permission denial data (when Claude tries to use a tool without permission)
export interface PermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}

// Permission request event data (legacy flow)
export interface PermissionRequestData {
  sessionId: string;
  denials: PermissionDenial[];
  originalMessage: string; // The message that triggered the permission request
  eventSequence?: number;
}

// Server to Client Events
/** Why a lifecycle beat was sent. Advisory: the state fields are the truth. */
export type SessionLifecycleReason =
  | 'busy'
  | 'idle'
  | 'error'
  | 'approval'
  | 'question'
  | 'turn_complete';

/** The smallest description of a session that is still worth acting on. */
export interface SessionLifecycleEvent {
  sessionId: string;
  reason: SessionLifecycleReason;
  status: SessionStatus;
  busy: boolean;
  queueDepth: number;
  pendingApprovals: number;
  /** Questions the agent is blocked on — a different block, same urgency. */
  pendingQuestions: number;
  activitySummary: string | null;
  lastActivityAt: string | null;
  at: string;
}

export interface ServerToClientEvents {
  'session:chats': (data: {
    sessionId: string;
    chats: Array<{ id: string; title: string; createdAt: string | null; updatedAt: string | null }>;
    activeChatId: string | null;
  }) => void;
  /**
   * Account-wide notification-centre entry. Unlike `session:*` events this is
   * emitted to the `user:<id>` room, so it arrives regardless of which session
   * the client currently has open.
   */
  'notification:new': (data: {
    id: string;
    sessionId: string | null;
    kind: string;
    title: string;
    body: string | null;
    createdAt: string;
  }) => void;
  'session:output': (data: StreamingMessage) => void;
  'session:message': (data: Message) => void;
  'session:status': (data: { sessionId: string; status: SessionStatus }) => void;
  /**
   * One compact "something changed" beat per session, fanned out to
   * `user:<userId>` rather than to a session room. A client that supervises
   * many sessions can follow all of them without joining every room, and a
   * client that missed events while asleep learns the current state rather
   * than replaying a stream it cannot catch up on.
   */
  'session:lifecycle': (data: SessionLifecycleEvent) => void;
  'session:error': (data: { sessionId: string; error: string }) => void;
  'session:tool_use': (data: {
    sessionId: string;
    toolName: string;
    status: 'started' | 'completed' | 'error';
    toolId?: string;
    input?: unknown;
    result?: string;
    error?: string;
    actionSummary?: ToolActionSummary;
    /**
     * Backend-clock timestamp at the moment of emission. Frontend should
     * prefer this over its own Date.now() so the chat timeline orders tools
     * against assistant messages (which are also stamped with the backend
     * clock) regardless of browser/server clock skew.
     */
    timestamp?: number;
    eventSequence?: number;
  }) => void;
  'session:agent': (data: {
    sessionId: string;
    agentId?: string;
    agentType: string;
    description?: string;
    status: SubagentRunStatus;
    startedAt?: number;
    completedAt?: number;
    result?: string;
    error?: string;
    toolId?: string;
    externalAgentId?: string;
    timestamp?: number;
    eventSequence?: number;
  }) => void;
  'session:thinking': (data: { sessionId: string; isThinking: boolean; message?: string }) => void;
  'session:todos': (data: { sessionId: string; todos: TodoItem[]; eventSequence?: number }) => void;
  'session:usage': (data: UsageData) => void;
  'session:image': (data: GeneratedImageData) => void;
  'session:reconnected': (data: {
    sessionId: string;
    bufferedMessages: BufferedMessage[];
    isRunning: boolean;
    /** A real turn/tool/subagent is active, unlike an idle persistent process. */
    isBusy?: boolean;
    /** Authoritative thread after reconnect; null is the implicit main chat. */
    activeChatId?: string | null;
    /** Full current response at this packet's position in the socket stream. */
    streamingSnapshot?: StreamingMessage | null;
    /** True when buffer rolled over since lastTimestamp — client should full-resync from REST. */
    needsFullResync?: boolean;
    /**
     * Latest completely replayed cursor. Omitted when needsFullResync is true;
     * the client must apply a REST snapshot before advancing its cursor.
     */
    highWatermark?: number;
    /** Message snapshot revision used to reject stale REST results. */
    snapshotRevision?: number;
  }) => void;
  'session:cursor': (data: { sessionId: string; sequence: number; timestamp: number }) => void;
  'session:presence': (data: SessionPresenceSnapshot) => void;
  'session:compact': (data: {
    id?: string;
    sessionId: string;
    message: string;
    summary?: string;
    clear?: boolean;
    reason?: 'auto-compact' | 'provider-switch' | 'context-limit' | 'settings-deferred';
    error?: string;
    createdAt?: string;
    eventSequence?: number;
  }) => void;
  'session:mode': (data: { sessionId: string; mode: SessionMode; eventSequence?: number }) => void;
  'session:queue': (data: SessionQueueData) => void;
  'session:question_request': (data: PendingQuestion) => void;
  // Legacy permission request (simple denials flow)
  'session:permission_request': (data: PermissionRequestData | PendingPermission) => void;
  error: (message: string) => void;
}

// Inter-server Events (for scaling)
export interface InterServerEvents {
  ping: () => void;
}

// Socket Data
export interface SocketData {
  userId: string;
  subscribedSessions: Set<string>;
}
