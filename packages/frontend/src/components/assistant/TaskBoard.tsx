import { Link } from 'react-router-dom';
import type { AssistantResource } from '@plum-code-webui/shared';
import { Button } from '@/components/ui/button';
export function TaskBoard({
  items,
  tree,
  labels,
  onSelect,
  selectedId,
}: {
  items: AssistantResource[];
  tree: boolean;
  selectedId?: string;
  labels: Record<string, string>;
  onSelect: (task: AssistantResource) => void;
}) {
  const loaded = new Map(items.map((item) => [item.id, item])),
    ordered: Array<{ task: AssistantResource; depth: number }> = [],
    visited = new Set<string>();
  const add = (task: AssistantResource, depth: number) => {
    if (visited.has(task.id)) return;
    visited.add(task.id);
    ordered.push({ task, depth });
    for (const child of items) if (child.body.parentId === task.id) add(child, depth + 1);
  };
  if (tree) {
    for (const item of items)
      if (!item.body.parentId || !loaded.has(String(item.body.parentId))) add(item, 0);
    for (const item of items) add(item, 0);
  } else items.forEach((task) => ordered.push({ task, depth: 0 }));
  return (
    <section aria-label="Task-Board" className="plum-task-board min-w-0 space-y-3">
      <p className="plum-task-count text-xs text-muted-foreground">
        {items.length} geladene Treffer.
        {tree
          ? ' Der Baum zeigt geladene Eltern und Teilaufträge. Filter können Eltern oder Kinder ausblenden.'
          : ' Status und Reihenfolge gelten auch für weitere Seiten.'}
      </p>
      {!items.length && (
        <p className="rounded border border-dashed p-4 text-sm">
          Keine Aufträge für diese Auswahl.
        </p>
      )}
      <ol className="space-y-3">
        {ordered.map(({ task, depth }) => {
          const due = task.body.dueAt ? new Date(String(task.body.dueAt)) : null;
          const validDue = due && Number.isFinite(due.getTime());
          const overdue =
            validDue &&
            due.getTime() < Date.now() &&
            !['completed', 'cancelled'].includes(String(task.body.status));
          return (
            <li key={task.id} style={{ paddingInlineStart: tree ? Math.min(depth, 6) * 12 : 0 }}>
              <article
                className="plum-task-card min-w-0 space-y-2"
                data-selected={selectedId === task.id || undefined}
              >
                <Button
                  variant="ghost"
                  className="plum-task-open h-auto w-full justify-start whitespace-normal text-left"
                  aria-pressed={selectedId === task.id}
                  onClick={() => onSelect(task)}
                >
                  <span className="plum-task-card-heading min-w-0">
                    <span className="block break-words font-semibold">{task.title}</span>
                    <span
                      className="plum-task-status text-xs"
                      data-status={String(task.body.status)}
                    >
                      {labels[String(task.body.status)] ?? String(task.body.status)}
                    </span>
                  </span>
                </Button>
                <p className="line-clamp-2 break-words text-sm text-muted-foreground">
                  {String(task.body.goal ?? '')}
                </p>
                <div className="plum-task-meta flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span>Priorität {Number(task.body.priority ?? 0)}</span>
                  <span className="break-all">
                    {String(task.body.agentId || task.body.provider || 'Unbekannte Laufzeit')}
                  </span>
                  {validDue && (
                    <time
                      dateTime={due.toISOString()}
                      className={overdue ? 'font-medium text-destructive' : ''}
                    >
                      {overdue ? 'Überfällig: ' : 'Frist: '}
                      {due.toLocaleString('de-CH')}
                    </time>
                  )}
                </div>
                {typeof task.body.parentId === 'string' && (
                  <Link
                    className="break-words text-xs text-primary underline"
                    to={`/assistant/tasks?resource=${encodeURIComponent(task.body.parentId)}`}
                  >
                    {loaded.get(task.body.parentId)?.title
                      ? `Übergeordnet: ${loaded.get(task.body.parentId)!.title}`
                      : 'Übergeordneten Auftrag öffnen (nicht in den geladenen Treffern)'}
                  </Link>
                )}
                {tree && depth > 6 && (
                  <p className="text-xs text-muted-foreground">Hierarchieebene {depth + 1}</p>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
