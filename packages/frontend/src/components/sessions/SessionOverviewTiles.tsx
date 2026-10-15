import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { ArrowUpRight, Star } from 'lucide-react';
import type { PermissionAction, Session } from '@plum-code-webui/shared';
import { Button } from '@/components/ui/button';
import { SessionIcon } from '@/components/session/SessionIcon';
import { toast } from '@/hooks/use-toast';
import { formatRelativeTime } from '@/lib/relativeTime';
import type { SessionRunState } from '@/lib/sessionRunState';
import { cn } from '@/lib/utils';
import { socketService } from '@/services/socket';
import { useSessionStore } from '@/stores/sessionStore';
import {
  PROVIDER_ACCENT,
  TONE_LABEL,
  messagePreview,
  projectName,
  sessionUnreadCount,
} from './sessionOverview';

export interface SessionTileProps {
  session: Session;
  runState: SessionRunState;
  /** Freshest activity stamp (ISO). */
  activityAt: string;
  now: number;
  /** Position in its list, drives the staggered entrance. */
  index?: number;
  /** The existing per-session overflow menu (rename, icon, move, delete …). */
  menu: ReactNode;
  onOpen: () => void;
  onToggleStar: () => void;
}

function tileStyle(session: Session, index = 0): CSSProperties {
  return {
    '--tile-accent': PROVIDER_ACCENT[session.cliProvider] ?? 'hsl(var(--primary))',
    '--i': Math.min(index, 12),
  } as CSSProperties;
}

/** Whole tile opens the session; nested controls stop the click themselves. */
function openProps(session: Session, onOpen: () => void) {
  return {
    role: 'link' as const,
    tabIndex: 0,
    'aria-label': `${session.name} öffnen`,
    onClick: onOpen,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen();
      }
    },
  };
}

function TileActions({
  session,
  menu,
  onToggleStar,
}: Omit<SessionTileProps, 'runState' | 'activityAt' | 'now' | 'onOpen'>) {
  const unread = sessionUnreadCount(session);
  return (
    <div className="session-tile-actions" onClick={(event) => event.stopPropagation()}>
      {unread > 0 && (
        <span
          className="session-tile-unread"
          aria-label={`${unread} ungelesene ${unread === 1 ? 'Nachricht' : 'Nachrichten'}`}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
      <button
        type="button"
        className={cn('session-tile-star', session.starred && 'is-starred')}
        onClick={onToggleStar}
        aria-label={
          session.starred ? `${session.name} nicht mehr merken` : `${session.name} merken`
        }
        title={session.starred ? 'Nicht mehr merken' : 'Merken'}
      >
        <Star className="h-3.5 w-3.5" />
      </button>
      {menu}
    </div>
  );
}

function TileMeta({
  session,
  activityAt,
  now,
}: Pick<SessionTileProps, 'session' | 'activityAt' | 'now'>) {
  return (
    <div className="session-tile-meta">
      <span className="session-tile-project" title={session.workingDirectory}>
        {projectName(session.workingDirectory)}
      </span>
      <time dateTime={activityAt}>{formatRelativeTime(activityAt, now)}</time>
    </div>
  );
}

/** Compact tile for the "Zuletzt" grid, project groups and board columns. */
export function SessionTile(props: SessionTileProps) {
  const { session, runState, index, onOpen } = props;
  const preview = messagePreview(session.lastMessage);
  return (
    <article
      className={cn('session-tile', `is-${runState.tone}`)}
      style={tileStyle(session, index)}
      {...openProps(session, onOpen)}
    >
      <header className="session-tile-head">
        <span
          className={cn('dashboard-status-dot', `is-${runState.tone}`)}
          title={`${TONE_LABEL[runState.tone]} · ${runState.detail}`}
        />
        <h3 className="session-tile-title">{session.name}</h3>
        <TileActions {...props} />
      </header>
      {preview && <p className="session-tile-preview">{preview}</p>}
      <TileMeta {...props} />
    </article>
  );
}

/** "Arbeitet gerade": live tile with a pulsing ring and the current activity. */
export function LiveSessionTile(props: SessionTileProps) {
  const { session, runState, activityAt, now, index, onOpen } = props;
  return (
    <article
      className="session-live-tile"
      style={tileStyle(session, index)}
      {...openProps(session, onOpen)}
    >
      <header className="session-tile-head">
        <span className="session-live-ring">
          <SessionIcon
            session={session}
            logoClassName="h-4 w-4"
            imageClassName="h-7 w-7 rounded-full"
          />
        </span>
        <h3 className="session-tile-title">{session.name}</h3>
        <TileActions {...props} />
      </header>
      <p className="session-live-activity" aria-live="polite">
        {runState.detail}
      </p>
      <div className="session-tile-meta">
        <span className="session-tile-project" title={session.workingDirectory}>
          {projectName(session.workingDirectory)}
        </span>
        <time dateTime={activityAt}>aktiv {formatRelativeTime(activityAt, now)}</time>
      </div>
    </article>
  );
}

/**
 * "Braucht dich": large card. When the approval or question is known in this
 * tab it can be answered right here (same calls as the monitor); otherwise
 * the card opens the session.
 */
export function AttentionCard(props: SessionTileProps) {
  const { session, runState, index, onOpen } = props;
  const id = session.id;
  const pendingPermission = useSessionStore((state) => state.pendingPermissions[id]);
  const legacyPermission = useSessionStore((state) => state.permissionRequests[id]);
  const pendingQuestion = useSessionStore((state) => state.pendingQuestions[id]);

  const respond = async (action: PermissionAction) => {
    try {
      if (pendingPermission) {
        await socketService.respondToPermission(id, pendingPermission.requestId, action);
      } else if (legacyPermission) {
        if (action === 'deny') socketService.denyPermission(id);
        else
          socketService.approvePermission(
            id,
            legacyPermission.denials.map((denial) => denial.tool_name),
            legacyPermission.originalMessage
          );
      }
    } catch (error) {
      toast({
        title: 'Freigabe nicht gesendet',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const answer = async (option: string) => {
    if (!pendingQuestion) return;
    try {
      await socketService.respondToQuestion(
        id,
        pendingQuestion.requestId,
        [[option]],
        pendingQuestion.providerSessionId
      );
    } catch (error) {
      toast({
        title: 'Antwort nicht gesendet',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const approvalTool =
    pendingPermission?.toolName ??
    (legacyPermission
      ? legacyPermission.denials.map((denial) => denial.tool_name).join(', ')
      : null);
  const firstQuestion = pendingQuestion?.questions[0];
  const questionOptions =
    pendingQuestion && pendingQuestion.questions.length === 1
      ? (firstQuestion?.options ?? [])
          .map((option) => option.label)
          .filter(Boolean)
          .slice(0, 3)
      : [];
  const ask = approvalTool
    ? `Freigabe für ${approvalTool}`
    : pendingQuestion
      ? firstQuestion?.question || 'Der Agent hat eine Frage gestellt.'
      : runState.detail;

  return (
    <article
      className={cn('session-attention-card', `is-${runState.tone}`)}
      style={tileStyle(session, index)}
      {...openProps(session, onOpen)}
    >
      <header className="session-tile-head">
        <SessionIcon
          session={session}
          className="shrink-0"
          logoClassName="h-5 w-5"
          imageClassName="h-8 w-8 rounded-full"
        />
        <div className="min-w-0 flex-1">
          <h3 className="session-tile-title">{session.name}</h3>
          <span className="session-attention-label">{TONE_LABEL[runState.tone]}</span>
        </div>
        <TileActions {...props} />
      </header>
      <p className="session-attention-ask">{ask}</p>
      <div className="session-attention-actions" onClick={(event) => event.stopPropagation()}>
        {approvalTool ? (
          <>
            <Button size="sm" onClick={() => void respond('allow_once')}>
              Erlauben
            </Button>
            <Button size="sm" variant="outline" onClick={() => void respond('deny')}>
              Ablehnen
            </Button>
          </>
        ) : (
          questionOptions.map((option) => (
            <Button key={option} size="sm" variant="outline" onClick={() => void answer(option)}>
              {option}
            </Button>
          ))
        )}
        <Button size="sm" variant="ghost" onClick={onOpen}>
          Öffnen
          <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>
      <TileMeta {...props} />
    </article>
  );
}
