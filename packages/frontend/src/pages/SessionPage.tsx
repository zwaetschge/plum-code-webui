import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  FolderOpen,
  Image,
  CheckCircle2,
  Brain,
  Wrench,
  FileText,
  Terminal,
  Search,
  Edit3,
  Globe,
  ListTodo,
  Circle,
  CheckCircle,
  Loader2,
  MessageSquare,
  Code2,
  FolderKey,
  Palette,
  X,
  Pencil,
  RotateCcw,
  Settings,
  Square,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  PenLine,
  Smartphone,
  Hand,
  Zap,
  Sparkles,
  Network,
  Link2,
  SendHorizontal,
  Lightbulb,
  GitBranch,
  GitPullRequest,
  History,
  StickyNote,
  MonitorPlay,
  ScrollText,
  BookmarkPlus,
  Download,
} from 'lucide-react';
import 'katex/dist/katex.min.css';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StreamingContent } from '@/components/chat/StreamingContent';
import { AllowedDirectoriesDialog } from '@/components/session/AllowedDirectoriesDialog';
import { PermissionRequestCard } from '@/components/session/PermissionRequestCard';
import { EditorPanel } from '@/components/code-editor';
import { WorkspaceFiles } from '@/components/files';
import { AgentsEditor } from '@/components/agents-editor';
import { MemoryViewer } from '@/components/memory-viewer';
import { RunCockpit, type RunCockpitSection } from '@/components/session/RunCockpit';
import { RenameSessionDialog } from '@/components/session/RenameSessionDialog';
import { OracleBrowserPanel } from '@/components/session/OracleBrowserPanel';
import { CompactBoundaryCard } from '@/components/chat/CompactBoundaryCard';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ToolExecutionCard } from '@/components/chat/ToolExecutionCard';
import { ToolDetailDialog } from '@/components/session/ToolDetailDialog';
import { AndroidDevicePanel } from '@/components/session/AndroidDevicePanel';
import { SessionStyleLibraryPanel } from '@/components/session/SessionStyleLibraryPanel';
import { CheckpointsPanel } from '@/components/session/CheckpointsPanel';
import { ToolLogPanel } from '@/components/session/ToolLogPanel';
import { GitPanel } from '@/components/git-panel';
import { GitHubPanel } from '@/components/github/GitHubPanel';
import { Notepad } from '@/components/notepad';
import { WebPreview } from '@/components/preview';
import { TaskWorkbenchHeader, TodoFloatingStrip } from '@/components/session/TaskWorkbench';
import {
  getActiveTodoPresentation,
  getTaskWorkbenchState,
} from '@/components/session/taskWorkbenchState';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import {
  useSessionStore,
  type ActivityState,
  type TodoItem,
  type GeneratedImage,
  type OpenFile,
  type SubagentRun,
} from '@/stores/sessionStore';
import { usePanelDockStore, type DockablePanel } from '@/stores/panelDockStore';
import { useShallow } from 'zustand/react/shallow';
import { api, ApiError } from '@/services/api';
import { ChatThreadSwitcher } from '@/components/chat/ChatThreadSwitcher';
import {
  getMessageSearchTarget,
  type MessageSearchResult,
} from '@/components/session/MessageSearch';
import { socketService } from '@/services/socket';
import {
  isMessageSnapshotStale,
  loadThenCommit,
  messageBelongsToChat,
  mergeMessageHistorySnapshot,
  normalizeMessageChatId,
} from '@/lib/messageHistory';
import type {
  Session,
  Message,
  ApiResponse,
  CliTool,
  Command,
  CommandExecutionResult,
  SessionMode,
  SessionSurface,
  PermissionAction,
  CLIProvider,
  UserSettings,
  ToolExecution,
  UsageSnapshot,
  ActiveFollowupMode,
  SessionDelegation,
  SessionPeerLink,
  HomeAssistantIntegrationSettings,
  HomeAssistantLightEntity,
  HomeAssistantStatus,
  SessionReadState,
  MessageHistorySnapshot,
} from '@plum-code-webui/shared';
import { normalizeUsageSnapshot } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { ChatInput, type ChatSendOptions } from '@/components/chat/ChatInput';
import { PermissionApprovalDialog } from '@/components/chat/PermissionApprovalDialog';
import { QuestionApprovalDialog } from '@/components/chat/QuestionApprovalDialog';
import {
  CLI_PROVIDER_DEFAULT_MODEL,
  CLI_PROVIDER_LABEL,
  toUiProvider,
  toCliProvider,
  type UiProvider,
} from '@/lib/providers';
import { TASK_WORKFLOWS } from '@/lib/taskWorkflows';
import { toast } from '@/hooks/use-toast';

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

// Stable empty references prevent selector fallbacks from triggering re-renders
const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TODOS: TodoItem[] = [];
const EMPTY_IMAGES: GeneratedImage[] = [];
const EMPTY_TOOL_EXECUTIONS: ToolExecution[] = [];
const EMPTY_OPEN_FILES: OpenFile[] = [];
const EMPTY_AGENT_RUNS: SubagentRun[] = [];
const IDLE_ACTIVITY: ActivityState = { type: 'idle' };
type WorkspaceSheetPanel = Exclude<DockablePanel, 'files' | 'tools'>;
type MobileSheetPanel = WorkspaceSheetPanel | 'settings';
const CLI_SUBAGENT_OFF = '__off__';
const CLI_SUBAGENT_DEFAULT_MODEL = '__default__';

interface CliSubagentSummary {
  id: string;
  label: string;
  provider: string;
  model?: string;
  enabled: boolean;
}

type RightMenuGroupId =
  | 'chat'
  | 'session'
  | 'view'
  | 'runtime'
  | 'subagents'
  | 'styles'
  | 'workspace';
const DOCKED_PANEL_KEYS: WorkspaceSheetPanel[] = [
  'tasks',
  'mesh',
  'designStyle',
  'writingStyle',
  'android',
  'browser',
  'git',
  'github',
  'checkpoints',
  'notes',
  'preview',
  'toolLog',
];
const STYLE_PANEL_KEYS: WorkspaceSheetPanel[] = ['designStyle', 'writingStyle'];
const DEFAULT_RIGHT_MENU_GROUPS: Record<RightMenuGroupId, boolean> = {
  chat: true,
  session: true,
  view: true,
  runtime: true,
  subagents: true,
  styles: true,
  workspace: false,
};
const ACTIVE_FOLLOWUP_MODE_DEFAULT: ActiveFollowupMode = 'queue';
const MESSAGE_HISTORY_PAGE_SIZE = 500;
const MESSAGE_JUMP_WINDOW_SIZE = 160;
const MESSAGE_HISTORY_FIRST_INDEX = 1_000_000;
const SESSION_DETAIL_FALLBACK_INTERVAL_MS = 15_000;
const AUTO_GOAL_MIN_CHARS = 220;
const AUTO_GOAL_MAX_CHARS = 3200;
const AUTO_GOAL_ACTION_HINT =
  /\b(add|build|connect|create|debug|design|finish|fix|implement|integrate|migrate|polish|refactor|rewrite|ship|test|update|wire)\b/i;

interface MessageHistoryPagination {
  total: number;
  limit: number;
  hasMore: boolean;
  hasMoreBefore?: boolean;
  hasMoreAfter?: boolean;
  oldestId: string | null;
  newestId?: string | null;
  aroundId?: string;
  anchorIndex?: number | null;
}

interface MessageHistoryResponse extends ApiResponse<Message[]> {
  pagination?: MessageHistoryPagination;
  snapshot?: MessageHistorySnapshot;
  readState?: SessionReadState;
}

interface SessionChatListPayload {
  chats: Array<{ id: string; title: string }>;
  activeChatId: string | null;
}

const SESSION_MODE_OPTIONS: Array<{
  value: SessionMode;
  label: string;
  description: string;
  icon: typeof Brain;
}> = [
  {
    value: 'planning',
    label: 'Plan mode',
    description: 'Plans but asks before executing',
    icon: Brain,
  },
  {
    value: 'auto-accept',
    label: 'Auto mode',
    description: 'Automatically approve safe operations',
    icon: CheckCircle,
  },
  {
    value: 'manual',
    label: 'Manual mode',
    description: 'Approve each operation manually',
    icon: Hand,
  },
  {
    value: 'danger',
    label: 'YOLO mode',
    description: 'Skip all confirmations',
    icon: Zap,
  },
];

function isActiveFollowupMode(value: string | null): value is ActiveFollowupMode {
  return value === 'queue' || value === 'steer';
}

function buildAutoGoalObjective(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed || trimmed.startsWith('/')) return null;

  const lineCount = trimmed.split(/\n/).filter((line) => line.trim()).length;
  const hasLongShape =
    trimmed.length >= AUTO_GOAL_MIN_CHARS ||
    lineCount >= 4 ||
    (trimmed.length >= 140 && AUTO_GOAL_ACTION_HINT.test(trimmed));

  if (!hasLongShape) return null;

  const compact = trimmed.replace(/\s+/g, ' ');
  const clipped =
    compact.length > AUTO_GOAL_MAX_CHARS
      ? `${compact.slice(0, AUTO_GOAL_MAX_CHARS - 3).trim()}...`
      : compact;

  return `Work through this request end-to-end and maintain an updated todo list: ${clipped}`;
}

function selectFreshestUsage(
  storeUsage: UsageSnapshot | undefined,
  telemetryUsage: UsageSnapshot | null | undefined
): UsageSnapshot | undefined {
  if (!storeUsage) return telemetryUsage ?? undefined;
  if (!telemetryUsage) return storeUsage;
  if (storeUsage.totalTokens <= 0 && telemetryUsage.totalTokens > 0) return telemetryUsage;
  if (storeUsage.contextUsedPercent >= 100 && telemetryUsage.contextUsedPercent < 100) {
    return telemetryUsage;
  }
  const storeMs = storeUsage.recordedAt ? Date.parse(storeUsage.recordedAt) : 0;
  const telemetryMs = telemetryUsage.recordedAt ? Date.parse(telemetryUsage.recordedAt) : 0;
  if (telemetryMs > storeMs) return telemetryUsage;
  if (
    telemetryMs === storeMs &&
    storeUsage.contextUsedPercent >= 100 &&
    telemetryUsage.contextUsedPercent < 100
  ) {
    return telemetryUsage;
  }
  return storeUsage;
}

function formatTimelineTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

type ChatTimelineMarker = {
  key: string;
  index: number;
  time: string;
  title: string;
  kind: 'user' | 'assistant' | 'tool' | 'image';
};

function ChatQuickTimeline({
  markers,
  activeIndex,
  onJump,
}: {
  markers: ChatTimelineMarker[];
  activeIndex: number;
  onJump: (index: number) => void;
}) {
  if (markers.length < 3) return null;

  return (
    <nav className="chat-quick-timeline" aria-label="Chat timeline">
      <div className="chat-quick-timeline-track" aria-hidden="true" />
      {markers.map((marker, markerIndex) => (
        <button
          key={marker.key}
          type="button"
          className={cn(
            'chat-quick-timeline-dot',
            `is-${marker.kind}`,
            marker.index === activeIndex && 'is-active'
          )}
          style={{
            top: `${markers.length === 1 ? 50 : (markerIndex / (markers.length - 1)) * 100}%`,
          }}
          aria-label={`Jump to ${marker.title} at ${marker.time}`}
          title={`${marker.time} · ${marker.title}`}
          onClick={() => onJump(marker.index)}
        >
          <span className="chat-quick-timeline-label">
            <time>{marker.time}</time>
            <strong>{marker.title}</strong>
          </span>
        </button>
      ))}
    </nav>
  );
}

type TimelineRange = { startIndex: number; endIndex: number };

type TimelineRangeStore = {
  get: () => TimelineRange;
  set: (next: TimelineRange) => void;
  subscribe: (listener: () => void) => () => void;
};

function createTimelineRangeStore(): TimelineRangeStore {
  let range: TimelineRange = { startIndex: 0, endIndex: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => range,
    set: (next) => {
      if (next.startIndex === range.startIndex && next.endIndex === range.endIndex) return;
      range = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// Owns the visible-range state so Virtuoso's rangeChanged (which fires on
// every scroll shift) re-renders only this rail, never the whole session page.
function QuickTimelineRail({
  store,
  markers,
  onJump,
}: {
  store: TimelineRangeStore;
  markers: ChatTimelineMarker[];
  onJump: (index: number) => void;
}) {
  const range = useSyncExternalStore(store.subscribe, store.get);
  const visibleIndex = Math.round((range.startIndex + range.endIndex) / 2);
  const activeIndex = useMemo(() => {
    if (markers.length === 0) return visibleIndex;
    return markers.reduce((nearest, marker) =>
      Math.abs(marker.index - visibleIndex) < Math.abs(nearest.index - visibleIndex)
        ? marker
        : nearest
    ).index;
  }, [markers, visibleIndex]);
  return <ChatQuickTimeline markers={markers} activeIndex={activeIndex} onJump={onJump} />;
}

function TimelineContinuation({ children }: { children: ReactNode }) {
  return (
    <div className="timeline-continuation">
      <div className="timeline-continuation-body">{children}</div>
    </div>
  );
}

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [isSending, setIsSending] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('auto-accept');
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isAtTop, setIsAtTop] = useState(false);
  const timelineRangeStore = useMemo(createTimelineRangeStore, []);
  const [historyFirstItemIndex, setHistoryFirstItemIndex] = useState(MESSAGE_HISTORY_FIRST_INDEX);
  const [historyPagination, setHistoryPagination] = useState<MessageHistoryPagination>({
    total: 0,
    limit: MESSAGE_HISTORY_PAGE_SIZE,
    hasMore: false,
    oldestId: null,
  });
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [isLoadingLatestMessages, setIsLoadingLatestMessages] = useState(false);
  const [isSearchHistoryWindow, setIsSearchHistoryWindow] = useState(false);
  const [olderMessagesError, setOlderMessagesError] = useState<string | null>(null);
  const [pendingMessageJump, setPendingMessageJump] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [messageJumpStatus, setMessageJumpStatus] = useState('');
  const handledUrlJumpRef = useRef('');
  const lastReadSentRef = useRef('');
  const messageSnapshotRef = useRef<MessageHistorySnapshot>();
  const messageHistoryEpochRef = useRef(0);
  const activeChatIdRef = useRef<string | null | undefined>(undefined);
  const historyOwnerSessionIdRef = useRef(id);
  if (historyOwnerSessionIdRef.current !== id) {
    historyOwnerSessionIdRef.current = id;
    activeChatIdRef.current = undefined;
    messageSnapshotRef.current = undefined;
    messageHistoryEpochRef.current += 1;
  }
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  // Floating header + input overlay: measure their heights so the scroll area
  // below gets matching top/bottom padding. Without this, content scrolls
  // completely behind the bars and the top/bottom rows are permanently hidden.
  // Callback refs, not useRef: the composer only renders on the chat view, so
  // switching to Files and back mounts a *new* node. A ResizeObserver attached
  // once at mount keeps watching the detached one, --chat-input-h freezes, and
  // the transcript then scrolls behind a composer that has since grown — the
  // status strip appearing during a turn is enough to swallow the last lines.
  const [headerBarEl, setHeaderBarEl] = useState<HTMLDivElement | null>(null);
  const [inputBarEl, setInputBarEl] = useState<HTMLDivElement | null>(null);
  const rootShellRef = useRef<HTMLDivElement>(null);

  // Per-session slices: shallow-compared so unrelated sessions don't trigger re-renders
  const {
    sessionMessages,
    hasStreamingContent,
    currentActivity,
    currentUsage,
    currentTodos,
    currentActiveAgent,
    currentAgentRuns,
    currentGeneratedImages,
    currentToolExecutions,
    currentQueue,
    currentPendingPermission,
    currentPendingQuestion,
    currentOpenFiles,
  } = useSessionStore(
    useShallow((s) => {
      const sid = id ?? '';
      return {
        sessionMessages: s.messages[sid] ?? EMPTY_MESSAGES,
        // Boolean on purpose: the string itself flushes every 50ms while
        // streaming and would re-render this 4900-line page each time. The
        // components that show the text subscribe to the string themselves.
        hasStreamingContent: Boolean(s.streamingContent[sid]),
        currentActivity: s.activity[sid] ?? IDLE_ACTIVITY,
        currentUsage: s.usage[sid],
        currentTodos: s.todos[sid] ?? EMPTY_TODOS,
        currentActiveAgent: s.activeAgent[sid] ?? null,
        currentAgentRuns: s.agentRuns[sid] ?? EMPTY_AGENT_RUNS,
        currentGeneratedImages: s.generatedImages[sid] ?? EMPTY_IMAGES,
        currentToolExecutions: s.toolExecutions[sid] ?? EMPTY_TOOL_EXECUTIONS,
        currentQueue: s.queueState[sid] ?? null,
        currentPendingPermission: s.pendingPermissions[sid] ?? null,
        currentPendingQuestion: s.pendingQuestions[sid] ?? null,
        currentOpenFiles: s.openFiles[sid] ?? EMPTY_OPEN_FILES,
      };
    })
  );

  // Actions are stable Zustand refs — subscribing doesn't trigger re-renders
  const setMessages = useSessionStore((s) => s.setMessages);
  const addMessage = useSessionStore((s) => s.addMessage);
  const clearStreamingContent = useSessionStore((s) => s.clearStreamingContent);
  const openFileInStore = useSessionStore((s) => s.openFile);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setAgentRuns = useSessionStore((s) => s.setAgentRuns);

  const [showSavedIndicator, setShowSavedIndicator] = useState(false);
  const [selectedCliTool, setSelectedCliTool] = useState<string | null>(null);
  const [isExecutingTool, _setIsExecutingTool] = useState(false);
  const cliToolAbortRef = useRef<AbortController | null>(null);
  const autoGoalBySessionRef = useRef<Record<string, string>>({});
  const [showAllowedDirsDialog, setShowAllowedDirsDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [templateNameDraft, setTemplateNameDraft] = useState<string | null>(null);
  const [mobileSheetPanel, setMobileSheetPanel] = useState<MobileSheetPanel | null>(null);
  const [goalDraft, setGoalDraft] = useState('');
  const [meshTargetSessionId, setMeshTargetSessionId] = useState('');
  const [meshRoleDraft, setMeshRoleDraft] = useState('peer consultant');
  const [meshDelegationTargetId, setMeshDelegationTargetId] = useState('');
  const [meshDelegationDraft, setMeshDelegationDraft] = useState(
    'Bitte pruefe diese Frage aus deinem Session-Kontext und antworte knapp mit Begruendung.'
  );

  useEffect(() => {
    const handler = () => setShowAllowedDirsDialog(true);
    window.addEventListener('command:open-allowed-dirs', handler);
    return () => window.removeEventListener('command:open-allowed-dirs', handler);
  }, []);

  useEffect(() => {
    const handler = () => setMobileSheetPanel('settings');
    window.addEventListener('session:open-mobile-right-menu', handler);
    return () => window.removeEventListener('session:open-mobile-right-menu', handler);
  }, []);

  const [selectedToolDetail, setSelectedToolDetail] = useState<
    (typeof currentToolExecutions)[0] | null
  >(null);
  const loadedModeForSessionRef = useRef<string | null>(null);

  const pinnedPanels = usePanelDockStore((s) => s.pinned);
  const togglePinPanel = usePanelDockStore((s) => s.togglePin);
  const setPinnedPanel = usePanelDockStore((s) => s.setPinned);
  const unpinAllPanels = usePanelDockStore((s) => s.unpinAll);
  const sessionModeStorageKey = useMemo(() => (id ? `sessionMode:${id}` : null), [id]);
  const activeFollowupModeStorageKey = useMemo(
    () => (id ? `activeFollowupMode:${id}` : null),
    [id]
  );
  const [activeFollowupMode, setActiveFollowupMode] = useState<ActiveFollowupMode>(
    ACTIVE_FOLLOWUP_MODE_DEFAULT
  );

  useEffect(() => {
    if (!activeFollowupModeStorageKey || typeof window === 'undefined') {
      setActiveFollowupMode(ACTIVE_FOLLOWUP_MODE_DEFAULT);
      return;
    }

    const stored = window.localStorage.getItem(activeFollowupModeStorageKey);
    setActiveFollowupMode(isActiveFollowupMode(stored) ? stored : ACTIVE_FOLLOWUP_MODE_DEFAULT);
  }, [activeFollowupModeStorageKey]);

  const handleActiveFollowupModeChange = useCallback(
    (checked: boolean) => {
      const next: ActiveFollowupMode = checked ? 'steer' : 'queue';
      setActiveFollowupMode(next);
      if (activeFollowupModeStorageKey && typeof window !== 'undefined') {
        window.localStorage.setItem(activeFollowupModeStorageKey, next);
      }
    },
    [activeFollowupModeStorageKey]
  );

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' });
    setIsAtBottom(true);
  }, []);

  // Sync floating header/input heights into CSS vars on the shell so the
  // scroll area can reserve matching top/bottom padding.
  useEffect(() => {
    const shell = rootShellRef.current;
    if (!shell || typeof ResizeObserver === 'undefined') return;
    const setVar = (name: string, el: HTMLElement | null) => {
      if (!el) return;
      shell.style.setProperty(name, `${el.offsetHeight}px`);
    };
    const ro = new ResizeObserver(() => {
      setVar('--chat-header-h', headerBarEl);
      setVar('--chat-input-h', inputBarEl);
    });
    if (headerBarEl) ro.observe(headerBarEl);
    if (inputBarEl) ro.observe(inputBarEl);
    // Prime the values for the nodes currently mounted
    setVar('--chat-header-h', headerBarEl);
    setVar('--chat-input-h', inputBarEl);
    return () => ro.disconnect();
  }, [headerBarEl, inputBarEl]);

  // Fetch available CLI tools
  const { data: cliTools } = useQuery({
    queryKey: ['cli-tools'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CliTool[]>>('/api/cli-tools');
      return (response.data.data || []).filter((t) => t.enabled);
    },
  });

  interface CLIProviderInfo {
    id: CLIProvider;
    name: string;
    icon: string;
    available: boolean;
    enabled?: boolean;
    models?: string[];
    modelLabels?: Record<string, string>;
    defaultModel?: string;
  }
  const { data: cliProviders } = useQuery({
    queryKey: ['cli-providers'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CLIProviderInfo[]>>('/api/cli-providers');
      return response.data.data || [];
    },
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<UserSettings>>('/api/settings');
      return response.data.data;
    },
  });

  const { data: homeAssistantSettings } = useQuery({
    queryKey: ['home-assistant-settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<HomeAssistantIntegrationSettings>>(
        '/api/home-assistant/settings'
      );
      return response.data.data;
    },
  });

  const { data: homeAssistantLights = [] } = useQuery({
    queryKey: ['home-assistant-lights'],
    enabled: Boolean(homeAssistantSettings?.configured),
    queryFn: async () => {
      const response = await api.get<ApiResponse<HomeAssistantLightEntity[]>>(
        '/api/home-assistant/lights'
      );
      return response.data.data || [];
    },
  });

  const { data: meshSessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Session[]>>('/api/sessions');
      return response.data.data || [];
    },
  });

  const meshPeersQuery = useQuery({
    queryKey: ['session-peers', id],
    enabled: !!id,
    queryFn: async () => {
      const response = await api.get<ApiResponse<SessionPeerLink[]>>(`/api/sessions/${id}/peers`);
      return response.data.data || [];
    },
  });

  const meshDelegationsQuery = useQuery({
    queryKey: ['session-delegations', id],
    enabled: !!id,
    queryFn: async () => {
      const response = await api.get<ApiResponse<SessionDelegation[]>>(
        `/api/sessions/${id}/delegations`
      );
      return response.data.data || [];
    },
  });

  // Memoized selected tool name for placeholder
  const selectedToolName = useMemo(() => {
    if (!selectedCliTool || !cliTools) return null;
    return cliTools.find((t) => t.id === selectedCliTool)?.name;
  }, [selectedCliTool, cliTools]);

  const [mainView, setMainView] = useState<'chat' | 'editor' | 'files'>('chat');
  const [configTab, setConfigTab] = useState<'memories' | 'agents'>('memories');
  const [rightDockCollapsed, setRightDockCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('chat.rightDockCollapsed') === '1';
  });
  const [rightMenuGroupsOpen, setRightMenuGroupsOpen] = useState<Record<RightMenuGroupId, boolean>>(
    () => {
      if (typeof window === 'undefined') return DEFAULT_RIGHT_MENU_GROUPS;
      try {
        const saved = window.localStorage.getItem('chat.rightMenuGroupsOpen');
        if (!saved) return DEFAULT_RIGHT_MENU_GROUPS;
        const parsed = JSON.parse(saved) as Partial<Record<RightMenuGroupId, boolean>>;
        return { ...DEFAULT_RIGHT_MENU_GROUPS, ...parsed };
      } catch {
        return DEFAULT_RIGHT_MENU_GROUPS;
      }
    }
  );
  const [runCockpitOpen, setRunCockpitOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('chat.runCockpitOpen') === '1';
  });
  const [runCockpitTarget, setRunCockpitTarget] = useState<{
    section: RunCockpitSection;
    version: number;
  }>({ section: 'overview', version: 0 });
  const toggleRightDockCollapsed = useCallback(() => {
    setRightDockCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('chat.rightDockCollapsed', next ? '1' : '0');
      }
      return next;
    });
  }, []);
  const toggleRightMenuGroup = useCallback(
    (groupId: RightMenuGroupId) => {
      if (rightDockCollapsed) {
        setRightDockCollapsed(false);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('chat.rightDockCollapsed', '0');
        }
        setRightMenuGroupsOpen((prev) => {
          const next = { ...prev, [groupId]: true };
          if (typeof window !== 'undefined') {
            window.localStorage.setItem('chat.rightMenuGroupsOpen', JSON.stringify(next));
          }
          return next;
        });
        return;
      }

      setRightMenuGroupsOpen((prev) => {
        const next = { ...prev, [groupId]: !prev[groupId] };
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('chat.rightMenuGroupsOpen', JSON.stringify(next));
        }
        return next;
      });
    },
    [rightDockCollapsed]
  );
  const openRunCockpitSection = useCallback(
    (section: RunCockpitSection = 'overview') => {
      unpinAllPanels();
      setRunCockpitOpen(true);
      setRunCockpitTarget((prev) => ({ section, version: prev.version + 1 }));
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('chat.runCockpitOpen', '1');
      }
    },
    [unpinAllPanels]
  );
  const handleOpenRunOverview = useCallback(
    () => openRunCockpitSection('overview'),
    [openRunCockpitSection]
  );
  const closeActivityRails = useCallback(() => {
    setRunCockpitOpen(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('chat.runCockpitOpen', '0');
    }
  }, []);

  const openRightPanel = useCallback(
    (panel: WorkspaceSheetPanel) => {
      const openCount = DOCKED_PANEL_KEYS.filter((key) => pinnedPanels[key]).length;
      const isOnlyOpenPanel = pinnedPanels[panel] && openCount === 1;

      unpinAllPanels();
      if (!isOnlyOpenPanel) {
        setPinnedPanel(panel, true);
        closeActivityRails();
      }
    },
    [closeActivityRails, pinnedPanels, setPinnedPanel, unpinAllPanels]
  );

  const hasOpenFiles = currentOpenFiles.length > 0;
  const hasLiveAssistantFooter =
    currentActivity.type === 'thinking' || !!currentActiveAgent || hasStreamingContent;
  const hasLiveAssistantTimelinePoint = hasStreamingContent;

  // Combine messages, generated images and tool executions into a single timeline
  type TimelineItem =
    | { type: 'message'; data: Message; timestamp: number }
    | { type: 'image'; data: (typeof currentGeneratedImages)[0]; timestamp: number }
    | { type: 'tool'; data: (typeof currentToolExecutions)[0]; timestamp: number };

  // Memoized per source: a tool progress event must not re-parse the createdAt
  // of every message again. Array.prototype.sort is stable, so equal timestamps
  // keep the message → image → tool concatenation order without index juggling.
  const messageTimelineItems = useMemo<TimelineItem[]>(
    () =>
      sessionMessages.map((msg) => ({
        type: 'message' as const,
        data: msg,
        timestamp: new Date(msg.createdAt).getTime(),
      })),
    [sessionMessages]
  );
  const imageTimelineItems = useMemo<TimelineItem[]>(
    () =>
      currentGeneratedImages.map((img) => ({
        type: 'image' as const,
        data: img,
        timestamp: img.timestamp,
      })),
    [currentGeneratedImages]
  );
  const toolTimelineItems = useMemo<TimelineItem[]>(
    () =>
      currentToolExecutions.map((tool) => ({
        type: 'tool' as const,
        data: tool,
        timestamp: tool.timestamp,
      })),
    [currentToolExecutions]
  );
  const timeline = useMemo<TimelineItem[]>(() => {
    const items = [...messageTimelineItems, ...imageTimelineItems, ...toolTimelineItems];
    items.sort((a, b) => a.timestamp - b.timestamp);
    return items;
  }, [messageTimelineItems, imageTimelineItems, toolTimelineItems]);

  // Live ref of the current timeline so Run turn jumps always read
  // fresh indices without retriggering Virtuoso's internal observers.
  const timelineRef = useRef<TimelineItem[]>([]);
  timelineRef.current = timeline;

  const assistantTurnSegments = useMemo(() => {
    const isAssistantProduced = (item: TimelineItem | undefined) =>
      !!item && (item.type !== 'message' || (item.data as Message).role === 'assistant');

    return timeline.map((item, index) => {
      const inTurn = isAssistantProduced(item);
      if (!inTurn) {
        return {
          inTurn: false,
          startsAfterUser: false,
          continuesBefore: false,
          continuesAfter: false,
          continuation: false,
        };
      }

      const previousItem = timeline[index - 1];
      const nextItem = timeline[index + 1];
      const isLastItem = index === timeline.length - 1;
      const previousContinuesTurn = isAssistantProduced(previousItem);
      const nextContinuesTurn = isAssistantProduced(nextItem);

      return {
        inTurn: true,
        startsAfterUser: !isAssistantProduced(previousItem),
        continuesBefore: previousContinuesTurn,
        continuesAfter: nextContinuesTurn || (isLastItem && hasLiveAssistantTimelinePoint),
        continuation: item.type !== 'message',
      };
    });
  }, [hasLiveAssistantTimelinePoint, timeline]);

  const compactMessageNumbers = useMemo(() => {
    let compactCount = 0;
    const byId = new Map<string, number>();
    for (const message of sessionMessages) {
      if (message.id?.startsWith('compact-')) {
        compactCount += 1;
        byId.set(message.id, compactCount);
      }
    }
    return { compactCount, byId };
  }, [sessionMessages]);

  const footerConnectsToAssistantTurn = useMemo(() => {
    if (!hasLiveAssistantTimelinePoint) return false;
    const lastItem = timeline[timeline.length - 1];
    return (
      !!lastItem && (lastItem.type !== 'message' || (lastItem.data as Message).role === 'assistant')
    );
  }, [hasLiveAssistantTimelinePoint, timeline]);

  const jumpToMessage = useCallback(
    (messageId: string) => {
      const idx = timelineRef.current.findIndex(
        (item) => item.type === 'message' && (item.data as { id?: string }).id === messageId
      );
      if (idx >= 0) {
        virtuosoRef.current?.scrollToIndex({
          index: historyFirstItemIndex + idx,
          behavior:
            typeof window !== 'undefined' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'auto'
              : 'smooth',
          align: 'start',
        });
        setHighlightedMessageId(messageId);
        setMessageJumpStatus('Moved to the matching message.');
        window.setTimeout(() => {
          document.getElementById(`chat-message-${messageId}`)?.focus({ preventScroll: true });
        }, 180);
        return true;
      }
      return false;
    },
    [historyFirstItemIndex]
  );

  useEffect(() => {
    if (!pendingMessageJump) return;
    if (!jumpToMessage(pendingMessageJump)) return;
    setPendingMessageJump(null);
  }, [jumpToMessage, pendingMessageJump, timeline]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const timeout = window.setTimeout(() => setHighlightedMessageId(null), 2_800);
    return () => window.clearTimeout(timeout);
  }, [highlightedMessageId]);

  const jumpToTimelineIndex = useCallback((index: number) => {
    virtuosoRef.current?.scrollToIndex({ index, behavior: 'smooth', align: 'start' });
  }, []);

  const jumpToMessageFromRun = useCallback(
    (messageId: string) => {
      setMainView('chat');
      if (typeof window === 'undefined') {
        jumpToMessage(messageId);
        return;
      }
      window.requestAnimationFrame(() => jumpToMessage(messageId));
    },
    [jumpToMessage]
  );

  // Helper to get tool icon and name - memoized to prevent re-creation on every render
  const getToolDisplay = useCallback((toolName: string) => {
    const toolMap: Record<string, { icon: typeof Wrench; label: string }> = {
      // Claude tools
      Write: { icon: FileText, label: 'Writing file' },
      Read: { icon: Search, label: 'Reading file' },
      Edit: { icon: Edit3, label: 'Editing file' },
      Bash: { icon: Terminal, label: 'Running command' },
      Glob: { icon: Search, label: 'Searching files' },
      Grep: { icon: Search, label: 'Searching code' },
      WebFetch: { icon: Globe, label: 'Fetching webpage' },
      WebSearch: { icon: Globe, label: 'Searching web' },
      Task: { icon: Brain, label: 'Starting agent' },
      Agent: { icon: Brain, label: 'Starting agent' },
      // Codex / generic tool names
      read_file: { icon: Search, label: 'Reading file' },
      read_many_files: { icon: Search, label: 'Reading files' },
      write_file: { icon: FileText, label: 'Writing file' },
      replace: { icon: Edit3, label: 'Editing file' },
      run_shell_command: { icon: Terminal, label: 'Running command' },
      shell: { icon: Terminal, label: 'Running command' },
      glob: { icon: Search, label: 'Searching files' },
      grep_search: { icon: Search, label: 'Searching code' },
      list_directory: { icon: Search, label: 'Listing directory' },
      TodoWrite: { icon: FileText, label: 'Updating tasks' },
      TodoRead: { icon: Search, label: 'Reading tasks' },
    };
    return toolMap[toolName] || { icon: Wrench, label: toolName };
  }, []);

  // Helper to get agent display name - memoized
  const getAgentDisplay = useCallback((agentType: string) => {
    const agentMap: Record<string, string> = {
      Explore: 'Explorer',
      Plan: 'Planner',
      'general-purpose': 'General',
      'claude-code-guide': 'Documentation',
      'research-bot': 'Research',
      'frontend-developer': 'Frontend Dev',
      'mobile-developer': 'Mobile Dev',
      'backend-dev': 'Backend Dev',
      'fullstack-dev': 'Fullstack Dev',
      'api-designer': 'API Designer',
      'ui-designer': 'UI Designer',
      devops: 'DevOps',
      'devops-engineer': 'DevOps',
      database: 'Database',
      'database-specialist': 'Database',
      'git-ops': 'Git Ops',
      'git-operations': 'Git Ops',
      debugger: 'Debugger',
      'debugging-expert': 'Debugger',
      architect: 'Architect',
      'system-architect': 'Architect',
      'test-engineer': 'Test Engineer',
      'security-auditor': 'Security',
      'performance-optimizer': 'Performance',
      'release-manager': 'Release',
      'data-engineer': 'Data Engineer',
      'documentation-writer': 'Docs',
      'statusline-setup': 'Status Line',
    };
    return agentMap[agentType] || agentType;
  }, []);

  const getAgentDescription = useCallback((agentType: string) => {
    const descriptions: Record<string, string> = {
      Explore: 'Exploring project',
      Plan: 'Drafting a plan',
      'general-purpose': 'Handling general tasks',
      'claude-code-guide': 'Checking docs',
      'research-bot': 'Researching',
      'frontend-developer': 'Working on UI',
      'mobile-developer': 'Working on mobile',
      'backend-dev': 'Working on backend',
      'fullstack-dev': 'Working across stack',
      'api-designer': 'Designing API',
      'ui-designer': 'Designing UI',
      devops: 'Handling infra',
      'devops-engineer': 'Handling infra',
      database: 'Working on database',
      'database-specialist': 'Working on database',
      'git-ops': 'Managing git tasks',
      'git-operations': 'Managing git tasks',
      debugger: 'Debugging',
      'debugging-expert': 'Debugging',
      architect: 'Designing architecture',
      'system-architect': 'Designing architecture',
      'test-engineer': 'Writing tests',
      'security-auditor': 'Auditing security',
      'performance-optimizer': 'Optimizing performance',
      'release-manager': 'Managing release',
      'data-engineer': 'Working on data pipeline',
      'documentation-writer': 'Writing documentation',
      'statusline-setup': 'Configuring status line',
    };
    return descriptions[agentType] || `Running ${agentType} agent`;
  }, []);

  const formatElapsed = useCallback((ms: number) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }, []);

  // Refs keep a live handle on values the stable Virtuoso Footer/Header
  // closures need to read. The components object is memoized with empty deps
  // (see virtuosoComponents below) so Virtuoso keeps the same component
  // identity across parent renders — otherwise every state change would
  // remount Footer and restart every CSS/SVG animation inside it.
  const footerDepsRef = useRef<{
    id: string | undefined;
    uiProvider: UiProvider;
    providerLabel: string;
    getAgentDisplay: typeof getAgentDisplay;
    getAgentDescription: typeof getAgentDescription;
    getToolDisplay: typeof getToolDisplay;
    formatElapsed: typeof formatElapsed;
    clearStreamingContent: typeof clearStreamingContent;
    openRunCockpitSection: (section: RunCockpitSection) => void;
    footerConnectsToAssistantTurn: boolean;
  } | null>(null);

  const virtuosoComponents = useMemo(() => {
    function ChatFooter() {
      const sid = footerDepsRef.current?.id ?? '';
      const footerActivity = useSessionStore((s) => s.activity[sid] ?? IDLE_ACTIVITY);
      const footerActiveAgent = useSessionStore((s) => s.activeAgent[sid] ?? null);
      const footerAgentRuns = useSessionStore((s) => s.agentRuns[sid] ?? EMPTY_AGENT_RUNS);
      const footerStreamingContent = useSessionStore((s) => s.streamingContent[sid] ?? '');
      const footerPermissionRequest = useSessionStore((s) => s.permissionRequests[sid] ?? null);
      const footerActiveAgents = footerAgentRuns.filter((agent) => agent.status === 'started');
      const [footerNow, setFooterNow] = useState(() => Date.now());
      // Only tick while something actually shows a duration; an idle session
      // otherwise re-rendered the footer once per second for the tab's life.
      const footerTicks =
        footerActivity.type === 'thinking' || !!footerActiveAgent || footerActiveAgents.length > 0;
      useEffect(() => {
        if (!footerTicks) return;
        setFooterNow(Date.now());
        const intervalId = window.setInterval(() => setFooterNow(Date.now()), 1000);
        return () => window.clearInterval(intervalId);
      }, [footerTicks]);
      const deps = footerDepsRef.current;
      if (!deps) {
        return <div aria-hidden className="chat-footer-spacer" />;
      }
      const footerHasAgentActivity = !!footerActiveAgent || footerActiveAgents.length > 0;
      const footerThinkingDetail =
        footerActivity.type === 'thinking' ? footerActivity.message?.trim() || '' : '';
      const normalizedThinkingDetail = footerThinkingDetail
        .toLowerCase()
        .replace(/\.+$/g, '')
        .trim();
      const hideThinkingDetail =
        normalizedThinkingDetail === `${deps.providerLabel.toLowerCase()} is thinking` ||
        normalizedThinkingDetail === `${deps.providerLabel.toLowerCase()} thinking`;
      return (
        <div
          className={cn(
            'chat-stream chat-footer-stream',
            deps.footerConnectsToAssistantTurn && 'asst-footer-continues'
          )}
        >
          {/* Tool activity is rendered as a compact ToolExecutionCard inside the
              timeline (see itemContent → 'tool' branch) — it appears at the
              correct chronological position with a live spinner + duration and
              persists after completion. The footer only handles state with no
              timeline equivalent: thinking and active subagents. */}
          {(footerActivity.type === 'thinking' ||
            footerActiveAgent ||
            footerActiveAgents.length > 0) &&
            !footerStreamingContent && (
              <div className="turn-asst pl-thinking-turn animate-fade-in">
                <div className="ai-body">
                  <div
                    className={cn('pl-thinking-body', footerHasAgentActivity && 'is-clickable')}
                    role={footerHasAgentActivity ? 'button' : undefined}
                    tabIndex={footerHasAgentActivity ? 0 : undefined}
                    onClick={() => {
                      if (footerHasAgentActivity) deps.openRunCockpitSection('agents');
                    }}
                    onKeyDown={(event) => {
                      if (!footerHasAgentActivity) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        deps.openRunCockpitSection('agents');
                      }
                    }}
                  >
                    <span className="pl-thinking-inline-mark" aria-hidden="true">
                      {footerActiveAgent || footerActiveAgents.length > 0 ? (
                        <Brain className="h-3.5 w-3.5" />
                      ) : (
                        <ProviderLogo provider={deps.uiProvider} className="h-4 w-4" />
                      )}
                      <span className="pl-thinking-ping" />
                    </span>
                    <div className="pl-thinking-title">
                      {footerActiveAgent ? (
                        footerActiveAgents.length > 1 ? (
                          <>Subagents: {footerActiveAgents.length} running</>
                        ) : (
                          <>Agent: {deps.getAgentDisplay(footerActiveAgent.agentType)}</>
                        )
                      ) : (
                        <>
                          {deps.providerLabel} thinking
                          <span className="pl-thinking-dots" aria-hidden="true">
                            <span>.</span>
                            <span>.</span>
                            <span>.</span>
                          </span>
                          {/* The elapsed time used to disappear whenever the
                              detail line was hidden, which is exactly the case
                              where a long wait feels stuck. */}
                          {footerActivity.messageStartedAt && (
                            <span className="pl-thinking-elapsed">
                              {deps.formatElapsed(footerNow - footerActivity.messageStartedAt)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {footerActiveAgent ? (
                      <div className="pl-thinking-detail">
                        {footerActiveAgent.description ||
                          deps.getAgentDescription(footerActiveAgent.agentType)}
                        {footerActiveAgent.startedAt
                          ? ` (${deps.formatElapsed(footerNow - footerActiveAgent.startedAt)})`
                          : ''}
                      </div>
                    ) : footerThinkingDetail && !hideThinkingDetail ? (
                      <div className="pl-thinking-detail">
                        {footerThinkingDetail}
                        {footerActivity.messageStartedAt
                          ? ` (${deps.formatElapsed(footerNow - footerActivity.messageStartedAt)})`
                          : ''}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

          {footerStreamingContent && (
            <div className="turn-asst animate-fade-in">
              <div className="ai-body">
                <StreamingContent
                  content={footerStreamingContent}
                  provider={deps.uiProvider}
                  providerLabel={deps.providerLabel}
                  onResponse={(response) => {
                    if (deps.id) {
                      socketService.sendInput(deps.id, response);
                      deps.clearStreamingContent(deps.id);
                    }
                  }}
                />
              </div>
            </div>
          )}

          {footerPermissionRequest && deps.id && (
            <div className="flex justify-start">
              <PermissionRequestCard
                sessionId={deps.id}
                denials={footerPermissionRequest.denials}
                originalMessage={footerPermissionRequest.originalMessage}
                providerLabel={deps.providerLabel}
              />
            </div>
          )}
        </div>
      );
    }

    function ChatHeader() {
      return <div className="chat-top-spacer" aria-hidden="true" />;
    }

    return { Footer: ChatFooter, Header: ChatHeader };
  }, []);

  const allowedSessionModes: SessionMode[] = useMemo(
    () => ['planning', 'auto-accept', 'manual', 'danger'],
    []
  );

  const getStoredSessionMode = useCallback(
    (key: string) => {
      try {
        const stored = window.localStorage.getItem(key);
        if (stored && allowedSessionModes.includes(stored as SessionMode)) {
          return stored as SessionMode;
        }
      } catch {
        // Ignore storage errors (private mode, blocked, etc.)
      }
      return null;
    },
    [allowedSessionModes]
  );

  // Fetch session details
  const {
    data: session,
    isLoading: sessionLoading,
    isError: sessionQueryFailed,
    error: sessionQueryError,
    refetch: retrySession,
  } = useQuery({
    queryKey: ['session', id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Session>>(`/api/sessions/${id}`);
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return null;
    },
    enabled: !!id,
    // Runtime events arrive over the socket. This slower foreground-only poll is
    // a recovery path and avoids repeatedly parsing large Codex rollouts.
    refetchInterval: SESSION_DETAIL_FALLBACK_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const sessionProvider = session?.cliProvider ?? toCliProvider();
  const sessionSurface = session?.surface ?? 'code';
  const isTaskSurface = sessionSurface === 'task';
  const sessionUiProvider = toUiProvider(sessionProvider);
  const providerLabel = CLI_PROVIDER_LABEL[sessionProvider];
  const sessionRuntime = session?.runtime;
  const sessionTelemetryUsage = session?.telemetry?.usage ?? null;
  const visibleUsage = normalizeUsageSnapshot(
    sessionProvider === 'codex' && sessionTelemetryUsage
      ? sessionTelemetryUsage
      : selectFreshestUsage(currentUsage, sessionTelemetryUsage)
  );
  const contextEventStats = session?.telemetry
    ? {
        contextSnapshots: session.telemetry.contextSnapshots,
        compactEvents: session.telemetry.compactEvents,
      }
    : compactMessageNumbers.compactCount > 0
      ? {
          contextSnapshots: 0,
          compactEvents: compactMessageNumbers.compactCount,
        }
      : undefined;
  const compactIndexOffset = Math.max(
    0,
    (contextEventStats?.compactEvents ?? compactMessageNumbers.compactCount) -
      compactMessageNumbers.compactCount
  );
  const hasRuntimeRunActivity =
    !!sessionRuntime?.busy ||
    !!sessionRuntime?.streaming ||
    !!sessionRuntime?.subagents?.some((agent) => agent.status === 'started');
  const hasLiveRunActivity =
    hasLiveAssistantFooter || currentActivity.type === 'tool' || hasRuntimeRunActivity;
  const hasQueuedRunWork =
    !!currentQueue?.busy ||
    (sessionRuntime?.queueDepth ?? 0) > 0 ||
    (sessionRuntime?.queueItems?.length ?? 0) > 0;
  const isActive = hasLiveRunActivity || hasQueuedRunWork;
  const supportsActiveFollowups =
    sessionProvider === 'claude' ||
    sessionProvider === 'zai' ||
    sessionProvider === 'codex' ||
    sessionProvider === 'opencode' ||
    sessionProvider === 'pi';
  const supportsSteeredFollowups = sessionProvider === 'codex';
  const composerActiveFollowupMode: ActiveFollowupMode | undefined = supportsActiveFollowups
    ? supportsSteeredFollowups
      ? activeFollowupMode
      : 'queue'
    : undefined;
  const activeSendFollowupMode: ActiveFollowupMode | undefined =
    supportsActiveFollowups && isActive ? composerActiveFollowupMode : undefined;
  const composerQueuesWhileActive =
    sessionProvider === 'claude' ||
    sessionProvider === 'zai' ||
    sessionProvider === 'opencode' ||
    sessionProvider === 'pi' ||
    (supportsSteeredFollowups && activeFollowupMode === 'queue');
  const composerSteersWhileActive = supportsSteeredFollowups && activeFollowupMode === 'steer';
  const canInterruptActiveRun =
    hasLiveRunActivity ||
    (!composerQueuesWhileActive && !composerSteersWhileActive && hasQueuedRunWork);
  const quickTimelineMarkers = useMemo<ChatTimelineMarker[]>(() => {
    const raw = timeline
      .map((item, index): ChatTimelineMarker | null => {
        const time = formatTimelineTime(item.timestamp);
        if (item.type === 'message') {
          const message = item.data;
          if (message.id?.startsWith('compact-')) return null;
          return {
            key: `message-${message.id || item.timestamp}`,
            index: historyFirstItemIndex + index,
            time,
            title: message.role === 'user' ? 'You' : providerLabel,
            kind: message.role === 'user' ? 'user' : 'assistant',
          };
        }
        if (item.type === 'tool') {
          return {
            key: `tool-${item.data.toolId}`,
            index: historyFirstItemIndex + index,
            time,
            title: item.data.actionSummary?.title || item.data.toolName,
            kind: 'tool',
          };
        }
        return {
          key: `image-${item.data.timestamp}`,
          index: historyFirstItemIndex + index,
          time,
          title: 'Generated image',
          kind: 'image',
        };
      })
      .filter((marker): marker is ChatTimelineMarker => marker !== null);

    const maxMarkers = 30;
    if (raw.length <= maxMarkers) return raw;

    const sampled: ChatTimelineMarker[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < maxMarkers; i += 1) {
      const rawIndex = Math.round((i / (maxMarkers - 1)) * (raw.length - 1));
      const marker = raw[rawIndex];
      if (marker && !seen.has(marker.index)) {
        sampled.push(marker);
        seen.add(marker.index);
      }
    }
    return sampled;
  }, [historyFirstItemIndex, providerLabel, timeline]);

  useEffect(() => {
    if (!id || !session) {
      return;
    }
    if (session.runtime?.subagents?.length) {
      setAgentRuns(id, session.runtime.subagents);
    }
    if (loadedModeForSessionRef.current !== id) {
      // Prefer the DB-persisted mode so the choice follows the user across browsers;
      // fall back to legacy per-browser localStorage for sessions created before the
      // backend started persisting `mode`.
      const persistedMode =
        session.mode && allowedSessionModes.includes(session.mode as SessionMode)
          ? (session.mode as SessionMode)
          : null;
      const initialMode =
        persistedMode ??
        (sessionModeStorageKey ? getStoredSessionMode(sessionModeStorageKey) : null);
      if (initialMode) {
        setSessionMode(initialMode);
        socketService.setSessionMode(id, initialMode);
      }
      loadedModeForSessionRef.current = id;
    }
  }, [id, session, sessionModeStorageKey, getStoredSessionMode, allowedSessionModes, setAgentRuns]);

  // Keep the footer's live dependencies fresh. The stable memoized Footer
  // component reads from this ref every render, so updates here propagate
  // without changing component identity.
  footerDepsRef.current = {
    id,
    uiProvider: sessionUiProvider,
    providerLabel,
    getAgentDisplay,
    getAgentDescription,
    getToolDisplay,
    formatElapsed,
    clearStreamingContent,
    openRunCockpitSection,
    footerConnectsToAssistantTurn,
  };
  const configuredModelsForProvider = settings?.cliProviderModelLists?.[sessionProvider] || [];
  const rawSelectedModel = session?.cliModel || '';
  const selectedModel =
    (sessionProvider === 'opencode' || sessionProvider === 'pi') &&
    rawSelectedModel &&
    configuredModelsForProvider.length > 0 &&
    !configuredModelsForProvider.includes(rawSelectedModel)
      ? ''
      : rawSelectedModel;
  const currentProviderInfo = cliProviders?.find((provider) => provider.id === sessionProvider);
  const providerDefaultModel =
    currentProviderInfo?.defaultModel || CLI_PROVIDER_DEFAULT_MODEL[sessionProvider];
  const resolvedSharedProviderDefaultModel = (() => {
    if (sessionProvider !== 'opencode' && sessionProvider !== 'pi') return '';
    return configuredModelsForProvider[0] || providerDefaultModel;
  })();
  const resolvedDefaultModel =
    selectedModel ||
    (sessionProvider === 'opencode' || sessionProvider === 'pi'
      ? resolvedSharedProviderDefaultModel
      : providerDefaultModel);
  const modelSelectValue = selectedModel || '__default__';
  const modelLabels = useMemo(() => {
    return currentProviderInfo?.modelLabels || {};
  }, [currentProviderInfo]);
  // Compact label shown next to the assistant name in each turn (template's `asst-model`).
  const asstModelLabel = (() => {
    const runtimeModel = session?.runtime?.model;
    const raw =
      runtimeModel && runtimeModel !== 'unknown'
        ? runtimeModel
        : selectedModel || resolvedDefaultModel || '';
    const labelled = modelLabels[raw];
    return (labelled || raw).toString();
  })();
  const modelOptions = useMemo(() => {
    const configuredModels = settings?.cliProviderModelLists?.[sessionProvider] || [];
    if (sessionProvider === 'opencode' || sessionProvider === 'pi') {
      return Array.from(
        new Set(configuredModels.length > 0 ? configuredModels : currentProviderInfo?.models || [])
      );
    }

    const options = new Set<string>();
    const providerModels = currentProviderInfo?.models || [];
    for (const model of providerModels) {
      options.add(model);
    }
    for (const model of configuredModels) {
      options.add(model);
    }
    if (selectedModel) {
      options.add(selectedModel);
    }
    return Array.from(options);
  }, [currentProviderInfo, sessionProvider, selectedModel, settings?.cliProviderModelLists]);
  const showDefaultModelOption =
    sessionProvider === 'pi' ||
    sessionProvider !== 'opencode' ||
    configuredModelsForProvider.length > 0;
  const selectedReasoning = session?.cliReasoning || '';
  const reasoningSelectValue = selectedReasoning || '__default__';
  const selectedServiceTier = session?.cliServiceTier || '';
  const serviceTierSelectValue = selectedServiceTier || '__default__';
  const fastModeActive = sessionProvider === 'codex' && serviceTierSelectValue === 'fast';
  const reasoningOptions = useMemo(() => {
    if (sessionProvider === 'claude' || sessionProvider === 'zai') {
      return [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        // The CLI's session-level tier behind the "ultrathink" prompt keyword.
        { value: 'xhigh', label: 'X-High (ultrathink)' },
        { value: 'max', label: 'Max' },
      ];
    }
    if (sessionProvider === 'opencode' || sessionProvider === 'pi') {
      return [
        { value: 'minimal', label: 'Minimal' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'max', label: 'Max' },
      ];
    }
    return [
      { value: 'none', label: 'None' },
      { value: 'minimal', label: 'Minimal' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'xhigh', label: 'XHigh' },
      { value: 'max', label: 'Max' },
      { value: 'ultra', label: 'Ultra' },
    ];
  }, [sessionProvider]);

  const { data: sessionChatList, isSuccess: sessionChatsReady } = useQuery({
    queryKey: ['session-chats', id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<SessionChatListPayload>>(
        `/api/sessions/${id}/chats`
      );
      if (!response.data.success || !response.data.data) {
        throw new Error('Chat threads could not be loaded.');
      }
      return response.data.data;
    },
    enabled: !!id,
  });

  const activeHistoryChatId = normalizeMessageChatId(sessionChatList?.activeChatId) ?? null;
  const activeHistoryChatKey = activeHistoryChatId ?? 'main';

  useEffect(() => {
    if (!id || !sessionChatsReady) return;
    activeChatIdRef.current = activeHistoryChatId;
    socketService.setSessionChat(id, activeHistoryChatId);
  }, [activeHistoryChatId, id, sessionChatsReady]);

  const resolveActiveHistoryChatId = useCallback(async (): Promise<string | null> => {
    if (!id) throw new Error('Session unavailable.');
    if (activeChatIdRef.current !== undefined) return activeChatIdRef.current;
    const cached = queryClient.getQueryData<SessionChatListPayload>(['session-chats', id]);
    let payload = cached;
    if (!payload) {
      const response = await api.get<ApiResponse<SessionChatListPayload>>(
        `/api/sessions/${id}/chats`
      );
      if (!response.data.success || !response.data.data) {
        throw new Error('Chat threads could not be loaded.');
      }
      payload = response.data.data;
      queryClient.setQueryData(['session-chats', id], payload);
    }
    const chatId = normalizeMessageChatId(payload.activeChatId) ?? null;
    activeChatIdRef.current = chatId;
    socketService.setSessionChat(id, chatId);
    return chatId;
  }, [id, queryClient]);

  const applyMessageHistory = useCallback(
    (
      response: MessageHistoryResponse,
      options?: {
        replaceWindow?: boolean;
        preserveAfterSequence?: number;
        completeFullResync?: boolean;
      }
    ): Message[] => {
      if (!id) return [];
      const responseChatId = normalizeMessageChatId(response.snapshot?.chatId) ?? null;
      const snapshotMessages = (response.data ?? []).filter((message) =>
        messageBelongsToChat(message, responseChatId)
      );
      const liveMessages = (useSessionStore.getState().messages[id] ?? []).filter((message) => {
        if (!messageBelongsToChat(message, responseChatId)) return false;
        if (!options?.replaceWindow) return true;
        return (message.eventSequence ?? 0) > (options.preserveAfterSequence ?? 0);
      });
      const cursor = socketService.getSessionCursor(id);
      const stale = isMessageSnapshotStale(response.snapshot, messageSnapshotRef.current, cursor);
      const reconciled = mergeMessageHistorySnapshot(snapshotMessages, liveMessages);

      // Even a stale response can safely contribute persisted rows once it is
      // merged with the live store; it must never replace newer socket events.
      setMessages(id, reconciled);
      if (response.snapshot) {
        socketService.recordSessionSnapshot(
          id,
          response.snapshot.highWatermark,
          responseChatId,
          options?.completeFullResync
        );
        const currentChatId = normalizeMessageChatId(messageSnapshotRef.current?.chatId);
        if (!stale || currentChatId !== responseChatId) {
          messageSnapshotRef.current = { ...response.snapshot, chatId: responseChatId };
        }
        activeChatIdRef.current = responseChatId;
      }
      return reconciled;
    },
    [id, setMessages]
  );

  // Fetch messages
  const {
    isLoading: messagesLoading,
    isError: messagesQueryFailed,
    refetch: retryMessages,
  } = useQuery({
    queryKey: ['messages', id, activeHistoryChatKey],
    queryFn: async () => {
      const requestEpoch = messageHistoryEpochRef.current;
      const params = new URLSearchParams({
        limit: String(MESSAGE_HISTORY_PAGE_SIZE),
        chatId: activeHistoryChatId ?? '',
      });
      const response = await api.get<MessageHistoryResponse>(
        `/api/sessions/${id}/messages?${params.toString()}`
      );
      if (response.data.success && response.data.data) {
        if (requestEpoch !== messageHistoryEpochRef.current) return response.data.data;
        if (normalizeMessageChatId(response.data.snapshot?.chatId) !== activeHistoryChatId) {
          throw new Error('The chat changed while its history was loading.');
        }
        const reconciled = applyMessageHistory(response.data, { completeFullResync: true });
        setHistoryPagination(
          response.data.pagination ?? {
            total: reconciled.length,
            limit: MESSAGE_HISTORY_PAGE_SIZE,
            hasMore: false,
            oldestId: reconciled[0]?.id ?? null,
          }
        );
        return reconciled;
      }
      return [];
    },
    enabled: !!id && sessionChatsReady && !isSearchHistoryWindow,
  });

  // Fetch available commands
  const { data: commands } = useQuery({
    queryKey: ['commands', session?.workingDirectory],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Command[]>>(
        `/api/commands?projectPath=${encodeURIComponent(session?.workingDirectory || '')}`
      );
      return response.data.data || [];
    },
    enabled: !!session,
  });

  const loadOlderMessages = useCallback(async () => {
    if (
      !id ||
      isLoadingOlderMessages ||
      !historyPagination.hasMore ||
      !historyPagination.oldestId
    ) {
      return;
    }

    const requestEpoch = messageHistoryEpochRef.current;
    setIsLoadingOlderMessages(true);
    setOlderMessagesError(null);
    try {
      const historyChatId = normalizeMessageChatId(messageSnapshotRef.current?.chatId) ?? null;
      const params = new URLSearchParams({
        limit: String(MESSAGE_HISTORY_PAGE_SIZE),
        before: historyPagination.oldestId,
        chatId: historyChatId ?? '',
      });
      const response = await api.get<MessageHistoryResponse>(
        `/api/sessions/${id}/messages?${params.toString()}`
      );
      if (requestEpoch !== messageHistoryEpochRef.current) return;
      if (normalizeMessageChatId(response.data.snapshot?.chatId) !== historyChatId) {
        throw new Error('The chat changed while older messages were loading.');
      }
      const olderMessages = response.data.data ?? [];
      const currentMessages = useSessionStore.getState().messages[id] ?? [];
      const currentIds = new Set(currentMessages.map((message) => message.id));
      const uniqueOlderMessages = olderMessages.filter((message) => !currentIds.has(message.id));

      if (uniqueOlderMessages.length > 0) {
        setMessages(id, [...uniqueOlderMessages, ...currentMessages]);
        setHistoryFirstItemIndex((current) => current - uniqueOlderMessages.length);
      }

      setHistoryPagination(
        response.data.pagination ?? {
          total: currentMessages.length + uniqueOlderMessages.length,
          limit: MESSAGE_HISTORY_PAGE_SIZE,
          hasMore: false,
          oldestId: uniqueOlderMessages[0]?.id ?? historyPagination.oldestId,
        }
      );
      if (response.data.snapshot) {
        socketService.recordSessionSnapshot(
          id,
          response.data.snapshot.highWatermark,
          historyChatId
        );
        if (
          !isMessageSnapshotStale(
            response.data.snapshot,
            messageSnapshotRef.current,
            socketService.getSessionCursor(id)
          )
        ) {
          messageSnapshotRef.current = response.data.snapshot;
        }
      }
    } catch (error) {
      setOlderMessagesError(
        error instanceof Error ? error.message : 'Older messages could not be loaded.'
      );
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, [
    historyPagination.hasMore,
    historyPagination.oldestId,
    id,
    isLoadingOlderMessages,
    setMessages,
  ]);

  const activateSearchTargetChat = useCallback(
    async (targetChatId: string | null): Promise<SessionChatListPayload> => {
      if (!id) throw new Error('Session unavailable.');
      const targetId = targetChatId ?? 'main';
      messageHistoryEpochRef.current += 1;
      await queryClient.cancelQueries({ queryKey: ['messages', id] });
      // Activation is intentionally idempotent and unconditional. A cached chat
      // list can be stale when another device changed the active thread.
      const response = await api.post<ApiResponse<SessionChatListPayload>>(
        `/api/sessions/${id}/chats/${encodeURIComponent(targetId)}/activate`
      );
      if (!response.data.success) throw new Error('The matching chat could not be activated.');
      if (!response.data.data) throw new Error('The matching chat could not be activated.');
      const activatedChatId = normalizeMessageChatId(response.data.data.activeChatId) ?? null;
      activeChatIdRef.current = activatedChatId;
      socketService.setSessionChat(id, activatedChatId);
      await queryClient.invalidateQueries({ queryKey: ['session', id] });
      return response.data.data;
    },
    [id, queryClient]
  );

  const openMessageSearchResult = useCallback(
    async (result: MessageSearchResult) => {
      if (!id) return;
      const target = getMessageSearchTarget(result);
      if (target.sessionId !== id) {
        const params = new URLSearchParams({ message: target.messageId });
        if (target.chatId) params.set('chat', target.chatId);
        navigate(`/session/${target.sessionId}?${params.toString()}`);
        return;
      }

      setMainView('chat');

      setMessageJumpStatus('Loading the matching part of the conversation…');
      setPendingMessageJump(target.messageId);
      let previousChatId = activeChatIdRef.current;
      let previousChatList = sessionChatList;
      const previousStreamingContent = useSessionStore.getState().streamingContent[id] ?? '';
      const targetChatId = normalizeMessageChatId(target.chatId) ?? null;
      const cursorBeforeRequest = socketService.getSessionCursor(id);
      let activatedPayload: SessionChatListPayload | null = null;
      try {
        if (previousChatId === undefined) {
          previousChatId = await resolveActiveHistoryChatId();
          previousChatList = queryClient.getQueryData<SessionChatListPayload>([
            'session-chats',
            id,
          ]);
        }
        activatedPayload = await activateSearchTargetChat(targetChatId);
        if (previousChatId === targetChatId && jumpToMessage(target.messageId)) {
          queryClient.setQueryData(['session-chats', id], activatedPayload);
          setPendingMessageJump(null);
          return;
        }
        const requestEpoch = messageHistoryEpochRef.current;
        const params = new URLSearchParams({
          limit: String(MESSAGE_JUMP_WINDOW_SIZE),
          around: target.messageId,
          chatId: targetChatId ?? '',
        });
        await loadThenCommit(
          async () => {
            const response = await api.get<MessageHistoryResponse>(
              `/api/sessions/${id}/messages?${params.toString()}`
            );
            if (requestEpoch !== messageHistoryEpochRef.current) {
              throw new Error('The chat changed while the result was loading.');
            }
            const windowMessages = response.data.data ?? [];
            if (!response.data.success || windowMessages.length === 0) {
              throw new Error('The matching message is no longer available.');
            }
            if (normalizeMessageChatId(response.data.snapshot?.chatId) !== targetChatId) {
              throw new Error('The matching message belongs to a different chat.');
            }
            return response.data;
          },
          (history) => {
            // Commit only after the complete pinned snapshot succeeded. Until
            // this point the previous conversation remains visible and intact.
            clearStreamingContent(id);
            messageSnapshotRef.current = undefined;
            setHistoryFirstItemIndex(MESSAGE_HISTORY_FIRST_INDEX);
            setHistoryPagination(
              history.pagination ?? {
                total: history.data?.length ?? 0,
                limit: MESSAGE_JUMP_WINDOW_SIZE,
                hasMore: false,
                hasMoreAfter: false,
                oldestId: history.data?.[0]?.id ?? null,
                newestId: history.data?.at(-1)?.id ?? null,
              }
            );
            setIsSearchHistoryWindow(true);
            applyMessageHistory(history, {
              replaceWindow: true,
              preserveAfterSequence: cursorBeforeRequest,
            });
            queryClient.setQueryData(['session-chats', id], activatedPayload);
          }
        );
      } catch (error) {
        if (activatedPayload && previousChatId !== undefined && previousChatId !== targetChatId) {
          messageHistoryEpochRef.current += 1;
          try {
            const restoredChatId = previousChatId;
            const restoreId = restoredChatId ?? 'main';
            await api.post(`/api/sessions/${id}/chats/${encodeURIComponent(restoreId)}/activate`);
            activeChatIdRef.current = restoredChatId;
            socketService.setSessionChat(id, restoredChatId);
            const sessionStore = useSessionStore.getState();
            sessionStore.clearStreamingContent(id);
            if (previousStreamingContent) {
              sessionStore.appendStreamingContent(id, previousStreamingContent);
            }
            setMessages(
              id,
              (useSessionStore.getState().messages[id] ?? []).filter((message) =>
                messageBelongsToChat(message, restoredChatId)
              )
            );
            if (previousChatList) {
              queryClient.setQueryData(['session-chats', id], previousChatList);
            } else {
              await queryClient.invalidateQueries({ queryKey: ['session-chats', id] });
            }
          } catch {
            await queryClient.invalidateQueries({ queryKey: ['session-chats', id] });
          }
        }
        setPendingMessageJump(null);
        setMessageJumpStatus(
          error instanceof Error ? error.message : 'The matching message could not be loaded.'
        );
        toast({
          title: 'Could not jump to message',
          description:
            error instanceof Error ? error.message : 'The matching message could not be loaded.',
          variant: 'destructive',
        });
      }
    },
    [
      activateSearchTargetChat,
      applyMessageHistory,
      clearStreamingContent,
      id,
      jumpToMessage,
      navigate,
      queryClient,
      resolveActiveHistoryChatId,
      sessionChatList,
      setMessages,
    ]
  );

  const returnToLatestConversation = useCallback(async () => {
    if (!id || isLoadingLatestMessages) return;
    if (!historyPagination.hasMoreAfter) {
      scrollToBottom();
      return;
    }
    const chatId = normalizeMessageChatId(messageSnapshotRef.current?.chatId) ?? null;
    const requestEpoch = messageHistoryEpochRef.current;
    const cursorBeforeRequest = socketService.getSessionCursor(id);
    const params = new URLSearchParams({
      limit: String(MESSAGE_HISTORY_PAGE_SIZE),
      chatId: chatId ?? '',
    });
    setIsLoadingLatestMessages(true);
    setMessageJumpStatus('Loading the latest messages…');
    try {
      await loadThenCommit(
        async () => {
          const response = await api.get<MessageHistoryResponse>(
            `/api/sessions/${id}/messages?${params.toString()}`
          );
          if (
            requestEpoch !== messageHistoryEpochRef.current ||
            !response.data.success ||
            !response.data.data ||
            normalizeMessageChatId(response.data.snapshot?.chatId) !== chatId
          ) {
            throw new Error('The latest conversation could not be verified.');
          }
          return response.data;
        },
        (history) => {
          const reconciled = applyMessageHistory(history, {
            replaceWindow: true,
            preserveAfterSequence: cursorBeforeRequest,
            completeFullResync: true,
          });
          setHistoryFirstItemIndex(MESSAGE_HISTORY_FIRST_INDEX);
          setHistoryPagination(
            history.pagination ?? {
              total: reconciled.length,
              limit: MESSAGE_HISTORY_PAGE_SIZE,
              hasMore: false,
              hasMoreAfter: false,
              oldestId: reconciled[0]?.id ?? null,
              newestId: reconciled.at(-1)?.id ?? null,
            }
          );
          setIsSearchHistoryWindow(false);
        }
      );
      setMessageJumpStatus('Moved to the latest messages.');
      window.requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'auto' });
        setIsAtBottom(true);
      });
    } catch (error) {
      const description =
        error instanceof Error ? error.message : 'The latest messages could not be loaded.';
      setMessageJumpStatus(description);
      toast({ title: 'Could not load latest messages', description, variant: 'destructive' });
    } finally {
      setIsLoadingLatestMessages(false);
    }
  }, [
    applyMessageHistory,
    historyPagination.hasMoreAfter,
    id,
    isLoadingLatestMessages,
    scrollToBottom,
  ]);

  useEffect(() => {
    const messageId = searchParams.get('message');
    if (!id || !messageId) return;
    const jumpKey = `${id}:${messageId}`;
    if (handledUrlJumpRef.current === jumpKey) return;
    handledUrlJumpRef.current = jumpKey;
    void openMessageSearchResult({
      id: messageId,
      sessionId: id,
      chatId: searchParams.get('chat'),
      role: 'system',
      content: '',
      createdAt: new Date(0).toISOString(),
    });
  }, [id, openMessageSearchResult, searchParams]);

  useEffect(() => {
    const handleFullResync = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!id || detail?.sessionId !== id) return;
      setMessageJumpStatus('Refreshing the conversation after reconnect…');
      const requestEpoch = messageHistoryEpochRef.current;
      void loadThenCommit(
        async () => {
          const chatId = await resolveActiveHistoryChatId();
          const params = new URLSearchParams({
            limit: String(MESSAGE_HISTORY_PAGE_SIZE),
            chatId: chatId ?? '',
          });
          const response = await api.get<MessageHistoryResponse>(
            `/api/sessions/${id}/messages?${params.toString()}`
          );
          if (
            requestEpoch !== messageHistoryEpochRef.current ||
            !response.data.success ||
            !response.data.data ||
            normalizeMessageChatId(response.data.snapshot?.chatId) !== chatId
          ) {
            throw new Error('The reconnect snapshot could not be verified.');
          }
          return response.data;
        },
        (history) => {
          const reconciled = applyMessageHistory(history, { completeFullResync: true });
          setHistoryFirstItemIndex(MESSAGE_HISTORY_FIRST_INDEX);
          setHistoryPagination(
            history.pagination ?? {
              total: reconciled.length,
              limit: MESSAGE_HISTORY_PAGE_SIZE,
              hasMore: false,
              hasMoreAfter: false,
              oldestId: reconciled[0]?.id ?? null,
              newestId: reconciled.at(-1)?.id ?? null,
            }
          );
          setIsSearchHistoryWindow(false);
        }
      )
        .then(() => {
          setMessageJumpStatus('Conversation refreshed.');
          void retrySession();
        })
        .catch((error) => {
          setMessageJumpStatus(
            error instanceof Error ? error.message : 'Conversation refresh failed.'
          );
        });
    };
    window.addEventListener('plum:session-full-resync', handleFullResync);
    return () => window.removeEventListener('plum:session-full-resync', handleFullResync);
  }, [applyMessageHistory, id, resolveActiveHistoryChatId, retrySession]);

  const latestMessageId = sessionMessages[sessionMessages.length - 1]?.id ?? null;
  useEffect(() => {
    if (!id || !isAtBottom || historyPagination.hasMoreAfter || !latestMessageId) return;
    const readKey = `${id}:${latestMessageId}`;
    if (lastReadSentRef.current === readKey) return;
    const timeout = window.setTimeout(() => {
      lastReadSentRef.current = readKey;
      void api
        .put<ApiResponse<SessionReadState>>(`/api/sessions/${id}/read-state`, {
          chatId: activeChatIdRef.current ?? null,
          lastReadMessageId: latestMessageId,
        })
        .then(() => {
          // REST is the single authoritative read-marker write. Presence only
          // advertises that this web client is viewing the conversation.
          socketService.setSessionPresence(id, 'active');
          void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        })
        .catch((error) => {
          socketService.setSessionPresence(id, 'active');
          // Legacy servers do not expose read state. Presence and chat remain usable.
          if (!(error instanceof ApiError) || error.status !== 404) {
            console.warn('[READ-STATE] Could not persist read position:', error);
          }
        });
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [historyPagination.hasMoreAfter, id, isAtBottom, latestMessageId, queryClient]);

  const homeAssistantLightMutation = useMutation({
    mutationFn: async (entityId: string | null) => {
      const response = await api.put<ApiResponse<{ entityId: string | null }>>(
        `/api/home-assistant/sessions/${id}/light`,
        { entityId }
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      if (!id || !data) return;
      const update = { homeAssistantEntityId: data.entityId };
      queryClient.setQueryData<Session>(['session', id], (current) =>
        current ? { ...current, ...update } : current
      );
      useSessionStore.getState().updateSession(id, update);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast({
        title: data.entityId ? 'Status light connected' : 'Status light disconnected',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Light assignment failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const homeAssistantPreviewMutation = useMutation({
    mutationFn: async (status: HomeAssistantStatus) => {
      await api.post(`/api/home-assistant/sessions/${id}/test`, { status });
      return status;
    },
    onSuccess: (status) => {
      toast({ title: `Testing ${status} light pattern` });
    },
    onError: (error: Error) => {
      toast({ title: 'Light preview failed', description: error.message, variant: 'destructive' });
    },
  });

  const providerMutation = useMutation({
    mutationFn: async (provider: CLIProvider) => {
      const response = await api.patch<ApiResponse<Session>>(`/api/sessions/${id}/provider`, {
        cliProvider: provider,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data && id) {
        queryClient.setQueryData(['session', id], data.data);
        useSessionStore.getState().updateSession(id, data.data);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        toast({
          title: 'Provider switched',
          description: 'The running session was reloaded with the new provider.',
        });
      }
    },
  });

  const sessionModelMutation = useMutation({
    mutationFn: async (model: string | null) => {
      const response = await api.patch<ApiResponse<Session>>(`/api/sessions/${id}/model`, {
        model,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data && id) {
        queryClient.setQueryData(['session', id], data.data);
        useSessionStore.getState().updateSession(id, data.data);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        toast({
          title: 'Model updated',
          description:
            session?.status === 'running'
              ? 'The running session was reloaded with the new model.'
              : 'The new model will be used when the session starts.',
        });
      }
    },
  });

  // Routable subagent model groups (Z.AI + custom upstreams). Only fetched for
  // Claude-transport sessions — the override rides on CLAUDE_CODE_SUBAGENT_MODEL.
  const isClaudeTransportSession = sessionProvider === 'claude' || sessionProvider === 'zai';
  const { data: subagentModelGroups = [] } = useQuery({
    queryKey: ['subagent-models'],
    queryFn: async () => {
      const response = await api.get<{
        success: boolean;
        data: Array<{ group: string; models: string[] }>;
      }>('/api/settings/subagent-models');
      return response.data.data;
    },
    enabled: isClaudeTransportSession,
  });

  const sessionSubagentModelMutation = useMutation({
    mutationFn: async (model: string | null) => {
      const response = await api.patch<ApiResponse<Session>>(`/api/sessions/${id}/subagent-model`, {
        model,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data && id) {
        queryClient.setQueryData(['session', id], data.data);
        useSessionStore.getState().updateSession(id, data.data);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        toast({
          title: 'Subagent model updated',
          description:
            session?.status === 'running'
              ? 'The running session was reloaded; new subagents use the selected model.'
              : 'Subagents will use the selected model when the session starts.',
        });
      }
    },
  });

  // Whole CLIs this account may hand work to through the `subagents` MCP tool.
  // Independent of the provider running the session and of the model router
  // above, so it is listed for every harness -- otherwise a configured target
  // (pi, say) has no surface at all until it happens to be running.
  const { data: cliSubagents = [] } = useQuery({
    queryKey: ['cli-subagents'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CliSubagentSummary[]>>(
        '/api/settings/cli-subagents'
      );
      return response.data.data ?? [];
    },
    staleTime: 60_000,
  });

  const cliSubagentsSaveMutation = useMutation({
    mutationFn: async (next: CliSubagentSummary[]) => {
      const response = await api.put<ApiResponse<CliSubagentSummary[]>>(
        '/api/settings/cli-subagents',
        next.map((entry) => ({
          id: entry.id,
          label: entry.label,
          provider: entry.provider,
          model: entry.model ?? '',
          enabled: entry.enabled,
        }))
      );
      return response.data.data ?? [];
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['cli-subagents'], data);
      toast({
        title: 'Subagenten aktualisiert',
        description: 'Neue Sessions und neu gestartete Harnesses nutzen die Auswahl.',
      });
    },
  });

  /**
   * One control per delegable CLI: off, provider default, or a specific model.
   * A worker's model is worth choosing per task -- pi alone routes a couple of
   * dozen -- so the pick belongs next to the switch, not only in Settings.
   */
  const applyCliSubagentChoice = useCallback(
    (entryId: string, choice: string) => {
      if (cliSubagentsSaveMutation.isPending) return;
      cliSubagentsSaveMutation.mutate(
        cliSubagents.map((entry) => {
          if (entry.id !== entryId) return entry;
          if (choice === CLI_SUBAGENT_OFF) return { ...entry, enabled: false };
          if (choice === CLI_SUBAGENT_DEFAULT_MODEL) return { ...entry, enabled: true, model: '' };
          return { ...entry, enabled: true, model: choice };
        })
      );
    },
    [cliSubagents, cliSubagentsSaveMutation]
  );

  const sessionReasoningMutation = useMutation({
    mutationFn: async (reasoning: string | null) => {
      const response = await api.patch<ApiResponse<Session>>(`/api/sessions/${id}/reasoning`, {
        reasoning,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data && id) {
        queryClient.setQueryData(['session', id], data.data);
        useSessionStore.getState().updateSession(id, data.data);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        toast({
          title: 'Reasoning updated',
          description:
            session?.status === 'running'
              ? 'The running session was reloaded with the new reasoning level.'
              : 'The new reasoning level will be used when the session starts.',
        });
      }
    },
  });

  const sessionServiceTierMutation = useMutation({
    mutationFn: async (serviceTier: string | null) => {
      const response = await api.patch<ApiResponse<Session>>(`/api/sessions/${id}/service-tier`, {
        serviceTier,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data && id) {
        queryClient.setQueryData(['session', id], data.data);
        useSessionStore.getState().updateSession(id, data.data);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        toast({
          title: data.data.cliServiceTier === 'fast' ? 'Fast enabled' : 'Fast disabled',
          description:
            session?.status === 'running'
              ? 'The running session was reloaded to apply Fast mode.'
              : 'Fast mode will be applied when the session starts.',
        });
      }
    },
  });

  const sessionSurfaceMutation = useMutation({
    mutationFn: async (surface: SessionSurface) => {
      const response = await api.patch<ApiResponse<Session>>(`/api/sessions/${id}/surface`, {
        surface,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data && id) {
        queryClient.setQueryData(['session', id], data.data);
        useSessionStore.getState().updateSession(id, data.data);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Surface update failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const linkPeerMutation = useMutation({
    mutationFn: async ({ targetSessionId, role }: { targetSessionId: string; role: string }) => {
      const response = await api.post<ApiResponse<SessionPeerLink>>(`/api/sessions/${id}/peers`, {
        targetSessionId,
        role: role.trim() || null,
      });
      return response.data.data;
    },
    onSuccess: (peer) => {
      queryClient.invalidateQueries({ queryKey: ['session-peers', id] });
      if (peer?.targetSessionId) setMeshDelegationTargetId(peer.targetSessionId);
      toast({
        title: 'Peer linked',
        description: peer?.target?.name ? `${peer.target.name} can now be consulted.` : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Peer link failed', description: error.message, variant: 'destructive' });
    },
  });

  const unlinkPeerMutation = useMutation({
    mutationFn: async (targetSessionId: string) => {
      await api.delete(`/api/sessions/${id}/peers/${encodeURIComponent(targetSessionId)}`);
      return targetSessionId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-peers', id] });
      toast({ title: 'Peer unlinked' });
    },
    onError: (error: Error) => {
      toast({ title: 'Unlink failed', description: error.message, variant: 'destructive' });
    },
  });

  const createDelegationMutation = useMutation({
    mutationFn: async ({ toSessionId, content }: { toSessionId: string; content: string }) => {
      const response = await api.post<ApiResponse<SessionDelegation>>(
        `/api/sessions/${id}/delegations`,
        {
          toSessionId,
          content,
          kind: 'consult',
        }
      );
      return response.data.data;
    },
    onSuccess: (delegation) => {
      queryClient.invalidateQueries({ queryKey: ['session-delegations', id] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast({
        title: 'Delegation sent',
        description: delegation?.correlationId,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Delegation failed', description: error.message, variant: 'destructive' });
    },
  });

  // Connect to socket and subscribe to session (with reconnect support)
  useEffect(() => {
    if (!id) return;

    socketService.connect();
    // Use reconnect instead of subscribe to get buffered messages if session is running.
    // Pass the stored lastTimestamp so returning to a previously-visited session only
    // replays messages newer than what we've already rendered — otherwise the server
    // resends its whole buffer and Virtuoso re-mounts the entire thread.
    const lastTimestamp = useSessionStore.getState().lastMessageTimestamp[id];
    socketService.reconnectToSession(id, lastTimestamp);

    return () => {
      socketService.unsubscribeFromSession(id);
    };
  }, [id, sessionModeStorageKey]);

  // Handle tab visibility changes - reconnect with timestamp when tab becomes visible
  useEffect(() => {
    if (!id) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[TAB] Tab became visible, reconnecting to session...');
        const lastTimestamp = useSessionStore.getState().lastMessageTimestamp[id];
        socketService.reconnectToSession(id, lastTimestamp);
      } else {
        socketService.setSessionPresence(id, 'idle');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [id]);

  // Handle Escape key to interrupt session (like CLI Ctrl+C)
  useEffect(() => {
    if (!id) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger on Escape when Claude is active and not typing in an input
      if (e.key === 'Escape' && canInterruptActiveRun) {
        const target = e.target as HTMLElement;
        const isTyping =
          target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

        // If typing, let first Escape blur the input, second Escape interrupts
        if (isTyping && document.activeElement === target) {
          return; // Let the input handle the first Escape
        }

        e.preventDefault();
        console.log('[INTERRUPT] Escape pressed, interrupting session...');
        socketService.interruptSession(id);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [id, canInterruptActiveRun]);

  useEffect(() => {
    if (!id) return;
    setActiveSession(id);
    return () => setActiveSession(null);
  }, [id, setActiveSession]);

  useEffect(() => {
    setHistoryFirstItemIndex(MESSAGE_HISTORY_FIRST_INDEX);
    setHistoryPagination({
      total: 0,
      limit: MESSAGE_HISTORY_PAGE_SIZE,
      hasMore: false,
      oldestId: null,
    });
    setIsLoadingOlderMessages(false);
    setIsLoadingLatestMessages(false);
    setIsSearchHistoryWindow(false);
    setOlderMessagesError(null);
  }, [id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateNetworkState = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateNetworkState);
    window.addEventListener('offline', updateNetworkState);
    return () => {
      window.removeEventListener('online', updateNetworkState);
      window.removeEventListener('offline', updateNetworkState);
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    const unsubscribe = socketService.onModeChange((data) => {
      if (data.sessionId !== id) return;
      setSessionMode(data.mode);
      if (sessionModeStorageKey) {
        try {
          window.localStorage.setItem(sessionModeStorageKey, data.mode);
        } catch {
          // Ignore storage errors
        }
      }
    });
    return unsubscribe;
  }, [id, sessionModeStorageKey]);

  useEffect(() => {
    if (isTaskSurface && mainView !== 'chat') {
      setMainView('chat');
    }
  }, [isTaskSurface, mainView]);

  // Show a brief indicator when an assistant message is persisted
  useEffect(() => {
    if (!id || sessionMessages.length === 0) {
      lastMessageIdRef.current = null;
      return;
    }

    const lastMessage = sessionMessages[sessionMessages.length - 1];
    if (!lastMessage) return;

    const previousId = lastMessageIdRef.current;
    lastMessageIdRef.current = lastMessage.id;

    if (previousId && lastMessage.id !== previousId && lastMessage.role === 'assistant') {
      setShowSavedIndicator(true);
    }
  }, [id, sessionMessages]);

  useEffect(() => {
    if (!showSavedIndicator) return;
    const timeout = window.setTimeout(() => {
      setShowSavedIndicator(false);
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [showSavedIndicator]);

  const maybeAutoSetGoal = useCallback(
    (message: string) => {
      if (!id || sessionProvider !== 'codex' || currentTodos.length > 0) return;

      const objective = buildAutoGoalObjective(message);
      if (!objective) return;
      if (autoGoalBySessionRef.current[id] === objective) return;

      autoGoalBySessionRef.current[id] = objective;
      socketService.sendMessage(id, `/goal ${objective}`);
    },
    [currentTodos.length, id, sessionProvider]
  );

  // Callbacks for ChatInput
  const handleSendMessage = useCallback(
    async (message: string, options?: ChatSendOptions) => {
      if (!id) return;
      await resolveActiveHistoryChatId();
      maybeAutoSetGoal(message);
      const acknowledgement = await socketService.sendMessage(
        id,
        message,
        undefined,
        activeSendFollowupMode,
        options?.clientMessageId
      );
      if (acknowledgement.status !== 'rejected') {
        clearStreamingContent(id);
      }
      return acknowledgement;
    },
    [
      id,
      maybeAutoSetGoal,
      activeSendFollowupMode,
      clearStreamingContent,
      resolveActiveHistoryChatId,
    ]
  );

  const handleSendMessageWithFiles = useCallback(
    async (message: string, files: File[], options?: ChatSendOptions) => {
      if (!id) return;
      setIsSending(true);
      try {
        await resolveActiveHistoryChatId();
        maybeAutoSetGoal(message);
        const acknowledgement = await socketService.sendMessageWithFiles(
          id,
          message,
          files,
          activeSendFollowupMode,
          options?.clientMessageId,
          {
            signal: options?.signal,
            onProgress: options?.onUploadProgress,
          }
        );
        if (acknowledgement.status !== 'rejected') {
          clearStreamingContent(id);
        }
        return acknowledgement;
      } finally {
        setIsSending(false);
      }
    },
    [
      id,
      maybeAutoSetGoal,
      activeSendFollowupMode,
      clearStreamingContent,
      resolveActiveHistoryChatId,
    ]
  );

  const handleCommandExecute = useCallback(
    async (input: string) => {
      if (!id) return;

      const appendAssistant = (content: string) => {
        addMessage(id, {
          id: generateId(),
          sessionId: id,
          chatId: activeChatIdRef.current ?? null,
          role: 'assistant',
          content,
          createdAt: new Date().toISOString(),
        });
      };

      try {
        const response = await api.post<ApiResponse<CommandExecutionResult>>(
          '/api/commands/execute',
          {
            input,
            projectPath: session?.workingDirectory,
            sessionId: id,
            currentModel: resolvedDefaultModel || CLI_PROVIDER_DEFAULT_MODEL[sessionProvider],
            provider: sessionProvider,
            usage: visibleUsage
              ? {
                  inputTokens: visibleUsage.inputTokens,
                  outputTokens: visibleUsage.outputTokens,
                  cacheReadTokens: visibleUsage.cacheReadTokens,
                  cacheCreationTokens: visibleUsage.cacheCreationTokens,
                  totalTokens: visibleUsage.totalTokens,
                  contextWindow: visibleUsage.contextWindow,
                  contextUsedPercent: visibleUsage.contextUsedPercent,
                  cost: visibleUsage.totalCostUsd,
                }
              : undefined,
          }
        );

        const result = response.data.data;
        if (!result) return;

        if (!result.success && result.error) {
          appendAssistant(`⚠️ ${result.error}`);
          return;
        }

        const data = (result.data ?? {}) as Record<string, unknown>;

        switch (result.action) {
          case 'clear':
            setMessages(id, []);
            break;

          case 'send_message':
          case 'forward_to_cli':
            if (result.response) socketService.sendMessage(id, result.response);
            break;

          case 'open_login': {
            const provider =
              typeof data.provider === 'string' && data.provider ? data.provider : 'codex';
            window.location.href = `/auth/${encodeURIComponent(provider)}`;
            toast({
              title: 'Login',
              description: `Opening ${provider} login flow.`,
            });
            break;
          }

          case 'rename_session': {
            const name = typeof data.name === 'string' ? data.name : '';
            if (!name) break;
            try {
              await api.put(`/api/sessions/${id}`, { name });
              await queryClient.invalidateQueries({ queryKey: ['session', id] });
              await queryClient.invalidateQueries({ queryKey: ['sessions'] });
              toast({ title: 'Session renamed', description: `Now called "${name}".` });
            } catch (err) {
              toast({
                title: 'Rename failed',
                description: err instanceof Error ? err.message : 'Unknown error',
                variant: 'destructive',
              });
            }
            break;
          }

          case 'copy_response': {
            const n = typeof data.n === 'number' && data.n > 0 ? data.n : 1;
            const assistantMessages = sessionMessages.filter((m) => m.role === 'assistant');
            const target = assistantMessages[assistantMessages.length - n];
            if (!target?.content) {
              toast({ title: 'Nothing to copy', description: 'No matching response found.' });
              break;
            }
            try {
              await navigator.clipboard.writeText(target.content);
              toast({
                title: 'Copied',
                description:
                  n > 1
                    ? `Response #${n} copied to clipboard.`
                    : 'Last response copied to clipboard.',
              });
            } catch {
              toast({
                title: 'Copy failed',
                description: 'Clipboard access denied by browser.',
                variant: 'destructive',
              });
            }
            break;
          }

          case 'export_conversation': {
            const filename =
              typeof data.filename === 'string' && data.filename
                ? data.filename
                : `session-${id}-${new Date().toISOString().slice(0, 10)}.txt`;
            const body = sessionMessages
              .map(
                (m) =>
                  `### ${m.role.toUpperCase()} · ${new Date(m.createdAt).toISOString()}\n\n${m.content}\n`
              )
              .join('\n---\n\n');
            const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast({
              title: 'Exported',
              description: `Saved ${filename} (${sessionMessages.length} messages).`,
            });
            break;
          }

          case 'new_session':
            navigate('/?new=true');
            break;

          case 'resume_session':
            navigate('/');
            toast({ title: 'Session picker', description: 'Pick a session from the dashboard.' });
            break;

          case 'open_settings': {
            const tab = typeof data.tab === 'string' ? data.tab : undefined;
            const section = typeof data.section === 'string' ? data.section : undefined;
            const params = new URLSearchParams();
            if (tab) params.set('tab', tab);
            if (section) params.set('section', section);
            const query = params.toString();
            navigate(query ? `/settings?${query}` : '/settings');
            break;
          }

          case 'open_permissions':
            navigate('/settings?tab=security');
            break;

          case 'open_diff':
            toast({
              title: 'Git diff',
              description: 'Open the Git panel from the side dock to view uncommitted changes.',
            });
            break;

          case 'open_feedback': {
            const report = typeof data.report === 'string' ? data.report : '';
            const url = report
              ? `https://github.com/anthropics/claude-code/issues/new?title=${encodeURIComponent(report.slice(0, 80))}&body=${encodeURIComponent(report)}`
              : 'https://github.com/anthropics/claude-code/issues/new';
            window.open(url, '_blank', 'noopener,noreferrer');
            toast({ title: 'Feedback', description: 'Opening GitHub issues in a new tab.' });
            break;
          }

          case 'show_doctor': {
            const lines = [
              '**WebUI Diagnostics**',
              '',
              `- Session ID: \`${id}\``,
              `- Provider: ${sessionProvider}`,
              `- Model: ${resolvedDefaultModel || CLI_PROVIDER_DEFAULT_MODEL[sessionProvider]}`,
              `- Working directory: ${session?.workingDirectory ?? 'none'}`,
              `- Status: ${session?.status ?? 'unknown'}`,
              `- Messages: ${sessionMessages.length}`,
              visibleUsage
                ? `- Usage: ${visibleUsage.inputTokens.toLocaleString()} in / ${visibleUsage.outputTokens.toLocaleString()} out, $${visibleUsage.totalCostUsd.toFixed(4)}`
                : '- Usage: no data',
            ].filter((line): line is string => typeof line === 'string');
            appendAssistant(lines.join('\n'));
            break;
          }

          default:
            if (result.response) appendAssistant(result.response);
            break;
        }
      } catch (error) {
        console.error('Command execution failed:', error);
        appendAssistant(
          `⚠️ Command failed: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    },
    [
      id,
      session?.workingDirectory,
      session?.status,
      visibleUsage,
      sessionMessages,
      sessionProvider,
      resolvedDefaultModel,
      setMessages,
      addMessage,
      navigate,
      queryClient,
    ]
  );

  const handleInterrupt = useCallback(() => {
    if (!id) return;
    socketService.interruptSession(id);
  }, [id]);

  const handleRestart = () => {
    if (!id) return;
    socketService.restartSession(id);
  };

  const applyModelSelection = (value: string) => {
    if (!sessionProvider) return;
    if (!id) return;
    const current = session?.cliModel || '';
    const nextValue = value === '__default__' ? '' : value.trim();
    if (nextValue === current) return;

    sessionModelMutation.mutate(nextValue || null);
  };

  const applyReasoningSelection = (value: string) => {
    if (!sessionProvider) return;
    if (!id) return;
    const current = session?.cliReasoning || '';
    const nextValue =
      value === '__default__'
        ? ''
        : value
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_');
    if (nextValue === current) return;

    sessionReasoningMutation.mutate(nextValue || null);
  };

  const applyServiceTier = sessionServiceTierMutation.mutate;
  const handleFastModeToggle = useCallback(() => {
    if (sessionProvider !== 'codex' || !id) return;
    const current = session?.cliServiceTier || '';
    const nextValue = fastModeActive ? '' : 'fast';
    if (nextValue === current) return;
    applyServiceTier(nextValue || null);
  }, [sessionProvider, id, session?.cliServiceTier, fastModeActive, applyServiceTier]);

  const applySurfaceSelection = (surface: SessionSurface) => {
    if (!id || surface === sessionSurface) return;
    sessionSurfaceMutation.mutate(surface);
    if (surface === 'task') {
      setMainView('chat');
    }
  };

  const handleModeChange = useCallback(
    (newMode: SessionMode) => {
      setSessionMode(newMode);
      if (id) {
        socketService.setSessionMode(id, newMode);
        // Persist to the DB so the mode survives browser/device switches. Fire-and-forget:
        // the socket call is the authoritative runtime signal; this PATCH just updates the
        // row that subsequent loads read from. Errors are logged but don't block the UI.
        api.patch(`/api/sessions/${id}/mode`, { mode: newMode }).catch((err) => {
          console.warn('Failed to persist session mode', err);
        });
      }
      if (sessionModeStorageKey) {
        try {
          window.localStorage.setItem(sessionModeStorageKey, newMode);
        } catch {
          // Ignore storage errors
        }
      }
    },
    [id, sessionModeStorageKey]
  );

  /**
   * Download the whole transcript as Markdown. Goes through fetch rather than a
   * plain link so the session cookie and the auth interceptor both apply.
   */
  const handleExportSession = useCallback(async () => {
    if (!id) return;
    try {
      const response = await api.download(`/api/sessions/${id}/export`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(session?.name || 'session').replace(/[^a-zA-Z0-9-_]+/g, '-')}.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed', error);
      toast({ title: 'Export failed', variant: 'destructive' });
    }
  }, [id, session?.name]);

  /** Freeze this session's provider/model/directory setup as a reusable start. */
  const handleSaveTemplate = useCallback(
    async (name: string) => {
      if (!session) return;
      try {
        await api.post('/api/workspace/templates', {
          name,
          cliProvider: session.cliProvider ?? null,
          cliModel: session.cliModel ?? null,
          cliReasoning: session.cliReasoning ?? null,
          mode: session.mode ?? null,
          workingDirectory: session.workingDirectory ?? null,
          designStyleSkill: session.designStyleSkill ?? null,
          writingStyleSkill: session.writingStyleSkill ?? null,
        });
        toast({ title: 'Template saved', description: name });
      } catch (error) {
        console.error('Template save failed', error);
        toast({ title: 'Could not save template', variant: 'destructive' });
      }
    },
    [session]
  );

  // Handler for hooks-based permission response
  const handlePermissionResponse = useCallback(
    async (action: PermissionAction, pattern?: string) => {
      if (!id || !currentPendingPermission) return;
      try {
        await socketService.respondToPermission(
          id,
          currentPendingPermission.requestId,
          action,
          pattern
        );
      } catch (error) {
        console.error('Failed to respond to permission request:', error);
      }
    },
    [id, currentPendingPermission]
  );

  const handleQuestionResponse = useCallback(
    async (answers: string[][]) => {
      if (!id || !currentPendingQuestion) return;
      try {
        await socketService.respondToQuestion(
          id,
          currentPendingQuestion.requestId,
          answers,
          currentPendingQuestion.providerSessionId
        );
      } catch (error) {
        console.error('Failed to respond to OpenCode question:', error);
      }
    },
    [id, currentPendingQuestion]
  );

  const handleQuestionReject = useCallback(async () => {
    if (!id || !currentPendingQuestion) return;
    try {
      await socketService.rejectQuestion(
        id,
        currentPendingQuestion.requestId,
        currentPendingQuestion.providerSessionId
      );
    } catch (error) {
      console.error('Failed to reject OpenCode question:', error);
    }
  }, [id, currentPendingQuestion]);

  const handleCancelCliTool = () => {
    if (cliToolAbortRef.current) {
      cliToolAbortRef.current.abort();
    }
  };

  const handleReviewChanges = useCallback(() => {
    if (!id) return;
    socketService.sendMessage(id, '/review');
    clearStreamingContent(id);
  }, [clearStreamingContent, id]);

  const handleGoalSubmit = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const objective = goalDraft.trim();
      if (!objective || !id) return;

      await handleCommandExecute(`/goal ${objective}`);
      setGoalDraft('');
    },
    [goalDraft, handleCommandExecute, id]
  );

  const meshPeers = useMemo(() => meshPeersQuery.data || [], [meshPeersQuery.data]);
  const meshPeerTargetIds = useMemo(
    () => new Set(meshPeers.filter((peer) => peer.enabled).map((peer) => peer.targetSessionId)),
    [meshPeers]
  );
  const meshAvailableSessions = useMemo(
    () =>
      (meshSessions || [])
        .filter((candidate) => candidate.id !== id && !meshPeerTargetIds.has(candidate.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [id, meshPeerTargetIds, meshSessions]
  );
  const meshDelegationTargets = useMemo(() => {
    const linked = meshPeers
      .filter((peer) => peer.enabled)
      .map((peer) => ({
        id: peer.target.id,
        name: peer.target.name,
        provider: peer.target.cliProvider,
        status: peer.target.status,
      }));
    const linkedIds = new Set(linked.map((peer) => peer.id));
    const fallback = (meshSessions || [])
      .filter((candidate) => candidate.id !== id && !linkedIds.has(candidate.id))
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        provider: candidate.cliProvider,
        status: candidate.status,
      }));
    return [...linked, ...fallback].sort((a, b) => a.name.localeCompare(b.name));
  }, [id, meshPeers, meshSessions]);
  const meshRecentDelegations = (meshDelegationsQuery.data || []).slice(0, 8);

  useEffect(() => {
    if (
      meshTargetSessionId &&
      meshAvailableSessions.some((item) => item.id === meshTargetSessionId)
    ) {
      return;
    }
    setMeshTargetSessionId(meshAvailableSessions[0]?.id || '');
  }, [meshAvailableSessions, meshTargetSessionId]);

  useEffect(() => {
    if (
      meshDelegationTargetId &&
      meshDelegationTargets.some((item) => item.id === meshDelegationTargetId)
    ) {
      return;
    }
    setMeshDelegationTargetId(meshDelegationTargets[0]?.id || '');
  }, [meshDelegationTargetId, meshDelegationTargets]);

  const pendingTasksCount = currentTodos.filter((t) => t.status !== 'completed').length;
  const completedTasksCount = currentTodos.filter((t) => t.status === 'completed').length;
  const totalTasksCount = currentTodos.length;
  const sessionConfirmedMissing =
    sessionQueryError instanceof ApiError && sessionQueryError.status === 404;
  const hasInitialSessionError = sessionQueryFailed && !session;
  const hasInitialMessagesError = messagesQueryFailed && sessionMessages.length === 0;

  if ((sessionLoading && !session) || (messagesLoading && sessionMessages.length === 0)) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loader" />
      </div>
    );
  }

  if (hasInitialSessionError && !sessionConfirmedMissing) {
    return (
      <div className="flex min-h-[20rem] items-center justify-center px-5">
        <div
          role="alert"
          className="glass max-w-md rounded-2xl border border-border/70 p-6 text-center"
        >
          <p className="font-semibold text-foreground">
            {isOnline ? 'Session could not be loaded' : 'You are offline'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {isOnline
              ? 'The server did not answer. Your cached chat remains untouched.'
              : 'Reconnect to refresh this session. Existing cached content is preserved.'}
          </p>
          <button
            type="button"
            className="ui-pill ui-pill-subtle mt-4 min-h-10 px-4"
            onClick={() => void retrySession()}
          >
            <RotateCcw className="h-4 w-4" />
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!session || sessionConfirmedMissing) {
    return (
      <div className="flex min-h-[20rem] items-center justify-center px-5 text-center">
        <div>
          <p className="font-semibold text-foreground">Session not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted or you may no longer have access.
          </p>
        </div>
      </div>
    );
  }

  const goalObjective = goalDraft.trim();
  const canUseCodexGoal = sessionProvider === 'codex';
  const goalObjectiveTooLong = goalObjective.length > 4000;
  const visibleDockedPanels: WorkspaceSheetPanel[] = isTaskSurface
    ? ['tasks', 'mesh', 'designStyle', 'writingStyle', 'browser']
    : DOCKED_PANEL_KEYS;
  const hasVisiblePinnedPanel = visibleDockedPanels.some((panel) => pinnedPanels[panel]);
  const activeStyleCount = (session.designStyleSkill ? 1 : 0) + (session.writingStyleSkill ? 1 : 0);
  const styleMenuPanels = visibleDockedPanels.filter((panel) => STYLE_PANEL_KEYS.includes(panel));
  const workspaceMenuPanels = visibleDockedPanels.filter(
    (panel) => !STYLE_PANEL_KEYS.includes(panel)
  );
  const hasPinnedWorkspacePanel = workspaceMenuPanels.some((panel) => pinnedPanels[panel]);
  const handleStyleSessionUpdated = (updatedSession: Session) => {
    queryClient.setQueryData(['session', id], updatedSession);
    if (id) {
      useSessionStore.getState().updateSession(id, updatedSession);
    }
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
  };

  const tasksBody = (
    <div className="session-goal-task-panel">
      <form className="session-goal-card" onSubmit={handleGoalSubmit}>
        <div className="session-goal-card-header">
          <span className="session-goal-icon">
            <ListTodo className="h-4 w-4" />
          </span>
          <span className="session-goal-copy">
            <span className="session-goal-title">Goal</span>
            <span className="session-goal-kicker">{canUseCodexGoal ? '/goal' : 'Codex only'}</span>
          </span>
        </div>
        <textarea
          className="session-goal-input"
          value={goalDraft}
          onChange={(event) => setGoalDraft(event.target.value)}
          disabled={!canUseCodexGoal}
          rows={3}
          maxLength={4200}
          placeholder={
            canUseCodexGoal ? 'Objective for this session' : 'Switch to Codex to set a goal'
          }
        />
        <div className="session-goal-footer">
          <span className={cn('session-goal-status', goalObjectiveTooLong && 'is-error')}>
            {!canUseCodexGoal
              ? 'Unavailable'
              : goalObjectiveTooLong
                ? 'Max 4,000 chars'
                : 'Auto on long tasks'}
          </span>
          <button
            type="submit"
            className="session-goal-submit"
            disabled={!canUseCodexGoal || !goalObjective || goalObjectiveTooLong}
          >
            Set /goal
          </button>
        </div>
      </form>

      {currentTodos.length === 0 ? (
        <div className="session-task-empty">
          <div className="session-task-empty-icon">
            <ListTodo className="h-5 w-5" />
          </div>
          <span>No active tasks</span>
        </div>
      ) : (
        <div className="session-task-list">
          {currentTodos.map((todo, index) => (
            <div
              key={index}
              className={cn(
                'flex items-start gap-2.5 p-2.5 rounded-lg text-xs transition-all',
                todo.status === 'completed' && 'bg-foreground/[0.02] text-muted-foreground',
                todo.status === 'in_progress' && 'bg-primary/10 border border-primary/30 shadow-sm',
                todo.status === 'pending' && 'bg-foreground/[0.03]'
              )}
            >
              <div className="shrink-0 mt-0.5">
                {todo.status === 'completed' && (
                  <CheckCircle className="h-4 w-4 text-emerald-500/80" />
                )}
                {todo.status === 'in_progress' && (
                  <Loader2 className="h-4 w-4 text-primary animate-spin" />
                )}
                {todo.status === 'pending' && (
                  <Circle className="h-4 w-4 text-muted-foreground/60" />
                )}
              </div>
              <p
                className={cn(
                  'flex-1 leading-relaxed',
                  todo.status === 'completed' && 'line-through opacity-70',
                  todo.status === 'in_progress' && 'font-medium text-foreground'
                )}
              >
                {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const meshBody = (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-sm">
      <form
        className="rounded-lg border border-border/70 bg-background/60 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!meshTargetSessionId) return;
          linkPeerMutation.mutate({
            targetSessionId: meshTargetSessionId,
            role: meshRoleDraft,
          });
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-md border border-border bg-muted/40 p-1.5 text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="text-xs font-semibold text-foreground">Link Peer</div>
            <div className="text-[11px] text-muted-foreground">Session-to-session route</div>
          </div>
        </div>
        <div className="space-y-2">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
            value={meshTargetSessionId}
            onChange={(event) => setMeshTargetSessionId(event.target.value)}
          >
            {meshAvailableSessions.length === 0 ? (
              <option value="">No unlinked sessions</option>
            ) : (
              meshAvailableSessions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {CLI_PROVIDER_LABEL[candidate.cliProvider]}
                </option>
              ))
            )}
          </select>
          <input
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
            value={meshRoleDraft}
            onChange={(event) => setMeshRoleDraft(event.target.value)}
            placeholder="Peer role"
          />
          <button
            type="submit"
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!meshTargetSessionId || linkPeerMutation.isPending}
          >
            {linkPeerMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            Link session
          </button>
        </div>
      </form>

      <div className="rounded-lg border border-border/70 bg-background/60 p-3">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-md border border-border bg-muted/40 p-1.5 text-muted-foreground">
            <Network className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="text-xs font-semibold text-foreground">Peers</div>
            <div className="text-[11px] text-muted-foreground">{meshPeers.length} linked</div>
          </div>
        </div>
        {meshPeersQuery.isLoading ? (
          <div className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading peers
          </div>
        ) : meshPeers.length === 0 ? (
          <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            No peers linked.
          </div>
        ) : (
          <div className="space-y-2">
            {meshPeers.map((peer) => (
              <div
                key={peer.id}
                className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-foreground">
                    {peer.target.name}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {CLI_PROVIDER_LABEL[peer.target.cliProvider]} · {peer.role || 'peer'}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Unlink peer"
                  onClick={() => unlinkPeerMutation.mutate(peer.targetSessionId)}
                  disabled={unlinkPeerMutation.isPending}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <form
        className="rounded-lg border border-border/70 bg-background/60 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const content = meshDelegationDraft.trim();
          if (!meshDelegationTargetId || !content) return;
          createDelegationMutation.mutate({
            toSessionId: meshDelegationTargetId,
            content,
          });
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-md border border-border bg-muted/40 p-1.5 text-muted-foreground">
            <SendHorizontal className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="text-xs font-semibold text-foreground">Consult</div>
            <div className="text-[11px] text-muted-foreground">Queue work in another session</div>
          </div>
        </div>
        <div className="space-y-2">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
            value={meshDelegationTargetId}
            onChange={(event) => setMeshDelegationTargetId(event.target.value)}
          >
            {meshDelegationTargets.length === 0 ? (
              <option value="">No target sessions</option>
            ) : (
              meshDelegationTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name} · {CLI_PROVIDER_LABEL[target.provider]}
                </option>
              ))
            )}
          </select>
          <textarea
            className="min-h-[108px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs leading-relaxed"
            value={meshDelegationDraft}
            onChange={(event) => setMeshDelegationDraft(event.target.value)}
            maxLength={50_000}
          />
          <button
            type="submit"
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              !meshDelegationTargetId ||
              !meshDelegationDraft.trim() ||
              createDelegationMutation.isPending
            }
          >
            {createDelegationMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <SendHorizontal className="h-3.5 w-3.5" />
            )}
            Send consult
          </button>
        </div>
      </form>

      <div className="rounded-lg border border-border/70 bg-background/60 p-3">
        <div className="mb-2 text-xs font-semibold text-foreground">Recent Delegations</div>
        {meshRecentDelegations.length === 0 ? (
          <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            No delegations yet.
          </div>
        ) : (
          <div className="space-y-2">
            {meshRecentDelegations.map((delegation) => (
              <div key={delegation.id} className="rounded-md bg-muted/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate font-medium text-foreground">
                    {delegation.toSessionName || delegation.toSessionId}
                  </span>
                  <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-muted-foreground">
                    {delegation.status}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                  {delegation.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderConfigBody = (heightClass: string) => (
    <div className={cn('flex flex-col', heightClass)}>
      <div className="flex gap-1 p-1.5 bg-muted/30 border-b border-border/60 shrink-0">
        <button
          onClick={() => setConfigTab('memories')}
          className={cn(
            'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all',
            configTab === 'memories'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
          )}
        >
          Memories
        </button>
        <button
          onClick={() => setConfigTab('agents')}
          className={cn(
            'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all',
            configTab === 'agents'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
          )}
        >
          Agents
        </button>
      </div>
      {configTab === 'memories' ? (
        <MemoryViewer
          workingDirectory={session.workingDirectory}
          className="flex-1 overflow-auto"
        />
      ) : (
        <AgentsEditor
          workingDirectory={session.workingDirectory}
          className="flex-1 overflow-auto"
        />
      )}
    </div>
  );

  const panelMeta: Record<
    Exclude<DockablePanel, 'tools'>,
    { title: string; icon: ReactElement; badge?: ReactElement | null }
  > = {
    files: {
      title: 'Files',
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      badge: null,
    },
    tasks: {
      title: 'Goal & Tasks',
      icon: <ListTodo className="h-3.5 w-3.5" />,
      badge:
        pendingTasksCount > 0 ? <span className="panel-badge">{pendingTasksCount}</span> : null,
    },
    mesh: {
      title: 'Session Mesh',
      icon: <Network className="h-3.5 w-3.5" />,
      badge: meshPeers.length > 0 ? <span className="panel-badge">{meshPeers.length}</span> : null,
    },
    config: {
      title: 'Config',
      icon: <Brain className="h-3.5 w-3.5" />,
      badge: null,
    },
    designStyle: {
      title: 'Design Styles',
      icon: <Palette className="h-3.5 w-3.5" />,
      badge: session.designStyleSkill ? <span className="panel-badge">On</span> : null,
    },
    writingStyle: {
      title: 'Writing Styles',
      icon: <PenLine className="h-3.5 w-3.5" />,
      badge: session.writingStyleSkill ? <span className="panel-badge">On</span> : null,
    },
    browser: {
      title: 'Browser',
      icon: <Globe className="h-3.5 w-3.5" />,
      badge: null,
    },
    android: {
      title: 'Android',
      icon: <Smartphone className="h-3.5 w-3.5" />,
      badge: session.androidDeviceSerial ? <span className="panel-badge">1</span> : null,
    },
    git: {
      title: 'Git',
      icon: <GitBranch className="h-3.5 w-3.5" />,
      badge: null,
    },
    github: {
      title: 'GitHub',
      icon: <GitPullRequest className="h-3.5 w-3.5" />,
      badge: null,
    },
    checkpoints: {
      title: 'Checkpoints',
      icon: <History className="h-3.5 w-3.5" />,
      badge: null,
    },
    notes: {
      title: 'Notes',
      icon: <StickyNote className="h-3.5 w-3.5" />,
      badge: null,
    },
    preview: {
      title: 'Preview',
      icon: <MonitorPlay className="h-3.5 w-3.5" />,
      badge: null,
    },
    toolLog: {
      title: 'Tool Log',
      icon: <ScrollText className="h-3.5 w-3.5" />,
      badge:
        currentToolExecutions.length > 0 ? (
          <span className="panel-badge">{currentToolExecutions.length}</span>
        ) : null,
    },
  };

  const renderDockedPanel = (panel: WorkspaceSheetPanel) => {
    const meta = panelMeta[panel];
    let body: ReactElement | null = null;
    if (panel === 'tasks') body = <div className="h-full overflow-auto">{tasksBody}</div>;
    else if (panel === 'mesh') body = meshBody;
    else if (panel === 'config') body = renderConfigBody('h-full');
    else if (panel === 'designStyle') {
      body = (
        <SessionStyleLibraryPanel
          sessionId={session.id}
          provider={sessionProvider}
          kind="design"
          selectedSkill={session.designStyleSkill}
          onSessionUpdated={handleStyleSessionUpdated}
          className="h-full"
        />
      );
    } else if (panel === 'writingStyle') {
      body = (
        <SessionStyleLibraryPanel
          sessionId={session.id}
          provider={sessionProvider}
          kind="writing"
          selectedSkill={session.writingStyleSkill}
          onSessionUpdated={handleStyleSessionUpdated}
          className="h-full"
        />
      );
    } else if (panel === 'android') {
      body = <AndroidDevicePanel sessionId={session.id} className="h-full" />;
    } else if (panel === 'browser') {
      body = <OracleBrowserPanel sessionId={session.id} className="h-full" />;
    } else if (panel === 'git') {
      body = <GitPanel workingDirectory={session.workingDirectory} className="h-full" />;
    } else if (panel === 'github') {
      body = <GitHubPanel workingDirectory={session.workingDirectory} className="h-full" />;
    } else if (panel === 'checkpoints') {
      body = <CheckpointsPanel sessionId={session.id} className="h-full" />;
    } else if (panel === 'notes') {
      body = (
        <Notepad
          sessionId={session.id}
          onSendToChat={(content) => handleSendMessage(content)}
          className="h-full"
        />
      );
    } else if (panel === 'preview') {
      body = (
        <WebPreview
          sessionId={session.id}
          workingDirectory={session.workingDirectory}
          className="h-full"
        />
      );
    } else if (panel === 'toolLog') {
      body = <ToolLogPanel executions={currentToolExecutions} className="h-full" />;
    }

    if (!body) return null;

    return (
      <div
        key={panel}
        className={cn(
          'session-docked-panel',
          panel === 'browser' && 'session-docked-browser-panel'
        )}
      >
        <div className="session-docked-panel-header">
          <span className="session-docked-panel-icon">{meta.icon}</span>
          <span className="session-docked-panel-title">{meta.title}</span>
          {meta.badge}
          <button
            type="button"
            onClick={() => togglePinPanel(panel)}
            className="session-docked-panel-close"
            title="Unpin panel"
            aria-label={`Close ${meta.title}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">{body}</div>
      </div>
    );
  };

  const renderRunCockpitPanel = (presentation: 'dock' | 'rail' = 'dock') => (
    <RunCockpit
      presentation={presentation}
      activeSection={runCockpitTarget.section}
      focusVersion={runCockpitTarget.version}
      workingDirectory={session.workingDirectory}
      providerLabel={providerLabel}
      sessionStatus={session.status}
      messages={sessionMessages}
      streamingSessionId={id || ''}
      activity={currentActivity}
      todos={currentTodos}
      tools={currentToolExecutions}
      agents={currentAgentRuns}
      usage={visibleUsage}
      queue={currentQueue}
      onClose={() => {
        setRunCockpitOpen(false);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('chat.runCockpitOpen', '0');
        }
      }}
      onInterrupt={handleInterrupt}
      onRestart={handleRestart}
      onReviewChanges={handleReviewChanges}
      onJumpToMessage={jumpToMessageFromRun}
    />
  );

  const renderRuntimeField = ({
    id: fieldId,
    label,
    value,
    icon,
    children,
  }: {
    id: string;
    label: string;
    value?: string;
    icon: ReactElement;
    children: ReactNode;
  }) => (
    <label className="session-runtime-field" htmlFor={fieldId}>
      <span className="session-runtime-icon">{icon}</span>
      <span className="session-runtime-copy">
        <span className="session-runtime-label">{label}</span>
        <span className="session-runtime-value">{value}</span>
      </span>
      <span className="session-runtime-caret" aria-hidden="true">
        <ChevronDown className="h-3.5 w-3.5" />
      </span>
      {children}
    </label>
  );

  const renderCliSubagentField = (
    entry: CliSubagentSummary,
    variant: 'sidebar' | 'mobile' = 'sidebar'
  ) => {
    const fieldKey = `${variant === 'mobile' ? 'mobile-' : ''}cli-subagent-${entry.id || entry.provider}`;
    // The worker runs the provider's own CLI, so its model catalogue is exactly
    // the one that provider offers a session -- pi's is the long one.
    const providerInfo = cliProviders?.find((provider) => provider.id === entry.provider);
    const models = providerInfo?.models ?? [];
    const labels = providerInfo?.modelLabels ?? {};
    const providerDefault = providerInfo?.defaultModel;
    const selected = !entry.enabled ? CLI_SUBAGENT_OFF : entry.model || CLI_SUBAGENT_DEFAULT_MODEL;
    const displayValue = !entry.enabled
      ? 'Aus'
      : entry.model
        ? labels[entry.model] || entry.model
        : `Default${providerDefault ? ` · ${labels[providerDefault] || providerDefault}` : ''}`;

    return renderRuntimeField({
      id: fieldKey,
      label: entry.label || entry.provider,
      value: displayValue,
      icon: <Network className="h-3.5 w-3.5" />,
      children: (
        <select
          id={fieldKey}
          className="session-runtime-select"
          value={selected}
          onChange={(event) => applyCliSubagentChoice(entry.id, event.target.value)}
          aria-label={`Subagent ${entry.label || entry.provider}`}
          disabled={cliSubagentsSaveMutation.isPending}
        >
          <option value={CLI_SUBAGENT_OFF}>Aus (nicht delegierbar)</option>
          <option value={CLI_SUBAGENT_DEFAULT_MODEL}>
            Default
            {providerDefault ? ` (${labels[providerDefault] || providerDefault})` : ''}
          </option>
          {models.map((model) => (
            <option key={`${entry.id}-${model}`} value={model}>
              {labels[model] || model}
            </option>
          ))}
          {entry.model && !models.includes(entry.model) && (
            <option value={entry.model}>{entry.model}</option>
          )}
        </select>
      ),
    });
  };

  const renderSessionRuntimeControls = (variant: 'sidebar' | 'mobile' = 'sidebar') => {
    const fieldId = (name: string) => `session-runtime-${variant}-${name}`;
    const activeMode =
      SESSION_MODE_OPTIONS.find((option) => option.value === sessionMode) ??
      SESSION_MODE_OPTIONS[1]!;
    const ActiveModeIcon = activeMode.icon;
    const providerOptions =
      cliProviders
        ?.filter((provider) => provider.enabled !== false || provider.id === sessionProvider)
        .map((provider) => ({
          id: provider.id,
          name: provider.name,
          enabled: provider.enabled !== false,
          available: provider.available,
        })) ?? [];
    const currentProvider = providerOptions.find((option) => option.id === sessionProvider);
    const modelLabel =
      modelSelectValue === '__default__'
        ? `Default${resolvedDefaultModel ? ` · ${modelLabels[resolvedDefaultModel] || resolvedDefaultModel}` : ''}`
        : modelLabels[modelSelectValue] || modelSelectValue;
    const showReasoningControls = ['claude', 'zai', 'codex', 'opencode', 'pi'].includes(
      sessionProvider
    );
    const reasoningValueLabel =
      reasoningSelectValue === '__default__'
        ? 'Default'
        : reasoningOptions.find((option) => option.value === reasoningSelectValue)?.label ||
          reasoningSelectValue;
    const activeTool = selectedCliTool
      ? cliTools?.find((tool) => tool.id === selectedCliTool)
      : null;
    const surfaceValueLabel = sessionSurface === 'task' ? 'Task' : 'Code';
    const SurfaceIcon = sessionSurface === 'task' ? ListTodo : Code2;
    // Z.AI sessions talk to the Z.AI endpoint directly (no model router), so
    // only GLM targets are reachable there; claude sessions can use them all.
    const routableSubagentGroups =
      sessionProvider === 'zai'
        ? subagentModelGroups.filter((group) => group.group.startsWith('Z.AI'))
        : subagentModelGroups;

    return (
      <div className={cn('session-runtime-controls', variant === 'mobile' && 'is-mobile')}>
        {renderRuntimeField({
          id: fieldId('surface'),
          label: 'Surface',
          value: surfaceValueLabel,
          icon: <SurfaceIcon className="h-3.5 w-3.5" />,
          children: (
            <select
              id={fieldId('surface')}
              className="session-runtime-select"
              value={sessionSurface}
              onChange={(event) => applySurfaceSelection(event.target.value as SessionSurface)}
              aria-label="Session surface"
            >
              <option value="code">Code</option>
              <option value="task">Task</option>
            </select>
          ),
        })}

        {renderRuntimeField({
          id: fieldId('mode'),
          label: 'Mode',
          value: activeMode.label,
          icon: <ActiveModeIcon className="h-3.5 w-3.5" />,
          children: (
            <select
              id={fieldId('mode')}
              className="session-runtime-select"
              value={sessionMode}
              onChange={(event) => handleModeChange(event.target.value as SessionMode)}
              aria-label="Session mode"
            >
              {SESSION_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ),
        })}

        {providerOptions.length > 0 &&
          renderRuntimeField({
            id: fieldId('provider'),
            label: 'Provider',
            value: currentProvider?.name ?? CLI_PROVIDER_LABEL[sessionProvider],
            icon: <ProviderLogo provider={toUiProvider(sessionProvider)} className="h-3.5 w-3.5" />,
            children: (
              <select
                id={fieldId('provider')}
                className="session-runtime-select"
                value={sessionProvider}
                onChange={(event) => providerMutation.mutate(event.target.value as CLIProvider)}
                aria-label="Session provider"
              >
                {providerOptions.map((provider) => (
                  <option key={provider.id} value={provider.id} disabled={!provider.available}>
                    {provider.name}
                    {!provider.enabled
                      ? ' (disabled)'
                      : !provider.available
                        ? ' (not configured)'
                        : ''}
                  </option>
                ))}
              </select>
            ),
          })}

        {renderRuntimeField({
          id: fieldId('model'),
          label: 'Model',
          value: modelLabel,
          icon: <Sparkles className="h-3.5 w-3.5" />,
          children: (
            <select
              id={fieldId('model')}
              className="session-runtime-select"
              value={modelSelectValue}
              onChange={(event) => applyModelSelection(event.target.value)}
              aria-label="Session model"
            >
              {showDefaultModelOption && (
                <option value="__default__">
                  Default
                  {resolvedDefaultModel
                    ? ` (${modelLabels[resolvedDefaultModel] || resolvedDefaultModel})`
                    : ''}
                </option>
              )}
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {modelLabels[model] || model}
                </option>
              ))}
            </select>
          ),
        })}

        {isClaudeTransportSession &&
          renderRuntimeField({
            id: fieldId('subagent-model'),
            label: 'Task agent model',
            value: session.subagentModel || 'Default',
            icon: <Network className="h-3.5 w-3.5" />,
            children: (
              <select
                id={fieldId('subagent-model')}
                className="session-runtime-select"
                value={session.subagentModel ?? '__default__'}
                onChange={(event) =>
                  sessionSubagentModelMutation.mutate(
                    event.target.value === '__default__' ? null : event.target.value
                  )
                }
                aria-label="Task agent model"
                disabled={sessionSubagentModelMutation.isPending}
              >
                <option value="__default__">Default (Agent-Definition)</option>
                {sessionProvider === 'claude' && modelOptions.length > 0 && (
                  <optgroup label="Anthropic">
                    {modelOptions.map((model) => (
                      <option key={`sub-${model}`} value={model}>
                        {modelLabels[model] || model}
                      </option>
                    ))}
                  </optgroup>
                )}
                {routableSubagentGroups.map((group) => (
                  <optgroup key={group.group} label={group.group}>
                    {group.models.map((model) => (
                      <option key={`sub-${group.group}-${model}`} value={model}>
                        {model}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {session.subagentModel &&
                  !modelOptions.includes(session.subagentModel) &&
                  !routableSubagentGroups.some((group) =>
                    group.models.includes(session.subagentModel as string)
                  ) && <option value={session.subagentModel}>{session.subagentModel}</option>}
              </select>
            ),
          })}

        {showReasoningControls &&
          renderRuntimeField({
            id: fieldId('reasoning'),
            label:
              sessionProvider === 'claude' || sessionProvider === 'zai' ? 'Effort' : 'Reasoning',
            value: reasoningValueLabel,
            icon: <Brain className="h-3.5 w-3.5" />,
            children: (
              <select
                id={fieldId('reasoning')}
                className="session-runtime-select"
                value={reasoningSelectValue}
                onChange={(event) => applyReasoningSelection(event.target.value)}
                aria-label="Session reasoning"
              >
                <option value="__default__">Default</option>
                {reasoningOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ),
          })}

        {cliTools &&
          cliTools.length > 0 &&
          renderRuntimeField({
            id: fieldId('cli-tool'),
            label: 'CLI Tool',
            value: activeTool?.name ?? 'No tool',
            icon: <Wrench className="h-3.5 w-3.5" />,
            children: (
              <select
                id={fieldId('cli-tool')}
                className="session-runtime-select"
                value={selectedCliTool ?? ''}
                onChange={(event) => setSelectedCliTool(event.target.value || null)}
                aria-label="CLI tool"
              >
                <option value="">No tool</option>
                {cliTools.map((tool) => (
                  <option key={tool.id} value={tool.id}>
                    {tool.name}
                  </option>
                ))}
              </select>
            ),
          })}

        {homeAssistantSettings?.configured &&
          renderRuntimeField({
            id: fieldId('home-assistant-light'),
            label: 'Status Light',
            value:
              homeAssistantLights.find((light) => light.entityId === session.homeAssistantEntityId)
                ?.name ||
              (session.homeAssistantEntityId ? session.homeAssistantEntityId : 'No light'),
            icon: <Lightbulb className="h-3.5 w-3.5" />,
            children: (
              <select
                id={fieldId('home-assistant-light')}
                className="session-runtime-select"
                value={session.homeAssistantEntityId || ''}
                onChange={(event) => homeAssistantLightMutation.mutate(event.target.value || null)}
                aria-label="Home Assistant status light"
                disabled={homeAssistantLightMutation.isPending}
              >
                <option value="">No light</option>
                {homeAssistantLights.map((light) => (
                  <option key={light.entityId} value={light.entityId} disabled={!light.available}>
                    {light.name}
                    {!light.available
                      ? ' (unavailable)'
                      : light.colorCapable
                        ? ''
                        : ' (pulse only)'}
                  </option>
                ))}
              </select>
            ),
          })}

        {session.homeAssistantEntityId && homeAssistantSettings?.configured && (
          <div className="session-runtime-actions" aria-label="Test status light patterns">
            {(
              [
                ['success', 'Done', 'text-emerald-500'],
                ['problem', 'Problem', 'text-red-500'],
                ['question', 'Question', 'text-blue-500'],
              ] as const
            ).map(([status, label, color]) => (
              <button
                key={status}
                type="button"
                className="session-runtime-action"
                onClick={() => homeAssistantPreviewMutation.mutate(status)}
                disabled={homeAssistantPreviewMutation.isPending}
                title={`Test ${label.toLowerCase()} light pattern`}
              >
                <Circle className={cn('h-3.5 w-3.5 fill-current', color)} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}

        {variant === 'sidebar' && (
          <div className="session-runtime-actions">
            <button
              type="button"
              className="session-runtime-action"
              onClick={handleInterrupt}
              disabled={!hasLiveRunActivity && !hasQueuedRunWork && session.status !== 'running'}
              title="Interrupt session"
            >
              <Square className="h-3.5 w-3.5" />
              <span>Interrupt</span>
            </button>
            <button
              type="button"
              className="session-runtime-action"
              onClick={handleRestart}
              title="Restart session"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Restart</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  const { todo: activeTodo, text: activeTodoText } = getActiveTodoPresentation(currentTodos);
  const activeAgentLabel = currentActiveAgent
    ? getAgentDisplay(currentActiveAgent.agentType)
    : currentAgentRuns.find((agent) => agent.status === 'started')?.agentType ||
      (session.runtime?.currentAgentType
        ? getAgentDisplay(session.runtime.currentAgentType)
        : undefined);

  const activeToolLabel =
    currentActivity.type === 'tool'
      ? getToolDisplay(currentActivity.toolName || '').label
      : currentToolExecutions.find((tool) => tool.status === 'started')?.actionSummary?.title ||
        (session.runtime?.currentToolName
          ? getToolDisplay(session.runtime.currentToolName).label
          : undefined);
  const runtimeActivityDetail =
    session.runtime?.activitySummary ||
    session.runtime?.currentAgentDescription ||
    activeToolLabel ||
    (session.runtime?.currentAgentType
      ? `${getAgentDisplay(session.runtime.currentAgentType)} running`
      : undefined);
  const queuedDepth = currentQueue?.depth ?? session.runtime?.queueDepth ?? 0;
  const taskWorkbenchState = getTaskWorkbenchState({
    sessionStatus: session.status,
    isActive,
    pendingTasksCount,
    completedTasksCount,
    totalTasksCount,
    canUseCodexGoal,
    composerSteersWhileActive,
    composerQueuesWhileActive,
    queuedDepth,
    activityMessage: currentActivity.message,
    activeToolLabel,
    runtimeActivityDetail,
    activeAgentLabel,
    activeTodoText,
    lastMessage: session.lastMessage,
    hasSelectedTool: Boolean(selectedCliTool),
    selectedToolName: selectedToolName || undefined,
  });

  const renderSideMenuItem = ({
    id: itemId,
    label,
    icon,
    onClick,
    active,
    disabled,
    badge,
    badgePulse,
    title,
    nested,
  }: {
    id: string;
    label: string;
    icon: ReactElement;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    badge?: number;
    badgePulse?: boolean;
    title?: string;
    nested?: boolean;
  }) => (
    <button
      key={itemId}
      type="button"
      className={cn('session-side-menu-item', nested && 'is-subitem', active && 'is-active')}
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      aria-pressed={active || undefined}
    >
      <span className="session-side-menu-icon">{icon}</span>
      <span className="session-side-menu-label">{label}</span>
      {badge && badge > 0 ? (
        <span className={cn('session-side-menu-badge', badgePulse && 'is-pulsing')}>{badge}</span>
      ) : null}
    </button>
  );

  const renderSideMenuGroup = ({
    id: groupId,
    label,
    icon,
    children,
    open,
    badge,
    badgePulse,
  }: {
    id: RightMenuGroupId;
    label: string;
    icon: ReactElement;
    children: ReactNode;
    open?: boolean;
    badge?: number;
    badgePulse?: boolean;
  }) => {
    const isOpen = open ?? rightMenuGroupsOpen[groupId];
    return (
      <div className={cn('session-side-menu-group', isOpen && 'is-open')}>
        <button
          type="button"
          className={cn('session-side-menu-group-trigger', isOpen && 'is-open')}
          onClick={() => toggleRightMenuGroup(groupId)}
          aria-expanded={isOpen}
          title={label}
        >
          <span className="session-side-menu-icon">{icon}</span>
          <span className="session-side-menu-group-title">{label}</span>
          {badge && badge > 0 ? (
            <span className={cn('session-side-menu-badge', badgePulse && 'is-pulsing')}>
              {badge}
            </span>
          ) : null}
          <span className="session-side-menu-group-caret">
            <ChevronRight className="h-3 w-3" />
          </span>
        </button>
        {isOpen && <div className="session-side-menu-group-body">{children}</div>}
      </div>
    );
  };

  const renderPanelMenuItem = (panel: WorkspaceSheetPanel, nested = false) => {
    const meta = panelMeta[panel];
    const isActive = pinnedPanels[panel];
    let badgeCount = 0;
    if (panel === 'tasks') badgeCount = pendingTasksCount;
    else if (panel === 'mesh') badgeCount = meshPeers.length;
    else if (panel === 'designStyle' && session.designStyleSkill) badgeCount = 1;
    else if (panel === 'writingStyle' && session.writingStyleSkill) badgeCount = 1;
    else if (panel === 'android' && session.androidDeviceSerial) badgeCount = 1;

    return renderSideMenuItem({
      id: `panel-${panel}`,
      label: meta.title,
      icon: meta.icon,
      onClick: () => openRightPanel(panel),
      active: isActive,
      badge: badgeCount,
      title: isActive ? `Close ${meta.title}` : `Open ${meta.title}`,
      nested,
    });
  };

  const renderMobileSheetContent = () => {
    if (!mobileSheetPanel) return null;

    if (mobileSheetPanel === 'settings') {
      return (
        <div className="mobile-session-sheet-content">
          <div className="mobile-session-sheet-header">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <h3>Session</h3>
          </div>
          <div className="mobile-session-sheet-body space-y-4">
            <div className="mobile-view-switch">
              <button
                type="button"
                onClick={() => {
                  setMainView('chat');
                  setMobileSheetPanel(null);
                }}
                className={cn(mainView === 'chat' && 'is-active')}
              >
                <MessageSquare className="h-4 w-4" />
                <span>Chat</span>
              </button>
              {!isTaskSurface && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMainView('editor');
                      setMobileSheetPanel(null);
                    }}
                    disabled={!hasOpenFiles}
                    className={cn(mainView === 'editor' && 'is-active')}
                  >
                    <Code2 className="h-4 w-4" />
                    <span>Code</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMainView('files');
                      setMobileSheetPanel(null);
                    }}
                    className={cn(mainView === 'files' && 'is-active')}
                  >
                    <FolderOpen className="h-4 w-4" />
                    <span>Files</span>
                  </button>
                </>
              )}
            </div>
            <div className="session-runtime-mobile-card">
              {renderSessionRuntimeControls('mobile')}
              {cliSubagents.length > 0 && (
                <>
                  <p className="mt-2 px-1 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    Delegierbar per run_subagent
                  </p>
                  <div className="session-runtime-controls is-mobile">
                    {cliSubagents.map((entry) => (
                      <Fragment key={`mobile-${entry.id || entry.provider}`}>
                        {renderCliSubagentField(entry, 'mobile')}
                      </Fragment>
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* The right dock is desktop-only, so the chat switcher gets its
                own slot here instead of being unreachable on a phone. */}
            {id && (
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Chat
                </div>
                <ChatThreadSwitcher
                  sessionId={id}
                  onSwitched={(chatId) => {
                    messageHistoryEpochRef.current += 1;
                    messageSnapshotRef.current = undefined;
                    activeChatIdRef.current = chatId;
                    socketService.setSessionChat(id, chatId);
                    clearStreamingContent(id);
                    setMessages(id, []);
                    setIsSearchHistoryWindow(false);
                    setHistoryFirstItemIndex(MESSAGE_HISTORY_FIRST_INDEX);
                    setHistoryPagination({
                      total: 0,
                      limit: MESSAGE_HISTORY_PAGE_SIZE,
                      hasMore: false,
                      oldestId: null,
                    });
                    setOlderMessagesError(null);
                    queryClient.invalidateQueries({ queryKey: ['session', id] });
                    setMobileSheetPanel(null);
                  }}
                />
              </div>
            )}
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Styles
              </div>
              <div className="grid grid-cols-2 gap-2">
                {styleMenuPanels.map((panel) => {
                  const meta = panelMeta[panel];
                  return (
                    <button
                      key={panel}
                      type="button"
                      onClick={() => setMobileSheetPanel(panel)}
                      className="mobile-sheet-command"
                    >
                      {meta.icon}
                      <span>{meta.title}</span>
                      {meta.badge}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Workspace
              </div>
              <div className="grid grid-cols-2 gap-2">
                {workspaceMenuPanels.map((panel) => {
                  const meta = panelMeta[panel];
                  return (
                    <button
                      key={panel}
                      type="button"
                      onClick={() => setMobileSheetPanel(panel)}
                      className="mobile-sheet-command"
                    >
                      {meta.icon}
                      <span>{meta.title}</span>
                      {meta.badge}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMobileSheetPanel(null);
                  setShowRenameDialog(true);
                }}
                className="mobile-sheet-command"
              >
                <Pencil className="h-4 w-4" />
                <span>Rename</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileSheetPanel(null);
                  setShowAllowedDirsDialog(true);
                }}
                className="mobile-sheet-command"
              >
                <FolderKey className="h-4 w-4" />
                <span>Directories</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileSheetPanel(null);
                  setTemplateNameDraft(session.name);
                }}
                className="mobile-sheet-command"
              >
                <BookmarkPlus className="h-4 w-4" />
                <span>Template</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileSheetPanel(null);
                  void handleExportSession();
                }}
                className="mobile-sheet-command"
              >
                <Download className="h-4 w-4" />
                <span>Export</span>
              </button>
              {session.status === 'running' && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileSheetPanel(null);
                    handleInterrupt();
                  }}
                  className="mobile-sheet-command"
                >
                  <Square className="h-4 w-4" />
                  <span>Interrupt</span>
                </button>
              )}
              {isExecutingTool && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileSheetPanel(null);
                    handleCancelCliTool();
                  }}
                  className="mobile-sheet-command"
                >
                  <X className="h-4 w-4" />
                  <span>Cancel tool</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMobileSheetPanel(null);
                  handleRestart();
                }}
                className="mobile-sheet-command"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Restart</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    const meta = panelMeta[mobileSheetPanel];
    return (
      <div className="mobile-session-sheet-content">
        <div className="mobile-session-sheet-header">
          <span className="text-muted-foreground">{meta.icon}</span>
          <h3>{meta.title}</h3>
        </div>
        <div className="mobile-session-sheet-body">
          {mobileSheetPanel === 'tasks' && (
            <div className="h-[56dvh] overflow-auto">{tasksBody}</div>
          )}
          {mobileSheetPanel === 'mesh' && <div className="h-[76dvh] overflow-auto">{meshBody}</div>}
          {mobileSheetPanel === 'browser' && (
            <OracleBrowserPanel sessionId={session.id} className="h-[76dvh]" />
          )}
          {mobileSheetPanel === 'android' && (
            <AndroidDevicePanel sessionId={session.id} className="h-[76dvh]" />
          )}
          {mobileSheetPanel === 'designStyle' && (
            <SessionStyleLibraryPanel
              sessionId={session.id}
              provider={sessionProvider}
              kind="design"
              selectedSkill={session.designStyleSkill}
              onSessionUpdated={handleStyleSessionUpdated}
              className="h-[76dvh]"
            />
          )}
          {mobileSheetPanel === 'writingStyle' && (
            <SessionStyleLibraryPanel
              sessionId={session.id}
              provider={sessionProvider}
              kind="writing"
              selectedSkill={session.writingStyleSkill}
              onSessionUpdated={handleStyleSessionUpdated}
              className="h-[76dvh]"
            />
          )}
          {mobileSheetPanel === 'config' && renderConfigBody('h-[56dvh]')}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={rootShellRef}
      className={cn(
        'flex h-full min-h-0 relative overflow-hidden',
        isTaskSurface ? 'session-surface-task' : 'session-surface-code'
      )}
    >
      {/* Main column: layered chat viewport with transparent topbar/composer overlays */}
      <div
        className={cn(
          'session-main-column flex-1 min-h-0 flex flex-col overflow-hidden',
          mainView === 'chat' && 'session-chat-layered',
          isTaskSurface && 'session-task-main'
        )}
      >
        {/* Session Header measurement point; visible runtime controls live in the right menu. */}
        <div
          ref={setHeaderBarEl}
          className={cn(
            'chat-topbar relative shrink-0',
            isTaskSurface ? 'task-workbench-topbar' : 'is-empty'
          )}
        >
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {messageJumpStatus}
          </span>
          {isTaskSurface && (
            <TaskWorkbenchHeader
              sessionName={session.name}
              state={taskWorkbenchState}
              queuedDepth={queuedDepth}
              contextUsedPercent={visibleUsage?.contextUsedPercent}
              canInterruptActiveRun={canInterruptActiveRun}
              onOpenRun={() => openRunCockpitSection(isActive ? 'overview' : 'turns')}
              onOpenTasks={() => openRightPanel('tasks')}
              onInterrupt={handleInterrupt}
              onRestart={handleRestart}
            />
          )}
        </div>

        {/* Main Content - Chat or Editor */}
        <div
          className={cn(
            'flex-1 min-h-0',
            mainView === 'chat' ? 'chat-scroll-shell' : 'overflow-y-auto'
          )}
        >
          {mainView === 'editor' ? (
            <EditorPanel sessionId={id || ''} />
          ) : mainView === 'files' ? (
            <WorkspaceFiles
              workingDirectory={session.workingDirectory}
              onManageDirectories={() => setShowAllowedDirsDialog(true)}
              onFileOpen={(path, content) => {
                if (!id) return;
                openFileInStore(id, path, content);
                setMainView('editor');
              }}
              className="h-full"
            />
          ) : (
            <>
              {(sessionQueryFailed || (messagesQueryFailed && timeline.length > 0)) && (
                <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--chat-header-h)+0.5rem)] z-30 flex justify-center px-4">
                  <div
                    role="status"
                    className="pointer-events-auto flex max-w-md items-center gap-2 rounded-full border border-amber-400/30 bg-background/90 px-3 py-2 text-xs text-foreground shadow-lg backdrop-blur"
                  >
                    <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />
                    <span>
                      {isOnline
                        ? 'Refresh failed — showing cached data.'
                        : 'Offline — showing cached data.'}
                    </span>
                    <button
                      type="button"
                      className="min-h-8 rounded-full px-2 font-semibold hover:bg-muted"
                      onClick={() => {
                        void retrySession();
                        void retryMessages();
                      }}
                    >
                      Retry
                    </button>
                  </div>
                </div>
              )}

              {timeline.length === 0 &&
                !hasStreamingContent &&
                (hasInitialMessagesError ? (
                  <div className="flex h-full items-center justify-center px-5 text-center">
                    <div role="alert" className="max-w-sm">
                      <p className="font-semibold text-foreground">
                        {isOnline ? 'Chat history could not be loaded' : 'Chat history is offline'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        No messages were removed. Try loading the history again.
                      </p>
                      <button
                        type="button"
                        className="ui-pill ui-pill-subtle mt-4 min-h-10 px-4"
                        onClick={() => void retryMessages()}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Try again
                      </button>
                    </div>
                  </div>
                ) : isTaskSurface ? (
                  <div className="task-empty-state">
                    <div className="task-empty-mark">
                      <MessageSquare className="h-7 w-7" />
                    </div>
                    <h2>{session.name}</h2>
                    <p>Pick a starting point or write a specific task below.</p>
                    <div className="task-workflow-grid">
                      {TASK_WORKFLOWS.map((workflow) => {
                        const WorkflowIcon =
                          workflow.id === 'quick-brief'
                            ? FileText
                            : workflow.id === 'research-brief'
                              ? Globe
                              : workflow.id === 'draft-message'
                                ? MessageSquare
                                : workflow.id === 'plan-project'
                                  ? ListTodo
                                  : workflow.id === 'creative-direction'
                                    ? Sparkles
                                    : workflow.id === 'decision-support'
                                      ? Brain
                                      : ListTodo;
                        return (
                          <button
                            key={workflow.id}
                            type="button"
                            onClick={() => handleSendMessage(workflow.prompt)}
                          >
                            <span>
                              <WorkflowIcon className="h-3.5 w-3.5" />
                              {workflow.shortTitle}
                            </span>
                            <small>{workflow.description}</small>
                            <em>{workflow.meta}</em>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-center">
                    <div>
                      <div className="p-4 rounded-full bg-muted/50 mb-4 mx-auto w-fit">
                        <Image className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                      <p className="text-muted-foreground mb-1">Start a conversation</p>
                      <p className="text-xs text-muted-foreground/70">
                        Type a message or paste/drop an image
                      </p>
                    </div>
                  </div>
                ))}

              {/* Virtualized timeline: messages and generated images sorted by timestamp */}
              {timeline.length > 0 && (
                <Virtuoso
                  ref={virtuosoRef}
                  data={timeline}
                  firstItemIndex={historyFirstItemIndex}
                  initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
                  overscan={200}
                  increaseViewportBy={200}
                  followOutput="smooth"
                  atBottomStateChange={setIsAtBottom}
                  atTopStateChange={setIsAtTop}
                  startReached={() => void loadOlderMessages()}
                  className="chat-virtuoso flex-1"
                  computeItemKey={(_index, item) =>
                    item.type === 'message'
                      ? `msg-${item.data.id ?? item.timestamp}`
                      : item.type === 'tool'
                        ? `tool-${item.data.toolId}`
                        : `img-${item.data.timestamp}`
                  }
                  itemContent={(absoluteIndex, item) => {
                    const index = absoluteIndex - historyFirstItemIndex;
                    const turnSegment = assistantTurnSegments[index];
                    const isInTurn = turnSegment?.inTurn ?? false;
                    const isMessage = item.type === 'message';
                    let content: ReactElement;
                    if (item.type === 'message') {
                      const message = item.data;
                      if (message.id?.startsWith('compact-')) {
                        const compactIndex = message.id
                          ? compactMessageNumbers.byId.get(message.id)
                          : undefined;
                        content = (
                          <CompactBoundaryCard
                            content={message.content}
                            compactIndex={
                              typeof compactIndex === 'number'
                                ? compactIndex + compactIndexOffset
                                : undefined
                            }
                          />
                        );
                      } else {
                        content = (
                          <MessageBubble
                            message={message}
                            sessionId={id!}
                            sessionStatus={session.status}
                            provider={sessionUiProvider}
                            modelLabel={asstModelLabel}
                            assistantName={providerLabel}
                            showAssistantIdentity={
                              message.role === 'assistant' ? !!turnSegment?.startsAfterUser : true
                            }
                          />
                        );
                      }
                    } else if (item.type === 'tool') {
                      content = (
                        <TimelineContinuation>
                          {isTaskSurface ? (
                            <div className={cn('task-progress-card', `is-${item.data.status}`)}>
                              <span className="task-progress-dot" />
                              <span>
                                <strong>
                                  {item.data.status === 'completed'
                                    ? 'Step completed'
                                    : item.data.status === 'error'
                                      ? 'Needs attention'
                                      : 'Working'}
                                </strong>
                                <small>
                                  {item.data.actionSummary?.title ||
                                    item.data.actionSummary?.explanation ||
                                    'Plum is applying the requested task.'}
                                </small>
                              </span>
                            </div>
                          ) : (
                            <ToolExecutionCard execution={item.data} />
                          )}
                        </TimelineContinuation>
                      );
                    } else {
                      const img = item.data;
                      content = (
                        <TimelineContinuation>
                          <Card className="p-3 sm:p-4 bg-muted/40 border-border/60">
                            <div className="flex items-center gap-2 mb-3">
                              <div className="p-1.5 rounded-full bg-muted/60">
                                <Image className="h-4 w-4 text-primary" />
                              </div>
                              <span className="text-sm font-medium text-foreground">
                                Generated Image
                              </span>
                            </div>
                            {img.imageBase64 && (
                              <img
                                src={`data:${img.mimeType};base64,${img.imageBase64}`}
                                alt={img.prompt}
                                className="max-w-full rounded-lg border border-border/60 cursor-pointer hover:opacity-90 transition-opacity mb-3"
                                onClick={() => {
                                  const link = document.createElement('a');
                                  link.href = `data:${img.mimeType};base64,${img.imageBase64}`;
                                  link.download = `generated-image-${img.timestamp}.png`;
                                  link.click();
                                }}
                              />
                            )}
                            <p className="text-xs text-muted-foreground italic">"{img.prompt}"</p>
                          </Card>
                        </TimelineContinuation>
                      );
                    }
                    return (
                      <div
                        id={
                          item.type === 'message' && item.data.id
                            ? `chat-message-${item.data.id}`
                            : undefined
                        }
                        data-message-id={
                          item.type === 'message' ? (item.data.id ?? undefined) : undefined
                        }
                        tabIndex={item.type === 'message' ? -1 : undefined}
                        className={cn(
                          'mx-auto w-full px-4 sm:px-7 animate-fade-in',
                          isTaskSurface ? 'task-timeline-item max-w-[840px]' : 'max-w-[760px]',
                          isInTurn ? 'asst-turn-item' : 'pb-9',
                          isInTurn && turnSegment?.startsAfterUser && 'asst-turn-start',
                          isInTurn && turnSegment?.continuesBefore && 'asst-turn-link-before',
                          isInTurn && turnSegment?.continuesAfter && 'asst-turn-link-after',
                          isInTurn && !turnSegment?.continuesAfter && 'asst-turn-end',
                          isInTurn && !isMessage && 'asst-turn-cont',
                          item.type === 'message' &&
                            item.data.id === highlightedMessageId &&
                            'is-search-highlighted'
                        )}
                      >
                        {content}
                      </div>
                    );
                  }}
                  components={virtuosoComponents}
                  rangeChanged={(range) =>
                    timelineRangeStore.set({
                      startIndex: range.startIndex,
                      endIndex: range.endIndex,
                    })
                  }
                />
              )}

              {timeline.length > 0 &&
                isAtTop &&
                (historyPagination.hasMore || isLoadingOlderMessages || olderMessagesError) && (
                  <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--chat-header-h)+0.5rem)] z-30 flex justify-center px-4">
                    <div className="pointer-events-auto flex min-h-10 items-center gap-2 rounded-full border border-border/70 bg-background/90 px-3 py-2 text-xs text-foreground shadow-lg backdrop-blur">
                      {isLoadingOlderMessages ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading older messages…
                        </>
                      ) : olderMessagesError ? (
                        <>
                          <span className="max-w-52 truncate">{olderMessagesError}</span>
                          <button
                            type="button"
                            className="min-h-8 rounded-full px-2 font-semibold hover:bg-muted"
                            onClick={() => void loadOlderMessages()}
                          >
                            Retry
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="min-h-8 rounded-full px-2 font-semibold hover:bg-muted"
                          onClick={() => void loadOlderMessages()}
                        >
                          Load older messages
                        </button>
                      )}
                    </div>
                  </div>
                )}

              {timeline.length > 0 && mainView === 'chat' && (
                <QuickTimelineRail
                  store={timelineRangeStore}
                  markers={quickTimelineMarkers}
                  onJump={jumpToTimelineIndex}
                />
              )}

              {(!isAtBottom || historyPagination.hasMoreAfter) && mainView === 'chat' && (
                <div className="chat-jump-latest flex justify-center pointer-events-none z-30">
                  <button
                    type="button"
                    onClick={() => void returnToLatestConversation()}
                    disabled={isLoadingLatestMessages}
                    className="pointer-events-auto ui-pill ui-pill-subtle hover:bg-muted/70"
                  >
                    {isLoadingLatestMessages ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                    {isLoadingLatestMessages ? 'Loading latest…' : 'Jump to latest'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Centered composer */}
        {mainView === 'chat' && (
          <div ref={setInputBarEl} className="composer-wrap shrink-0">
            <div className="composer-inner">
              {showSavedIndicator && (
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground animate-fade-in pb-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>Response saved</span>
                </div>
              )}
              <TodoFloatingStrip
                todo={activeTodo}
                pendingTasksCount={pendingTasksCount}
                mode="desktop"
                onOpenTasks={() => openRightPanel('tasks')}
              />
              <ChatInput
                sessionId={id || ''}
                onSendMessage={handleSendMessage}
                onSendMessageWithFiles={handleSendMessageWithFiles}
                onCommandExecute={handleCommandExecute}
                onInterrupt={handleInterrupt}
                commands={commands}
                selectedToolName={selectedToolName}
                selectedCliTool={selectedCliTool}
                disabled={session.status === 'error'}
                isSending={isSending}
                isExecutingTool={isExecutingTool}
                isActive={isActive}
                queuesWhileActive={composerQueuesWhileActive}
                steersWhileActive={composerSteersWhileActive}
                surface={sessionSurface}
                activeStatusLabel={taskWorkbenchState.composerStatusLabel}
                activeStatusDetail={taskWorkbenchState.composerStatusDetail}
                activeFollowupMode={composerActiveFollowupMode}
                onActiveFollowupModeChange={
                  supportsSteeredFollowups ? handleActiveFollowupModeChange : undefined
                }
                fastModeActive={fastModeActive}
                fastModePending={sessionServiceTierMutation.isPending}
                onFastModeToggle={sessionProvider === 'codex' ? handleFastModeToggle : undefined}
                queueDepth={queuedDepth}
                onOpenRun={handleOpenRunOverview}
              />
            </div>
          </div>
        )}
      </div>
      {/* /main column */}

      {/* Right session menu: former More actions, Run, and workspace panels live here. */}
      <div
        className={cn('session-right-dock hidden md:flex', rightDockCollapsed && 'is-collapsed')}
      >
        {(runCockpitOpen || hasVisiblePinnedPanel) && (
          <div
            className={cn(
              'session-docked-panel-column',
              !runCockpitOpen && pinnedPanels.browser && 'is-browser-active'
            )}
          >
            {runCockpitOpen
              ? renderRunCockpitPanel()
              : visibleDockedPanels.map((p) => (pinnedPanels[p] ? renderDockedPanel(p) : null))}
          </div>
        )}
        <nav className="session-right-menu" aria-label="Session menu">
          <div className="session-right-menu-header">
            <button
              type="button"
              className="session-right-collapse-button"
              onClick={toggleRightDockCollapsed}
              title={rightDockCollapsed ? 'Expand right menu' : 'Collapse right menu'}
              aria-label={rightDockCollapsed ? 'Expand right menu' : 'Collapse right menu'}
            >
              {rightDockCollapsed ? (
                <ChevronLeft className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <div className="session-side-menu-scroll">
            {/* Chat threads belong to the session, so they live in the right
                menu with the other per-session controls rather than floating
                over the transcript. */}
            {id &&
              renderSideMenuGroup({
                id: 'chat',
                label: 'Chat',
                icon: <MessageSquare className="h-3.5 w-3.5" />,
                children: rightDockCollapsed ? null : (
                  <div className="session-side-menu-embed">
                    <ChatThreadSwitcher
                      sessionId={id}
                      onSwitched={(chatId) => {
                        // The server stopped the CLI and swapped the thread
                        // context; drop live UI state and reload the transcript.
                        messageHistoryEpochRef.current += 1;
                        messageSnapshotRef.current = undefined;
                        activeChatIdRef.current = chatId;
                        socketService.setSessionChat(id, chatId);
                        clearStreamingContent(id);
                        setMessages(id, []);
                        setIsSearchHistoryWindow(false);
                        setHistoryFirstItemIndex(MESSAGE_HISTORY_FIRST_INDEX);
                        setHistoryPagination({
                          total: 0,
                          limit: MESSAGE_HISTORY_PAGE_SIZE,
                          hasMore: false,
                          oldestId: null,
                        });
                        setOlderMessagesError(null);
                        queryClient.invalidateQueries({ queryKey: ['session', id] });
                      }}
                    />
                  </div>
                ),
              })}

            {renderSideMenuGroup({
              id: 'session',
              label: 'Session',
              icon: <Settings className="h-3.5 w-3.5" />,
              children: (
                <>
                  {renderSideMenuItem({
                    id: 'session-rename',
                    label: 'Rename',
                    icon: <Pencil className="h-3.5 w-3.5" />,
                    onClick: () => setShowRenameDialog(true),
                    nested: true,
                  })}
                  {renderSideMenuItem({
                    id: 'session-template',
                    label: 'Save as template',
                    icon: <BookmarkPlus className="h-3.5 w-3.5" />,
                    onClick: () => setTemplateNameDraft(session.name),
                    nested: true,
                  })}
                  {renderSideMenuItem({
                    id: 'session-export',
                    label: 'Export transcript',
                    icon: <Download className="h-3.5 w-3.5" />,
                    onClick: () => void handleExportSession(),
                    nested: true,
                  })}
                  {renderSideMenuItem({
                    id: 'session-directories',
                    label: 'Directories',
                    icon: <FolderKey className="h-3.5 w-3.5" />,
                    onClick: () => setShowAllowedDirsDialog(true),
                    nested: true,
                  })}
                </>
              ),
            })}

            {renderSideMenuGroup({
              id: 'view',
              label: 'View',
              icon: <MessageSquare className="h-3.5 w-3.5" />,
              children: (
                <>
                  {renderSideMenuItem({
                    id: 'view-chat',
                    label: 'Chat view',
                    icon: <MessageSquare className="h-3.5 w-3.5" />,
                    onClick: () => setMainView('chat'),
                    active: mainView === 'chat',
                    nested: true,
                  })}
                  {!isTaskSurface &&
                    hasOpenFiles &&
                    renderSideMenuItem({
                      id: 'view-editor',
                      label: 'Editor view',
                      icon: <Code2 className="h-3.5 w-3.5" />,
                      onClick: () => setMainView('editor'),
                      active: mainView === 'editor',
                      nested: true,
                    })}
                  {!isTaskSurface &&
                    renderSideMenuItem({
                      id: 'view-files',
                      label: 'Files view',
                      icon: <FolderOpen className="h-3.5 w-3.5" />,
                      onClick: () => setMainView('files'),
                      active: mainView === 'files',
                      nested: true,
                    })}
                </>
              ),
            })}

            {renderSideMenuGroup({
              id: 'runtime',
              label: 'Runtime',
              icon: <Sparkles className="h-3.5 w-3.5" />,
              children: <>{!rightDockCollapsed && renderSessionRuntimeControls('sidebar')}</>,
            })}

            {renderSideMenuGroup({
              id: 'subagents',
              label: 'CLI subagents',
              icon: <Brain className="h-3.5 w-3.5" />,
              badge: cliSubagents.filter((entry) => entry.enabled).length,
              children: (
                <>
                  {cliSubagents.length === 0 ? (
                    <p className="px-3 py-1.5 text-[11px] leading-snug text-muted-foreground">
                      Keine CLI-Subagenten konfiguriert. Einstellungen &rarr; Subagenten.
                    </p>
                  ) : (
                    !rightDockCollapsed && (
                      <>
                        <p className="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                          Delegierbar per run_subagent
                        </p>
                        <div className="session-runtime-controls">
                          {cliSubagents.map((entry) => (
                            <Fragment key={entry.id || entry.provider}>
                              {renderCliSubagentField(entry)}
                            </Fragment>
                          ))}
                        </div>
                      </>
                    )
                  )}
                </>
              ),
            })}

            {renderSideMenuGroup({
              id: 'styles',
              label: 'Styles',
              icon: <Palette className="h-3.5 w-3.5" />,
              badge: activeStyleCount,
              children: <>{styleMenuPanels.map((panel) => renderPanelMenuItem(panel, true))}</>,
            })}

            {renderSideMenuGroup({
              id: 'workspace',
              label: 'Workspace',
              icon: <FolderOpen className="h-3.5 w-3.5" />,
              open: rightMenuGroupsOpen.workspace || hasPinnedWorkspacePanel,
              badge: pendingTasksCount + meshPeers.length + (session.androidDeviceSerial ? 1 : 0),
              children: <>{workspaceMenuPanels.map((panel) => renderPanelMenuItem(panel, true))}</>,
            })}
          </div>
        </nav>
      </div>

      {runCockpitOpen && <div className="md:hidden">{renderRunCockpitPanel('rail')}</div>}

      <Sheet
        open={mobileSheetPanel !== null}
        onOpenChange={(open) => {
          if (!open) setMobileSheetPanel(null);
        }}
      >
        <SheetContent side="bottom" className="mobile-session-sheet p-0">
          {renderMobileSheetContent()}
        </SheetContent>
      </Sheet>

      {/* Permission Approval Dialog (hooks-based flow) */}
      {currentPendingPermission && (
        <PermissionApprovalDialog
          permission={currentPendingPermission}
          onRespond={handlePermissionResponse}
          providerLabel={providerLabel}
        />
      )}

      {currentPendingQuestion && (
        <QuestionApprovalDialog
          question={currentPendingQuestion}
          onRespond={handleQuestionResponse}
          onReject={handleQuestionReject}
          providerLabel={providerLabel}
        />
      )}

      {/* Allowed Directories Dialog */}
      <AllowedDirectoriesDialog
        sessionId={id || ''}
        open={showAllowedDirsDialog}
        onOpenChange={setShowAllowedDirsDialog}
        providerLabel={providerLabel}
        onDirectoriesChanged={() => {
          // Invalidate session query to get updated allowed directories
          queryClient.invalidateQueries({ queryKey: ['session', id] });
        }}
      />

      <RenameSessionDialog
        session={session}
        open={showRenameDialog}
        onOpenChange={setShowRenameDialog}
      />

      <Dialog
        open={templateNameDraft !== null}
        onOpenChange={(open) => !open && setTemplateNameDraft(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>
              Stores this session&apos;s provider, model, mode and workspace as a reusable starting
              point. Messages are not copied.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={templateNameDraft ?? ''}
            onChange={(event) => setTemplateNameDraft(event.target.value)}
            placeholder="Template name"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter' && templateNameDraft?.trim()) {
                void handleSaveTemplate(templateNameDraft.trim());
                setTemplateNameDraft(null);
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTemplateNameDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={!templateNameDraft?.trim()}
              onClick={() => {
                void handleSaveTemplate((templateNameDraft ?? '').trim());
                setTemplateNameDraft(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tool Detail Dialog */}
      <ToolDetailDialog
        tool={selectedToolDetail}
        open={!!selectedToolDetail}
        onOpenChange={(open) => !open && setSelectedToolDetail(null)}
      />
    </div>
  );
}
