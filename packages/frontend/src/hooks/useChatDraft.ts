import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

const writes = new Map<string, Promise<unknown>>();

/** Mounted with a session/chat key. Text is durable before debounce or navigation. */
export function useChatDraft(sessionId: string, chatId: string | null) {
  const userId = useAuthStore((state) => state.user?.id) ?? '';
  const key = `plum.chat.draft.v1:${JSON.stringify([userId, sessionId, chatId])}`;
  const [input, updateInput] = useState(() => {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  });
  const current = useRef(input);
  const revision = useRef(0);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const flush = useCallback(() => {
    if (pending.current === null) return;
    const content = pending.current;
    pending.current = null;
    const previous = writes.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() =>
        api.put(`/api/workspace/sessions/${encodeURIComponent(sessionId)}/draft`, {
          content,
          chatId,
        })
      );
    writes.set(key, next);
    void next
      .catch(() => {})
      .finally(() => {
        if (writes.get(key) === next) writes.delete(key);
      });
  }, [key, sessionId, chatId]);
  const setInput = useCallback(
    (action: SetStateAction<string>) => {
      const text = typeof action === 'function' ? action(current.current) : action;
      current.current = text;
      revision.current++;
      updateInput(text);
      try {
        localStorage.setItem(key, text);
      } catch {
        /* Keep the visible text if storage is full. */
      }
      pending.current = text;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 500);
    },
    [key, flush]
  );
  useEffect(() => {
    let disposed = false;
    let localExists = false;
    try {
      localExists = localStorage.getItem(key) !== null;
    } catch {
      /* Remote can still load. */
    }
    if (!localExists) {
      const expectedRevision = revision.current;
      void api
        .get<{ data: { content?: string } }>(
          `/api/workspace/sessions/${encodeURIComponent(sessionId)}/draft?chatId=${encodeURIComponent(chatId ?? '')}`
        )
        .then(({ data }) => {
          if (!disposed && revision.current === expectedRevision && data.data?.content)
            setInput(data.data.content);
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
      clearTimeout(timer.current);
      flush();
    };
  }, [key, sessionId, chatId, setInput, flush]);
  return [input, setInput] as const;
}
