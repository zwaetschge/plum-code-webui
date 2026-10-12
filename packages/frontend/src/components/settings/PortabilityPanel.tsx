import { useState } from 'react';
import { api } from '@/services/api';
import { socketService, type PersistedOutboxEntry } from '@/services/socket';
import { Button } from '@/components/ui/button';
import type { Session } from '@plum-code-webui/shared';
import { useAuthStore } from '@/stores/authStore';
import {
  assistantDeliveries,
  validateAssistantDeliveries,
  checkAssistantDeliveryImport,
  importAssistantDeliveries,
  type AssistantDelivery,
} from '@/services/assistantOutbox';

interface Identity {
  instanceId: string;
  userId: string;
}
interface BrowserExport {
  format: 'plum-browser';
  version: 1 | 2;
  identity: Identity;
  origin: string;
  exportedAt: string;
  drafts: Record<string, string>;
  preferences: Record<string, string>;
  outbox: PersistedOutboxEntry[];
  assistantOutbox?: AssistantDelivery[];
}
const PREFS = [
  'theme',
  'background-animation',
  'claude-webui-panel-dock',
  'chat.rightMenuGroupsOpen.v2',
  'plum-dashboard-dock-collapsed',
];
async function identityAndSessions() {
  const owner = useAuthStore.getState().user?.id;
  const [identity, sessions] = await Promise.all([
    api.get<{ data: Identity }>('/api/assistant/identity'),
    api.get<{ data: Session[] }>('/api/sessions'),
  ]);
  if (!owner || useAuthStore.getState().user?.id !== owner || identity.data.data.userId !== owner)
    throw new Error('Das Konto hat sich während der Übertragung geändert');
  return {
    identity: identity.data.data,
    sessions: new Set(sessions.data.data.map((session) => session.id)),
  };
}
function draftScope(key: string, identity: Identity, sessions: Set<string>) {
  if (!key.startsWith('plum.chat.draft.v1:')) return false;
  try {
    const scope = JSON.parse(key.slice('plum.chat.draft.v1:'.length));
    return (
      Array.isArray(scope) &&
      scope.length === 3 &&
      scope[0] === identity.userId &&
      typeof scope[1] === 'string' &&
      sessions.has(scope[1]) &&
      (scope[2] === null || typeof scope[2] === 'string')
    );
  } catch {
    return false;
  }
}
export function PortabilityPanel() {
  const owner = useAuthStore((state) => state.user?.id);
  return <AccountPortabilityPanel key={owner ?? 'signed-out'} />;
}
function AccountPortabilityPanel() {
  const owner = useAuthStore((state) => state.user?.id);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [incoming, setIncoming] = useState<BrowserExport | null>(null),
    [replace, setReplace] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (failure) {
      if (useAuthStore.getState().user?.id === owner)
        setNotice(failure instanceof Error ? failure.message : 'Übertragung fehlgeschlagen');
    } finally {
      if (useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  };
  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-4"
      aria-label="Browserzustand übertragen"
    >
      <h3 className="font-semibold">Browserzustand und Domainwechsel</h3>
      <p className="text-sm text-muted-foreground">
        Entwürfe, fertige Uploadreferenzen und ausstehende Nachrichten auf einer anderen
        Plum-Adresse desselben Kontos übernehmen. Die neue Anmeldung erfolgt separat. Importierte
        Outbox-Nachrichten warten auf deine Prüfung.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const { identity, sessions } = await identityAndSessions();
              const drafts: Record<string, string> = {},
                preferences: Record<string, string> = {};
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)!;
                if (draftScope(key, identity, sessions)) drafts[key] = localStorage.getItem(key)!;
              }
              for (const key of PREFS) {
                const value = localStorage.getItem(key);
                if (value !== null) preferences[key] = value;
              }
              const outbox = socketService
                .getOutboxEntries()
                .filter((entry) => sessions.has(entry.sessionId))
                .map(({ sending: _sending, ...entry }) => entry);
              const data: BrowserExport = {
                format: 'plum-browser',
                version: 2,
                identity,
                origin: location.origin,
                exportedAt: new Date().toISOString(),
                drafts,
                preferences,
                outbox,
                assistantOutbox: validateAssistantDeliveries(assistantDeliveries()),
              };
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = 'plum-browser-transfer.json';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              setNotice(
                `${Object.keys(drafts).length} Entwürfe und ${outbox.length} Outbox-Einträge exportiert.`
              );
            })
          }
        >
          Browserzustand exportieren
        </Button>
        <label className="cursor-pointer rounded-md border px-3 py-2 text-sm">
          Übertragungsdatei prüfen
          <input
            className="sr-only"
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              void run(async () => {
                if (file.size > 12 * 1024 * 1024)
                  throw new Error('Übertragungsdatei überschreitet 12 MB');
                const data = JSON.parse(await file.text()) as BrowserExport;
                const { identity, sessions } = await identityAndSessions();
                if (
                  data.format !== 'plum-browser' ||
                  ![1, 2].includes(data.version) ||
                  data.identity?.userId !== identity.userId ||
                  data.identity?.instanceId !== identity.instanceId
                )
                  throw new Error(
                    'Diese Datei gehört nicht zu derselben Plum-Installation und demselben Konto'
                  );
                if (
                  !data.drafts ||
                  typeof data.drafts !== 'object' ||
                  Array.isArray(data.drafts) ||
                  !data.preferences ||
                  typeof data.preferences !== 'object' ||
                  !Array.isArray(data.outbox)
                )
                  throw new Error('Ungültige Übertragungsdatei');
                for (const [key, text] of Object.entries(data.drafts))
                  if (
                    !draftScope(key, identity, sessions) ||
                    typeof text !== 'string' ||
                    text.length > 40000
                  )
                    throw new Error('Entwurf enthält einen ungültigen Bezug oder zu langen Text');
                for (const [key, value] of Object.entries(data.preferences))
                  if (!PREFS.includes(key) || typeof value !== 'string' || value.length > 20000)
                    throw new Error('Nicht unterstützte Browsereinstellung');
                if (data.outbox.length > 500) throw new Error('Zu viele Outbox-Einträge');
                data.assistantOutbox = validateAssistantDeliveries(data.assistantOutbox ?? []);
                checkAssistantDeliveryImport(data.assistantOutbox);
                for (const entry of data.outbox)
                  if (
                    entry.version !== 1 ||
                    typeof entry.clientMessageId !== 'string' ||
                    entry.clientMessageId.length > 200 ||
                    !sessions.has(entry.sessionId) ||
                    typeof entry.message !== 'string' ||
                    entry.message.length > 40000 ||
                    (entry.chatId !== undefined &&
                      entry.chatId !== null &&
                      typeof entry.chatId !== 'string') ||
                    !Number.isInteger(entry.attempts) ||
                    typeof entry.createdAt !== 'string' ||
                    (entry.uploadIds !== undefined &&
                      (!Array.isArray(entry.uploadIds) ||
                        entry.uploadIds.some((id) => typeof id !== 'string' || id.length > 200)))
                  )
                    throw new Error('Outbox enthält einen ungültigen Eintrag');
                // Persist only known fields; imported JSON cannot inject runtime/outbox metadata.
                data.outbox = data.outbox.map((entry) => ({
                  version: 1,
                  clientMessageId: entry.clientMessageId,
                  sessionId: entry.sessionId,
                  chatId: entry.chatId ?? null,
                  message: entry.message,
                  ...(entry.activeFollowupMode === 'steer' || entry.activeFollowupMode === 'queue'
                    ? { activeFollowupMode: entry.activeFollowupMode }
                    : {}),
                  ...(entry.uploadIds ? { uploadIds: entry.uploadIds } : {}),
                  createdAt: entry.createdAt,
                  attempts: 0,
                  retryable: true,
                  requiresReview: true,
                }));
                if (useAuthStore.getState().user?.id !== identity.userId)
                  throw new Error('Konto wurde gewechselt');
                setIncoming(data);
                setNotice(
                  `${Object.keys(data.drafts).length} Entwürfe, ${data.outbox.length} Nachrichten und ${data.assistantOutbox.length} Assistenz-Zustellungen können übernommen werden.`
                );
              });
            }}
          />
        </label>
      </div>
      {incoming && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={replace}
              onChange={(event) => setReplace(event.target.checked)}
            />
            Abweichende lokale Entwürfe durch die importierte Fassung ersetzen
          </label>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { identity, sessions } = await identityAndSessions();
                if (
                  identity.userId !== incoming.identity.userId ||
                  identity.instanceId !== incoming.identity.instanceId
                )
                  throw new Error('Konto hat sich seit der Dateiprüfung geändert');
                // Outbox import checks transaction conflicts before any write and preserves the original IDs.
                const assistant = validateAssistantDeliveries(incoming.assistantOutbox ?? []);
                checkAssistantDeliveryImport(assistant);
                socketService.importOutboxEntries(
                  incoming.outbox.filter((entry) => sessions.has(entry.sessionId))
                );
                importAssistantDeliveries(assistant);
                let restored = 0,
                  kept = 0;
                for (const [key, text] of Object.entries(incoming.drafts)) {
                  if (!draftScope(key, identity, sessions)) continue;
                  const current = localStorage.getItem(key);
                  if (!replace && current !== null && current !== text) {
                    kept++;
                    continue;
                  }
                  localStorage.setItem(key, text);
                  restored++;
                }
                for (const [key, value] of Object.entries(incoming.preferences))
                  if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
                setIncoming(null);
                setNotice(
                  `${restored} Entwürfe übernommen, ${kept} lokale Konfliktfassungen behalten. Outbox öffnen und importierte Nachrichten vor dem Senden prüfen.`
                );
              })
            }
          >
            Geprüfte Datei übernehmen
          </Button>
          <Button
            variant="outline"
            onClick={() => window.dispatchEvent(new Event('plum:open-outbox'))}
          >
            Outbox öffnen
          </Button>
        </div>
      )}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const response = await api.download('/api/assistant/export?format=zip');
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'plum-assistant-export.zip';
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setNotice(
              'Kontodaten exportiert. Die Importbilanz und nicht verfügbare Medien stehen im Archivmanifest.'
            );
          })
        }
      >
        Gespräche, Versionen und Dateien exportieren
      </Button>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </section>
  );
}
