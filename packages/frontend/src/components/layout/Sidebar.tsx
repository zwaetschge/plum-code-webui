import { Inbox } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  LayoutDashboard,
  Settings,
  Star,
  BarChart3,
  Search,
  X,
  MoreHorizontal,
  Pencil,
  Trash2,
  ArrowDownAZ,
  ArrowUpDown,
  Clock,
  CalendarPlus,
  Folder,
  ChevronDown,
  ImageIcon,
  Upload,
  FolderInput,
  RotateCcw,
  Sparkles,
  Loader2,
  ServerCog,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSessionStore } from '@/stores/sessionStore';
import { useCategoryStore } from '@/stores/categoryStore';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { NotificationCenter } from '@/components/session/NotificationCenter';
import { SessionIcon } from '@/components/session/SessionIcon';
import { ContextPopover } from '@/components/session/SessionControls';
import { CLI_PROVIDER_LABEL, UI_PROVIDER_META } from '@/lib/providers';
import { getSessionRunState } from '@/lib/sessionRunState';
import { RECENT_SESSIONS_LIMIT } from '@/lib/sessionGrouping';
import { api, ApiError } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import type { ApiResponse, Session } from '@plum-code-webui/shared';
import type { UsageData } from '@plum-code-webui/shared';

const baseNavItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: BarChart3, label: 'Analytics', path: '/analytics' },
  { icon: ServerCog, label: 'Operations', path: '/operations' },
  { icon: Settings, label: 'General Settings', path: '/settings' },
];

type SortMode = 'updated' | 'created' | 'name';

const SORT_OPTIONS: { value: SortMode; label: string; icon: typeof Clock }[] = [
  { value: 'updated', label: 'Recently active', icon: Clock },
  { value: 'created', label: 'Newest', icon: CalendarPlus },
  { value: 'name', label: 'Name (A-Z)', icon: ArrowDownAZ },
];

const COLOR_VALUES: Record<string, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  purple: '#a855f7',
  orange: '#f97316',
  pink: '#ec4899',
  yellow: '#eab308',
  red: '#ef4444',
  teal: '#14b8a6',
};

const UNCATEGORIZED_GROUP_ID = '__uncategorized__';
const FAVORITES_GROUP_ID = '__favorites__';
const RECENT_GROUP_ID = '__recent__';

interface SidebarProps {
  onNavigate?: () => void;
  mobile?: boolean;
  navigationOnly?: boolean;
  contextUsage?: UsageData;
  contextStats?: {
    contextSnapshots: number;
    compactEvents: number;
  };
  contextSession?: Session | null;
}

export function Sidebar({
  onNavigate,
  mobile,
  navigationOnly = false,
  contextUsage,
  contextStats,
  contextSession,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    sessions,
    setSessions,
    updateSession,
    removeSession,
    activity,
    activeAgent,
    agentRuns,
    toolExecutions,
    queueState,
    lifecycle,
    pendingApprovalCounts,
  } = useSessionStore(
    useShallow((state) => ({
      sessions: state.sessions,
      setSessions: state.setSessions,
      updateSession: state.updateSession,
      removeSession: state.removeSession,
      activity: state.activity,
      activeAgent: state.activeAgent,
      agentRuns: state.agentRuns,
      toolExecutions: state.toolExecutions,
      queueState: state.queueState,
      lifecycle: state.lifecycle,
      pendingApprovalCounts: state.pendingApprovalCounts,
    }))
  );
  const streamingSessionIds = useSessionStore(
    useShallow((state) =>
      Object.entries(state.streamingContent)
        .filter(([, content]) => Boolean(content))
        .map(([sessionId]) => sessionId)
        .sort()
    )
  );
  const { categories, fetchCategories } = useCategoryStore();
  const activeMeta = UI_PROVIDER_META.plum;
  const iconUploadInputRef = useRef<HTMLInputElement>(null);

  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('updated');
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Record<string, boolean>>({});
  const [collapsedSessionFlyout, setCollapsedSessionFlyout] = useState<{
    id: string;
    name: string;
    top: number;
    left: number;
  } | null>(null);
  const [collapsedCategoryFlyout, setCollapsedCategoryFlyout] = useState<{
    id: string;
    name: string;
    top: number;
    left: number;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [iconUploadSessionId, setIconUploadSessionId] = useState<string | null>(null);
  const [iconBusySessionId, setIconBusySessionId] = useState<string | null>(null);
  const isCollapsed = mobile ? false : navigationOnly ? true : collapsed;

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    if (!isCollapsed) {
      setCollapsedSessionFlyout(null);
      setCollapsedCategoryFlyout(null);
    }
  }, [isCollapsed]);

  const activeMatch = location.pathname.match(/^\/session\/([^/]+)/);
  const activeId = activeMatch ? activeMatch[1] : null;
  const activeSession = useMemo(
    () =>
      activeId
        ? contextSession?.id === activeId
          ? contextSession
          : (sessions.find((session) => session.id === activeId) ?? null)
        : null,
    [activeId, contextSession, sessions]
  );
  const activeSessionRunState = useMemo(
    () =>
      activeSession
        ? getSessionRunState(activeSession, {
            activity: activity[activeSession.id],
            activeAgent: activeAgent[activeSession.id],
            agentRuns: agentRuns[activeSession.id],
            streamingContent: streamingSessionIds.includes(activeSession.id)
              ? 'streaming'
              : undefined,
            tools: toolExecutions[activeSession.id],
            queue: queueState[activeSession.id],
            lifecycle: lifecycle[activeSession.id],
            pendingApprovals: pendingApprovalCounts[activeSession.id],
          })
        : null,
    [
      activeAgent,
      activeSession,
      activity,
      agentRuns,
      lifecycle,
      pendingApprovalCounts,
      queueState,
      streamingSessionIds,
      toolExecutions,
    ]
  );

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = sessions;

    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.workingDirectory.toLowerCase().includes(q) ||
          (s.lastMessage ?? '').toLowerCase().includes(q)
      );
    }

    const sorted = [...list];
    switch (sortMode) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'created':
        sorted.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        break;
      case 'updated':
      default:
        sorted.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
        break;
    }

    sorted.sort((a, b) => {
      const aWorking = getSessionRunState(a, {
        activity: activity[a.id],
        activeAgent: activeAgent[a.id],
        agentRuns: agentRuns[a.id],
        streamingContent: streamingSessionIds.includes(a.id) ? 'streaming' : undefined,
        tools: toolExecutions[a.id],
        queue: queueState[a.id],
        lifecycle: lifecycle[a.id],
        pendingApprovals: pendingApprovalCounts[a.id],
      }).isWorking;
      const bWorking = getSessionRunState(b, {
        activity: activity[b.id],
        activeAgent: activeAgent[b.id],
        agentRuns: agentRuns[b.id],
        streamingContent: streamingSessionIds.includes(b.id) ? 'streaming' : undefined,
        tools: toolExecutions[b.id],
        queue: queueState[b.id],
        lifecycle: lifecycle[b.id],
        pendingApprovals: pendingApprovalCounts[b.id],
      }).isWorking;

      if (aWorking !== bWorking) return aWorking ? -1 : 1;
      return 0;
    });

    return sorted;
  }, [
    activeAgent,
    activity,
    agentRuns,
    lifecycle,
    pendingApprovalCounts,
    queueState,
    searchQuery,
    sessions,
    sortMode,
    streamingSessionIds,
    toolExecutions,
  ]);

  const sessionGroups = useMemo(() => {
    const knownCategoryIds = new Set(categories.map((category) => category.id));
    const usedSessionIds = new Set<string>();
    const grouped = new Map<string, Session[]>();
    const getHasWorking = (groupSessions: Session[]) =>
      groupSessions.some(
        (session) =>
          getSessionRunState(session, {
            activity: activity[session.id],
            activeAgent: activeAgent[session.id],
            agentRuns: agentRuns[session.id],
            streamingContent: streamingSessionIds.includes(session.id) ? 'streaming' : undefined,
            tools: toolExecutions[session.id],
            queue: queueState[session.id],
            lifecycle: lifecycle[session.id],
            pendingApprovals: pendingApprovalCounts[session.id],
          }).isWorking
      );

    const priorityGroups: Array<{
      id: string;
      label: string;
      sessions: Session[];
      hasWorking: boolean;
    }> = [];

    const favoriteSessions = filteredSessions.filter((session) => session.starred);
    if (favoriteSessions.length > 0) {
      priorityGroups.push({
        id: FAVORITES_GROUP_ID,
        label: 'Favorites',
        sessions: favoriteSessions,
        hasWorking: getHasWorking(favoriteSessions),
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
        id: RECENT_GROUP_ID,
        label: 'Recent Sessions',
        sessions: recentSessions,
        hasWorking: getHasWorking(recentSessions),
      });
      recentSessions.forEach((session) => usedSessionIds.add(session.id));
    }

    for (const session of filteredSessions) {
      if (usedSessionIds.has(session.id)) continue;
      const groupId =
        session.category && knownCategoryIds.has(session.category)
          ? session.category
          : UNCATEGORIZED_GROUP_ID;
      const groupSessions = grouped.get(groupId) ?? [];
      groupSessions.push(session);
      grouped.set(groupId, groupSessions);
    }

    const groups = categories
      .map((category) => {
        const groupSessions = grouped.get(category.id) ?? [];
        return {
          id: category.id,
          label: category.name,
          sessions: groupSessions,
          hasWorking: getHasWorking(groupSessions),
        };
      })
      .filter((group) => group.sessions.length > 0);

    const uncategorized = grouped.get(UNCATEGORIZED_GROUP_ID) ?? [];
    if (uncategorized.length > 0) {
      groups.push({
        id: UNCATEGORIZED_GROUP_ID,
        label: 'Uncategorized',
        sessions: uncategorized,
        hasWorking: getHasWorking(uncategorized),
      });
    }

    const remainingGroups = groups.sort((a, b) => {
      if (a.hasWorking !== b.hasWorking) return a.hasWorking ? -1 : 1;
      return 0;
    });

    return [...priorityGroups, ...remainingGroups];
  }, [
    activeAgent,
    activity,
    agentRuns,
    categories,
    filteredSessions,
    lifecycle,
    pendingApprovalCounts,
    queueState,
    streamingSessionIds,
    toolExecutions,
  ]);

  const workingCount = useMemo(
    () =>
      sessions.filter(
        (session) =>
          getSessionRunState(session, {
            activity: activity[session.id],
            activeAgent: activeAgent[session.id],
            agentRuns: agentRuns[session.id],
            streamingContent: streamingSessionIds.includes(session.id) ? 'streaming' : undefined,
            tools: toolExecutions[session.id],
            queue: queueState[session.id],
            lifecycle: lifecycle[session.id],
            pendingApprovals: pendingApprovalCounts[session.id],
          }).isWorking
      ).length,
    [
      activity,
      activeAgent,
      agentRuns,
      lifecycle,
      pendingApprovalCounts,
      queueState,
      sessions,
      streamingSessionIds,
      toolExecutions,
    ]
  );

  const handleLinkClick = () => {
    if (onNavigate) onNavigate();
  };

  const startRename = (session: Session) => {
    setEditingId(session.id);
    setEditName(session.name);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditName('');
  };

  const commitRename = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      cancelRename();
      return;
    }
    const original = sessions.find((s) => s.id === id);
    if (original && original.name === trimmed) {
      cancelRename();
      return;
    }
    try {
      await api.put(`/api/sessions/${id}`, { name: trimmed });
      updateSession(id, { name: trimmed });
      toast({ title: 'Session renamed' });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Rename failed';
      toast({ title: 'Rename failed', description: msg, variant: 'destructive' });
    } finally {
      cancelRename();
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete session "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/sessions/${id}`);
      removeSession(id);
      toast({ title: 'Session deleted' });
      if (activeId === id) navigate('/');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Delete failed';
      toast({ title: 'Delete failed', description: msg, variant: 'destructive' });
    }
  };

  const handleToggleStar = async (id: string, currentlyStarred: boolean) => {
    try {
      await api.patch(`/api/sessions/${id}/star`, { starred: !currentlyStarred });
      updateSession(id, { starred: !currentlyStarred });
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed';
      toast({ title: 'Failed to update star', description: msg, variant: 'destructive' });
    }
  };

  const handleAssignCategory = async (id: string, categoryId: string | null) => {
    try {
      await api.patch(`/api/sessions/${id}/category`, { categoryId });
      updateSession(id, { category: categoryId });
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed';
      toast({ title: 'Failed to update category', description: msg, variant: 'destructive' });
    }
  };

  const getErrorMessage = (err: unknown, fallback: string) =>
    err instanceof ApiError ? err.message : err instanceof Error ? err.message : fallback;

  const refreshSessions = async () => {
    const response = await api.get<ApiResponse<Session[]>>('/api/sessions');
    if (response.data.success && response.data.data) {
      setSessions(response.data.data);
    }
  };

  const applyIconSession = async (session: Session | undefined) => {
    if (session) updateSession(session.id, session);
    await refreshSessions().catch(() => undefined);
  };

  const handleGenerateIcon = async (session: Session) => {
    if (iconBusySessionId) return;
    setIconBusySessionId(session.id);
    toast({
      title: 'Generating icon',
      description: 'This can take a moment.',
    });
    try {
      const response = await api.post<ApiResponse<Session>>(
        `/api/sessions/${session.id}/icon/generate`
      );
      await applyIconSession(response.data.data);
      toast({
        title: 'Session icon updated',
      });
    } catch (err) {
      toast({
        title: 'Icon generation failed',
        description: getErrorMessage(err, 'Failed to generate icon'),
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
      await applyIconSession(response.data.data);
      toast({ title: 'Project icon applied' });
    } catch (err) {
      toast({
        title: 'Project icon not found',
        description: getErrorMessage(err, 'No usable icon was found in this project'),
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
      await applyIconSession(response.data.data);
      toast({ title: 'Session icon uploaded' });
    } catch (err) {
      toast({
        title: 'Icon upload failed',
        description: getErrorMessage(err, 'Failed to upload icon'),
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
      await applyIconSession(response.data.data);
      toast({ title: 'Session icon reset' });
    } catch (err) {
      toast({
        title: 'Failed to reset icon',
        description: getErrorMessage(err, 'Failed to reset icon'),
        variant: 'destructive',
      });
    } finally {
      setIconBusySessionId(null);
    }
  };

  const handleRenameKey = (e: KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  };

  const toggleSessionGroup = (groupId: string) => {
    setCollapsedCategoryIds((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const getCategoryAbbreviation = (label: string) => {
    if (label === 'Favorites') return '★';
    if (label === 'Recent Sessions') return 'R';
    if (label === 'Uncategorized') return '•';
    const initials = label
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
    return initials || '•';
  };

  const showCollapsedSessionFlyout = (session: Session, target: HTMLElement) => {
    if (!isCollapsed) return;
    const icon = target.querySelector<HTMLElement>('.sidebar-session-provider-icon');
    const rect = icon?.getBoundingClientRect() ?? target.getBoundingClientRect();
    setCollapsedCategoryFlyout(null);
    setCollapsedSessionFlyout({
      id: session.id,
      name: session.name,
      top: rect.top + rect.height / 2,
      left: rect.right + 4,
    });
  };

  const hideCollapsedSessionFlyout = (sessionId: string) => {
    setCollapsedSessionFlyout((current) => (current?.id === sessionId ? null : current));
  };

  const showCollapsedCategoryFlyout = (
    category: { id: string; label: string },
    target: HTMLElement
  ) => {
    if (!isCollapsed) return;
    const bubble = target.querySelector<HTMLElement>('.sidebar-session-group-bubble');
    const rect = bubble?.getBoundingClientRect() ?? target.getBoundingClientRect();
    setCollapsedSessionFlyout(null);
    setCollapsedCategoryFlyout({
      id: category.id,
      name: category.label,
      top: rect.top + rect.height / 2,
      left: rect.right + 4,
    });
  };

  const hideCollapsedCategoryFlyout = (categoryId: string) => {
    setCollapsedCategoryFlyout((current) => (current?.id === categoryId ? null : current));
  };

  const renderSessionRow = (session: Session) => {
    const isActive = location.pathname === `/session/${session.id}`;
    const isEditing = editingId === session.id;
    const sessionProviderLabel = session.cliProvider
      ? CLI_PROVIDER_LABEL[session.cliProvider] || session.cliProvider
      : activeMeta.productName;
    const sessionRunState = getSessionRunState(session, {
      activity: activity[session.id],
      activeAgent: activeAgent[session.id],
      agentRuns: agentRuns[session.id],
      streamingContent: streamingSessionIds.includes(session.id) ? 'streaming' : undefined,
      tools: toolExecutions[session.id],
      queue: queueState[session.id],
      lifecycle: lifecycle[session.id],
      pendingApprovals: pendingApprovalCounts[session.id],
    });
    const unreadCount = Math.max(
      0,
      Number((session as Session & { unreadCount?: number }).unreadCount) || 0
    );

    if (isEditing && !isCollapsed) {
      return (
        <div key={session.id} className="sidebar-session-row is-editing">
          <span className="sidebar-session-provider-icon" aria-label={sessionProviderLabel}>
            <SessionIcon
              session={session}
              className="shrink-0"
              logoClassName="h-5 w-5"
              imageClassName="h-6 w-6 rounded-full"
            />
            {iconBusySessionId === session.id && (
              <span className="session-icon-busy-overlay">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
            )}
          </span>
          <Input
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => handleRenameKey(e, session.id)}
            onBlur={() => commitRename(session.id)}
            className="h-6 px-1.5 text-xs"
          />
        </div>
      );
    }

    return (
      <div
        key={session.id}
        className={cn(
          'sidebar-session-row group/session relative flex items-center',
          isActive && 'is-active',
          sessionRunState.isWorking && 'is-working',
          isCollapsed && 'is-collapsed'
        )}
        onMouseEnter={(e) => showCollapsedSessionFlyout(session, e.currentTarget)}
        onMouseLeave={() => hideCollapsedSessionFlyout(session.id)}
        onFocus={(e) => showCollapsedSessionFlyout(session, e.currentTarget)}
        onBlur={() => hideCollapsedSessionFlyout(session.id)}
      >
        <Link
          to={`/session/${session.id}`}
          title={session.name}
          aria-current={isActive ? 'page' : undefined}
          onClick={handleLinkClick}
          aria-label={
            isCollapsed
              ? `${session.name}${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`
              : undefined
          }
          className={cn(
            'flex flex-1 items-center gap-2.5 px-3 py-2 text-sm min-w-0',
            isCollapsed && 'justify-center px-2'
          )}
        >
          <span className="sidebar-session-provider-icon" aria-label={sessionProviderLabel}>
            <SessionIcon
              session={session}
              className="shrink-0"
              logoClassName="h-5 w-5"
              imageClassName="h-6 w-6 rounded-full"
            />
            {iconBusySessionId === session.id && (
              <span className="session-icon-busy-overlay">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
            )}
            {isCollapsed && unreadCount > 0 && (
              <span className="sidebar-session-unread is-collapsed" aria-hidden="true">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </span>
          {!isCollapsed && (
            <span className="flex min-w-0 flex-1 items-center text-xs">
              <span className="sidebar-session-name min-w-0 flex-1 font-medium">
                {session.name}
              </span>
              {unreadCount > 0 && (
                <span
                  className="sidebar-session-unread"
                  aria-label={`${unreadCount} unread ${unreadCount === 1 ? 'message' : 'messages'}`}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
              <span
                className={cn('sidebar-session-run-dot', `is-${sessionRunState.tone}`)}
                title={sessionRunState.detail}
                aria-hidden="true"
              />
            </span>
          )}
        </Link>

        {!isCollapsed && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="sidebar-session-options"
                onClick={(e) => e.stopPropagation()}
                title="Session options"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => startRename(session)} className="cursor-pointer">
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleToggleStar(session.id, session.starred)}
                className="cursor-pointer"
              >
                <Star
                  className={cn(
                    'mr-2 h-3.5 w-3.5',
                    session.starred && 'fill-amber-500 text-amber-500'
                  )}
                />
                {session.starred ? 'Unstar' : 'Star'}
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
                    {iconBusySessionId === session.id ? 'Generating...' : 'Generate'}
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
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="cursor-pointer">
                  <Folder className="mr-2 h-3.5 w-3.5" />
                  Category
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  <DropdownMenuItem
                    onClick={() => handleAssignCategory(session.id, null)}
                    className="cursor-pointer"
                  >
                    <span className="mr-2 h-2.5 w-2.5 rounded-full border border-muted-foreground/40" />
                    None
                    {!session.category && <span className="ml-auto text-primary">•</span>}
                  </DropdownMenuItem>
                  {categories.length > 0 && <DropdownMenuSeparator />}
                  {categories.map((cat) => (
                    <DropdownMenuItem
                      key={cat.id}
                      onClick={() => handleAssignCategory(session.id, cat.id)}
                      className="cursor-pointer"
                    >
                      <span
                        className="mr-2 h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: COLOR_VALUES[cat.color] ?? cat.color }}
                      />
                      <span className="flex-1 truncate">{cat.name}</span>
                      {session.category === cat.id && (
                        <span className="ml-auto text-primary">•</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleDelete(session.id, session.name)}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  return (
    <div
      className={cn(
        'app-sidebar-shell flex flex-col h-full transition-all duration-300',
        mobile ? 'app-sidebar-mobile w-full' : '',
        navigationOnly && !mobile && 'app-sidebar-navigation-only',
        !mobile && (isCollapsed ? 'w-16' : 'w-[272px]')
      )}
    >
      {/* Active session identity */}
      <div
        className={cn(
          'sidebar-header flex items-center transition-all duration-300',
          isCollapsed
            ? 'h-14 justify-center px-2'
            : activeSession && !mobile
              ? 'min-h-[3.5rem] px-4 py-2'
              : 'h-14 px-4'
        )}
      >
        {mobile ? (
          <Link to="/" onClick={handleLinkClick} className="flex items-center gap-3">
            <ProviderLogo provider="plum" className="h-7 w-7 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              {activeMeta.productName}{' '}
              <span className="text-muted-foreground font-normal">{activeMeta.tagline}</span>
            </span>
          </Link>
        ) : activeSession ? (
          <button
            onClick={() => setCollapsed(!isCollapsed)}
            onMouseEnter={(e) => showCollapsedSessionFlyout(activeSession, e.currentTarget)}
            onMouseLeave={() => hideCollapsedSessionFlyout(activeSession.id)}
            onFocus={(e) => showCollapsedSessionFlyout(activeSession, e.currentTarget)}
            onBlur={() => hideCollapsedSessionFlyout(activeSession.id)}
            className={cn(
              'sidebar-identity-button min-w-0 transition-colors cursor-pointer',
              isCollapsed
                ? 'is-collapsed flex items-center justify-center'
                : 'flex w-full flex-col items-start gap-1 px-1 py-1 text-left'
            )}
            aria-label={isCollapsed ? activeSession.name : 'Collapse sidebar'}
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              <span className="sidebar-session-provider-icon sidebar-identity-provider-icon">
                <SessionIcon
                  session={activeSession}
                  className="shrink-0 text-primary"
                  logoClassName="h-5 w-5"
                  imageClassName="h-6 w-6 rounded-full"
                />
                {iconBusySessionId === activeSession.id && (
                  <span className="session-icon-busy-overlay">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </span>
                )}
              </span>
              {!isCollapsed && (
                <>
                  <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {activeSession.name}
                  </span>
                  <span
                    className={cn(
                      'session-header-run-dot shrink-0',
                      activeSessionRunState && `is-${activeSessionRunState.tone}`
                    )}
                    title={activeSessionRunState?.detail}
                  />
                </>
              )}
            </span>
          </button>
        ) : (
          <button
            onClick={() => {
              if (!navigationOnly) setCollapsed(!isCollapsed);
            }}
            className={cn(
              'sidebar-identity-button flex items-center gap-3 transition-colors cursor-pointer',
              isCollapsed ? 'is-collapsed' : '',
              navigationOnly && 'cursor-default'
            )}
            aria-label={
              navigationOnly
                ? activeMeta.productName
                : isCollapsed
                  ? activeMeta.productName
                  : 'Collapse sidebar'
            }
          >
            <span className="sidebar-session-provider-icon sidebar-identity-provider-icon">
              <ProviderLogo provider="plum" className="h-5 w-5 text-primary" />
            </span>
            {!isCollapsed && (
              <span className="text-sm font-semibold text-foreground">
                {activeMeta.productName}{' '}
                <span className="text-muted-foreground font-normal">{activeMeta.tagline}</span>
              </span>
            )}
          </button>
        )}
        {!isCollapsed && (
          <div className="ml-auto shrink-0 pl-2">
            <NotificationCenter />
          </div>
        )}
      </div>

      <nav className="flex-1 flex flex-col min-h-0 px-2 pt-2 pb-0 overflow-visible">
        {/* Notification centre lives with the main navigation: it spans every
            session rather than belonging to the one currently open. */}

        <button
          type="button"
          aria-label="Outbox"
          title="Outbox"
          className={cn(
            'sidebar-nav-item flex shrink-0 items-center gap-3 px-3 py-2 text-sm font-medium',
            isCollapsed && 'is-collapsed'
          )}
          onClick={() => {
            handleLinkClick();
            window.dispatchEvent(new Event('plum:open-outbox'));
          }}
        >
          <Inbox className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span>Outbox</span>}
        </button>
        {/* Top nav */}
        <div className="space-y-1 shrink-0">
          {baseNavItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.path === '/settings'
                ? location.pathname === '/settings'
                : location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={handleLinkClick}
                aria-label={isCollapsed ? item.label : undefined}
                className={cn(
                  'sidebar-nav-item flex items-center gap-3 px-3 py-2 text-sm font-medium',
                  isActive && 'is-active',
                  isCollapsed && 'is-collapsed'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!isCollapsed && item.label}
              </Link>
            );
          })}
        </div>

        {contextUsage && (
          <div className={cn('sidebar-context-slot shrink-0', isCollapsed && 'is-collapsed')}>
            <ContextPopover
              usage={contextUsage}
              contextStats={contextStats}
              triggerVariant="sidebarUsageBar"
              placement="right"
              collapsed={isCollapsed}
              sessionId={activeSession?.id ?? activeId}
              sessionProvider={activeSession?.cliProvider}
              sessionModel={activeSession?.cliModel}
              sessionRuntimeModel={activeSession?.runtime?.model}
            />
          </div>
        )}

        {/* Sessions section. The dashboard itself is the primary wide session surface. */}
        <div className={cn('pt-3 flex flex-col flex-1 min-h-0', navigationOnly && 'hidden')}>
          <div
            className={cn(
              'flex items-center px-3 py-1.5 shrink-0',
              isCollapsed ? 'hidden' : 'justify-between'
            )}
          >
            {!isCollapsed && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Sessions
                </span>
                {workingCount > 0 && (
                  <span className="session-run-count" title={`${workingCount} sessions working`}>
                    {workingCount}
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-0.5">
              {!isCollapsed && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-lg"
                      title="Sort sessions"
                    >
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {SORT_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <DropdownMenuItem
                          key={opt.value}
                          onClick={() => setSortMode(opt.value)}
                          className="cursor-pointer"
                        >
                          <Icon className="mr-2 h-4 w-4" />
                          <span className="flex-1">{opt.label}</span>
                          {sortMode === opt.value && <span className="text-primary">•</span>}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Search (only when expanded) */}
          {!isCollapsed && (
            <div className="px-2 pb-1 space-y-1.5 shrink-0">
              <div className="sidebar-session-search relative">
                <Search className="absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search sessions..."
                  aria-label="Search sessions"
                  className="h-9 rounded-full border-0 bg-transparent pl-8 pr-8 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full hover:bg-muted"
                    title="Clear search"
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Session list — scrollable, no slice */}
          <div
            className="sidebar-session-scroll flex-1 min-h-0 overflow-y-auto"
            onScroll={() => {
              setCollapsedSessionFlyout(null);
              setCollapsedCategoryFlyout(null);
            }}
          >
            <div className="sidebar-session-scroll-content mt-1">
              {filteredSessions.length === 0
                ? !isCollapsed && (
                    <div className="px-3 py-3 text-center">
                      <p className="text-xs text-muted-foreground/70">
                        {searchQuery ? 'No matches' : 'No sessions'}
                      </p>
                      {searchQuery && (
                        <Button
                          variant="link"
                          size="sm"
                          className="text-xs mt-1 h-auto p-0"
                          onClick={() => setSearchQuery('')}
                        >
                          Clear filters
                        </Button>
                      )}
                    </div>
                  )
                : sessionGroups.map((group) => {
                    const isGroupCollapsed = searchQuery.trim()
                      ? false
                      : (collapsedCategoryIds[group.id] ?? false);
                    return (
                      <div
                        key={group.id}
                        className={cn(
                          'sidebar-session-group',
                          isCollapsed && 'is-collapsed',
                          group.hasWorking && 'has-working'
                        )}
                      >
                        <button
                          type="button"
                          className={cn(
                            'sidebar-session-group-trigger',
                            isCollapsed && 'is-collapsed'
                          )}
                          onClick={() => toggleSessionGroup(group.id)}
                          onMouseEnter={(e) => showCollapsedCategoryFlyout(group, e.currentTarget)}
                          onMouseLeave={() => hideCollapsedCategoryFlyout(group.id)}
                          onFocus={(e) => showCollapsedCategoryFlyout(group, e.currentTarget)}
                          onBlur={() => hideCollapsedCategoryFlyout(group.id)}
                          aria-expanded={!isGroupCollapsed}
                          aria-label={
                            isCollapsed ? `${group.label} (${group.sessions.length})` : undefined
                          }
                        >
                          {isCollapsed ? (
                            <>
                              <span className="sidebar-session-group-bubble">
                                {getCategoryAbbreviation(group.label)}
                              </span>
                              <span className="sidebar-session-group-count">
                                {group.sessions.length}
                              </span>
                            </>
                          ) : (
                            <>
                              <ChevronDown
                                className={cn(
                                  'sidebar-session-group-chevron',
                                  isGroupCollapsed && 'is-collapsed'
                                )}
                              />
                              <span className="sidebar-session-group-title">{group.label}</span>
                              <span className="sidebar-session-group-count">
                                {group.sessions.length}
                              </span>
                            </>
                          )}
                        </button>
                        {!isGroupCollapsed && (
                          <div className="sidebar-session-group-items">
                            {group.sessions.map(renderSessionRow)}
                          </div>
                        )}
                      </div>
                    );
                  })}
            </div>
          </div>
        </div>
      </nav>
      {collapsedSessionFlyout && (
        <div
          className="sidebar-session-flyout"
          style={{
            top: collapsedSessionFlyout.top,
            left: collapsedSessionFlyout.left,
          }}
          aria-hidden="true"
        >
          <span className="sidebar-session-flyout-name">{collapsedSessionFlyout.name}</span>
        </div>
      )}
      {collapsedCategoryFlyout && (
        <div
          className="sidebar-session-flyout"
          style={{
            top: collapsedCategoryFlyout.top,
            left: collapsedCategoryFlyout.left,
          }}
          aria-hidden="true"
        >
          <span className="sidebar-session-flyout-name">{collapsedCategoryFlyout.name}</span>
        </div>
      )}
      <input
        ref={iconUploadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,.ico"
        className="hidden"
        onChange={(event) => handleIconUploadFile(event.target.files?.[0])}
      />
    </div>
  );
}
