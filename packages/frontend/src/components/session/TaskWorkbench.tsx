import type { TodoItem } from '../../stores/sessionStore';
import { cn } from '../../lib/utils';

interface TodoFloatingStripProps {
  todo: TodoItem | undefined;
  pendingTasksCount: number;
  completedTasksCount: number;
  totalTasksCount: number;
  onOpenTasks: () => void;
}

export function TodoFloatingStrip({
  todo,
  pendingTasksCount,
  completedTasksCount,
  totalTasksCount,
  onOpenTasks,
}: TodoFloatingStripProps) {
  if (!todo || pendingTasksCount === 0) return null;

  return (
    <button
      type="button"
      className="todo-floating-strip"
      aria-label={`Tasks: ${completedTasksCount}/${totalTasksCount} complete, ${pendingTasksCount} remaining. Open task list`}
      onClick={onOpenTasks}
    >
      <span className={cn('todo-floating-dot', todo.status === 'in_progress' && 'is-running')} />
      <span className="truncate">
        {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
      </span>
      <span className="todo-floating-count">
        {completedTasksCount}/{totalTasksCount}
      </span>
    </button>
  );
}
