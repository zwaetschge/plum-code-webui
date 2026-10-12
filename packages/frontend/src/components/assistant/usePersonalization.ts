import { useQuery } from '@tanstack/react-query';
import { DEFAULT_PERSONALIZATION, type AssistantPersonalization } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
export function usePersonalization() {
  const owner = useAuthStore((s) => s.user?.id);
  const query = useQuery({
    queryKey: ['assistant', 'personalization', owner],
    enabled: !!owner,
    queryFn: async () =>
      (await api.get<{ data: AssistantPersonalization }>('/api/assistant/personalization')).data
        .data,
    staleTime: 15000,
  });
  return { ...query, preferences: query.data ?? DEFAULT_PERSONALIZATION };
}
