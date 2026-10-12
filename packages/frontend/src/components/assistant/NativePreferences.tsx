import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
type Template = {
  id: string;
  titel: string;
  agent: string;
  ziel: string;
  budgetUsd?: number | null;
  budgetMin?: number | null;
  frist?: string | null;
  favorit?: boolean;
};
type Settings = {
  v?: number;
  zeit?: number;
  vorlagen?: Template[];
  antwortenVorlesen?: boolean;
  pdfSeiten?: boolean;
  screenshotsSperren?: boolean;
};
type Snapshot = { settings: Settings; hash: string; nativeUserId: string; epoch: string };
type Packet = {
  commandId: string;
  nativeUserId: string;
  epoch: string;
  expectedHash: string;
  zeit: number;
  changes: Settings;
};
export function NativePreferences({
  nativeUserId,
  epoch,
  onCommand,
}: {
  nativeUserId: string;
  epoch: string;
  onCommand: (command: string) => void;
}) {
  const owner = useAuthStore((s) => s.user?.id),
    active = useRef(true),
    started = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [draft, setDraft] = useState<Settings | null>(null),
    [pending, setPending] = useState<Packet | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<Template | null>(null),
    [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const valid = () => active.current && useAuthStore.getState().user?.id === owner;
  async function load() {
    setBusy(true);
    setError('');
    try {
      const result = (await api.get<{ data: Snapshot }>('/api/assistant/matrix/preferences')).data
        .data;
      if (valid()) {
        if (result.nativeUserId !== nativeUserId || result.epoch !== epoch)
          throw new Error('Matrix-Verbindung wurde inzwischen gewechselt.');
        setSnapshot(result);
        setDraft(result.settings);
        setSelected(null);
        setValues({});
        setPending(null);
      }
    } catch (e) {
      if (valid())
        setError(e instanceof Error ? e.message : 'Einstellungen konnten nicht geladen werden.');
    } finally {
      if (valid()) setBusy(false);
    }
  }
  async function save(packet: Packet) {
    setPending(packet);
    setBusy(true);
    setError('');
    try {
      const result = (
        await api.post<{ data: Snapshot }>('/api/assistant/matrix/preferences', packet)
      ).data.data;
      if (valid()) {
        setSnapshot(result);
        setDraft(result.settings);
        setPending(null);
      }
    } catch (e) {
      if (valid()) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) setPending(null);
        setError(e instanceof Error ? e.message : 'Speicherung wurde nicht bestätigt.');
      }
    } finally {
      if (valid()) setBusy(false);
    }
  }
  const editable = !!draft && (draft.v === undefined || draft.v === 1) && !busy && !pending;
  const update = (id: string, patch: Partial<Template>) => {
    if (!draft) return;
    const items = (draft.vorlagen ?? []).map((v) => (v.id === id ? { ...v, ...patch } : v));
    if (items.filter((v) => v.favorit).length > 6) {
      setError('Es gibt höchstens sechs Favoriten. Zuerst einen anderen Stern entfernen.');
      return;
    }
    setDraft({ ...draft, vorlagen: items });
    setError('');
  };
  const placeholders = selected
    ? [
        ...new Set(
          [...selected.ziel.matchAll(/\{([^{}\n]{1,40})\}/g)]
            .map((m) => m[1]!.trim())
            .filter(Boolean)
        ),
      ]
    : [];
  return (
    <details
      className="space-y-3 rounded-lg border bg-card p-4"
      aria-label="Native Kontoeinstellungen"
      onToggle={(e) => {
        if (e.currentTarget.open && !started.current) {
          started.current = true;
          void load();
        }
      }}
    >
      <summary className="cursor-pointer font-semibold">
        Schwarm-Vorlagen und Kontoeinstellungen
      </summary>
      <p className="text-xs text-muted-foreground">
        Diese Einstellungen liegen in deinem bisherigen Matrix-Konto und werden mit dem nativen
        Plum-Schwarmclient geteilt. Vor dem Speichern wird der aktuelle Stand verglichen.
        Gleichzeitige Änderungen anderer Matrix-Geräte während der Zustellung folgen weiterhin dem
        nativen Zeitstempelvertrag.
      </p>
      {draft && (
        <>
          {draft.v !== undefined && draft.v !== 1 && (
            <p role="alert">Die Version {draft.v} ist schreibgeschützt.</p>
          )}
          <div className="grid gap-2">
            {(
              [
                ['antwortenVorlesen', 'Antworten automatisch vorlesen'],
                ['pdfSeiten', 'PDF-Seiten für Brian aufbereiten'],
                ['screenshotsSperren', 'Screenshots im nativen Schwarmbereich sperren'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={draft[key] ?? false}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            PDF-Aufbereitung und Geräteschutz wirken im nativen Schwarmclient. Der Browser erhält
            dadurch keine Screenshot-Sperre.
          </p>
          {(draft.vorlagen ?? []).map((template) => (
            <fieldset key={template.id} className="min-w-0 space-y-2 rounded-md border p-3">
              <legend className="max-w-full break-words px-1 text-sm">
                {template.titel}
                {template.favorit ? ' ★' : ''}
              </legend>
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  Vorlagentitel
                  <input
                    aria-label={`Vorlagentitel ${template.id}`}
                    maxLength={200}
                    disabled={!editable}
                    value={template.titel}
                    onChange={(e) => update(template.id, { titel: e.target.value })}
                    className="min-w-0 rounded-md border bg-background p-2"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Agent ohne @
                  <input
                    aria-label={`Vorlagenagent ${template.id}`}
                    maxLength={200}
                    disabled={!editable}
                    value={template.agent}
                    onChange={(e) => update(template.id, { agent: e.target.value })}
                    className="min-w-0 rounded-md border bg-background p-2"
                  />
                </label>
              </div>
              <label className="grid gap-1 text-sm">
                Ziel mit Platzhaltern
                <textarea
                  aria-label={`Vorlagenziel ${template.id}`}
                  maxLength={10000}
                  disabled={!editable}
                  value={template.ziel}
                  onChange={(e) => update(template.id, { ziel: e.target.value })}
                  className="min-h-20 rounded-md border bg-background p-2"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    ['budgetUsd', 'Budget (USD)'],
                    ['budgetMin', 'Zeitbudget (Minuten)'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="grid gap-1 text-sm">
                    {label}
                    <input
                      aria-label={`${label} ${template.id}`}
                      type="number"
                      min={key === 'budgetUsd' ? 0 : 1}
                      max={100000}
                      step={key === 'budgetUsd' ? 'any' : 1}
                      disabled={!editable}
                      value={template[key] ?? ''}
                      onChange={(e) =>
                        update(template.id, {
                          [key]: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="min-w-0 rounded-md border bg-background p-2"
                    />
                  </label>
                ))}
                <label className="grid gap-1 text-sm">
                  Frist als Hinweis
                  <input
                    aria-label={`Vorlagenfrist ${template.id}`}
                    maxLength={200}
                    disabled={!editable}
                    value={template.frist ?? ''}
                    onChange={(e) => update(template.id, { frist: e.target.value })}
                    className="min-w-0 rounded-md border bg-background p-2"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  aria-label={`Favorit ${template.id}`}
                  type="checkbox"
                  disabled={!editable}
                  checked={template.favorit ?? false}
                  onChange={(e) => update(template.id, { favorit: e.target.checked })}
                />
                Favorit
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !!pending}
                  onClick={() => {
                    setSelected(template);
                    setValues({});
                  }}
                >
                  Platzhalter ausfüllen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!editable}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      vorlagen: (draft.vorlagen ?? []).filter((v) => v.id !== template.id),
                    })
                  }
                >
                  Vorlage aus Entwurf entfernen
                </Button>
              </div>
            </fieldset>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={!editable || (draft.vorlagen ?? []).length >= 100}
            onClick={() =>
              setDraft({
                ...draft,
                vorlagen: [
                  ...(draft.vorlagen ?? []),
                  {
                    id: crypto.randomUUID(),
                    titel: 'Neue Vorlage',
                    agent: 'brian',
                    ziel: 'Beschreibe {Thema}',
                    favorit: false,
                  },
                ],
              })
            }
          >
            Vorlage hinzufügen
          </Button>
          {selected && (
            <section className="space-y-2 rounded-md border p-3" aria-label="Vorlage ausfüllen">
              <h3 className="text-sm font-medium">{selected.titel}</h3>
              {placeholders.map((name) => (
                <label key={name} className="grid gap-1 text-sm">
                  {name}
                  <input
                    aria-label={`Platzhalter ${name}`}
                    maxLength={2000}
                    value={values[name] ?? ''}
                    onChange={(e) => setValues({ ...values, [name]: e.target.value })}
                    className="rounded-md border bg-background p-2"
                  />
                </label>
              ))}
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  !!pending ||
                  !/^[-a-zA-Z0-9_/]+$/.test(selected.agent) ||
                  placeholders.some((name) => !values[name]?.trim())
                }
                onClick={() => {
                  const goal = selected.ziel
                    .replace(
                      /\{([^{}\n]{1,40})\}/g,
                      (original, name: string) => values[name.trim()]?.trim() || original
                    )
                    .trim()
                    .replace(/\s+/g, ' ');
                  const budget = [
                      selected.budgetUsd != null ? `${selected.budgetUsd} USD` : null,
                      selected.budgetMin != null ? `${selected.budgetMin} min` : null,
                    ]
                      .filter(Boolean)
                      .join(' / '),
                    notes = [
                      budget ? `Budget: ${budget}` : null,
                      selected.frist?.trim() ? `Frist: ${selected.frist.trim()}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                  onCommand(`!auftrag @${selected.agent} ${goal}${notes ? '\n' + notes : ''}`);
                }}
              >
                Im Nachrichtenfeld vorbereiten
              </Button>
              <p className="text-xs text-muted-foreground">
                Budget und Frist dieser nativen Vorlage sind Hinweise für den Agenten. Ein
                serverseitiges Budgetlimit setzt du im Taskformular. Dieser Schritt sendet noch
                nichts.
              </p>
            </section>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!editable || !snapshot}
              onClick={() => {
                if (snapshot)
                  void save({
                    commandId: crypto.randomUUID(),
                    nativeUserId,
                    epoch,
                    expectedHash: snapshot.hash,
                    zeit: Math.max(Date.now(), Number(snapshot.settings.zeit ?? 0) + 1),
                    changes: {
                      vorlagen: draft.vorlagen,
                      ...(draft.antwortenVorlesen !== undefined
                        ? { antwortenVorlesen: draft.antwortenVorlesen }
                        : {}),
                      ...(draft.pdfSeiten !== undefined ? { pdfSeiten: draft.pdfSeiten } : {}),
                      ...(draft.screenshotsSperren !== undefined
                        ? { screenshotsSperren: draft.screenshotsSperren }
                        : {}),
                    },
                  });
              }}
            >
              Native Einstellungen speichern
            </Button>
            {pending && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                className="h-auto min-h-9 max-w-full whitespace-normal"
                onClick={() => void save(pending)}
              >
                Dieselbe Speicherung bestätigen
              </Button>
            )}
          </div>
        </>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        className="h-auto min-h-9 max-w-full whitespace-normal"
        onClick={() => void load()}
      >
        Aktuellen Stand laden und lokalen Entwurf verwerfen
      </Button>
      {busy && <p role="status">Native Einstellungen werden geprüft …</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}
