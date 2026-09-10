import { create } from 'zustand';
import type {
  Session,
  Message,
  SessionStatus,
  UsageData,
  ToolExecution,
  PermissionDenial,
  PendingPermission,
  PendingQuestion,
  SessionQueueData,
  SubagentRun,
  SubagentRunStatus,
  SessionLifecycleEvent,
} from '@plum-code-webui/shared';

// --- Streaming content buffer ---
// Accumulates CLI deltas and flushes to Zustand at a bounded cadence. Rendering
// the whole streaming markdown tree on every browser frame is expensive enough
// to drag the chat below 60fps on long answers, so text updates are capped while
// the browser still gets free animation frames between React commits.
const STREAMING_FLUSH_INTERVAL_MS = 50;
// Most recent generated images kept per session (base64 payloads are heavy).
const MAX_GENERATED_IMAGES_PER_SESSION = 24;
// Ceiling for one session's un-flushed deltas. A backgrounded tab keeps
// receiving socket events while its timers are clamped to about one per second,
// so this is what stops a long answer from arriving as a single multi-megabyte
// setState on return.
const MAX_STREAMING_BUFFER_CHARS = 64 * 1024;
// Tool entries retained per session. They hold the tool's full input and result
// strings, so an agent-heavy turn with hundreds of calls is real memory — and
// every lookup below walks the list. Same reasoning as the agentRuns and
// generatedImages caps; only the tool log was left unbounded.
const MAX_TOOL_EXECUTIONS_PER_SESSION = 200;
// How many sessions keep their page-local slices after the user navigates away.
// Enough to cover the usual back-and-forth between a couple of sessions; past
// that, the tool log, the base64 images and the open editor buffers of a session
// nobody is looking at are just resident memory.
const MAX_HYDRATED_SESSIONS = 3;
const streamingBuffer: Record<string, string> = {};
/**
 * Most-recently-left sessions, newest first.
 *
 * Module-level rather than store state on purpose: eviction order is bookkeeping
 * nothing renders, and putting it in the store would re-render every subscriber
 * on each navigation.
 */
const recentlyLeftSessions: string[] = [];

let rafId: number | null = null;
let flushTimerId: number | null = null;
let lastStreamingFlushAt = 0;

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function tabIsHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Drop any pending frame/timer callback so a caller can flush right now. */
function cancelScheduledFlush() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (flushTimerId !== null) {
    window.clearTimeout(flushTimerId);
    flushTimerId = null;
  }
}

function scheduleStreamingFlush() {
  if (rafId !== null || flushTimerId !== null) return;

  const elapsed = nowMs() - lastStreamingFlushAt;
  const delay = Math.max(0, STREAMING_FLUSH_INTERVAL_MS - elapsed);

  flushTimerId = window.setTimeout(() => {
    flushTimerId = null;
    // requestAnimationFrame does not fire while the tab is hidden. Waiting for
    // a frame that never comes left `rafId` set for good, and every further
    // delta then piled up in the module buffer until the user came back — the
    // one big commit this whole throttle exists to avoid. Nothing is being
    // painted anyway, so commit straight to the store instead.
    if (tabIsHidden()) {
      flushStreamingBuffer();
      return;
    }
    rafId = requestAnimationFrame(flushStreamingBuffer);
  }, delay);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!tabIsHidden()) return;
    // A frame callback queued while the tab was still visible will not run once
    // it is hidden, so take it over here.
    cancelScheduledFlush();
    flushStreamingBuffer();
  });
}

function flushStreamingBuffer() {
  rafId = null;
  lastStreamingFlushAt = nowMs();
  const entries = Object.entries(streamingBuffer);
  if (entries.length === 0) return;

  // Drain the buffer
  const toFlush: Record<string, string> = {};
  for (const [sid, chunk] of entries) {
    toFlush[sid] = chunk;
    delete streamingBuffer[sid];
  }

  // Single Zustand update for all sessions
  useSessionStore.setState((state) => {
    const newContent = { ...state.streamingContent };
    for (const [sid, chunk] of Object.entries(toFlush)) {
      newContent[sid] = (newContent[sid] || '') + chunk;
    }
    // `lastMessageTimestamp` deliberately stays put here. It is handed back to
    // the server as a replay watermark and compared against server-stamped
    // buffer entries, so only server-produced times may ever land in it — a
    // browser clock running a few seconds fast would silently cut messages out
    // of the replay. Leaving it behind a live stream only costs a re-replay
    // that `addMessageIfNotExists` deduplicates.
    return { streamingContent: newContent };
  });
}

function bufferStreamingContent(sessionId: string, content: string) {
  const next = (streamingBuffer[sessionId] || '') + content;
  streamingBuffer[sessionId] = next;
  // Backstop for the case where even the clamped background timer is not
  // running (heavily throttled or frozen tab): commit early rather than let one
  // session's buffer grow without a ceiling.
  if (next.length >= MAX_STREAMING_BUFFER_CHARS) {
    cancelScheduledFlush();
    flushStreamingBuffer();
    return;
  }
  scheduleStreamingFlush();
}

function dropPendingStreamingChunks(sessionId: string) {
  delete streamingBuffer[sessionId];
}

/**
 * Move a session's replay watermark forward using the message's own server time.
 *
 * The value goes back to the server on reconnect and is compared there against
 * server-stamped buffer entries, so it has to come from the server's clock. A
 * `Date.now()` taken at receipt looks close enough but is the browser's clock,
 * and a browser running ahead makes the server skip messages that were never
 * delivered. Never moves backwards, so an out-of-order arrival cannot widen the
 * replay window again.
 */
function advanceMessageWatermark(
  current: Record<string, number>,
  sessionId: string,
  message: Message
): Record<string, number> {
  const createdAt = Date.parse(message.createdAt);
  if (!Number.isFinite(createdAt)) return current;
  const previous = current[sessionId];
  if (previous !== undefined && previous >= createdAt) return current;
  return { ...current, [sessionId]: createdAt };
}

/**
 * Locate a tool entry by id, newest first.
 *
 * Completion and result events almost always target the call that just started,
 * so scanning backwards finds it in the first step or two instead of walking
 * the whole turn's history.
 */
function findToolIndex(list: ToolExecution[], toolId: string): number {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.toolId === toolId) return i;
  }
  return -1;
}

function sortAgentRuns(runs: SubagentRun[]): SubagentRun[] {
  return [...runs].sort((a, b) => {
    if (a.status === 'started' && b.status !== 'started') return -1;
    if (a.status !== 'started' && b.status === 'started') return 1;
    return (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt);
  });
}

function mergeAgentRuns(existing: SubagentRun[], incoming: SubagentRun[]): SubagentRun[] {
  const byId = new Map<string, SubagentRun>();
  for (const run of existing) {
    byId.set(run.id, run);
  }
  for (const run of incoming) {
    const prior = byId.get(run.id);
    byId.set(run.id, {
      ...prior,
      ...run,
      startedAt: prior?.startedAt ?? run.startedAt,
      description: run.description || prior?.description,
      result: run.result || prior?.result,
      error: run.error || prior?.error,
      toolId: run.toolId || prior?.toolId,
      externalAgentId: run.externalAgentId || prior?.externalAgentId,
    });
  }
  const sorted = sortAgentRuns(Array.from(byId.values()));
  const active = sorted.filter((run) => run.status === 'started');
  const recent = sorted.filter((run) => run.status !== 'started').slice(0, 30);
  return [...active, ...recent];
}

function getActiveAgentFromRuns(runs: SubagentRun[]): AgentState | null {
  const active = sortAgentRuns(runs).find((run) => run.status === 'started');
  return active
    ? {
        agentType: active.agentType,
        description: active.description,
        status: active.status,
        startedAt: active.startedAt,
      }
    : null;
}

// Activity state for showing what Claude is doing
export interface ActivityState {
  type: 'idle' | 'thinking' | 'tool';
  toolName?: string;
  toolStatus?: 'started' | 'completed' | 'error';
  message?: string;
  startedAt?: number;
  messageStartedAt?: number;
}

// Active agent state
export interface AgentState {
  agentType: string;
  description?: string;
  status: SubagentRunStatus;
  startedAt?: number;
}

export type { SubagentRun };

export interface AgentEvent {
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
}

// Todo item from Claude's TodoWrite tool
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Generated image
export interface GeneratedImage {
  imageBase64?: string;
  mimeType: string;
  prompt: string;
  generator: 'opencode' | 'other';
  timestamp: number;
}

// Open file in code editor
export interface OpenFile {
  path: string;
  content: string;
  isDirty: boolean;
  originalContent: string;
}

// Permission request (legacy flow with denials)
export interface PermissionRequest {
  denials: PermissionDenial[];
  originalMessage: string;
}

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Record<string, Message[]>;
  streamingContent: Record<string, string>;
  thinking: Record<string, boolean>;
  activity: Record<string, ActivityState>;
  /**
   * The last `session:lifecycle` beat per session.
   *
   * Account-wide, so it is present for sessions the user is not looking at —
   * which is exactly the case the sidebar could not previously report, because
   * `session.runtime` is only as fresh as the last list fetch.
   */
  lifecycle: Record<string, SessionLifecycleEvent>;
  /**
   * Approvals blocking each session, seeded account-wide on connect.
   *
   * A lifecycle beat only fires on a state change, so a session that was
   * already waiting when the tab opened would otherwise read as idle until it
   * happened to change again.
   */
  pendingApprovalCounts: Record<string, number>;
  activeAgent: Record<string, AgentState | null>;
  agentRuns: Record<string, SubagentRun[]>;
  todos: Record<string, TodoItem[]>;
  usage: Record<string, UsageData>;
  generatedImages: Record<string, GeneratedImage[]>;
  toolExecutions: Record<string, ToolExecution[]>;
  queueState: Record<string, SessionQueueData | null>;

  // Permission request state (legacy)
  permissionRequests: Record<string, PermissionRequest | null>;

  // Pending permissions state (hooks-based)
  pendingPermissions: Record<string, PendingPermission | null>;

  // Pending OpenCode questions
  pendingQuestions: Record<string, PendingQuestion | null>;

  // File Tree state
  fileTreeOpen: Record<string, boolean>;
  selectedFile: Record<string, string | null>;

  // Code Editor state
  openFiles: Record<string, OpenFile[]>;
  activeFileTab: Record<string, string | null>;

  // Track last received message timestamp per session for reconnection
  lastMessageTimestamp: Record<string, number>;

  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  removeSession: (id: string) => void;
  pruneSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;

  setMessages: (sessionId: string, messages: Message[]) => void;
  addMessage: (sessionId: string, message: Message) => void;
  addMessageIfNotExists: (sessionId: string, message: Message) => void;

  appendStreamingContent: (sessionId: string, content: string) => void;
  replaceStreamingContent: (sessionId: string, content: string) => void;
  clearStreamingContent: (sessionId: string) => void;

  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  setThinking: (sessionId: string, isThinking: boolean) => void;
  setActivity: (sessionId: string, activity: ActivityState) => void;
  setLifecycle: (event: SessionLifecycleEvent) => void;
  setPendingApprovalCounts: (counts: Record<string, number>) => void;
  setActiveAgent: (sessionId: string, agent: AgentState | null) => void;
  recordAgentEvent: (sessionId: string, event: AgentEvent) => void;
  setAgentRuns: (sessionId: string, runs: SubagentRun[]) => void;
  setTodos: (sessionId: string, todos: TodoItem[]) => void;
  setUsage: (sessionId: string, usage: UsageData) => void;
  addGeneratedImage: (sessionId: string, image: Omit<GeneratedImage, 'timestamp'>) => void;
  addToolExecution: (sessionId: string, execution: ToolExecution) => void;
  updateToolExecution: (sessionId: string, toolId: string, update: Partial<ToolExecution>) => void;
  clearToolExecutions: (sessionId: string) => void;
  setQueueState: (sessionId: string, queue: SessionQueueData | null) => void;

  // Permission request actions (legacy)
  setPermissionRequest: (sessionId: string, request: PermissionRequest | null) => void;
  clearPermissionRequest: (sessionId: string) => void;

  // Pending permission actions (hooks-based)
  setPendingPermission: (sessionId: string, permission: PendingPermission | null) => void;

  setPendingQuestion: (sessionId: string, question: PendingQuestion | null) => void;

  // File Tree actions
  setFileTreeOpen: (sessionId: string, open: boolean) => void;
  setSelectedFile: (sessionId: string, path: string | null) => void;

  // Code Editor actions
  openFile: (sessionId: string, path: string, content: string) => void;
  closeFile: (sessionId: string, path: string) => void;
  updateFileContent: (sessionId: string, path: string, content: string) => void;
  markFileSaved: (sessionId: string, path: string) => void;
  setActiveTab: (sessionId: string, path: string) => void;

  // Timestamp tracking for reconnection
  updateLastMessageTimestamp: (sessionId: string, timestamp: number) => void;
  getLastMessageTimestamp: (sessionId: string) => number | undefined;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: {},
  streamingContent: {},
  thinking: {},
  activity: {},
  lifecycle: {},
  pendingApprovalCounts: {},
  activeAgent: {},
  agentRuns: {},
  todos: {},
  usage: {},
  generatedImages: {},
  toolExecutions: {},
  queueState: {},
  permissionRequests: {},
  pendingPermissions: {},
  pendingQuestions: {},
  fileTreeOpen: {},
  selectedFile: {},
  openFiles: {},
  activeFileTab: {},
  lastMessageTimestamp: {},

  setSessions: (sessions) =>
    set((state) => {
      const agentRuns = { ...state.agentRuns };
      const activeAgent = { ...state.activeAgent };
      for (const session of sessions) {
        if (!session.runtime?.subagents?.length) continue;
        const merged = mergeAgentRuns(agentRuns[session.id] || [], session.runtime.subagents);
        agentRuns[session.id] = merged;
        activeAgent[session.id] = getActiveAgentFromRuns(merged);
      }
      // The incoming list decides membership and order, but not the content of a
      // record we already hold a fresher copy of. This is called from a 30 s
      // fallback poll, and its snapshot can predate the commit behind a
      // `session:status` event we already applied — replacing wholesale then
      // reverted a running session to "idle" for up to half a minute, and undid
      // local renames the same way. Every server-side change to a session bumps
      // `updated_at`, so a snapshot that is not newer has nothing to teach us.
      const known = new Map(state.sessions.map((session) => [session.id, session]));
      const reconciled = sessions.map((incoming) => {
        const existing = known.get(incoming.id);
        if (!existing) return incoming;
        const existingAt = Date.parse(existing.updatedAt ?? '');
        const incomingAt = Date.parse(incoming.updatedAt ?? '');
        if (!Number.isFinite(existingAt) || !Number.isFinite(incomingAt)) return incoming;
        return incomingAt > existingAt ? incoming : existing;
      });
      return { sessions: reconciled, agentRuns, activeAgent };
    }),

  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions],
    })),

  updateSession: (id, updates) =>
    set((state) => {
      const nextState: Partial<SessionState> = {
        sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      };
      if (updates.runtime?.subagents?.length) {
        const merged = mergeAgentRuns(state.agentRuns[id] || [], updates.runtime.subagents);
        nextState.agentRuns = { ...state.agentRuns, [id]: merged };
        nextState.activeAgent = {
          ...state.activeAgent,
          [id]: getActiveAgentFromRuns(merged),
        };
      }
      return nextState;
    }),

  removeSession: (id) => {
    // Drop buffered (not yet flushed) streaming chunks so the flush cannot
    // recreate the deleted session's streamingContent entry.
    dropPendingStreamingChunks(id);
    // A deleted session must not go on occupying one of the LRU slots that keep
    // a live session's slices resident.
    const queued = recentlyLeftSessions.indexOf(id);
    if (queued !== -1) recentlyLeftSessions.splice(queued, 1);
    set((state) => {
      // Drop every per-session slice: messages, tool logs, base64 images and
      // open editor files of a deleted session otherwise stay resident until
      // a hard reload.
      const omit = <T>(record: Record<string, T>): Record<string, T> => {
        if (!(id in record)) return record;
        const { [id]: _removed, ...rest } = record;
        return rest;
      };
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
        messages: omit(state.messages),
        toolExecutions: omit(state.toolExecutions),
        streamingContent: omit(state.streamingContent),
        generatedImages: omit(state.generatedImages),
        agentRuns: omit(state.agentRuns),
        usage: omit(state.usage),
        todos: omit(state.todos),
        activity: omit(state.activity),
        lifecycle: omit(state.lifecycle),
        pendingApprovalCounts: omit(state.pendingApprovalCounts),
        queueState: omit(state.queueState),
        thinking: omit(state.thinking),
        activeAgent: omit(state.activeAgent),
        permissionRequests: omit(state.permissionRequests),
        pendingPermissions: omit(state.pendingPermissions),
        pendingQuestions: omit(state.pendingQuestions),
        fileTreeOpen: omit(state.fileTreeOpen),
        selectedFile: omit(state.selectedFile),
        openFiles: omit(state.openFiles),
        activeFileTab: omit(state.activeFileTab),
        lastMessageTimestamp: omit(state.lastMessageTimestamp),
      };
    });
  },

  pruneSession: (id) => {
    // Called when leaving a session, so `id` is now the most recently visited
    // one and whatever falls off the end of the list is what gets released.
    const existing = recentlyLeftSessions.indexOf(id);
    if (existing !== -1) recentlyLeftSessions.splice(existing, 1);
    recentlyLeftSessions.unshift(id);
    const evicted = recentlyLeftSessions.splice(MAX_HYDRATED_SESSIONS);
    if (evicted.length === 0) return;

    for (const sessionId of evicted) dropPendingStreamingChunks(sessionId);

    set((state) => {
      // Only the slices that are large and that the session page rebuilds for
      // itself. `messages` are refetched from the API on mount, but they are the
      // visible content and worth the round trip they would cost; `agentRuns`
      // and the pending permission/question prompts stay because the sidebar and
      // the approval flow read them for sessions nobody has open.
      const omit = <T>(record: Record<string, T>): Record<string, T> => {
        const present = evicted.filter((sessionId) => sessionId in record);
        if (present.length === 0) return record;
        const next = { ...record };
        for (const sessionId of present) delete next[sessionId];
        return next;
      };
      return {
        streamingContent: omit(state.streamingContent),
        toolExecutions: omit(state.toolExecutions),
        generatedImages: omit(state.generatedImages),
        openFiles: omit(state.openFiles),
        activeFileTab: omit(state.activeFileTab),
        thinking: omit(state.thinking),
      };
    });
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [sessionId]: messages },
    })),

  addMessage: (sessionId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: [...(state.messages[sessionId] || []), message],
      },
      lastMessageTimestamp: advanceMessageWatermark(state.lastMessageTimestamp, sessionId, message),
    })),

  // Add message only if it doesn't already exist (for deduplication during reconnection)
  addMessageIfNotExists: (sessionId, message) =>
    set((state) => {
      const existingMessages = state.messages[sessionId] || [];
      // Check if message with same ID already exists
      if (existingMessages.some((m) => m.id === message.id)) {
        return state; // Don't add duplicate
      }
      return {
        messages: {
          ...state.messages,
          [sessionId]: [...existingMessages, message],
        },
        lastMessageTimestamp: advanceMessageWatermark(
          state.lastMessageTimestamp,
          sessionId,
          message
        ),
      };
    }),

  appendStreamingContent: (sessionId, content) => {
    // Buffer content and flush via RAF at no more than 20fps instead of per-character updates
    bufferStreamingContent(sessionId, content);
  },

  // A reconnect snapshot already includes every delta before its packet.
  // Drop queued frame chunks before one atomic replacement, or the old prefix
  // would append again when the throttled renderer next flushes.
  replaceStreamingContent: (sessionId, content) => {
    dropPendingStreamingChunks(sessionId);
    set((state) => ({
      streamingContent: { ...state.streamingContent, [sessionId]: content },
    }));
  },

  clearStreamingContent: (sessionId) => {
    dropPendingStreamingChunks(sessionId);
    set((state) => ({
      streamingContent: {
        ...state.streamingContent,
        [sessionId]: '',
      },
    }));
  },

  updateSessionStatus: (sessionId, status) =>
    set((state) => {
      // Status events arrive at the start, on every retry and at the end of a
      // turn, usually repeating the value already held. Rebuilding the array
      // for that re-rendered every subscriber of `sessions` — the sidebar, the
      // layout, the session controls — for nothing.
      const current = state.sessions.find((s) => s.id === sessionId);
      if (!current || current.status === status) return state;
      return {
        sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s)),
      };
    }),

  setThinking: (sessionId, isThinking) =>
    set((state) => ({
      thinking: { ...state.thinking, [sessionId]: isThinking },
    })),

  setActivity: (sessionId, activity) =>
    set((state) => ({
      activity: { ...state.activity, [sessionId]: activity },
    })),

  setPendingApprovalCounts: (counts) => set({ pendingApprovalCounts: counts }),

  setLifecycle: (event) =>
    set((state) => ({
      lifecycle: { ...state.lifecycle, [event.sessionId]: event },
      // The beat is authoritative for its own session; the bootstrap map must
      // not keep claiming an approval the agent has already been given.
      pendingApprovalCounts: {
        ...state.pendingApprovalCounts,
        [event.sessionId]: event.pendingApprovals,
      },
      // Keep the session row itself honest. The list is fetched once and then
      // only patched by whatever the open conversation happens to report, so
      // without this a session that finished in the background keeps showing
      // the status it had when the list was loaded.
      sessions: state.sessions.map((s) =>
        s.id === event.sessionId
          ? {
              ...s,
              status: event.status,
              // Only patch a runtime that already exists — the interface has
              // required fields this event cannot supply, and an absent runtime
              // legitimately means "we never fetched one".
              runtime: s.runtime
                ? {
                    ...s.runtime,
                    busy: event.busy,
                    queueDepth: event.queueDepth,
                    activitySummary: event.activitySummary,
                    lastActivityAt: event.lastActivityAt,
                  }
                : s.runtime,
            }
          : s
      ),
    })),

  setActiveAgent: (sessionId, agent) =>
    set((state) => ({
      activeAgent: { ...state.activeAgent, [sessionId]: agent },
    })),

  recordAgentEvent: (sessionId, event) =>
    set((state) => {
      const now = event.timestamp ?? Date.now();
      const existing = state.agentRuns[sessionId] || [];
      const matching =
        event.agentId || event.toolId || event.externalAgentId
          ? existing.find(
              (run) =>
                run.id === event.agentId ||
                (!!event.toolId && run.toolId === event.toolId) ||
                (!!event.externalAgentId && run.externalAgentId === event.externalAgentId)
            )
          : event.status === 'started'
            ? undefined
            : [...existing]
                .reverse()
                .find(
                  (run) =>
                    run.status === 'started' &&
                    (!event.agentType || run.agentType === event.agentType)
                );
      const id =
        matching?.id ||
        event.agentId ||
        event.toolId ||
        event.externalAgentId ||
        `${event.agentType}-${now}-${Math.random().toString(36).slice(2, 8)}`;
      const run: SubagentRun = {
        ...matching,
        id,
        agentType: event.agentType || matching?.agentType || 'subagent',
        description: event.description || matching?.description,
        status: event.status,
        startedAt: matching?.startedAt ?? event.startedAt ?? now,
        completedAt:
          event.status === 'started'
            ? matching?.completedAt
            : (event.completedAt ?? matching?.completedAt ?? now),
        result: event.result || matching?.result,
        error: event.error || matching?.error,
        toolId: event.toolId || matching?.toolId,
        externalAgentId: event.externalAgentId || matching?.externalAgentId,
        provider: matching?.provider,
      };
      const merged = mergeAgentRuns(
        existing.filter((item) => item.id !== run.id),
        [run]
      );
      return {
        agentRuns: { ...state.agentRuns, [sessionId]: merged },
        activeAgent: {
          ...state.activeAgent,
          [sessionId]: getActiveAgentFromRuns(merged),
        },
      };
    }),

  setAgentRuns: (sessionId, runs) =>
    set((state) => {
      const merged = mergeAgentRuns(state.agentRuns[sessionId] || [], runs);
      return {
        agentRuns: { ...state.agentRuns, [sessionId]: merged },
        activeAgent: {
          ...state.activeAgent,
          [sessionId]: getActiveAgentFromRuns(merged),
        },
      };
    }),

  setTodos: (sessionId, todos) =>
    set((state) => ({
      todos: { ...state.todos, [sessionId]: todos },
    })),

  setUsage: (sessionId, usage) =>
    set((state) => ({
      usage: { ...state.usage, [sessionId]: usage },
    })),

  addGeneratedImage: (sessionId, image) =>
    set((state) => ({
      generatedImages: {
        ...state.generatedImages,
        // Cap retained images per session: each entry can hold a full base64
        // payload, so an unbounded list dominates heap on long sessions
        // (mirrors the agentRuns cap in mergeAgentRuns).
        [sessionId]: [
          ...(state.generatedImages[sessionId] || []),
          { ...image, timestamp: Date.now() },
        ].slice(-MAX_GENERATED_IMAGES_PER_SESSION),
      },
    })),

  addToolExecution: (sessionId, execution) =>
    set((state) => {
      const existing = state.toolExecutions[sessionId] || [];
      if (findToolIndex(existing, execution.toolId) !== -1) {
        return state;
      }
      return {
        toolExecutions: {
          ...state.toolExecutions,
          [sessionId]: [...existing, execution].slice(-MAX_TOOL_EXECUTIONS_PER_SESSION),
        },
      };
    }),

  updateToolExecution: (sessionId, toolId, update) =>
    set((state) => {
      const existing = state.toolExecutions[sessionId];
      if (!existing) return state;
      const index = findToolIndex(existing, toolId);
      // Unknown tool: return the same state object so nothing downstream
      // (timeline memo, turn segments, markers) recomputes for a no-op.
      if (index === -1) return state;
      const next = existing.slice();
      next[index] = { ...next[index]!, ...update };
      return {
        toolExecutions: {
          ...state.toolExecutions,
          [sessionId]: next,
        },
      };
    }),

  clearToolExecutions: (sessionId) =>
    set((state) => ({
      toolExecutions: {
        ...state.toolExecutions,
        [sessionId]: [],
      },
    })),

  setQueueState: (sessionId, queue) =>
    set((state) => ({
      queueState: {
        ...state.queueState,
        [sessionId]: queue,
      },
    })),

  // Permission request actions (legacy)
  setPermissionRequest: (sessionId, request) =>
    set((state) => ({
      permissionRequests: {
        ...state.permissionRequests,
        [sessionId]: request,
      },
    })),

  clearPermissionRequest: (sessionId) =>
    set((state) => ({
      permissionRequests: {
        ...state.permissionRequests,
        [sessionId]: null,
      },
    })),

  // Pending permission actions (hooks-based)
  setPendingPermission: (sessionId, permission) =>
    set((state) => ({
      pendingPermissions: {
        ...state.pendingPermissions,
        [sessionId]: permission,
      },
    })),

  setPendingQuestion: (sessionId, question) =>
    set((state) => ({
      pendingQuestions: {
        ...state.pendingQuestions,
        [sessionId]: question,
      },
    })),

  // File Tree actions
  setFileTreeOpen: (sessionId, open) =>
    set((state) => ({
      fileTreeOpen: { ...state.fileTreeOpen, [sessionId]: open },
    })),

  setSelectedFile: (sessionId, path) =>
    set((state) => ({
      selectedFile: { ...state.selectedFile, [sessionId]: path },
    })),

  // Code Editor actions
  openFile: (sessionId, path, content) =>
    set((state) => {
      const files = state.openFiles[sessionId] || [];
      const existing = files.find((f) => f.path === path);
      if (existing) {
        // File already open, just switch to it
        return {
          activeFileTab: { ...state.activeFileTab, [sessionId]: path },
        };
      }
      return {
        openFiles: {
          ...state.openFiles,
          [sessionId]: [...files, { path, content, isDirty: false, originalContent: content }],
        },
        activeFileTab: { ...state.activeFileTab, [sessionId]: path },
      };
    }),

  closeFile: (sessionId, path) =>
    set((state) => {
      const files = state.openFiles[sessionId] || [];
      const newFiles = files.filter((f) => f.path !== path);
      const currentTab = state.activeFileTab[sessionId] ?? null;
      let newActiveTab: string | null = currentTab;

      // If closing the active tab, switch to another
      if (currentTab === path) {
        const closedIndex = files.findIndex((f) => f.path === path);
        if (newFiles.length > 0) {
          const newIndex = Math.min(closedIndex, newFiles.length - 1);
          newActiveTab = newFiles[newIndex]?.path ?? null;
        } else {
          newActiveTab = null;
        }
      }

      const newActiveFileTab: Record<string, string | null> = { ...state.activeFileTab };
      newActiveFileTab[sessionId] = newActiveTab;

      return {
        openFiles: { ...state.openFiles, [sessionId]: newFiles },
        activeFileTab: newActiveFileTab,
      };
    }),

  updateFileContent: (sessionId, path, content) =>
    set((state) => {
      const files = state.openFiles[sessionId] || [];
      return {
        openFiles: {
          ...state.openFiles,
          [sessionId]: files.map((f) =>
            f.path === path ? { ...f, content, isDirty: content !== f.originalContent } : f
          ),
        },
      };
    }),

  markFileSaved: (sessionId, path) =>
    set((state) => {
      const files = state.openFiles[sessionId] || [];
      return {
        openFiles: {
          ...state.openFiles,
          [sessionId]: files.map((f) =>
            f.path === path ? { ...f, isDirty: false, originalContent: f.content } : f
          ),
        },
      };
    }),

  setActiveTab: (sessionId, path) =>
    set((state) => ({
      activeFileTab: { ...state.activeFileTab, [sessionId]: path },
    })),

  // Timestamp tracking for reconnection
  updateLastMessageTimestamp: (sessionId, timestamp) =>
    set((state) => ({
      lastMessageTimestamp: {
        ...state.lastMessageTimestamp,
        [sessionId]: timestamp,
      },
    })),

  getLastMessageTimestamp: (sessionId) => get().lastMessageTimestamp[sessionId],
}));
