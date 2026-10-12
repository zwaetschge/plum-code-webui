import { VoicePicker } from '@/components/assistant/VoicePicker';
import { MemoryManagement, MemoryModelChoice } from '@/components/assistant/MemoryManagement';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import type { AssistantPersonalization, ReferencePhotoSlot } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { usePersonalization } from '@/components/assistant/usePersonalization';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import './personalization.css';

export function PersonalizationPage() {
  const owner = useAuthStore((s) => s.user?.id);
  return <PersonalizationAccount key={owner} owner={owner} />;
}
function PersonalizationAccount({ owner }: { owner?: string }) {
  const query = usePersonalization(),
    cache = useQueryClient();
  const [draft, setDraft] = useState<AssistantPersonalization | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<'memory' | 'writing' | 'instructions' | null>(null),
    [area, setArea] = useState<'chat' | 'task' | 'code'>('chat');
  useEffect(() => {
    if (new URLSearchParams(location.search).get('view') === 'memory') setDialog('memory');
  }, []);

  const [memoryTitle, setMemoryTitle] = useState(''),
    [memoryText, setMemoryText] = useState('');
  const value = draft ?? query.preferences,
    dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(query.data);
  const set = <K extends keyof AssistantPersonalization>(
    key: K,
    v: AssistantPersonalization[K]
  ) => {
    setNotice('');
    setDraft((current) => ({ ...(current ?? query.preferences), [key]: v }));
  };
  const accept = (next: AssistantPersonalization) => {
    if (useAuthStore.getState().user?.id !== owner) return;
    cache.setQueryData(['assistant', 'personalization', owner], next);
    setDraft(null);
    setNotice('Gespeichert. Gilt ab der nächsten Antwort.');
  };
  const invoke = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (useAuthStore.getState().user?.id === owner)
        setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      if (useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  };
  const save = () =>
    invoke(async () => {
      const { revision, referencePhotos: _, ...preferences } = value;
      accept(
        (
          await api.put<{ data: AssistantPersonalization }>('/api/assistant/personalization', {
            expectedRevision: revision,
            preferences,
          })
        ).data.data
      );
    });
  const photo = async (slot: ReferencePhotoSlot, file?: File) =>
    invoke(async () => {
      if (dirty) throw new Error('Bitte deine Einstellungen zuerst speichern.');
      if (file) {
        const body = new FormData();
        body.append('file', file);
        body.append('expectedRevision', String(value.revision));
        accept(
          (
            await api.post<{ data: AssistantPersonalization }>(
              `/api/assistant/personalization/photos/${slot}`,
              body
            )
          ).data.data
        );
      } else
        accept(
          (
            await api.delete<{ data: AssistantPersonalization }>(
              `/api/assistant/personalization/photos/${slot}`,
              { body: JSON.stringify({ expectedRevision: value.revision }) }
            )
          ).data.data
        );
    });
  const toggle = (
    key:
      | 'agentMemorySharing'
      | 'memoryLearning'
      | 'chatHistory'
      | 'writingStyleLearning'
      | 'memoryEnabled'
      | 'writingStyleEnabled'
      | 'conciseAnswers'
      | 'suggestedPrompts'
      | 'voiceHistory'
      | 'webSearch'
      | 'voiceChat'
      | 'projectSearch'
      | 'connectorSearch',
    title: string,
    description: string
  ) => (
    <div className="personalization-row" key={key}>
      <div>
        <label htmlFor={`personal-${key}`}>{title}</label>
        <p>{description}</p>
      </div>
      <Switch
        id={`personal-${key}`}
        aria-label={title}
        checked={value[key]}
        disabled={busy}
        onCheckedChange={(v) => set(key, v)}
      />
    </div>
  );
  if (query.isPending)
    return (
      <div className="personalization-page" role="status">
        Personalisierung laden …
      </div>
    );
  if (query.isError)
    return (
      <div className="personalization-page">
        <p role="alert">Personalisierung konnte nicht geladen werden.</p>
        <Button onClick={() => query.refetch()}>Erneut laden</Button>
      </div>
    );
  const instructionsKey =
    area === 'chat'
      ? 'chatInstructions'
      : area === 'task'
        ? 'taskInstructions'
        : 'codeInstructions';
  return (
    <div className="personalization-page">
      <Link to="/chat" className="personalization-back">
        <ChevronLeft size={16} />
        Zurück zum Chat
      </Link>
      <h1>Personalisierung</h1>
      <p className="personalization-intro">
        Deine Vorgaben für Plum. Profile und Anweisungen im aktuellen Gespräch können den Stil
        anpassen.
      </p>
      <section aria-labelledby="personal-memory">
        <h2 id="personal-memory">Plum-Erinnerungen</h2>
        <div className="personalization-group">
          {toggle(
            'memoryEnabled',
            'Erinnerungen verwenden',
            'Erlaubt Plum, deine gespeicherten Erinnerungen zu berücksichtigen und neue zu speichern. Temporäre Chats bleiben ohne Gedächtnis.'
          )}
          {toggle(
            'memoryLearning',
            'Aus Gesprächen lernen',
            'Gewinnt nach deinen Antworten bleibende Erinnerungen aus deinen eigenen Angaben. Sensible Angaben werden zuerst zur Prüfung vorgeschlagen. Verwendet deine API-Verbindung und verursacht Modellkosten.'
          )}
          {toggle(
            'chatHistory',
            'Frühere Chats berücksichtigen',
            'Findet relevante Zusammenfassungen früherer erlaubter Gespräche wieder. Beginnt nach dem Aktivieren; temporäre Chats bleiben ausgeschlossen.'
          )}
          {toggle(
            'agentMemorySharing',
            'Erinnerungen mit beauftragten Schwarm-Agenten teilen',
            'Gibt relevante erlaubte Erinnerungen als Auftragskontext weiter. Dieser Kontext ist im zugehörigen Matrix-Auftragsraum sichtbar. Agentenwissen wird weiterhin ausdrücklich übernommen.'
          )}
          <MemoryModelChoice
            providerId={value.memoryProviderId}
            model={value.memoryModel}
            onChange={(providerId, model) => {
              set('memoryProviderId', providerId);
              set('memoryModel', model);
            }}
          />
          <div className="personalization-row">
            <div>
              <h3>Erinnerungsübersicht</h3>
              <p>
                Sieh nach, was du Plum mitgeteilt hast. Du kannst einzelne Erinnerungen ergänzen
                oder entfernen.
              </p>
            </div>
            <Button variant="secondary" onClick={() => setDialog('memory')}>
              Verwalten
            </Button>
          </div>
          <p className="personalization-note">
            Lernen und Rückgriff auf frühere Chats sind getrennt steuerbar. Beide benötigen
            aktivierte Erinnerungen. ChatGPT-Kontoerinnerungen werden nicht übernommen.
          </p>
        </div>
      </section>
      <section aria-labelledby="personal-writing">
        <h2 id="personal-writing">Schreibstil</h2>
        <div className="personalization-group">
          {toggle(
            'writingStyleEnabled',
            'Meinen Schreibstil berücksichtigen',
            'Nutze deine eigene Textprobe, wenn Plum für dich schreibt.'
          )}
          {toggle(
            'writingStyleLearning',
            'Meinen Schreibstil lernen',
            'Leitet deinen Stil aus neuen eigenen Nachrichten ab, wenn Erinnerungen und Schreibstil aktiv sind. Deine hinterlegte Textprobe bleibt erhalten.'
          )}
          <button
            className="personalization-row personalization-action"
            onClick={() => setDialog('writing')}
          >
            <span>
              Schreibprobe {value.writingSample ? 'bearbeiten' : 'hinzufügen'}
              <small>
                {value.writingSample
                  ? 'Deine gespeicherte Textprobe'
                  : 'Zum Beispiel eine E-Mail oder ein Text, der nach dir klingt.'}
              </small>
            </span>
            <ChevronRight size={18} />
          </button>
        </div>
      </section>
      <section aria-labelledby="personal-photos">
        <h2 id="personal-photos">Referenzfotos</h2>
        <div className="personalization-group">
          {(['portrait', 'fullBody'] as const).map((slot) => (
            <div className="personalization-row" key={slot}>
              <div>
                <h3>{slot === 'portrait' ? 'Referenzfoto' : 'Ganzkörper-Referenzfoto'}</h3>
                <p>
                  {slot === 'portrait'
                    ? 'Für ausdrücklich gewünschte Bilder von dir selbst.'
                    : 'Für Bilder, die Kleidung und Accessoires an dir zeigen.'}
                </p>
                {value.referencePhotos[slot] && (
                  <small>{value.referencePhotos[slot]!.filename}</small>
                )}
              </div>
              <div className="personalization-photo-actions">
                <label className="personalization-upload">
                  <span>{value.referencePhotos[slot] ? 'Ersetzen' : 'Hinzufügen'}</span>
                  <input
                    type="file"
                    aria-label={
                      slot === 'portrait'
                        ? 'Referenzfoto hinzufügen'
                        : 'Ganzkörper-Referenzfoto hinzufügen'
                    }
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    disabled={busy || dirty}
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0];
                      e.currentTarget.value = '';
                      if (file) void photo(slot, file);
                    }}
                  />
                </label>
                {value.referencePhotos[slot] && (
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy || dirty}
                    aria-label={`${slot === 'portrait' ? 'Referenzfoto' : 'Ganzkörper-Referenzfoto'} entfernen`}
                    onClick={() => photo(slot)}
                  >
                    <Trash2 size={16} />
                  </Button>
                )}
              </div>
            </div>
          ))}
          <p className="personalization-note">
            Privat gespeichert · maximal 5 MB je Foto. CLI-Chats lesen das Foto über Plum-Werkzeuge
            nur für den gewünschten Bildauftrag. Im API-Chat wählst du es als Bildanhang aus.{' '}
            {dirty ? 'Vor dem Upload Einstellungen speichern.' : ''}
          </p>
        </div>
      </section>
      <section aria-labelledby="personal-tone">
        <h2 id="personal-tone">Stil und Tonfall</h2>
        <div className="personalization-group">
          <div className="personalization-row">
            <label htmlFor="personal-base">Basisstil und Tonfall</label>
            <select
              id="personal-base"
              value={value.baseStyle}
              disabled={busy}
              onChange={(e) =>
                set('baseStyle', e.target.value as AssistantPersonalization['baseStyle'])
              }
            >
              {[
                ['default', 'Standard'],
                ['friendly', 'Freundlich'],
                ['professional', 'Professionell'],
                ['direct', 'Direkt'],
                ['creative', 'Kreativ'],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {(
            [
              ['warmth', 'Herzlichkeit'],
              ['enthusiasm', 'Begeisterung'],
              ['emoji', 'Emoji'],
              ['visualLayout', 'Layout und visuelle Elemente'],
              ['headings', 'Überschriften und Listen'],
            ] as const
          ).map(([key, label]) => (
            <div className="personalization-row" key={key}>
              <label htmlFor={`personal-${key}`}>{label}</label>
              <select
                id={`personal-${key}`}
                disabled={busy}
                value={value[key]}
                onChange={(e) => set(key, e.target.value as AssistantPersonalization[typeof key])}
              >
                <option value="default">Standard</option>
                <option value="less">Weniger</option>
                <option value="more">Mehr</option>
              </select>
            </div>
          ))}
        </div>
      </section>
      <section aria-labelledby="personal-about">
        <h2 id="personal-about">Über dich</h2>
        <div className="personalization-group personalization-fields">
          <label>
            Wie soll Plum dich nennen?
            <Input
              value={value.nickname}
              maxLength={100}
              disabled={busy}
              placeholder="Dein Name oder Spitzname"
              onChange={(e) => set('nickname', e.target.value)}
            />
          </label>
          <label>
            Was machst du beruflich?
            <Input
              value={value.occupation}
              maxLength={200}
              disabled={busy}
              onChange={(e) => set('occupation', e.target.value)}
            />
          </label>
          <label>
            Was soll Plum über dich wissen?
            <Textarea
              value={value.aboutYou}
              maxLength={10000}
              rows={3}
              disabled={busy}
              placeholder="Interessen, Ziele oder Dinge, die dir wichtig sind"
              onChange={(e) => set('aboutYou', e.target.value)}
            />
          </label>
        </div>
      </section>
      <section aria-labelledby="personal-instructions">
        <h2 id="personal-instructions">Benutzerdefinierte Anweisungen</h2>
        <div className="personalization-group">
          {(['chat', 'task', 'code'] as const).map((key) => (
            <button
              key={key}
              aria-label={`Plum ${key === 'chat' ? 'Chat' : key === 'task' ? 'Task' : 'Code'}`}
              className="personalization-row personalization-action"
              onClick={() => {
                setArea(key);
                setDialog('instructions');
              }}
            >
              <span>
                Plum {key === 'chat' ? 'Chat' : key === 'task' ? 'Task' : 'Code'}
                <small>
                  {key === 'code'
                    ? 'Eigene Anweisungen für Coding-Sessions.'
                    : 'Zusätzliche Anweisungen und Kontext für diesen Bereich.'}
                </small>
              </span>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
      </section>
      <section aria-labelledby="personal-voice">
        <h2 id="personal-voice">Stimme zum Vorlesen</h2>
        <div className="personalization-group p-3">
          <VoicePicker
            value={value.voiceName}
            onChange={(voiceName) => set('voiceName', voiceName)}
          />
        </div>
      </section>
      <section aria-labelledby="personal-extra">
        <h2 id="personal-extra">Weitere Chat-Einstellungen</h2>
        <div className="personalization-group">
          {toggle(
            'conciseAnswers',
            'Kurze Antworten',
            'Bevorzuge kurze, direkte Antworten. Bei komplexen Fragen bleibt Platz für die nötigen Details.'
          )}
          {toggle(
            'suggestedPrompts',
            'Vorgeschlagene Prompts',
            'Zeige auf der Chat-Startseite Vorschläge zum Schreiben, Planen und Erklären.'
          )}
          {toggle(
            'voiceHistory',
            'Frühere Sprachnotizen berücksichtigen',
            'Verwende bis zu fünf gespeicherte Besprechungen oder Sprachnotizen als Kontext, wenn Erinnerungen aktiv sind.'
          )}
          {toggle(
            'webSearch',
            'Automatische Websuche',
            'CLI-Assistenten dürfen bei Bedarf im Web recherchieren. API-Chats haben keine automatische Websuche.'
          )}
          {toggle(
            'voiceChat',
            'Sprachchat',
            'Zeige Sprachaufnahme und Vorlesen über Vocarium OmniVoice und Whisper.'
          )}
          {toggle(
            'projectSearch',
            'Suche in Projekten',
            'Erlaube CLI-Assistenten, weitere Projekte bei Bedarf zu durchsuchen. Ausgewählte Quellen bleiben unabhängig davon verfügbar.'
          )}
          {toggle(
            'connectorSearch',
            'Konnektorsuche',
            'Erlaube CLI-Assistenten, verbundene Apps bei Bedarf zu durchsuchen. Ein ausdrücklicher Auftrag bleibt möglich.'
          )}
        </div>
      </section>
      <div className="personalization-save">
        <div>
          {error ? (
            <p role="alert">{error}</p>
          ) : (
            <p role="status">
              {dirty
                ? 'Ungespeicherte Änderungen'
                : notice || 'Einstellungen gelten für dein Konto.'}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {error && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setDraft(null);
                setError('');
                await query.refetch();
              }}
            >
              Neu laden
            </Button>
          )}
          <Button disabled={busy || !dirty} onClick={save}>
            {busy ? 'Speichern …' : 'Speichern'}
          </Button>
        </div>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className="plum-assistant-shell personalization-dialog">
          <DialogTitle>
            {dialog === 'memory'
              ? 'Erinnerungen'
              : dialog === 'writing'
                ? 'Deine Schreibprobe'
                : `Anweisungen für Plum ${area === 'chat' ? 'Chat' : area === 'task' ? 'Task' : 'Code'}`}
          </DialogTitle>
          <DialogDescription>
            {dialog === 'memory'
              ? 'Deine gespeicherten Erinnerungen. Änderungen hier werden direkt gespeichert.'
              : 'Diese Vorgaben werden mit «Speichern» auf der Personalisierungsseite übernommen.'}
          </DialogDescription>
          {dialog === 'memory' ? (
            <div className="personalization-memory-list">
              <MemoryManagement
                revision={value.revision}
                onChanged={() => {
                  void cache.invalidateQueries({
                    queryKey: ['assistant', 'resources', 'memory', owner],
                  });
                }}
              />
              <label>
                Titel
                <Input
                  value={memoryTitle}
                  maxLength={200}
                  onChange={(e) => setMemoryTitle(e.target.value)}
                />
              </label>
              <label>
                Neue Erinnerung
                <Textarea
                  value={memoryText}
                  maxLength={10000}
                  onChange={(e) => setMemoryText(e.target.value)}
                />
              </label>
              <Button
                disabled={busy || !memoryTitle.trim() || !memoryText.trim()}
                onClick={() =>
                  invoke(async () => {
                    await api.post('/api/assistant/memory', {
                      title: memoryTitle,
                      body: { text: memoryText, scope: 'personal' },
                    });
                    setMemoryTitle('');
                    setMemoryText('');
                    await cache.invalidateQueries({
                      queryKey: ['assistant', 'resources', 'memory', owner],
                    });
                  })
                }
              >
                Erinnerung speichern
              </Button>
              <Link to="/assistant/memory" className="underline">
                Alle Erinnerungen bearbeiten
              </Link>
            </div>
          ) : dialog === 'writing' ? (
            <Textarea
              aria-label="Deine Schreibprobe"
              rows={10}
              maxLength={10000}
              value={value.writingSample}
              onChange={(e) => set('writingSample', e.target.value)}
            />
          ) : (
            <Textarea
              aria-label="Benutzerdefinierte Anweisungen"
              rows={10}
              maxLength={10000}
              value={value[instructionsKey]}
              onChange={(e) => set(instructionsKey, e.target.value)}
            />
          )}
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Fertig
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
