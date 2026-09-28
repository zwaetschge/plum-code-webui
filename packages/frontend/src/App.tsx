import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useBasicAuthStore } from '@/stores/basicAuthStore';
import { useSocket } from '@/hooks/useSocket';
import { Layout } from '@/components/layout/Layout';
import { AdminRoute } from '@/components/AdminRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/toaster';

// Lazy load pages for code splitting
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
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
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
  const { isAuthenticated, isLoading: isUserLoading } = useAuthStore();
  const location = useLocation();

  if (isLoading || isUserLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

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
  const { isAuthenticated, isLoading } = useAuthStore();
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

  // Initialize both auth stores on mount. Running them in parallel lets the
  // UI finish loading as soon as persisted tokens are verified against the
  // backend, avoiding a flash of the login page on new tabs.
  useEffect(() => {
    initializeBasicAuth();
    initializeUserAuth();
  }, [initializeBasicAuth, initializeUserAuth]);

  return (
    <>
      <ErrorBoundary>
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
            <Route path="/auth/claude/callback" element={<ClaudeCallbackPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
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
