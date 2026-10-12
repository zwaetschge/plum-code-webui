import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import type { AssistantApiUsage } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { AnalyticsPanel } from './AnalyticsPanel';

export function ApiChatUsagePanel({
  window,
}: {
  window?: { startsAt: string | null; endsAt: string | null };
}) {
  const owner = useAuthStore((state) => state.user?.id);
  const usage = useQuery({
    queryKey: ['assistant', 'api-usage', owner, window?.startsAt, window?.endsAt],
    enabled: !!owner && !!window,
    refetchInterval: 30000,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (window?.startsAt) params.set('from', window.startsAt);
      if (window?.endsAt) params.set('to', window.endsAt);
      return (await api.get<{ data: AssistantApiUsage }>(`/api/assistant/api-chat-usage?${params}`))
        .data.data;
    },
  });
  const total = usage.data;
  return (
    <AnalyticsPanel
      icon={MessageSquare}
      title="Modellchat · persönliche API-Verbindungen"
      subtitle="Gleicher Zeitraum, eigenes API-Verbrauchsregister. CLI-Abos und Gesprächskopien zählen hier nicht mit."
    >
      {usage.isPending ? (
        <p role="status" className="p-4 text-sm">
          Modellchat-Verbrauch wird geladen …
        </p>
      ) : usage.isError ? (
        <p role="alert" className="p-4 text-sm">
          Modellchat-Verbrauch konnte nicht geladen werden.
        </p>
      ) : (
        total && (
          <div className="space-y-4 p-4">
            <p className="text-sm">
              {total.calls} Antwortversuche · {total.running} laufen ·{' '}
              {total.input + total.cached + total.cacheWrite} Eingabetokens · {total.output}{' '}
              Ausgabetokens · bekannter API-Gegenwert ${total.knownCostUsd.toFixed(4)}
            </p>
            {!!total.unpriced && (
              <p className="text-xs text-muted-foreground">
                Für {total.unpriced} abgeschlossene Versuche ist der Preis unbekannt, davon{' '}
                {total.missingUsage} ohne bestätigte Verbrauchswerte. Fehlende Werte zählen nicht
                als kostenlose Nutzung.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-left">Verbindung / Modell</th>
                    <th className="p-2 text-right">Versuche</th>
                    <th className="p-2 text-right">Tokens</th>
                    <th className="p-2 text-right">Bekannter Gegenwert</th>
                  </tr>
                </thead>
                <tbody>
                  {total.byModel.map((row) => (
                    <tr key={`${row.providerId}:${row.model}`} className="border-t">
                      <td className="p-2">
                        {row.providerId} · {row.model}
                      </td>
                      <td className="p-2 text-right">{row.calls}</td>
                      <td className="p-2 text-right">{row.tokens}</td>
                      <td className="p-2 text-right">
                        ${row.knownCostUsd.toFixed(4)}
                        {row.unpriced ? ` · ${row.unpriced} unbekannt` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </AnalyticsPanel>
  );
}
