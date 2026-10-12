import { api, ApiError } from './api';
import { useAuthStore } from '@/stores/authStore';
export interface AssistantDelivery {
  id: string;
  path: string;
  payload: Record<string, unknown>;
  label: string;
  createdAt: string;
  error?: string;
  expiresAt?: string;
}
const prefix = 'plum.assistant.outbox.v1:';
const account = () => useAuthStore.getState().user?.id;
const key = () => {
  const id = account();
  if (!id) throw new Error('Anmeldung erforderlich');
  return prefix + id;
};
const permitted = (path: string) =>
  /^\/api\/assistant\/(api-chats|sources\/import-url|sources\/[-\w]+\/(watch|refresh)|tasks\/[-\w]+\/(commands|image-edit|results)|artifacts\/comparison|artifacts\/[-\w]+\/(run|notebook|image-edit|analysis-task)|api-chats\/[-\w]+\/(turns|branches|results|selection)|matrix\/rooms\/[^/]+\/events)$/.test(
    path
  );
export function assistantDeliveries(): AssistantDelivery[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key()) || '[]');
    const entries = Array.isArray(data)
      ? data.filter(
          (entry) =>
            entry &&
            typeof entry.id === 'string' &&
            typeof entry.path === 'string' &&
            permitted(entry.path) &&
            entry.payload?.commandId === entry.id &&
            typeof entry.label === 'string' &&
            (!entry.expiresAt ||
              (typeof entry.expiresAt === 'string' && Date.parse(entry.expiresAt) > Date.now()))
        )
      : [];
    if (Array.isArray(data) && entries.length !== data.length)
      localStorage.setItem(key(), JSON.stringify(entries));
    return entries;
  } catch {
    return [];
  }
}
function persist(entries: AssistantDelivery[]) {
  localStorage.setItem(key(), JSON.stringify(entries));
  window.dispatchEvent(new Event('plum:assistant-outbox'));
}
export function discardAssistantDelivery(id: string) {
  persist(assistantDeliveries().filter((entry) => entry.id !== id));
}
export function validateAssistantDeliveries(input: unknown): AssistantDelivery[] {
  if (!Array.isArray(input) || input.length > 100)
    throw new Error('Zu viele Assistenz-Zustellungen');
  const ids = new Set<string>();
  return input
    .map((value: unknown) => {
      if (!value || typeof value !== 'object') throw new Error('Ungültige Assistenz-Zustellung');
      const entry = value as AssistantDelivery;
      if (
        typeof entry.id !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
          entry.id
        ) ||
        ids.has(entry.id) ||
        typeof entry.path !== 'string' ||
        !permitted(entry.path) ||
        !entry.payload ||
        typeof entry.payload !== 'object' ||
        Array.isArray(entry.payload) ||
        entry.payload.commandId !== entry.id ||
        JSON.stringify(entry.payload).length > 100000 ||
        typeof entry.label !== 'string' ||
        entry.label.length > 200 ||
        typeof entry.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(entry.createdAt)) ||
        (entry.expiresAt !== undefined &&
          (typeof entry.expiresAt !== 'string' || !Number.isFinite(Date.parse(entry.expiresAt))))
      )
        throw new Error('Ungültiger Zielaufruf oder Inhalt in der Assistenz-Outbox');
      ids.add(entry.id);
      const expiresAt =
        entry.payload.temporary === true
          ? new Date(
              Math.min(
                Date.parse(entry.createdAt) + 86400000,
                entry.expiresAt ? Date.parse(entry.expiresAt) : Infinity
              )
            ).toISOString()
          : entry.expiresAt;
      return {
        id: entry.id,
        path: entry.path,
        payload: entry.payload,
        label: entry.label,
        createdAt: entry.createdAt,
        ...(expiresAt ? { expiresAt } : {}),
      };
    })
    .filter((entry) => !entry.expiresAt || Date.parse(entry.expiresAt) > Date.now());
}
export function checkAssistantDeliveryImport(entries: AssistantDelivery[]) {
  const current = assistantDeliveries();
  for (const entry of entries) {
    const existing = current.find((row) => row.id === entry.id);
    if (
      existing &&
      (existing.path !== entry.path ||
        JSON.stringify(existing.payload) !== JSON.stringify(entry.payload))
    )
      throw new Error(
        'Eine lokale Assistenz-Befehlskennung hat einen anderen Inhalt. Zuerst die lokale Outbox prüfen.'
      );
  }
  if (new Set([...current, ...entries].map((entry) => entry.id)).size > 100)
    throw new Error('Zu viele Assistenz-Zustellungen');
}
export function importAssistantDeliveries(input: unknown) {
  const entries = validateAssistantDeliveries(input);
  checkAssistantDeliveryImport(entries);
  persist([
    ...new Map([...assistantDeliveries(), ...entries].map((entry) => [entry.id, entry])).values(),
  ]);
  // No request starts here: every imported action waits for explicit review.
}
const sending = new Map<string, Promise<unknown>>();
export async function retryAssistantDelivery(entry: AssistantDelivery) {
  const user = account();
  if (!user) throw new Error('Anmeldung erforderlich');
  if (
    !assistantDeliveries().some(
      (owned) =>
        owned.id === entry.id &&
        owned.path === entry.path &&
        JSON.stringify(owned.payload) === JSON.stringify(entry.payload)
    )
  )
    throw new Error('Diese Zustellung gehört nicht zur aktiven Konto-Outbox.');
  if (sending.has(entry.id)) return sending.get(entry.id);
  const request = (async () => {
    try {
      const result = await api.post(entry.path, entry.payload);
      if (account() === user) discardAssistantDelivery(entry.id);
      return result;
    } catch (failure) {
      if (account() === user) {
        // Definitive client errors are reviewed as an error; network/5xx keeps the original transaction.
        if (
          failure instanceof ApiError &&
          failure.status >= 400 &&
          failure.status < 500 &&
          failure.status !== 408 &&
          failure.status !== 429
        )
          discardAssistantDelivery(entry.id);
        else
          persist(
            assistantDeliveries().map((row) =>
              row.id === entry.id
                ? {
                    ...row,
                    error: failure instanceof Error ? failure.message : 'Zustellung unbestätigt',
                  }
                : row
            )
          );
      }
      throw failure;
    } finally {
      sending.delete(entry.id);
    }
  })();
  sending.set(entry.id, request);
  return request;
}
export async function deliverAssistant(
  path: string,
  payload: Record<string, unknown>,
  label: string,
  options?: { expiresAt?: string }
) {
  if (!permitted(path)) throw new Error('Dieser Aufruf unterstützt keine dauerhafte Zustellung');
  const { commandId: _discard, ...body } = payload;
  void _discard;
  const pending = assistantDeliveries().find((entry) => entry.path === path);
  if (pending) {
    const { commandId: _id, ...prior } = pending.payload;
    void _id;
    if (JSON.stringify(prior) !== JSON.stringify(body))
      throw new Error(
        'Für dieses Ziel ist eine Zustellung unbestätigt. Prüfe sie in der Assistenz-Outbox, bevor du einen anderen Inhalt sendest.'
      );
    return retryAssistantDelivery(pending);
  }
  const id = crypto.randomUUID(),
    entry = {
      id,
      path,
      payload: { ...body, commandId: id },
      label,
      createdAt: new Date().toISOString(),
      ...(options?.expiresAt || body.temporary === true
        ? { expiresAt: options?.expiresAt ?? new Date(Date.now() + 86400000).toISOString() }
        : {}),
    };
  persist([...assistantDeliveries(), entry]);
  return retryAssistantDelivery(entry);
}
