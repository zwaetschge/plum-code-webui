import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronRight, Coffee } from 'lucide-react';
import type { Session, SessionLifecycleEvent } from '@plum-code-webui/shared';
import { formatRelativeTime, useNow } from '@/lib/relativeTime';
import { getSessionRunState, type SessionRunState } from '@/lib/sessionRunState';
import { cn } from '@/lib/utils';
import {
  BOARD_COLUMNS,
  PROVIDER_ACCENT,
  SESSION_OVERVIEW_VIEWS,
  TONE_LABEL,
  boardColumn,
  projectName,
  sessionActivityAt,
  type BoardColumn,
  type SessionOverviewView,
} from './sessionOverview';
import {
  AttentionCard,
  LiveSessionTile,
  SessionTile,
  type SessionTileProps,
} from './SessionOverviewTiles';
import './session-overview.css';

const RECENT_PAGE = 24;
const BOARD_PAGE = 30;

interface SessionOverviewProps {
  view: Exclude<SessionOverviewView, 'categories'>;
  /** Already filtered by surface, search and category. */
  sessions: Session[];
  runStates: Map<string, SessionRunState>;
  lifecycle: Record<string, SessionLifecycleEvent | null | undefined>;
  renderMenu: (session: Session) => ReactNode;
  onOpen: (session: Session) => void;
  onToggleStar: (session: Session) => void;
}

interface Entry {
  session: Session;
  runState: SessionRunState;
  activityAt: string;
}

const needsYou = (entry: Entry) =>
  entry.runState.tone === 'needs-you' || entry.runState.tone === 'error';

/** Lagebild, Projekte and Board over the same filtered session list. */
export function SessionOverview({
  view,
  sessions,
  runStates,
  lifecycle,
  renderMenu,
  onOpen,
  onToggleStar,
}: SessionOverviewProps) {
  const now = useNow();
  const entries = useMemo(
    () =>
      sessions
        .map(
          (session): Entry => ({
            session,
            runState: runStates.get(session.id) ?? getSessionRunState(session),
            activityAt: sessionActivityAt(session, lifecycle[session.id]),
          })
        )
        .sort((a, b) => b.activityAt.localeCompare(a.activityAt)),
    [lifecycle, runStates, sessions]
  );
  const tileProps = (entry: Entry, index: number): SessionTileProps => ({
    session: entry.session,
    runState: entry.runState,
    activityAt: entry.activityAt,
    now,
    index,
    menu: renderMenu(entry.session),
    onOpen: () => onOpen(entry.session),
    onToggleStar: () => onToggleStar(entry.session),
  });

  if (view === 'projects') return <ProjectsView entries={entries} now={now} tile={tileProps} />;
  if (view === 'board') return <BoardView entries={entries} tile={tileProps} />;
  return <SituationView entries={entries} tile={tileProps} />;
}

type TileFactory = (entry: Entry, index: number) => SessionTileProps;

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <h3 className="session-overview-heading">
      {title}
      <span className="session-overview-count">{count}</span>
    </h3>
  );
}

function MoreButton({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  if (hidden <= 0) return null;
  return (
    <button type="button" className="session-overview-more" onClick={onClick}>
      {hidden} weitere anzeigen
    </button>
  );
}

function SituationView({ entries, tile }: { entries: Entry[]; tile: TileFactory }) {
  const [showAll, setShowAll] = useState(false);
  const attention = entries.filter(needsYou);
  const working = entries.filter((entry) => entry.runState.tone === 'working');
  const rest = entries.filter((entry) => !needsYou(entry) && entry.runState.tone !== 'working');
  const visibleRest = showAll ? rest : rest.slice(0, RECENT_PAGE);

  return (
    <div className="session-overview">
      {attention.length > 0 ? (
        <section className="session-overview-section" aria-label="Braucht dich">
          <SectionHeading title="Braucht dich" count={attention.length} />
          <div className="session-attention-grid">
            {attention.map((entry, index) => (
              <AttentionCard key={entry.session.id} {...tile(entry, index)} />
            ))}
          </div>
        </section>
      ) : (
        entries.length > 0 && (
          <p className="session-overview-calm" role="status">
            <Coffee className="h-4 w-4" aria-hidden />
            Alles ruhig: keine Session wartet auf dich.
          </p>
        )
      )}
      {working.length > 0 && (
        <section className="session-overview-section" aria-label="Arbeitet gerade">
          <SectionHeading title="Arbeitet gerade" count={working.length} />
          <div className="session-live-row">
            {working.map((entry, index) => (
              <LiveSessionTile key={entry.session.id} {...tile(entry, index)} />
            ))}
          </div>
        </section>
      )}
      {rest.length > 0 && (
        <section className="session-overview-section" aria-label="Zuletzt">
          <SectionHeading title="Zuletzt" count={rest.length} />
          <div className="session-tile-grid">
            {visibleRest.map((entry, index) => (
              <SessionTile key={entry.session.id} {...tile(entry, index)} />
            ))}
          </div>
          <MoreButton hidden={rest.length - visibleRest.length} onClick={() => setShowAll(true)} />
        </section>
      )}
    </div>
  );
}

interface ProjectGroup {
  key: string;
  name: string;
  entries: Entry[];
  latest: string;
  hot: boolean;
}

function ProjectsView({
  entries,
  now,
  tile,
}: {
  entries: Entry[];
  now: number;
  tile: TileFactory;
}) {
  // Explicit toggles; untouched groups open when something in them is live.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const byDirectory = new Map<string, Entry[]>();
    for (const entry of entries) {
      const key = entry.session.workingDirectory || '';
      byDirectory.set(key, [...(byDirectory.get(key) ?? []), entry]);
    }
    return [...byDirectory.entries()]
      .map(
        ([key, items]): ProjectGroup => ({
          key,
          name: projectName(key),
          entries: items,
          latest: items[0]?.activityAt ?? '',
          hot: items.some((item) => needsYou(item) || item.runState.tone === 'working'),
        })
      )
      .sort((a, b) => b.latest.localeCompare(a.latest));
  }, [entries]);

  return (
    <div className="session-overview session-project-list">
      {groups.map((group, groupIndex) => {
        const expanded = open[group.key] ?? group.hot;
        return (
          <section
            key={group.key}
            className={cn('session-project-card', expanded && 'is-open')}
            style={{ '--i': Math.min(groupIndex, 12) } as CSSProperties}
          >
            <button
              type="button"
              className="session-project-head"
              aria-expanded={expanded}
              onClick={() => setOpen((current) => ({ ...current, [group.key]: !expanded }))}
            >
              <ChevronRight className="session-project-chevron" aria-hidden />
              <span className="session-project-name">
                <strong>{group.name}</strong>
                <span className="session-project-path">{group.key || 'Kein Arbeitsordner'}</span>
              </span>
              <span className="session-project-dots" aria-hidden>
                {group.entries.slice(0, 10).map((entry) => (
                  <span
                    key={entry.session.id}
                    className={cn('dashboard-status-dot', `is-${entry.runState.tone}`)}
                    style={
                      entry.runState.tone === 'idle'
                        ? { background: PROVIDER_ACCENT[entry.session.cliProvider] }
                        : undefined
                    }
                    title={`${entry.session.name}: ${TONE_LABEL[entry.runState.tone]}`}
                  />
                ))}
                {group.entries.length > 10 && (
                  <span className="session-project-dots-more">+{group.entries.length - 10}</span>
                )}
              </span>
              <span className="session-overview-count">{group.entries.length}</span>
              <time className="session-project-time" dateTime={group.latest}>
                {formatRelativeTime(group.latest, now)}
              </time>
            </button>
            {expanded && (
              <div className="session-tile-grid session-project-body">
                {group.entries.map((entry, index) => (
                  <SessionTile key={entry.session.id} {...tile(entry, index)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function BoardView({ entries, tile }: { entries: Entry[]; tile: TileFactory }) {
  const [expanded, setExpanded] = useState<Partial<Record<BoardColumn, boolean>>>({});
  const columns = useMemo(() => {
    const byColumn = new Map<BoardColumn, Entry[]>(BOARD_COLUMNS.map((c) => [c.value, []]));
    for (const entry of entries)
      byColumn.get(boardColumn(entry.session, entry.runState))!.push(entry);
    return byColumn;
  }, [entries]);

  return (
    <div className="session-board" role="list" aria-label="Board">
      {BOARD_COLUMNS.map((column) => {
        const items = columns.get(column.value) ?? [];
        const visible = expanded[column.value] ? items : items.slice(0, BOARD_PAGE);
        return (
          <section
            key={column.value}
            role="listitem"
            className={cn('session-board-column', `is-${column.value}`)}
            aria-label={column.label}
          >
            <SectionHeading title={column.label} count={items.length} />
            <div className="session-board-stack">
              {visible.map((entry, index) => (
                <SessionTile key={entry.session.id} {...tile(entry, index)} />
              ))}
              {items.length === 0 && <p className="session-board-empty">Nichts hier.</p>}
              <MoreButton
                hidden={items.length - visible.length}
                onClick={() => setExpanded((current) => ({ ...current, [column.value]: true }))}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Segmented control for the list header. */
export function SessionOverviewSwitcher({
  value,
  onChange,
}: {
  value: SessionOverviewView;
  onChange: (view: SessionOverviewView) => void;
}) {
  return (
    <div className="session-overview-switcher" role="group" aria-label="Ansicht">
      {SESSION_OVERVIEW_VIEWS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={cn(value === option.value && 'is-active')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
