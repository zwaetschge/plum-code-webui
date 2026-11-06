import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useBasicAuthStore } from '@/stores/basicAuthStore';
import { useSocket } from '@/hooks/useSocket';
import { Layout } from '@/components/layout/Layout';
import { AdminRoute } from '@/components/AdminRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/toaster';
import { nativeShell } from '@/lib/nativeShell';
import { NativeAuthRecovery } from '@/components/NativeAuthRecovery';
const MemoryTopicsPage = lazy(() =>
  import('@/pages/MemoryTopicsPage').then((m) => ({ default: m.MemoryTopicsPage }))
);
const ChatSchedulesPage = lazy(() =>
  import('@/pages/ChatSchedulesPage').then((m) => ({ default: m.ChatSchedulesPage }))
);
const KnowledgePage = lazy(() =>
  import('@/pages/KnowledgePage').then((m) => ({ default: m.KnowledgePage }))
);
const ChatManagerPage = lazy(() =>
  import('@/pages/ChatManagerPage').then((m) => ({ default: m.ChatManagerPage }))
);

// Lazy load pages for code splitting
const AssistantPage = lazy(() =>
  import('@/pages/AssistantPage').then((m) => ({ default: m.AssistantPage }))
);
const MiniAssistantPage = lazy(() =>
  import('@/pages/MiniAssistantPage').then((m) => ({ default: m.MiniAssistantPage }))
);
const MiniAssistantShell = lazy(() =>
  import('@/pages/MiniAssistantPage').then((m) => ({ default: m.MiniAssistantShell }))
);
const ApiChatPage = lazy(() =>
  import('@/pages/ApiChatPage').then((m) => ({ default: m.ApiChatPage }))
);
const OfficeConnectPage = lazy(() =>
  import('@/pages/OfficeConnectPage').then((m) => ({ default: m.OfficeConnectPage }))
);
const SharedAssistantPage = lazy(() =>
  import('@/pages/SharedAssistantPage').then((m) => ({ default: m.SharedAssistantPage }))
);
const CollaborativeDocumentPage = lazy(() =>
  import('@/pages/CollaborativeDocumentPage').then((m) => ({
    default: m.CollaborativeDocumentPage,
  }))
);
const SwarmPage = lazy(() => import('@/pages/SwarmPage').then((m) => ({ default: m.SwarmPage })));
const HermesPage = lazy(() =>
  import('@/pages/HermesPage').then((m) => ({ default: m.HermesPage }))
);
const BasicLoginPage = lazy(() =>
  import('@/pages/BasicLoginPage').then((m) => ({ default: m.BasicLoginPage }))
);
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const AuthCallbackPage = lazy(() =>
  import('@/pages/AuthCallbackPage').then((m) => ({ default: m.AuthCallbackPage }))
);
const ClaudeCallbackPage = lazy(() =>
  import('@/pages/ClaudeCallbackPage').then((m) => ({ default: m.ClaudeCallbackPage }))
);
const SetupPage = lazy(() => import('@/pages/SetupPage').then((m) => ({ default: m.SetupPage })));
const TaskSessionsPage = lazy(() =>
  import('@/pages/TaskSessionsPage').then((m) => ({ default: m.TaskSessionsPage }))
);
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const ChatPage = lazy(() => import('@/pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const ChatWorkspacePage = lazy(() =>
  import('@/pages/ChatWorkspacePage').then((m) => ({ default: m.ChatWorkspacePage }))
);
const DynamicUiDemoPage = lazy(() =>
  import('@/pages/DynamicUiDemoPage').then((m) => ({ default: m.DynamicUiDemoPage }))
);
const PersonalizationPage = lazy(() =>
  import('@/pages/PersonalizationPage').then((m) => ({ default: m.PersonalizationPage }))
);
const SessionPage = lazy(() =>
  import('@/pages/SessionPage').then((m) => ({ default: m.SessionPage }))
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const MonitorPage = lazy(() =>
  import('@/pages/MonitorPage').then((m) => ({ default: m.MonitorPage }))
);
const AnalyticsPage = lazy(() =>
  import('@/pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage }))
);
const OperationsPage = lazy(() =>
  import('@/pages/OperationsPage').then((m) => ({ default: m.OperationsPage }))
);

// Loading fallback component
function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    </div>
  );
}

// Route that requires basic auth (if enabled)
function BasicAuthRoute({ children }: { children: React.ReactNode }) {
  const { isBasicAuthenticated, isBasicAuthEnabled, isLoading } = useBasicAuthStore();
  const { isAuthenticated, isLoading: isUserLoading, token } = useAuthStore();
  const location = useLocation();

  if (isLoading || isUserLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (nativeShell() && token && !isAuthenticated) return <NativeAuthRecovery />;

  // If basic auth is disabled, allow access
  if (isBasicAuthEnabled === false) {
    return <>{children}</>;
  }

  // If basic auth is enabled but not authenticated, redirect to basic login
  if (isBasicAuthEnabled === true && !isBasicAuthenticated && !isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, token } = useAuthStore();
  const {
    isBasicAuthenticated,
    isBasicAuthEnabled,
    isLoading: isBasicLoading,
  } = useBasicAuthStore();
  const location = useLocation();

  // Initialize socket connection when authenticated
  useSocket();

  if (isLoading || isBasicLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (nativeShell() && token && !isAuthenticated) return <NativeAuthRecovery />;

  // First check basic auth if enabled
  if (isBasicAuthEnabled === true && !isBasicAuthenticated && !isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const { initializeAuth: initializeBasicAuth } = useBasicAuthStore();
  const { initializeAuth: initializeUserAuth } = useAuthStore();
  const account = useAuthStore((state) => state.user?.id);

  // Initialize both auth stores on mount. Running them in parallel lets the
  // UI finish loading as soon as persisted tokens are verified against the
  // backend, avoiding a flash of the login page on new tabs.
  useEffect(() => {
    initializeBasicAuth();
    initializeUserAuth();
  }, [initializeBasicAuth, initializeUserAuth]);
  useEffect(() => {
    const syncAccount = (event: StorageEvent) => {
      if (
        event.storageArea !== localStorage ||
        (event.key !== 'claude-webui-auth' && event.key !== null)
      )
        return;
      try {
        const token =
          JSON.parse(localStorage.getItem('claude-webui-auth') || '{}').state?.token ?? null;
        if (token !== useAuthStore.getState().token) window.location.reload();
      } catch {
        window.location.reload();
      }
    };
    window.addEventListener('storage', syncAccount);
    return () => window.removeEventListener('storage', syncAccount);
  }, []);

  return (
    <>
      <ErrorBoundary key={account ?? 'anonymous'}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<BasicLoginPage />} />
            <Route path="/basic-login" element={<Navigate to="/login" replace />} />
            <Route
              path="/connect"
              element={
                <BasicAuthRoute>
                  <LoginPage />
                </BasicAuthRoute>
              }
            />
            <Route
              path="/setup"
              element={
                <ProtectedRoute>
                  <SetupPage />
                </ProtectedRoute>
              }
            />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route
              path="/office-connect"
              element={
                <ProtectedRoute>
                  <OfficeConnectPage />
                </ProtectedRoute>
              }
            />
            <Route path="/auth/claude/callback" element={<ClaudeCallbackPage />} />
            <Route
              path="/mini"
              element={
                <ProtectedRoute>
                  <MiniAssistantShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<MiniAssistantPage />} />
              <Route path="chat/:id" element={<ApiChatPage />} />
            </Route>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<AssistantPage />} />
              <Route path="chat" element={<ChatPage />} />
              <Route path="chat/history" element={<ChatManagerPage />} />
              <Route path="chat/assistants" element={<ChatWorkspacePage />} />
              <Route path="chat/assistants/:id" element={<ChatWorkspacePage />} />
              <Route path="chat/assistants/:id/edit" element={<ChatWorkspacePage />} />
              <Route path="chat/projects" element={<ChatWorkspacePage />} />
              <Route path="chat/projects/:id" element={<ChatWorkspacePage />} />
              <Route path="chat/projects/:id/edit" element={<ChatWorkspacePage />} />
              <Route path="chat/ui-demo" element={<DynamicUiDemoPage />} />
              <Route path="chat/personalization" element={<PersonalizationPage />} />
              <Route path="chat/session/:id" element={<SessionPage />} />
              <Route path="chat/model/:id" element={<ApiChatPage />} />
              <Route path="tasks" element={<TaskSessionsPage />} />
              <Route path="assistant/:section" element={<AssistantPage />} />
              <Route path="assistant/schedules" element={<ChatSchedulesPage />} />
              <Route path="assistant/knowledge" element={<KnowledgePage />} />
              <Route path="assistant/memory-topics" element={<MemoryTopicsPage />} />
              <Route path="hermes" element={<HermesPage />} />
              <Route path="swarm" element={<SwarmPage />} />
              <Route path="shared/:token" element={<SharedAssistantPage />} />
              <Route path="collaborate" element={<CollaborativeDocumentPage />} />
              <Route path="collaborate/:id" element={<CollaborativeDocumentPage />} />
              <Route path="code" element={<DashboardPage key="code" />} />
              <Route path="session/:id" element={<SessionPage />} />
              <Route path="monitor" element={<MonitorPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route
                path="operations"
                element={
                  <AdminRoute>
                    <OperationsPage />
                  </AdminRoute>
                }
              />
              <Route path="settings" element={<SettingsPage />} />
              <Route
                path="admin"
                element={
                  <AdminRoute>
                    <Navigate to="/settings?tab=admin&adminTab=overview" replace />
                  </AdminRoute>
                }
              />
              <Route
                path="admin/users"
                element={
                  <AdminRoute>
                    <Navigate to="/settings?tab=admin&adminTab=users" replace />
                  </AdminRoute>
                }
              />
              <Route
                path="admin/audit-log"
                element={
                  <AdminRoute>
                    <Navigate to="/settings?tab=admin&adminTab=audit-log" replace />
                  </AdminRoute>
                }
              />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
      <Toaster />
    </>
  );
}
