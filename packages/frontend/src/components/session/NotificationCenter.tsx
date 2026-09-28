import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { disableWebPush, enableWebPush, getWebPushState } from '@/services/webPush';
import { socketService } from '@/services/socket';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface NotificationItem {
  id: string;
  sessionId: string | null;
  kind: string;
  title: string;
  body: string | null;
  /** Approval rows carry the requestId so the feed can answer in place. */
  data: { requestId?: string; toolName?: string; suggestedPattern?: string } | null;
  readAt: string | null;
  createdAt: string;
}

const KIND_COLOR: Record<string, string> = {
  approval: 'text-amber-500',
  question: 'text-amber-500',
  error: 'text-red-500',
  usage_alert: 'text-amber-500',
  goal: 'text-emerald-500',
  reply: 'text-foreground',
};

/** "vor 5 Min" style stamp — absolute times add noise in a feed this dense. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Durable cross-session feed of what happened while you were elsewhere.
 *
 * Rendered through the dropdown primitive so the panel is portalled: anchored
 * inside the narrow sidebar rail it would otherwise be clipped by the rail's
 * own bounds, which chopped every row in half.
 */
export function NotificationCenter() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const response = await api.get<{
        success: boolean;
        data: { items: NotificationItem[]; unreadCount: number };
      }>('/api/workspace/notifications');
      return response.data.data;
    },
    refetchInterval: 60_000,
  });

  // Live arrivals refresh the list rather than being merged locally, so the
  // unread count always comes from one source of truth.
  useEffect(() => {
    const socket = socketService.getSocket?.();
    if (!socket) return;
    const onNew = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [queryClient]);

  const markRead = useMutation({
    mutationFn: async (ids?: string[]) => {
      await api.post('/api/workspace/notifications/read', ids ? { ids } : {});
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Answering here is the whole point of surfacing approvals in the feed: the
  // agent is blocked, and opening the session first costs the most time exactly
  // when time matters.
  const respond = useMutation({
    mutationFn: async (input: {
      notificationId: string;
      sessionId: string;
      requestId: string;
      action: 'allow_once' | 'deny';
    }) => {
      await api.post('/api/permissions/respond', {
        sessionId: input.sessionId,
        requestId: input.requestId,
        action: input.action,
      });
      await api.post('/api/workspace/notifications/read', { ids: [input.notificationId] });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      await api.delete('/api/workspace/notifications');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Browser push is optional; the control only appears once the server has
  // VAPID keys configured.
  const [pushState, setPushState] = useState<'unsupported' | 'unconfigured' | 'on' | 'off'>(
    'unsupported'
  );
  useEffect(() => {
    void getWebPushState().then(setPushState);
  }, []);

  const unread = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="sidebar-icon-button relative"
          title="Notifications"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && <span className="notification-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        navigation
        align="start"
        side="right"
        sideOffset={8}
        className="notification-panel"
      >
        <div className="notification-panel-header">
          <span className="text-xs font-semibold">Notifications</span>
          {unread > 0 && <span className="notification-panel-count">{unread} new</span>}
          <div className="ml-auto flex items-center gap-1">
            {(pushState === 'on' || pushState === 'off') && (
              <button
                type="button"
                onClick={async (event) => {
                  event.preventDefault();
                  if (pushState === 'on') {
                    await disableWebPush();
                    setPushState('off');
                  } else if (await enableWebPush()) {
                    setPushState('on');
                  }
                }}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                  pushState === 'on'
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                title={pushState === 'on' ? 'Disable browser push' : 'Enable browser push'}
              >
                Push
              </button>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                markRead.mutate(undefined);
              }}
              className="notification-panel-action"
              title="Mark all read"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                clearAll.mutate();
              }}
              className="notification-panel-action"
              title="Clear all"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="notification-panel-list">
          {items.length === 0 && <div className="notification-panel-empty">Nothing yet</div>}
          {items.map((item) => {
            const requestId = item.data?.requestId;
            const canAnswer =
              item.kind === 'approval' && !item.readAt && !!requestId && !!item.sessionId;
            return (
              <div key={item.id} className={cn('notification-row', !item.readAt && 'is-unread')}>
                <button
                  type="button"
                  className="notification-row-main"
                  onClick={() => {
                    markRead.mutate([item.id]);
                    if (item.sessionId) navigate(`/session/${item.sessionId}`);
                  }}
                >
                  <span className="notification-row-top">
                    <span
                      className={cn(
                        'notification-row-title',
                        KIND_COLOR[item.kind] || 'text-foreground'
                      )}
                    >
                      {item.title}
                    </span>
                    <span className="notification-row-time">{relativeTime(item.createdAt)}</span>
                  </span>
                  {item.body && <span className="notification-row-body">{item.body}</span>}
                </button>
                {canAnswer && (
                  <div className="notification-row-actions">
                    <button
                      type="button"
                      className="notification-approve"
                      disabled={respond.isPending}
                      onClick={(event) => {
                        event.preventDefault();
                        respond.mutate({
                          notificationId: item.id,
                          sessionId: item.sessionId!,
                          requestId: requestId!,
                          action: 'allow_once',
                        });
                      }}
                    >
                      Allow
                    </button>
                    <button
                      type="button"
                      className="notification-deny"
                      disabled={respond.isPending}
                      onClick={(event) => {
                        event.preventDefault();
                        respond.mutate({
                          notificationId: item.id,
                          sessionId: item.sessionId!,
                          requestId: requestId!,
                          action: 'deny',
                        });
                      }}
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
