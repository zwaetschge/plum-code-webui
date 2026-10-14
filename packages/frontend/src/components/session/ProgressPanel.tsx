import type { ReactNode } from 'react';
import { Activity, CheckCircle, Circle, ListTodo, Loader2, Settings2, Target } from 'lucide-react';
import type { TodoItem } from '@/stores/sessionStore';
import { cn } from '@/lib/utils';

/**
 * Fortschritt: goal, todo list and subagents of the current run in one
 * panel. The goal itself is set in the chat header; this panel only shows it.
 */
export function ProgressPanel({
  goal,
  todos,
  agents,
  agentCount,
  onOpenRun,
  onConfigureAgents,
  className,
}: {
  goal: string | null;
  todos: TodoItem[];
  /** Rendered subagent list (SubagentPanel), owned by the session page. */
  agents: ReactNode;
  agentCount: number;
  onOpenRun?: () => void;
  onConfigureAgents?: () => void;
  className?: string;
}) {
  const done = todos.filter((todo) => todo.status === 'completed').length;
  return (
    <div className={cn('session-progress-panel h-full overflow-auto', className)}>
      <section className="session-progress-goal" aria-label="Ziel">
        <Target className="h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="session-progress-heading">Ziel</div>
          <p className={cn('session-progress-goal-text', !goal && 'is-empty')}>
            {goal || 'Kein Ziel gesetzt. Setze es oben im Chatkopf.'}
          </p>
        </div>
      </section>

      <section aria-label="Aufgaben" className="session-progress-section">
        <div className="session-progress-heading">
          <ListTodo className="h-3.5 w-3.5" aria-hidden="true" />
          Aufgaben
          {todos.length > 0 && (
            <span className="session-progress-count">
              {done}/{todos.length}
            </span>
          )}
        </div>
        {todos.length === 0 ? (
          <p className="session-progress-empty">Keine offenen Aufgaben.</p>
        ) : (
          <ol className="session-task-list">
            {todos.map((todo, index) => (
              <li
                key={`${index}-${todo.content}`}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg p-2.5 text-xs transition-all',
                  todo.status === 'completed' && 'bg-foreground/[0.02] text-muted-foreground',
                  todo.status === 'in_progress' &&
                    'border border-primary/30 bg-primary/10 shadow-sm',
                  todo.status === 'pending' && 'bg-foreground/[0.03]'
                )}
              >
                <span className="mt-0.5 shrink-0" aria-hidden="true">
                  {todo.status === 'completed' && (
                    <CheckCircle className="h-4 w-4 text-emerald-500/80" />
                  )}
                  {todo.status === 'in_progress' && (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  )}
                  {todo.status === 'pending' && (
                    <Circle className="h-4 w-4 text-muted-foreground/60" />
                  )}
                </span>
                <p
                  className={cn(
                    'flex-1 leading-relaxed',
                    todo.status === 'completed' && 'line-through opacity-70',
                    todo.status === 'in_progress' && 'font-medium text-foreground'
                  )}
                >
                  {todo.status === 'in_progress' && todo.activeForm
                    ? todo.activeForm
                    : todo.content}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {agentCount > 0 && (
        <section aria-label="Subagenten" className="session-progress-agents">
          {agents}
        </section>
      )}

      <div className="session-progress-actions">
        {onOpenRun && (
          <button type="button" onClick={onOpenRun}>
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            Lauf-Übersicht
          </button>
        )}
        {onConfigureAgents && (
          <button type="button" onClick={onConfigureAgents}>
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            Agenten konfigurieren
          </button>
        )}
      </div>
    </div>
  );
}
