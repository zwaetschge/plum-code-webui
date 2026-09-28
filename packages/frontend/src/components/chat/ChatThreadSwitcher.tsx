import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Check, ChevronDown, MessageSquarePlus, MessagesSquare, Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface SessionChat {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ChatListPayload {
  chats: SessionChat[];
  activeChatId: string | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
}

/**
 * Dropdown to switch between chat threads inside one session and to start a
 * fresh thread. Switching swaps the provider-native context server-side and
 * stops the running CLI turn, so the caller must refetch messages afterwards.
 */
export function ChatThreadSwitcher({
  sessionId,
  onSwitched,
  className,
  showNewButton = false,
}: {
  sessionId: string;
  onSwitched: (chatId: string | null) => void;
  className?: string;
  showNewButton?: boolean;
}) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['session-chats', sessionId],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<ChatListPayload>>(
        `/api/sessions/${sessionId}/chats`
      );
      return response.data.data ?? { chats: [], activeChatId: null };
    },
    enabled: !!sessionId,
  });

  const refresh = (payload?: ChatListPayload) => {
    if (payload) queryClient.setQueryData(['session-chats', sessionId], payload);
    else void queryClient.invalidateQueries({ queryKey: ['session-chats', sessionId] });
    onSwitched(payload?.activeChatId === 'main' ? null : (payload?.activeChatId ?? null));
  };

  const activate = useMutation({
    mutationFn: async (chatId: string) => {
      const response = await api.post<ApiEnvelope<ChatListPayload>>(
        `/api/sessions/${sessionId}/chats/${chatId}/activate`
      );
      return response.data.data;
    },
    onSuccess: refresh,
  });

  const createChat = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiEnvelope<ChatListPayload>>(
        `/api/sessions/${sessionId}/chats`,
        {}
      );
      return response.data.data;
    },
    onSuccess: refresh,
  });

  const removeChat = useMutation({
    mutationFn: async (chatId: string) => {
      const response = await api.delete<ApiEnvelope<ChatListPayload>>(
        `/api/sessions/${sessionId}/chats/${chatId}`
      );
      return response.data.data;
    },
    onSuccess: refresh,
  });

  const chats = data?.chats ?? [];
  const activeChatId = data?.activeChatId ?? null;
  const active = chats.find((chat) => chat.id === activeChatId) ?? chats[0];
  const busy = activate.isPending || createChat.isPending || removeChat.isPending;

  return (
    <div className="session-thread-controls">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur transition-colors hover:text-foreground',
            busy && 'pointer-events-none opacity-60',
            className
          )}
          title="Switch chat thread"
        >
          <MessagesSquare className="h-3.5 w-3.5" />
          <span className="max-w-[140px] truncate">{active?.title ?? 'Chat 1'}</span>
          <ChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent navigation align="start" className="min-w-[220px]">
          {chats.map((chat) => (
            <DropdownMenuItem
              key={chat.id}
              className="flex items-center justify-between gap-2"
              onSelect={() => {
                if (chat.id !== activeChatId) activate.mutate(chat.id);
              }}
            >
              <span className="flex items-center gap-2 truncate">
                <Check
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    chat.id === activeChatId ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <span className="truncate">{chat.title}</span>
              </span>
              {chats.length > 1 && chat.id !== 'main' && (
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground/60 hover:text-destructive"
                  title="Delete this chat thread"
                  onClick={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    if (window.confirm(`Delete "${chat.title}" and its messages?`)) {
                      removeChat.mutate(chat.id);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => createChat.mutate()}>
            <MessageSquarePlus className="mr-2 h-3.5 w-3.5" />
            New chat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {showNewButton && (
        <button
          type="button"
          className="session-menu-more"
          disabled={busy}
          onClick={() => createChat.mutate()}
          aria-label="New chat"
          title="New chat"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
