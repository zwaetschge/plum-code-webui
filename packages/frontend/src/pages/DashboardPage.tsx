import {
  useEffect,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  FolderOpen,
  MessageSquare,
  Settings,
  FolderPlus,
  Folder,
  MoreHorizontal,
  Pencil,
  Star,
  Sparkles,
  ImageIcon,
  Upload,
  FolderInput,
  RotateCcw,
  Loader2,
  Send,
  Code2,
  ClipboardList,
  Brain,
  Zap,
  Hand,
  CheckCircle,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  WifiOff,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FolderBrowserDialog } from '@/components/ui/folder-browser';
import { SessionCategories } from '@/components/session-categories';
import { DiscoveredProjects } from '@/components/projects';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { RenameSessionDialog } from '@/components/session/RenameSessionDialog';
import { SessionIcon } from '@/components/session/SessionIcon';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';
import { useCategoryStore } from '@/stores/categoryStore';
import { api, ApiError } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type {
  Session,
  ApiResponse,
  UserSettings,
  CLIProvider,
  SessionMode,
  SessionSurface,
  Category,
} from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { getSessionRunState } from '@/lib/sessionRunState';
import { RECENT_SESSIONS_LIMIT } from '@/lib/sessionGrouping';
import { CLI_PROVIDER_DEFAULT_MODEL, toUiProvider } from '@/lib/providers';
import { TASK_WORKFLOWS, type TaskWorkflow } from '@/lib/taskWorkflows';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const DASHBOARD_SESSION_MODE_OPTIONS: Array<{
  value: SessionMode;
  label: string;
  description: string;
  icon: typeof Brain;
}> = [
  { value: 'planning', label: 'Plan', description: 'ask before executing', icon: Brain },
  { value: 'auto-accept', label: 'Auto', description: 'approve safe work', icon: CheckCircle },
  { value: 'manual', label: 'Manual', description: 'approve each step', icon: Hand },
  { value: 'danger', label: 'YOLO', description: 'skip confirmations', icon: Zap },
];

const DASHBOARD_FAVORITES_GROUP_ID = '__favorites';
const DASHBOARD_RECENT_GROUP_ID = '__recent';
const DASHBOARD_UNCATEGORIZED_GROUP_ID = '__uncategorized';
const DASHBOARD_SEARCH_GROUP_ID = '__search';
const DASHBOARD_SESSION_DRAG_TYPE = 'application/x-plum-session-id';

const DASHBOARD_CATEGORY_COLOR_VALUES: Record<string, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  purple: '#a855f7',
  orange: '#f97316',
  pink: '#ec4899',
  yellow: '#eab308',
  red: '#ef4444',
  teal: '#14b8a6',
};

const DASHBOARD_CATEGORY_COLOR_OPTIONS = Object.entries(DASHBOARD_CATEGORY_COLOR_VALUES).map(
  ([name, value]) => ({ name, value })
);

function getDashboardCategoryColorValue(color: string | null | undefined): string {
  return color
    ? (DASHBOARD_CATEGORY_COLOR_VALUES[color] ?? color)
    : (DASHBOARD_CATEGORY_COLOR_VALUES.blue ?? '#3b82f6');
}

function getNextDashboardCategoryColor(categories: Category[]): string {
  const option =
    DASHBOARD_CATEGORY_COLOR_OPTIONS[categories.length % DASHBOARD_CATEGORY_COLOR_OPTIONS.length];
  return option?.name ?? 'blue';
}

interface DashboardSessionGroup {
  id: string;
  label: string;
  sessions: Session[];
  hasWorking: boolean;
  categoryId: string | null;
  isDropTarget: boolean;
  color?: string;
}

function getDashboardReasoningOptions(provider: CLIProvider) {
  if (provider === 'claude' || provider === 'zai') {
    return [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'xhigh', label: 'X-High (ultrathink)' },
      { value: 'max', label: 'Max' },
    ];
  }
  if (provider === 'opencode' || provider === 'pi') {
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
}

function normalizeDashboardReasoning(provider: CLIProvider, value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return getDashboardReasoningOptions(provider).some((option) => option.value === normalized)
    ? normalized
    : '';
}

function deriveSessionName(prompt: string, surface: SessionSurface): string {
  const compact = prompt
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^\/\w+\s*/, '')
    .slice(0, 58)
    .replace(/[.:,;!?]+$/g, '')
    .trim();
  if (compact) return compact;
  return surface === 'task' ? 'New Task' : 'New Code Session';
}

function formatDashboardFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function getDashboardDefaultProvider(
  savedDefaultProvider: CLIProvider | undefined,
  enabledProviders?: CLIProvider[]
): CLIProvider {
  if (
    savedDefaultProvider &&
    (!enabledProviders || enabledProviders.includes(savedDefaultProvider))
  ) {
    return savedDefaultProvider;
  }
  return enabledProviders?.[0] ?? 'codex';
}

function toDashboardSentence(value: string | null | undefined): string | null {
  const compact = value
    ?.replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return null;

  const firstSentence = compact.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? compact;
  const clipped =
    firstSentence.length > 180
      ? `${firstSentence
          .slice(0, 176)
          .trim()
          .replace(/[,\s;:.-]+$/g, '')}.`
      : firstSentence;
  return /[.!?]$/.test(clipped) ? clipped : `${clipped}.`;
}

function getDashboardProjectDescription(session: Session): string {
  return (
    toDashboardSentence(session.projectDescription) ||
    `${session.surface === 'task' ? 'Task workspace' : 'Project workspace'} for ${session.name}.`
  );
}

function formatDashboardLastActivity(session: Session): string {
  const value = session.runtime?.lastActivityAt || session.lastActivity || session.updatedAt;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Last activity unknown';
  return `Last activity ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  // Only the slices the cards actually read. Subscribing to the store object
  // woke the dashboard for every message, permission prompt and editor
  // keystroke of every session as well; the live status shown here needs seven
  // of the twenty-one records.
  const {
    setSessions,
    sessions,
    updateSession,
    activity,
    activeAgent,
    agentRuns,
    streamingContent,
    toolExecutions,
    queueState,
    lifecycle,
    pendingApprovalCounts,
  } = useSessionStore(
    useShallow((s) => ({
      setSessions: s.setSessions,
      sessions: s.sessions,
      updateSession: s.updateSession,
      activity: s.activity,
      activeAgent: s.activeAgent,
      agentRuns: s.agentRuns,
      streamingContent: s.streamingContent,
      toolExecutions: s.toolExecutions,
      queueState: s.queueState,
      lifecycle: s.lifecycle,
      pendingApprovalCounts: s.pendingApprovalCounts,
    }))
  );
  const { categories, fetchCategories, createCategory } = useCategoryStore();

  const [showNewSession, setShowNewSession] = useState(searchParams.get('new') === 'true');
  const [isComposerExpanded, setIsComposerExpanded] = useState(searchParams.get('new') === 'true');
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [newSessionPrompt, setNewSessionPrompt] = useState('');
  const [newSessionName, setNewSessionName] = useState('');
  const [sessionMode, setSessionMode] = useState<'new' | 'existing'>('new');
  const [newSessionSurface, setNewSessionSurface] = useState<SessionSurface>('code');
  const [newSessionPermissionMode, setNewSessionPermissionMode] =
    useState<SessionMode>('auto-accept');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedReasoning, setSelectedReasoning] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [newSessionFiles, setNewSessionFiles] = useState<File[]>([]);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [collapsedDashboardGroupIds, setCollapsedDashboardGroupIds] = useState<
    Record<string, boolean>
  >({});
  const [creatingDashboardCategory, setCreatingDashboardCategory] = useState(false);
  const [dashboardCategoryName, setDashboardCategoryName] = useState('');
  const [dashboardCategoryColor, setDashboardCategoryColor] = useState('blue');
  const [dashboardCategorySubmitting, setDashboardCategorySubmitting] = useState(false);
  const [draggingDashboardSessionId, setDraggingDashboardSessionId] = useState<string | null>(null);
  const [dragOverDashboardGroupId, setDragOverDashboardGroupId] = useState<string | null>(null);
  const [renamingSession, setRenamingSession] = useState<Session | null>(null);
  const [iconUploadSessionId, setIconUploadSessionId] = useState<string | null>(null);
  const [iconBusySessionId, setIconBusySessionId] = useState<string | null>(null);
  const [dashboardSearchQuery, setDashboardSearchQuery] = useState(
    () => searchParams.get('q') || ''
  );
  const [dashboardDockCollapsed, setDashboardDockCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('plum-dashboard-dock-collapsed') === '1';
  });
  useEffect(() => {
    window.localStorage.setItem(
      'plum-dashboard-dock-collapsed',
      dashboardDockCollapsed ? '1' : '0'
    );
  }, [dashboardDockCollapsed]);

  // Category filter driven by the SessionCategories rail; null = all sessions.
  const [dashboardCategoryFilter, setDashboardCategoryFilter] = useState<string | null>(null);
  const [selectedCliProvider, setSelectedCliProvider] = useState<CLIProvider>(() =>
    getDashboardDefaultProvider(undefined)
  );
  const providerSelectedExplicitlyRef = useRef(false);
  const sessionNameEditedRef = useRef(false);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const newSessionFileInputRef = useRef<HTMLInputElement>(null);
  const iconUploadInputRef = useRef<HTMLInputElement>(null);
  const suppressDashboardCardClickRef = useRef(false);

  // Fetch user settings
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<UserSettings>>('/api/settings');
      return response.data.data;
    },
  });
  const dashboardDefaultProvider = getDashboardDefaultProvider(
    settings?.defaultCliProvider,
    settings?.enabledCliProviders
  );

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!showNewSession || !providerSelectedExplicitlyRef.current) {
      setSelectedCliProvider(dashboardDefaultProvider);
    }
  }, [dashboardDefaultProvider, showNewSession]);

  useEffect(() => {
    setSelectedModel(settings?.cliProviderModels?.[selectedCliProvider] || '');
    setSelectedReasoning(
      normalizeDashboardReasoning(
        selectedCliProvider,
        settings?.cliProviderReasoning?.[selectedCliProvider]
      )
    );
  }, [selectedCliProvider, settings?.cliProviderModels, settings?.cliProviderReasoning]);

  useEffect(() => {
    const input = promptInputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 176)}px`;
  }, [newSessionPrompt]);

  // Fetch sessions
  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Session[]>>('/api/sessions');
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return [];
    },
    retry: 1,
  });

  useEffect(() => {
    if (sessionsQuery.data !== undefined) {
      setSessions(sessionsQuery.data);
    }
  }, [sessionsQuery.data, setSessions]);

  // Fetch available CLI providers
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

  // A fresh instance has no usable harness yet. Sending the operator to the
  // wizard beats a dashboard whose "New session" button cannot work.
  const { data: setupStatus } = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<{ ready: boolean }>>('/api/setup/status');
      return response.data.data;
    },
    staleTime: 60_000,
  });
  useEffect(() => {
    if (setupStatus && !setupStatus.ready) {
      navigate('/setup', { replace: true });
    }
  }, [setupStatus, navigate]);

  // Create session mutation
  const createMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      workingDirectory?: string;
      cliProvider?: CLIProvider;
      cliModel?: string | null;
      cliReasoning?: string | null;
      mode?: SessionMode;
      surface?: SessionSurface;
      initialMessage?: string;
      files?: File[];
    }) => {
      if (data.files && data.files.length > 0) {
        const formData = new FormData();
        formData.append('name', data.name);
        if (data.workingDirectory) formData.append('workingDirectory', data.workingDirectory);
        if (data.cliProvider) formData.append('cliProvider', data.cliProvider);
        if (data.cliModel) formData.append('cliModel', data.cliModel);
        if (data.cliReasoning) formData.append('cliReasoning', data.cliReasoning);
        if (data.mode) formData.append('mode', data.mode);
        if (data.surface) formData.append('surface', data.surface);
        if (data.initialMessage) formData.append('initialMessage', data.initialMessage);
        data.files.forEach((file) => formData.append('files', file));

        const response = await api.post<ApiResponse<Session>>('/api/sessions', formData);
        return response.data;
      }

      const { files: _files, ...jsonData } = data;
      const response = await api.post<ApiResponse<Session>>('/api/sessions', jsonData);
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        providerSelectedExplicitlyRef.current = false;
        setShowNewSession(false);
        setNewSessionPrompt('');
        setNewSessionName('');
        sessionNameEditedRef.current = false;
        setSessionMode('new');
        setNewSessionSurface('code');
        setNewSessionPermissionMode('auto-accept');
        setSelectedModel('');
        setSelectedReasoning('');
        setSelectedFolder(null);
        setNewSessionFiles([]);
        if (newSessionFileInputRef.current) newSessionFileInputRef.current.value = '';
        setSelectedCliProvider(dashboardDefaultProvider);
        navigate(`/session/${data.data.id}`);
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const hasDefaultDir = !!settings?.defaultWorkingDir;
  const deferredDashboardSearch = useDeferredValue(dashboardSearchQuery);
  const normalizedDashboardSearch = deferredDashboardSearch.trim().toLocaleLowerCase();
  const dashboardCategoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories]
  );
  const filteredSessions = useMemo(() => {
    const byCategory = dashboardCategoryFilter
      ? sessions.filter((session) => session.category === dashboardCategoryFilter)
      : sessions;
    if (!normalizedDashboardSearch) return byCategory;

    return byCategory.filter((session) => {
      const searchableValues = [
        session.name,
        session.workingDirectory,
        session.projectDescription,
        session.lastMessage,
        session.cliProvider,
        session.cliModel,
        session.category ? dashboardCategoryNames.get(session.category) : null,
      ];
      return searchableValues.some((value) => {
        if (!value) return false;
        const normalizedValue = value.toLocaleLowerCase();
        if (normalizedDashboardSearch.length > 2) {
          return normalizedValue.includes(normalizedDashboardSearch);
        }
        const words: string[] = normalizedValue.match(/[\p{L}\p{N}]+/gu) ?? [];
        return words.includes(normalizedDashboardSearch);
      });
    });
  }, [dashboardCategoryFilter, dashboardCategoryNames, normalizedDashboardSearch, sessions]);
  const sessionRunStates = useMemo(
    () =>
      new Map(
        sessions.map((session) => [
          session.id,
          getSessionRunState(session, {
            activity: activity[session.id],
            activeAgent: activeAgent[session.id],
            agentRuns: agentRuns[session.id],
            streamingContent: streamingContent[session.id],
            tools: toolExecutions[session.id],
            queue: queueState[session.id],
            lifecycle: lifecycle[session.id],
            pendingApprovals: pendingApprovalCounts[session.id],
          }),
        ])
      ),
    [
      activity,
      activeAgent,
      agentRuns,
      lifecycle,
      pendingApprovalCounts,
      queueState,
      sessions,
      streamingContent,
      toolExecutions,
    ]
  );
  const dashboardSessionGroups = useMemo(() => {
    if (normalizedDashboardSearch) {
      if (filteredSessions.length === 0) return [];
      return [
        {
          id: DASHBOARD_SEARCH_GROUP_ID,
          label: 'Search results',
          sessions: filteredSessions,
          hasWorking: filteredSessions.some(
            (session) => sessionRunStates.get(session.id)?.isWorking
          ),
          categoryId: null,
          isDropTarget: false,
        },
      ];
    }

    const knownCategoryIds = new Set(categories.map((category) => category.id));
    const usedSessionIds = new Set<string>();
    const grouped = new Map<string, Session[]>();
    const getHasWorking = (groupSessions: Session[]) =>
      groupSessions.some((session) => sessionRunStates.get(session.id)?.isWorking);
    const priorityGroups: DashboardSessionGroup[] = [];

    const favoriteSessions = filteredSessions.filter((session) => session.starred);
    if (favoriteSessions.length > 0) {
      priorityGroups.push({
        id: DASHBOARD_FAVORITES_GROUP_ID,
        label: 'Favorites',
        sessions: favoriteSessions,
        hasWorking: getHasWorking(favoriteSessions),
        categoryId: null,
        isDropTarget: false,
      });
      favoriteSessions.forEach((session) => usedSessionIds.add(session.id));
    }

    const recentSessions = [...filteredSessions]
      .filter((session) => !usedSessionIds.has(session.id))
      .sort((a, b) =>
        (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '')
      )
      .slice(0, RECENT_SESSIONS_LIMIT);

    if (recentSessions.length > 0) {
      priorityGroups.push({
        id: DASHBOARD_RECENT_GROUP_ID,
        label: 'Recent Sessions',
        sessions: recentSessions,
        hasWorking: getHasWorking(recentSessions),
        categoryId: null,
        isDropTarget: false,
      });
      recentSessions.forEach((session) => usedSessionIds.add(session.id));
    }

    for (const session of filteredSessions) {
      if (usedSessionIds.has(session.id)) continue;

      const groupId =
        session.category && knownCategoryIds.has(session.category)
          ? session.category
          : DASHBOARD_UNCATEGORIZED_GROUP_ID;
      const groupSessions = grouped.get(groupId) ?? [];
      groupSessions.push(session);
      grouped.set(groupId, groupSessions);
    }

    const categoryGroups: DashboardSessionGroup[] = categories.map((category) => {
      const groupSessions = grouped.get(category.id) ?? [];
      return {
        id: category.id,
        label: category.name,
        sessions: groupSessions,
        hasWorking: getHasWorking(groupSessions),
        categoryId: category.id,
        isDropTarget: true,
        color: category.color,
      };
    });

    const uncategorized = grouped.get(DASHBOARD_UNCATEGORIZED_GROUP_ID) ?? [];
    if (
      uncategorized.length > 0 &&
      (categories.length > 0 || uncategorized.length > recentSessions.length)
    ) {
      categoryGroups.push({
        id: DASHBOARD_UNCATEGORIZED_GROUP_ID,
        label: 'No category',
        sessions: uncategorized,
        hasWorking: getHasWorking(uncategorized),
        categoryId: null,
        isDropTarget: true,
      });
    }

    categoryGroups.sort((a, b) => {
      if (a.id === DASHBOARD_UNCATEGORIZED_GROUP_ID) return 1;
      if (b.id === DASHBOARD_UNCATEGORIZED_GROUP_ID) return -1;
      if (a.hasWorking !== b.hasWorking) return a.hasWorking ? -1 : 1;
      return 0;
    });

    return [...priorityGroups, ...categoryGroups];
  }, [categories, filteredSessions, normalizedDashboardSearch, sessionRunStates]);
  const selectedProviderInfo = cliProviders?.find(
    (provider) => provider.id === selectedCliProvider
  );
  const configuredModelsForProvider = useMemo(() => {
    return settings?.cliProviderModelLists?.[selectedCliProvider] || [];
  }, [selectedCliProvider, settings?.cliProviderModelLists]);
  const selectedProviderModelLabels = selectedProviderInfo?.modelLabels || {};
  const providerDefaultModel =
    selectedProviderInfo?.defaultModel || CLI_PROVIDER_DEFAULT_MODEL[selectedCliProvider];
  const resolvedDefaultModel =
    selectedCliProvider === 'opencode' || selectedCliProvider === 'pi'
      ? configuredModelsForProvider[0] || providerDefaultModel
      : providerDefaultModel;
  const modelOptions = useMemo(() => {
    if (selectedCliProvider === 'opencode' || selectedCliProvider === 'pi') {
      return Array.from(
        new Set(
          configuredModelsForProvider.length > 0
            ? configuredModelsForProvider
            : selectedProviderInfo?.models || []
        )
      );
    }
    const options = new Set<string>();
    for (const model of selectedProviderInfo?.models || []) options.add(model);
    for (const model of configuredModelsForProvider) options.add(model);
    if (selectedModel) options.add(selectedModel);
    return Array.from(options);
  }, [
    configuredModelsForProvider,
    selectedCliProvider,
    selectedModel,
    selectedProviderInfo?.models,
  ]);
  const showDefaultModelOption =
    selectedCliProvider === 'pi' ||
    selectedCliProvider !== 'opencode' ||
    configuredModelsForProvider.length > 0;
  const reasoningOptions = useMemo(
    () => getDashboardReasoningOptions(selectedCliProvider),
    [selectedCliProvider]
  );
  const selectedModeOption = DASHBOARD_SESSION_MODE_OPTIONS.find(
    (option) => option.value === newSessionPermissionMode
  );
  const SelectedModeIcon = selectedModeOption?.icon || Brain;
  const selectedUiProvider = toUiProvider(selectedCliProvider);
  const workspaceSummary =
    sessionMode === 'new'
      ? hasDefaultDir
        ? `New folder in ${settings?.defaultWorkingDir}`
        : 'Default folder missing'
      : selectedFolder || 'Choose an existing folder';

  // Delete session mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/sessions/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast({ title: 'Session deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const handleToggleStar = async (id: string, currentlyStarred: boolean) => {
    try {
      await api.patch(`/api/sessions/${id}/star`, { starred: !currentlyStarred });
      updateSession(id, { starred: !currentlyStarred });
      queryClient.setQueryData<Session[]>(
        ['sessions'],
        (current) =>
          current?.map((session) =>
            session.id === id ? { ...session, starred: !currentlyStarred } : session
          ) ?? current
      );
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed';
      toast({ title: 'Failed to update star', description: message, variant: 'destructive' });
    }
  };

  const handleAssignCategory = async (sessionId: string, categoryId: string | null) => {
    const session = sessions.find((item) => item.id === sessionId);
    const previousCategory = session?.category ?? null;
    if (previousCategory === categoryId) return;

    updateSession(sessionId, { category: categoryId });
    queryClient.setQueryData<Session[]>(
      ['sessions'],
      (current) =>
        current?.map((item) =>
          item.id === sessionId ? { ...item, category: categoryId } : item
        ) ?? current
    );

    try {
      await api.patch(`/api/sessions/${sessionId}/category`, { categoryId });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    } catch (error) {
      updateSession(sessionId, { category: previousCategory });
      queryClient.setQueryData<Session[]>(
        ['sessions'],
        (current) =>
          current?.map((item) =>
            item.id === sessionId ? { ...item, category: previousCategory } : item
          ) ?? current
      );
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed';
      toast({ title: 'Failed to update category', description: message, variant: 'destructive' });
    }
  };

  const getDraggedDashboardSessionId = (event: DragEvent<HTMLElement>) =>
    event.dataTransfer.getData(DASHBOARD_SESSION_DRAG_TYPE) ||
    event.dataTransfer.getData('text/plain') ||
    draggingDashboardSessionId;

  const handleDashboardSessionDragStart = (event: DragEvent<HTMLElement>, session: Session) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-dashboard-no-drag="true"]')) {
      event.preventDefault();
      return;
    }

    suppressDashboardCardClickRef.current = true;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DASHBOARD_SESSION_DRAG_TYPE, session.id);
    event.dataTransfer.setData('text/plain', session.id);
    setDraggingDashboardSessionId(session.id);
  };

  const clearDashboardDragState = () => {
    setDraggingDashboardSessionId(null);
    setDragOverDashboardGroupId(null);
    window.setTimeout(() => {
      suppressDashboardCardClickRef.current = false;
    }, 0);
  };

  const handleDashboardGroupDragOver = (
    event: DragEvent<HTMLElement>,
    group: DashboardSessionGroup
  ) => {
    if (!group.isDropTarget || !draggingDashboardSessionId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragOverDashboardGroupId !== group.id) {
      setDragOverDashboardGroupId(group.id);
    }
  };

  const handleDashboardGroupDragLeave = (
    event: DragEvent<HTMLElement>,
    group: DashboardSessionGroup
  ) => {
    const relatedTarget = event.relatedTarget;
    if (
      relatedTarget instanceof Node &&
      event.currentTarget.contains(relatedTarget) &&
      dragOverDashboardGroupId === group.id
    ) {
      return;
    }
    if (dragOverDashboardGroupId === group.id) setDragOverDashboardGroupId(null);
  };

  const handleDashboardGroupDrop = async (
    event: DragEvent<HTMLElement>,
    group: DashboardSessionGroup
  ) => {
    if (!group.isDropTarget) return;
    event.preventDefault();
    const sessionId = getDraggedDashboardSessionId(event);
    clearDashboardDragState();
    if (!sessionId) return;
    await handleAssignCategory(sessionId, group.categoryId);
  };

  const handleCreateDashboardCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = dashboardCategoryName.trim();
    if (!name || dashboardCategorySubmitting) return;

    setDashboardCategorySubmitting(true);
    try {
      const category = await createCategory({
        name,
        color: dashboardCategoryColor,
        icon: 'folder',
      });
      if (!category) {
        toast({
          title: 'Failed to create category',
          description: 'The category could not be created.',
          variant: 'destructive',
        });
        return;
      }
      setDashboardCategoryName('');
      setDashboardCategoryColor(getNextDashboardCategoryColor([...categories, category]));
      setCreatingDashboardCategory(false);
      setCollapsedDashboardGroupIds((current) => ({ ...current, [category.id]: false }));
      toast({ title: 'Category created' });
    } finally {
      setDashboardCategorySubmitting(false);
    }
  };

  const getIconErrorMessage = (error: unknown, fallback: string) =>
    error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;

  const refreshSessions = async () => {
    const response = await api.get<ApiResponse<Session[]>>('/api/sessions');
    if (response.data.success && response.data.data) {
      setSessions(response.data.data);
      queryClient.setQueryData(['sessions'], response.data.data);
    }
  };

  const syncIconSession = async (session: Session | undefined) => {
    if (!session) return;
    updateSession(session.id, session);
    queryClient.setQueryData<Session[]>(
      ['sessions'],
      (current) =>
        current?.map((item) => (item.id === session.id ? { ...item, ...session } : item)) ?? current
    );
    await refreshSessions().catch(() => undefined);
  };

  const handleGenerateIcon = async (session: Session) => {
    if (iconBusySessionId) return;
    setIconBusySessionId(session.id);
    toast({ title: 'Generating icon', description: 'This can take a moment.' });
    try {
      const response = await api.post<ApiResponse<Session>>(
        `/api/sessions/${session.id}/icon/generate`
      );
      await syncIconSession(response.data.data);
      toast({ title: 'Session icon updated' });
    } catch (error) {
      toast({
        title: 'Icon generation failed',
        description: getIconErrorMessage(error, 'Failed to generate icon'),
        variant: 'destructive',
      });
    } finally {
      setIconBusySessionId(null);
    }
  };

  const handleUseProjectIcon = async (session: Session) => {
    if (iconBusySessionId) return;
    setIconBusySessionId(session.id);
    try {
      const response = await api.post<ApiResponse<Session>>(
        `/api/sessions/${session.id}/icon/project`
      );
      await syncIconSession(response.data.data);
      toast({ title: 'Project icon applied' });
    } catch (error) {
      toast({
        title: 'Project icon not found',
        description: getIconErrorMessage(error, 'No usable icon was found in this project'),
        variant: 'destructive',
      });
    } finally {
      setIconBusySessionId(null);
    }
  };

  const startIconUpload = (sessionId: string) => {
    setIconUploadSessionId(sessionId);
    if (iconUploadInputRef.current) {
      iconUploadInputRef.current.value = '';
      iconUploadInputRef.current.click();
    }
  };

  const handleIconUploadFile = async (file: File | undefined) => {
    if (!file || !iconUploadSessionId || iconBusySessionId) {
      if (!file) setIconUploadSessionId(null);
      return;
    }
    setIconBusySessionId(iconUploadSessionId);
    const formData = new FormData();
    formData.append('icon', file);
    try {
      const response = await api.post<ApiResponse<Session>>(
        `/api/sessions/${iconUploadSessionId}/icon/upload`,
        formData
      );
      await syncIconSession(response.data.data);
      toast({ title: 'Session icon uploaded' });
    } catch (error) {
      toast({
        title: 'Icon upload failed',
        description: getIconErrorMessage(error, 'Failed to upload icon'),
        variant: 'destructive',
      });
    } finally {
      setIconBusySessionId(null);
      setIconUploadSessionId(null);
      if (iconUploadInputRef.current) iconUploadInputRef.current.value = '';
    }
  };

  const handleResetIcon = async (session: Session) => {
    if (iconBusySessionId) return;
    setIconBusySessionId(session.id);
    try {
      const response = await api.delete<ApiResponse<Session>>(`/api/sessions/${session.id}/icon`);
      await syncIconSession(response.data.data);
      toast({ title: 'Session icon reset' });
    } catch (error) {
      toast({
        title: 'Failed to reset icon',
        description: getIconErrorMessage(error, 'Failed to reset icon'),
        variant: 'destructive',
      });
    } finally {
      setIconBusySessionId(null);
    }
  };

  const handlePromptChange = (value: string) => {
    setNewSessionPrompt(value);
    if (!sessionNameEditedRef.current) {
      setNewSessionName(deriveSessionName(value, newSessionSurface));
    }
  };

  const handleTaskWorkflowSelect = (workflow: TaskWorkflow) => {
    setNewSessionSurface('task');
    handlePromptChange(workflow.prompt);
    if (!sessionNameEditedRef.current || !newSessionName.trim()) {
      setNewSessionName(workflow.shortTitle);
    }
    window.setTimeout(() => promptInputRef.current?.focus({ preventScroll: true }), 0);
  };

  const handleSurfaceChange = (surface: SessionSurface) => {
    setNewSessionSurface(surface);
    if (!sessionNameEditedRef.current) {
      setNewSessionName(deriveSessionName(newSessionPrompt, surface));
    }
  };

  const handleNewSessionFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    setNewSessionFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const next = [...current];
      for (const file of selectedFiles) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(file);
      }
      return next;
    });

    event.target.value = '';
  };

  const removeNewSessionFile = (index: number) => {
    setNewSessionFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const clearNewSessionFiles = () => {
    setNewSessionFiles([]);
    if (newSessionFileInputRef.current) newSessionFileInputRef.current.value = '';
  };

  const handleCreateSession = (e: FormEvent) => {
    e.preventDefault();
    const prompt = newSessionPrompt.trim();
    if (!prompt) {
      toast({
        title: 'Write a request first',
        description: 'The dashboard starts sessions from a prompt.',
      });
      return;
    }
    if (sessionMode === 'new' && !hasDefaultDir) {
      toast({
        title: 'Default folder missing',
        description: 'Set a default working directory before creating new workspace folders.',
        variant: 'destructive',
      });
      return;
    }
    if (sessionMode === 'existing' && !selectedFolder) {
      toast({
        title: 'Choose a folder',
        description: 'Select an existing workspace folder for this session.',
        variant: 'destructive',
      });
      return;
    }

    const reasoning = selectedReasoning.trim();
    const payload: {
      name: string;
      workingDirectory?: string;
      cliProvider?: CLIProvider;
      cliModel?: string | null;
      cliReasoning?: string | null;
      mode?: SessionMode;
      surface?: SessionSurface;
      initialMessage?: string;
      files?: File[];
    } = {
      name: (newSessionName.trim() || deriveSessionName(prompt, newSessionSurface)).slice(0, 100),
      cliProvider: selectedCliProvider,
      cliModel: selectedModel.trim() || null,
      cliReasoning: normalizeDashboardReasoning(selectedCliProvider, reasoning) || null,
      mode: newSessionPermissionMode,
      surface: newSessionSurface,
      initialMessage: prompt,
      files: newSessionFiles,
    };
    if (sessionMode === 'existing' && selectedFolder) {
      payload.workingDirectory = selectedFolder;
    }
    createMutation.mutate(payload);
  };

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      providerSelectedExplicitlyRef.current = false;
      setShowNewSession(true);
      setIsComposerExpanded(true);
      window.setTimeout(() => promptInputRef.current?.focus({ preventScroll: true }), 0);
    }
  }, [searchParams]);

  const openNewSession = (provider?: CLIProvider) => {
    providerSelectedExplicitlyRef.current = !!provider;
    setSelectedCliProvider(provider ?? dashboardDefaultProvider);
    setShowNewSession(true);
    setIsComposerExpanded(true);
    window.setTimeout(() => promptInputRef.current?.focus({ preventScroll: true }), 0);
  };

  const closeNewSession = () => {
    providerSelectedExplicitlyRef.current = false;
    setShowNewSession(false);
    setIsComposerExpanded(false);
    setSessionMode('new');
    setSelectedFolder(null);
    setNewSessionPrompt('');
    setNewSessionName('');
    clearNewSessionFiles();
    sessionNameEditedRef.current = false;
  };

  const toggleDashboardGroup = (groupId: string) => {
    setCollapsedDashboardGroupIds((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  const isInitialSessionLoad = isOnline && sessionsQuery.isLoading && sessions.length === 0;
  const isSessionListUnavailable = (!isOnline || sessionsQuery.isError) && sessions.length === 0;
  const isShowingCachedSessions = sessions.length > 0 && (!isOnline || sessionsQuery.isError);
  const sessionLoadMessage = !isOnline
    ? 'You are offline. Reconnect to refresh your sessions.'
    : sessionsQuery.error instanceof Error
      ? sessionsQuery.error.message
      : 'Plum could not load your sessions.';

  return (
    <div className="dashboard-layout">
      <div className="dashboard-shell space-y-5">
        <section className="dashboard-command">
          <div className="dashboard-command-header">
            <div className="dashboard-hero-main">
              <div className="dashboard-eyebrow">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Plum Code</span>
              </div>
              <div className="dashboard-title-row">
                <h1>What should Plum do?</h1>
                <span className="dashboard-count">{sessions.length}</span>
              </div>
              <p className="dashboard-subtitle ui-text">
                Start a code workspace or a quieter task chat directly from here.
              </p>
            </div>
            <label className="dashboard-search" aria-label="Search sessions">
              <Search className="dashboard-search-icon" aria-hidden="true" />
              <input
                type="search"
                value={dashboardSearchQuery}
                onChange={(event) => setDashboardSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setDashboardSearchQuery('');
                    event.currentTarget.blur();
                  }
                }}
                placeholder="Search sessions"
              />
              {dashboardSearchQuery && (
                <button
                  type="button"
                  className="dashboard-search-clear"
                  onClick={() => setDashboardSearchQuery('')}
                  aria-label="Clear session search"
                >
                  <X aria-hidden="true" />
                </button>
              )}
              <span className="dashboard-search-count" aria-live="polite">
                {normalizedDashboardSearch ? `${filteredSessions.length}/${sessions.length}` : ''}
              </span>
            </label>
          </div>

          <form
            onSubmit={handleCreateSession}
            className={cn(
              'dashboard-start-composer dashboard-chatbar glass-chrome relative',
              isComposerExpanded && 'is-composer-expanded'
            )}
          >
            <button
              type="button"
              className="dashboard-composer-mobile-toggle"
              onClick={() => {
                const nextExpanded = !isComposerExpanded;
                setIsComposerExpanded(nextExpanded);
                if (nextExpanded) {
                  window.setTimeout(
                    () => promptInputRef.current?.focus({ preventScroll: true }),
                    0
                  );
                }
              }}
              aria-expanded={isComposerExpanded}
            >
              <span className="dashboard-composer-mobile-icon">
                {isComposerExpanded ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
              </span>
              <span className="dashboard-composer-mobile-copy">
                <strong>
                  {isComposerExpanded
                    ? 'Minimize session composer'
                    : newSessionPrompt.trim()
                      ? 'Continue session draft'
                      : 'Start a new session'}
                </strong>
                <small>
                  {newSessionPrompt.trim()
                    ? `${newSessionPrompt.trim().slice(0, 72)}${newSessionPrompt.trim().length > 72 ? '…' : ''}`
                    : 'Code or task · choose provider after opening'}
                </small>
              </span>
              {(newSessionFiles.length > 0 || newSessionPrompt.trim()) && !isComposerExpanded && (
                <span className="dashboard-composer-mobile-draft">Draft</span>
              )}
              <ChevronRight
                className={cn('dashboard-composer-mobile-chevron', isComposerExpanded && 'is-open')}
                aria-hidden="true"
              />
            </button>

            <div className="dashboard-chatbar-topline">
              <div
                className="dashboard-surface-switch dashboard-chatbar-segment"
                aria-label="New session surface"
              >
                <button
                  type="button"
                  className={cn(newSessionSurface === 'code' && 'is-active')}
                  onClick={() => handleSurfaceChange('code')}
                >
                  <Code2 className="h-4 w-4" />
                  <span>Code</span>
                </button>
                <button
                  type="button"
                  className={cn(newSessionSurface === 'task' && 'is-active')}
                  onClick={() => handleSurfaceChange('task')}
                >
                  <ClipboardList className="h-4 w-4" />
                  <span>Task</span>
                </button>
              </div>

              <label className="dashboard-chatbar-name" title="Session name">
                <Pencil className="h-3.5 w-3.5" />
                <input
                  value={newSessionName}
                  onChange={(event) => {
                    sessionNameEditedRef.current = true;
                    setNewSessionName(event.target.value);
                  }}
                  placeholder={
                    newSessionSurface === 'task' ? 'Vanessa editing task' : 'Feature work'
                  }
                  aria-label="Session name"
                />
              </label>
            </div>

            <div className="dashboard-prompt-shell dashboard-chatbar-input-shell">
              <div className="dashboard-chatbar-field">
                <textarea
                  ref={promptInputRef}
                  value={newSessionPrompt}
                  onChange={(event) => handlePromptChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  onInput={(event) => {
                    const target = event.currentTarget;
                    target.style.height = 'auto';
                    target.style.height = `${Math.min(target.scrollHeight, 176)}px`;
                  }}
                  placeholder={
                    newSessionSurface === 'task'
                      ? 'Ask for editing, writing, summarizing, research, file changes...'
                      : 'Describe what should be built, fixed, debugged, or changed...'
                  }
                  className="dashboard-prompt-input dashboard-chatbar-textarea"
                  rows={1}
                  style={{ height: 'auto', overflow: 'hidden' }}
                />
              </div>
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="dashboard-send-button dashboard-chatbar-send composer-control-button composer-control-send"
                disabled={
                  createMutation.isPending ||
                  !newSessionPrompt.trim() ||
                  (sessionMode === 'new' && !hasDefaultDir) ||
                  (sessionMode === 'existing' && !selectedFolder) ||
                  !!(selectedProviderInfo && !selectedProviderInfo.available)
                }
                title="Start session"
                aria-label="Start session"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>

            {newSessionSurface === 'task' && (
              <div className="dashboard-task-workflows" aria-label="Task workflows">
                {TASK_WORKFLOWS.map((workflow) => (
                  <button
                    key={workflow.id}
                    type="button"
                    onClick={() => handleTaskWorkflowSelect(workflow)}
                    className="dashboard-task-workflow"
                  >
                    <span className="dashboard-task-workflow-icon">
                      {workflow.id === 'quick-brief' ? (
                        <ClipboardList className="h-4 w-4" />
                      ) : workflow.id === 'research-brief' ? (
                        <Brain className="h-4 w-4" />
                      ) : workflow.id === 'draft-message' ? (
                        <MessageSquare className="h-4 w-4" />
                      ) : workflow.id === 'plan-project' ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : workflow.id === 'creative-direction' ? (
                        <Sparkles className="h-4 w-4" />
                      ) : workflow.id === 'decision-support' ? (
                        <SlidersHorizontal className="h-4 w-4" />
                      ) : (
                        <ClipboardList className="h-4 w-4" />
                      )}
                    </span>
                    <span className="dashboard-task-workflow-copy">
                      <strong>{workflow.shortTitle}</strong>
                      <small>{workflow.description}</small>
                      <em>{workflow.meta}</em>
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="dashboard-composer-controls dashboard-chatbar-tools">
              <label className="dashboard-control dashboard-chatbar-chip dashboard-chatbar-provider">
                <ProviderLogo provider={selectedUiProvider} className="h-4 w-4" alt="" />
                <span>Provider</span>
                <select
                  value={selectedCliProvider}
                  onChange={(event) => {
                    providerSelectedExplicitlyRef.current = true;
                    setSelectedCliProvider(event.target.value as CLIProvider);
                  }}
                  aria-label="Provider"
                >
                  {cliProviders
                    ?.filter((provider) => provider.enabled !== false)
                    .map((provider) => (
                      <option key={provider.id} value={provider.id} disabled={!provider.available}>
                        {provider.name}
                        {!provider.available ? ' (N/A)' : ''}
                      </option>
                    ))}
                </select>
              </label>

              <label className="dashboard-control dashboard-chatbar-chip">
                <SelectedModeIcon className="h-4 w-4" />
                <span>Mode</span>
                <select
                  value={newSessionPermissionMode}
                  onChange={(event) =>
                    setNewSessionPermissionMode(event.target.value as SessionMode)
                  }
                  aria-label="Mode"
                >
                  {DASHBOARD_SESSION_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} · {option.description}
                    </option>
                  ))}
                </select>
              </label>

              <label className="dashboard-control dashboard-chatbar-chip dashboard-chatbar-model">
                <Brain className="h-4 w-4" />
                <span>Model</span>
                <select
                  value={selectedModel || '__default__'}
                  onChange={(event) =>
                    setSelectedModel(event.target.value === '__default__' ? '' : event.target.value)
                  }
                  aria-label="Model"
                >
                  {showDefaultModelOption && (
                    <option value="__default__">
                      Default
                      {resolvedDefaultModel
                        ? ` · ${selectedProviderModelLabels[resolvedDefaultModel] || resolvedDefaultModel}`
                        : ''}
                    </option>
                  )}
                  {modelOptions.map((model) => (
                    <option key={model} value={model}>
                      {selectedProviderModelLabels[model] || model}
                    </option>
                  ))}
                </select>
              </label>

              <label className="dashboard-control dashboard-chatbar-chip">
                <Zap className="h-4 w-4" />
                <span>
                  {selectedCliProvider === 'claude' || selectedCliProvider === 'zai'
                    ? 'Effort'
                    : 'Reasoning'}
                </span>
                <select
                  value={selectedReasoning || '__default__'}
                  onChange={(event) =>
                    setSelectedReasoning(
                      event.target.value === '__default__' ? '' : event.target.value
                    )
                  }
                  aria-label={
                    selectedCliProvider === 'claude' || selectedCliProvider === 'zai'
                      ? 'Effort'
                      : 'Reasoning'
                  }
                >
                  <option value="__default__">Default</option>
                  {reasoningOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className={cn(
                  'dashboard-workspace-toggle dashboard-chatbar-chip dashboard-chatbar-workspace',
                  showNewSession && 'is-open'
                )}
                onClick={() => setShowNewSession((open) => !open)}
                title={workspaceSummary}
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span>Workspace</span>
                <strong>{workspaceSummary}</strong>
              </button>

              <input
                ref={newSessionFileInputRef}
                type="file"
                multiple
                className="sr-only"
                onChange={handleNewSessionFilesChange}
              />
              <button
                type="button"
                className={cn(
                  'dashboard-workspace-toggle dashboard-chatbar-chip dashboard-chatbar-upload',
                  newSessionFiles.length > 0 && 'has-files'
                )}
                onClick={() => newSessionFileInputRef.current?.click()}
                disabled={createMutation.isPending}
                title={
                  newSessionFiles.length > 0
                    ? `${newSessionFiles.length} file(s) will be copied into the workfolder`
                    : 'Upload files into the workfolder before the session starts'
                }
              >
                <Upload className="h-4 w-4" />
                <span>Files</span>
                <strong>
                  {newSessionFiles.length > 0 ? `${newSessionFiles.length} selected` : 'Upload'}
                </strong>
              </button>
            </div>

            {newSessionFiles.length > 0 && (
              <div className="dashboard-upload-list">
                {newSessionFiles.map((file, index) => (
                  <span
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    className="dashboard-upload-pill"
                    title={`${file.name} · ${formatDashboardFileSize(file.size)}`}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>{file.name}</span>
                    <em>{formatDashboardFileSize(file.size)}</em>
                    <button
                      type="button"
                      onClick={() => removeNewSessionFile(index)}
                      aria-label={`Remove ${file.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="dashboard-upload-clear"
                  onClick={clearNewSessionFiles}
                >
                  Clear files
                </button>
              </div>
            )}

            {showNewSession && (
              <div className="dashboard-workspace-panel">
                <div className="dashboard-workspace-modes">
                  <Button
                    type="button"
                    variant={sessionMode === 'new' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setSessionMode('new');
                      setSelectedFolder(null);
                    }}
                    className="gap-1.5"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    New folder
                  </Button>
                  <Button
                    type="button"
                    variant={sessionMode === 'existing' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSessionMode('existing')}
                    className="gap-1.5"
                  >
                    <Folder className="h-3.5 w-3.5" />
                    Existing folder
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={closeNewSession}>
                    Clear
                  </Button>
                </div>

                {sessionMode === 'new' && !hasDefaultDir ? (
                  <div className="dashboard-workspace-warning">
                    <FolderOpen className="h-4 w-4" />
                    <span>Set a default working directory before creating new folders.</span>
                    <Button size="sm" asChild>
                      <Link to="/settings">
                        <Settings className="mr-1.5 h-3.5 w-3.5" />
                        Settings
                      </Link>
                    </Button>
                  </div>
                ) : sessionMode === 'existing' ? (
                  <div className="dashboard-folder-picker">
                    <Input
                      value={selectedFolder || ''}
                      readOnly
                      placeholder="Select folder..."
                      className="bg-muted/50"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowFolderBrowser(true)}
                    >
                      Browse
                    </Button>
                  </div>
                ) : (
                  <div className="dashboard-workspace-note">
                    <FolderOpen className="h-4 w-4" />
                    <span>{workspaceSummary}</span>
                  </div>
                )}
              </div>
            )}
          </form>
        </section>

        <FolderBrowserDialog
          open={showFolderBrowser}
          onOpenChange={setShowFolderBrowser}
          value={selectedFolder || undefined}
          onChange={(path: string) => {
            setSelectedFolder(path);
            setShowFolderBrowser(false);
            if (!newSessionName) setNewSessionName(path.split('/').pop() || '');
          }}
        />

        {/* Sessions */}
        <div className="dashboard-content-row">
          <div className="dashboard-session-sections">
            {isShowingCachedSessions && (
              <div className="dashboard-data-state is-cached" role="status">
                <WifiOff aria-hidden="true" />
                <div>
                  <strong>{isOnline ? 'Refresh failed' : 'Offline'}</strong>
                  <span>Showing your last loaded sessions. New server changes may be missing.</span>
                </div>
                <button type="button" onClick={() => void sessionsQuery.refetch()}>
                  <RotateCcw aria-hidden="true" />
                  Retry
                </button>
              </div>
            )}

            {isInitialSessionLoad && (
              <div className="dashboard-data-state is-loading" role="status" aria-live="polite">
                <Loader2 className="animate-spin" aria-hidden="true" />
                <div>
                  <strong>Loading sessions</strong>
                  <span>Restoring your latest workspaces…</span>
                </div>
              </div>
            )}

            {isSessionListUnavailable && !isInitialSessionLoad && (
              <div className="dashboard-data-state is-error" role="alert">
                {isOnline ? <AlertCircle aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
                <div>
                  <strong>{isOnline ? 'Sessions unavailable' : 'You are offline'}</strong>
                  <span>{sessionLoadMessage}</span>
                </div>
                <button type="button" onClick={() => void sessionsQuery.refetch()}>
                  <RotateCcw aria-hidden="true" />
                  Retry
                </button>
              </div>
            )}

            {!isInitialSessionLoad &&
              !isSessionListUnavailable &&
              normalizedDashboardSearch &&
              filteredSessions.length === 0 && (
                <div className="dashboard-search-empty" role="status">
                  <Search aria-hidden="true" />
                  <div>
                    <strong>No sessions found</strong>
                    <span>Try a session name, project path, provider, model, or category.</span>
                  </div>
                  <button type="button" onClick={() => setDashboardSearchQuery('')}>
                    Clear search
                  </button>
                </div>
              )}
            {dashboardSessionGroups.map((group) => {
              const groupCollapsed = normalizedDashboardSearch
                ? false
                : (collapsedDashboardGroupIds[group.id] ?? false);
              const groupColor = group.color
                ? getDashboardCategoryColorValue(group.color)
                : undefined;
              const groupDragOver = dragOverDashboardGroupId === group.id;
              return (
                <section
                  key={group.id}
                  className={cn(
                    'dashboard-session-section',
                    group.isDropTarget && 'is-drop-target',
                    group.hasWorking && 'is-working',
                    groupDragOver && 'is-drag-over',
                    groupCollapsed && 'is-collapsed'
                  )}
                  onDragOver={(event) => handleDashboardGroupDragOver(event, group)}
                  onDragLeave={(event) => handleDashboardGroupDragLeave(event, group)}
                  onDrop={(event) => handleDashboardGroupDrop(event, group)}
                >
                  <button
                    type="button"
                    className="dashboard-session-section-header"
                    aria-expanded={!groupCollapsed}
                    onClick={() => toggleDashboardGroup(group.id)}
                  >
                    <div className="dashboard-session-section-heading">
                      <ChevronRight
                        className="dashboard-session-section-chevron"
                        aria-hidden="true"
                      />
                      <span
                        className="dashboard-session-section-dot"
                        style={
                          groupColor && !group.hasWorking
                            ? { backgroundColor: groupColor }
                            : undefined
                        }
                      />
                      <h2>{group.label}</h2>
                    </div>
                    <span className="dashboard-session-section-count">{group.sessions.length}</span>
                  </button>

                  {!groupCollapsed && (
                    <div className="dashboard-session-grid">
                      {group.sessions.length === 0 && group.isDropTarget && (
                        <div className="dashboard-session-empty-drop" aria-hidden="true" />
                      )}
                      {group.sessions.map((session) => {
                        const runState =
                          sessionRunStates.get(session.id) ?? getSessionRunState(session);
                        const unreadCount = Math.max(
                          0,
                          Number((session as Session & { unreadCount?: number }).unreadCount) || 0
                        );
                        return (
                          <Card
                            key={session.id}
                            className={cn(
                              'dashboard-session-card cursor-pointer',
                              'is-draggable',
                              draggingDashboardSessionId === session.id && 'is-dragging',
                              `is-${runState.tone}`
                            )}
                            draggable
                            onDragStart={(event) => handleDashboardSessionDragStart(event, session)}
                            onDragEnd={clearDashboardDragState}
                            onClick={() => {
                              if (suppressDashboardCardClickRef.current) return;
                              navigate(`/session/${session.id}`);
                            }}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                navigate(`/session/${session.id}`);
                              }
                            }}
                            role="link"
                            tabIndex={0}
                            aria-label={`Open session ${session.name}`}
                          >
                            <CardHeader className="dashboard-session-header">
                              <div className="dashboard-session-heading">
                                <div className="dashboard-session-title-row">
                                  <span className="dashboard-session-icon-wrap">
                                    <SessionIcon
                                      session={session}
                                      className="shrink-0"
                                      logoClassName="h-5 w-5"
                                      imageClassName="h-7 w-7 rounded-full"
                                    />
                                    {iconBusySessionId === session.id && (
                                      <span className="session-icon-busy-overlay">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      </span>
                                    )}
                                  </span>
                                  <div className="dashboard-session-title-main">
                                    <CardTitle className="dashboard-session-title">
                                      {session.name}
                                    </CardTitle>
                                    <div
                                      className="dashboard-session-action-stack"
                                      data-dashboard-no-drag="true"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      <div className="dashboard-session-card-actions">
                                        <div
                                          className="dashboard-run-state"
                                          title={runState.detail}
                                        >
                                          <span
                                            className={cn(
                                              'dashboard-status-dot',
                                              `is-${runState.tone}`
                                            )}
                                          />
                                          <span>{runState.label}</span>
                                        </div>
                                        {unreadCount > 0 && (
                                          <span
                                            className="dashboard-session-unread"
                                            aria-label={`${unreadCount} unread ${unreadCount === 1 ? 'message' : 'messages'}`}
                                          >
                                            {unreadCount > 99 ? '99+' : unreadCount}
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          className={cn(
                                            'dashboard-session-star-button',
                                            session.starred && 'is-starred'
                                          )}
                                          onClick={() =>
                                            void handleToggleStar(session.id, session.starred)
                                          }
                                          aria-label={
                                            session.starred
                                              ? `Unstar ${session.name}`
                                              : `Star ${session.name}`
                                          }
                                          title={
                                            session.starred ? 'Unstar session' : 'Star session'
                                          }
                                        >
                                          <Star className="h-3.5 w-3.5" />
                                        </button>
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="dashboard-session-menu-button"
                                              aria-label={`More options for ${session.name}`}
                                            >
                                              <MoreHorizontal className="h-3.5 w-3.5" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end" className="w-44">
                                            <DropdownMenuItem
                                              onClick={() => setRenamingSession(session)}
                                              className="cursor-pointer"
                                            >
                                              <Pencil className="mr-2 h-3.5 w-3.5" />
                                              Rename
                                            </DropdownMenuItem>
                                            <DropdownMenuSub>
                                              <DropdownMenuSubTrigger className="cursor-pointer">
                                                <ImageIcon className="mr-2 h-3.5 w-3.5" />
                                                Icon
                                              </DropdownMenuSubTrigger>
                                              <DropdownMenuSubContent className="w-52">
                                                <DropdownMenuItem
                                                  onSelect={(event) => {
                                                    event.preventDefault();
                                                    void handleGenerateIcon(session);
                                                  }}
                                                  disabled={!!iconBusySessionId}
                                                  className="cursor-pointer"
                                                >
                                                  {iconBusySessionId === session.id ? (
                                                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                                  ) : (
                                                    <Sparkles className="mr-2 h-3.5 w-3.5" />
                                                  )}
                                                  {iconBusySessionId === session.id
                                                    ? 'Generating...'
                                                    : 'Generate'}
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                  onSelect={(event) => {
                                                    event.preventDefault();
                                                    startIconUpload(session.id);
                                                  }}
                                                  disabled={!!iconBusySessionId}
                                                  className="cursor-pointer"
                                                >
                                                  <Upload className="mr-2 h-3.5 w-3.5" />
                                                  Upload image
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                  onSelect={(event) => {
                                                    event.preventDefault();
                                                    void handleUseProjectIcon(session);
                                                  }}
                                                  disabled={!!iconBusySessionId}
                                                  className="cursor-pointer"
                                                >
                                                  <FolderInput className="mr-2 h-3.5 w-3.5" />
                                                  Use project icon
                                                </DropdownMenuItem>
                                                {session.iconUrl && (
                                                  <>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                      onSelect={(event) => {
                                                        event.preventDefault();
                                                        void handleResetIcon(session);
                                                      }}
                                                      disabled={!!iconBusySessionId}
                                                      className="cursor-pointer"
                                                    >
                                                      <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                                      Reset icon
                                                    </DropdownMenuItem>
                                                  </>
                                                )}
                                              </DropdownMenuSubContent>
                                            </DropdownMenuSub>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                              onClick={() => deleteMutation.mutate(session.id)}
                                              className="cursor-pointer text-destructive focus:text-destructive"
                                            >
                                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                                              Delete
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </div>
                                      <span className="dashboard-session-date ui-text">
                                        {formatDashboardLastActivity(session)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="dashboard-session-body">
                              <p className="dashboard-session-description ui-text">
                                {getDashboardProjectDescription(session)}
                              </p>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}

            <div
              className={cn(
                'dashboard-category-create-slot',
                (isInitialSessionLoad || isSessionListUnavailable) && 'hidden'
              )}
            >
              {creatingDashboardCategory ? (
                <form
                  className="dashboard-category-create-form"
                  onSubmit={handleCreateDashboardCategory}
                >
                  <Input
                    value={dashboardCategoryName}
                    onChange={(event) => setDashboardCategoryName(event.target.value)}
                    placeholder="Category name"
                    className="dashboard-category-create-input"
                    autoFocus
                  />
                  <div className="dashboard-category-color-row" aria-label="Category color">
                    {DASHBOARD_CATEGORY_COLOR_OPTIONS.map((color) => (
                      <button
                        key={color.name}
                        type="button"
                        className={cn(
                          'dashboard-category-color-swatch',
                          dashboardCategoryColor === color.name && 'is-selected'
                        )}
                        style={{ backgroundColor: color.value }}
                        onClick={() => setDashboardCategoryColor(color.name)}
                        aria-label={`${color.name} category color`}
                      />
                    ))}
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!dashboardCategoryName.trim() || dashboardCategorySubmitting}
                  >
                    {dashboardCategorySubmitting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Create
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCreatingDashboardCategory(false);
                      setDashboardCategoryName('');
                      setDashboardCategoryColor(getNextDashboardCategoryColor(categories));
                    }}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <button
                  type="button"
                  className="dashboard-category-add-bubble"
                  onClick={() => {
                    setDashboardCategoryColor(getNextDashboardCategoryColor(categories));
                    setCreatingDashboardCategory(true);
                  }}
                  aria-label="Create category"
                >
                  <Plus className="h-4 w-4" />
                  <span>New category</span>
                </button>
              )}
            </div>

            {!isInitialSessionLoad &&
              !isSessionListUnavailable &&
              !normalizedDashboardSearch &&
              filteredSessions.length === 0 && (
                <Card className="dashboard-empty-card">
                  <CardContent className="flex flex-col items-center justify-center py-8">
                    <MessageSquare className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground mb-3">No sessions yet</p>
                    <Button size="sm" onClick={() => openNewSession()}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Create your first session
                    </Button>
                  </CardContent>
                </Card>
              )}
          </div>
        </div>

        <RenameSessionDialog
          session={renamingSession}
          open={!!renamingSession}
          onOpenChange={(open) => {
            if (!open) setRenamingSession(null);
          }}
        />
        {/* The right dock is desktop-only, so phones get the same options inline
          below the list rather than losing access to them. */}
        <div className="dashboard-mobile-options md:hidden">
          <SessionCategories
            selectedCategory={dashboardCategoryFilter}
            onCategorySelect={setDashboardCategoryFilter}
          />
          <DiscoveredProjects cliProvider={selectedCliProvider} />
        </div>

        <input
          ref={iconUploadInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,.ico"
          className="hidden"
          onChange={(event) => handleIconUploadFile(event.target.files?.[0])}
        />
      </div>

      {/* Right-hand options menu, mirroring the session screen: the left rail
          is app navigation, the right dock is always "options for what you are
          looking at" — here that is category management and project discovery. */}
      <div
        className={cn(
          'session-right-dock dashboard-right-dock hidden md:flex',
          dashboardDockCollapsed && 'is-collapsed'
        )}
      >
        <nav className="session-right-menu" aria-label="Dashboard options">
          <div className="session-right-menu-header">
            <button
              type="button"
              className="session-right-collapse-button"
              onClick={() => setDashboardDockCollapsed((prev) => !prev)}
              title={dashboardDockCollapsed ? 'Expand options' : 'Collapse options'}
              aria-label={dashboardDockCollapsed ? 'Expand options' : 'Collapse options'}
            >
              {dashboardDockCollapsed ? (
                <ChevronLeft className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {!dashboardDockCollapsed && (
            <div className="session-side-menu-scroll">
              <div className="session-side-menu-embed">
                <SessionCategories
                  selectedCategory={dashboardCategoryFilter}
                  onCategorySelect={setDashboardCategoryFilter}
                />
              </div>
              <div className="session-side-menu-embed">
                <DiscoveredProjects cliProvider={selectedCliProvider} />
              </div>
            </div>
          )}
        </nav>
      </div>
    </div>
  );
}
