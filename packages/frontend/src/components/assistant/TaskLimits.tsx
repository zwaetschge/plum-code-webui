import { useQuery } from '@tanstack/react-query';
import type { AssistantTaskLimits } from '@plum-code-webui/shared';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
export function TaskLimits({ taskId }: { taskId: string }) {
  const owner = useAuthStore((state) => state.user?.id);
  const query = useQuery({
    queryKey: ['assistant', 'task-limits', owner, taskId],
    queryFn: async () =>
      (await api.get<{ data: AssistantTaskLimits }>(`/api/assistant/tasks/${taskId}/limits`)).data
        .data,
    refetchInterval: 5000,
  });
  if (query.isError) return <p className="text-sm">Task-Kostenstand ist gerade nicht verfügbar.</p>;
  const limits = query.data;
  if (!limits) return null;
  if (limits.scope === 'native-coordinator')
    return (
      <p className="text-xs text-muted-foreground">
        Budget und Frist werden an den nativen Schwarm-Koordinator übergeben. Den aktuellen
        Verbrauch meldet dessen Auftragskarte.
      </p>
    );
  return (
    <div className="space-y-1 rounded-md border p-3 text-sm" aria-label="Task-Budget und Frist">
      <p>
        Bestätigter API-equivalenter Verbrauch: {(limits.knownCostUsd ?? 0).toFixed(4)} USD
        {limits.budgetUsd !== null ? ` / ${limits.budgetUsd.toFixed(2)} USD` : ''}
      </p>
      <p className="text-xs text-muted-foreground">
        Abgeschlossene Beiträge aller CLI-Versuche zählen gemeinsam. Weitere Beiträge werden am
        Budget oder an der Frist gestoppt. Ein laufender Beitrag kann das Budget überschreiten; dies
        ist keine Anbieter-Abrechnung oder Echtzeit-Kostengrenze.
      </p>
      {!!limits.unpricedTurns && (
        <p>{limits.unpricedTurns} Beiträge ohne bestätigten Modellpreis.</p>
      )}
      {limits.deadline && <p>Frist: {new Date(limits.deadline).toLocaleString()}</p>}
      {(limits.exhausted ||
        limits.deadlineExpired ||
        (limits.budgetUsd !== null && limits.unpricedTurns > 0)) && (
        <p role="status" className="font-medium">
          Vor weiterer Arbeit Budget, Frist oder fehlende Modellpreise prüfen.
        </p>
      )}
    </div>
  );
}
