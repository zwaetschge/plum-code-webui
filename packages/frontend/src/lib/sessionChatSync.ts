import type { QueryClient } from '@tanstack/react-query';
import type { ServerToClientEvents } from '@plum-code-webui/shared';

type SessionChatsEvent = Parameters<ServerToClientEvents['session:chats']>[0];
export type SessionChatSync = Pick<SessionChatsEvent, 'sessionId' | 'activeChatId'> &
  Partial<Pick<SessionChatsEvent, 'chats'>>;

/** Publish a socket's thread identity before separately refreshing its titles. */
export function updateSessionChatQuery(queryClient: QueryClient, data: SessionChatSync): void {
  const queryKey = ['session-chats', data.sessionId];
  // An older REST response must not roll back a newer socket switch/rename.
  void queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<Omit<SessionChatsEvent, 'sessionId'>>(queryKey, (current) => ({
    chats: data.chats ?? current?.chats ?? [],
    activeChatId: data.activeChatId,
  }));
  if (!data.chats) void queryClient.invalidateQueries({ queryKey });
}
