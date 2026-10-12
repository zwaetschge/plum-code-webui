import { Navigate, useLocation } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';

export function TaskSessionsPage() {
  const { search } = useLocation();
  // Preserve old links to structured task resources while /tasks now manages sessions.
  if (new URLSearchParams(search).has('resource'))
    return <Navigate to={`/assistant/tasks${search}`} replace />;
  return <DashboardPage key="task" surface="task" />;
}
