import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { ArtifactViewer } from '@/components/assistant/ArtifactViewer';
import type { AssistantResource } from '@plum-code-webui/shared';
export function SharedAssistantPage() {
  const { token } = useParams();
  const account = useAuthStore((state) => state.user?.id);
  const share = useQuery({
    queryKey: ['assistant', 'shared', token, account],
    queryFn: async () =>
      (
        await api.get<{ data: AssistantResource }>(
          '/api/assistant/shared/' + encodeURIComponent(token ?? '')
        )
      ).data.data,
    retry: false,
  });
  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-8">
        {share.isPending ? (
          <p role="status">Freigabe wird geladen …</p>
        ) : share.isError ? (
          <p role="alert">Diese Freigabe ist abgelaufen, widerrufen oder nicht verfügbar.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Geteilte Momentaufnahme · Revision {share.data.revision}
            </p>
            <h1 className="text-2xl font-semibold">{share.data.title}</h1>
            {share.data.kind === 'artifact' ? (
              <ArtifactViewer
                artifact={share.data}
                onSaved={() => {}}
                readOnly
                shareToken={token}
              />
            ) : (
              <p className="whitespace-pre-wrap">{String(share.data.body.description ?? '')}</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
