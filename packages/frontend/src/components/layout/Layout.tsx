import { useEffect, useMemo, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Menu, PanelRightOpen } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { applyTheme, normalizeTheme, useAppearanceStore } from '@/stores/appearanceStore';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/services/api';
import type { Session, ApiResponse, UsageSnapshot, UserSettings } from '@plum-code-webui/shared';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { UI_PROVIDER_META, toUiProvider } from '@/lib/providers';
import { AppBackground } from '@/components/effects/AppBackground';
import { OutboxPanel } from '@/components/chat/OutboxPanel';
import { CommandPalette } from '@/components/CommandPalette';
import { getSessionRunState } from '@/lib/sessionRunState';
import { cn } from '@/lib/utils';
import { normalizeUsageSnapshot } from '@plum-code-webui/shared';
import { GlobalMessageSearchDialog } from '@/components/search/GlobalMessageSearchDialog';

// Socket events and mutation invalidations keep the session shell current during
// normal use. This slower poll is only a recovery path for missed events or
// changes made in another browser, and avoids transferring the full session list
// every four seconds on read-only pages such as Settings.
const SESSION_LIST_FALLBACK_INTERVAL_MS = 30_000;
const SESSION_DETAIL_FALLBACK_INTERVAL_MS = 15_000;

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

export function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { backgroundAnimation, setBackgroundAnimation } = useAppearanceStore();
  const location = useLocation();
  // Session page manages its own scroll + floating chat bars, so it renders
  // edge-to-edge inside <main>. Every other page uses the default padded scroll.
  const isFullBleed = location.pathname.startsWith('/session/');
  const routeSessionId = location.pathname.match(/^\/session\/([^/]+)/)?.[1] ?? null;
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const setSessions = useSessionStore((state) => state.setSessions);
  const headerSessionId = routeSessionId ?? activeSessionId;
  const storeUsage = useSessionStore((state) =>
    headerSessionId ? state.usage[headerSessionId] : undefined
  );
  const sessionActivity = useSessionStore((state) =>
    headerSessionId ? state.activity[headerSessionId] : undefined
  );
  const sessionActiveAgent = useSessionStore((state) =>
    headerSessionId ? state.activeAgent[headerSessionId] : undefined
  );
  const sessionAgentRuns = useSessionStore((state) =>
    headerSessionId ? state.agentRuns[headerSessionId] : undefined
  );
  // Subscribe to streaming presence, not the growing text. The shell only
  // needs a run-state dot; full chunks belong to SessionPage.
  const sessionHasStreamingContent = useSessionStore((state) =>
    headerSessionId ? Boolean(state.streamingContent[headerSessionId]) : false
  );
  const sessionToolExecutions = useSessionStore((state) =>
    headerSessionId ? state.toolExecutions[headerSessionId] : undefined
  );
  const sessionQueue = useSessionStore((state) =>
    headerSessionId ? state.queueState[headerSessionId] : undefined
  );
  const sessionLifecycle = useSessionStore((state) =>
    headerSessionId ? state.lifecycle[headerSessionId] : undefined
  );
  const sessionPendingApprovals = useSessionStore((state) =>
    headerSessionId ? state.pendingApprovalCounts[headerSessionId] : undefined
  );

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<UserSettings>>('/api/settings');
      return response.data.data;
    },
  });

  // Only an account that opted into appearance sync lets the server dictate the
  // look. Without that guard the stored account theme overwrote whatever the
  // user had just picked on this device on every reload.
  useEffect(() => {
    if (!settings?.appearanceSync) return;
    if (settings.theme) {
      const nextTheme = normalizeTheme(settings.theme);
      window.localStorage.setItem('theme', nextTheme);
      applyTheme(nextTheme);
    }
    if (settings.backgroundAnimation) {
      setBackgroundAnimation(settings.backgroundAnimation);
    }
  }, [
    settings?.appearanceSync,
    settings?.backgroundAnimation,
    settings?.theme,
    setBackgroundAnimation,
  ]);

  // Populate session list on every authenticated page so the sidebar works
  // when a user lands directly on a session URL (bypassing the dashboard).
  const { data: shellSessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Session[]>>('/api/sessions');
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return [];
    },
    staleTime: SESSION_LIST_FALLBACK_INTERVAL_MS,
    refetchInterval: SESSION_LIST_FALLBACK_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (shellSessions !== undefined) {
      setSessions(shellSessions);
    }
  }, [setSessions, shellSessions]);

  const { data: routeSession } = useQuery({
    queryKey: ['session', routeSessionId],
    queryFn: async () => {
      if (!routeSessionId) return null;
      const response = await api.get<ApiResponse<Session>>(`/api/sessions/${routeSessionId}`);
      return response.data.success && response.data.data ? response.data.data : null;
    },
    enabled: !!routeSessionId,
    refetchInterval: SESSION_DETAIL_FALLBACK_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const activeMeta = UI_PROVIDER_META.plum;
  const activeSession = useMemo(() => {
    const sessionId = routeSessionId ?? activeSessionId;
    if (!sessionId) return null;
    return routeSession ?? sessions.find((s) => s.id === sessionId) ?? null;
  }, [activeSessionId, routeSession, routeSessionId, sessions]);
  const headerProvider = activeSession?.cliProvider
    ? toUiProvider(activeSession.cliProvider)
    : 'plum';
  const headerTitle = activeSession?.name ?? activeMeta.productName;
  const headerTelemetryUsage = routeSession?.telemetry?.usage ?? null;
  const headerUsage = headerSessionId
    ? normalizeUsageSnapshot(
        activeSession?.cliProvider === 'codex' && headerTelemetryUsage
          ? headerTelemetryUsage
          : selectFreshestUsage(storeUsage, headerTelemetryUsage)
      )
    : undefined;
  const headerContextStats = routeSession?.telemetry
    ? {
        contextSnapshots: routeSession.telemetry.contextSnapshots,
        compactEvents: routeSession.telemetry.compactEvents,
      }
    : undefined;
  const headerRunState = useMemo(() => {
    if (!activeSession) return null;
    return getSessionRunState(activeSession, {
      activity: sessionActivity,
      activeAgent: sessionActiveAgent,
      agentRuns: sessionAgentRuns,
      streamingContent: sessionHasStreamingContent ? 'streaming' : undefined,
      tools: sessionToolExecutions,
      queue: sessionQueue,
      lifecycle: sessionLifecycle,
      pendingApprovals: sessionPendingApprovals,
    });
  }, [
    activeSession,
    sessionLifecycle,
    sessionPendingApprovals,
    sessionActiveAgent,
    sessionActivity,
    sessionAgentRuns,
    sessionHasStreamingContent,
    sessionQueue,
    sessionToolExecutions,
  ]);

  // Close mobile menu on navigation
  const handleNavigation = () => {
    setMobileMenuOpen(false);
  };

  useEffect(() => {
    document.title = activeSession
      ? `${activeSession.name} · Plum Code`
      : `${activeMeta.productName} WebUI`;
  }, [activeMeta.productName, activeSession]);

  return (
    <div
      className={cn(
        'relative flex h-screen bg-background',
        isFullBleed && 'session-shell-has-edge-fades'
      )}
    >
      {/* Background effects */}
      <AppBackground animation={backgroundAnimation} />
      <div className="absolute inset-0 pattern-bg pointer-events-none" />
      {isFullBleed && (
        <>
          <div
            className="session-global-edge-fade session-global-edge-fade-top"
            aria-hidden="true"
          />
          <div
            className="session-global-edge-fade session-global-edge-fade-bottom"
            aria-hidden="true"
          />
        </>
      )}

      {/* Desktop Sidebar */}
      <div className="hidden md:block relative z-10">
        <Sidebar
          navigationOnly={location.pathname === '/'}
          contextUsage={isFullBleed ? headerUsage : undefined}
          contextStats={headerContextStats}
          contextSession={activeSession}
        />
      </div>

      {/* Mobile Sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <Sidebar
            onNavigate={handleNavigation}
            mobile
            contextUsage={isFullBleed ? headerUsage : undefined}
            contextStats={headerContextStats}
            contextSession={activeSession}
          />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative z-10">
        {/* Usage Limits Bar - shown on session pages */}

        {/* Mobile Header */}
        <header className="md:hidden flex h-14 items-center gap-2 border-b border-border/70 bg-background/95 px-2 backdrop-blur-md">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(true)}
            className="h-9 w-9"
            title="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <Link
            to={activeSession ? `/session/${activeSession.id}` : '/'}
            className="flex min-w-0 flex-1 items-center gap-2 px-1"
            title={headerTitle}
          >
            <ProviderLogo provider={headerProvider} className="h-6 w-6 shrink-0 object-contain" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold leading-tight text-foreground">
                {headerTitle}
              </span>
              {headerRunState && (
                <span
                  className={cn('mobile-header-run-state', `is-${headerRunState.tone}`)}
                  title={headerRunState.detail}
                >
                  <span className={cn('mobile-header-run-dot', `is-${headerRunState.tone}`)} />
                  <span className="truncate">
                    {headerRunState.isWorking ? headerRunState.detail : headerRunState.label}
                  </span>
                </span>
              )}
            </span>
          </Link>

          {isFullBleed && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.dispatchEvent(new Event('session:open-mobile-right-menu'))}
              className="h-9 w-9"
              title="Open session menu"
              aria-label="Open session menu"
            >
              <PanelRightOpen className="h-5 w-5" />
            </Button>
          )}
        </header>

        {/* Page Content */}
        <main
          className={
            isFullBleed ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 overflow-auto p-4 md:p-6'
          }
        >
          <Outlet />
        </main>
      </div>

      {/* Global command palette (Cmd/Ctrl+K) */}
      <CommandPalette />
      <GlobalMessageSearchDialog />
      <OutboxPanel />
    </div>
  );
}
