import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Server,
  Trash2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '@plum-code-webui/shared';

/** A registry entry as the backend returns it; the key itself never leaves the server. */
interface ModelProvider {
  id: string;
  name: string;
  hasKey: boolean;
  envVars?: string[];
  baseUrl?: string;
  enabled: boolean;
  /** Models this endpoint serves beyond what the shared catalog already knows. */
  models?: string[];
  /** False keeps the provider (models and key) out of Pi; model chat still uses it. */
  pi?: boolean;
}

interface CatalogProvider {
  name: string;
  models?: string[];
  env?: string[];
  api?: string;
}

interface ProviderTestResult {
  connected: boolean;
  message: string;
  envVars?: string[];
  modelCount?: number;
}

interface FormState {
  id: string;
  name: string;
  nameTouched: boolean;
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  pi: boolean;
  models: string[];
  modelDraft: string;
}

const BASE_PATH = '/api/model-providers';
const PROVIDERS_KEY = ['model-providers'] as const;
const CATALOG_KEY = ['model-providers-catalog'] as const;

function emptyForm(): FormState {
  return {
    id: '',
    name: '',
    nameTouched: false,
    apiKey: '',
    baseUrl: '',
    enabled: true,
    pi: true,
    models: [],
    modelDraft: '',
  };
}

function formFrom(provider: ModelProvider): FormState {
  return {
    id: provider.id,
    name: provider.name,
    nameTouched: true,
    apiKey: '',
    baseUrl: provider.baseUrl ?? '',
    enabled: provider.enabled,
    pi: provider.pi !== false,
    models: provider.models ?? [],
    modelDraft: '',
  };
}

/** Model ids in the registry are stored without the provider prefix. */
function normalizeModelId(providerId: string, value: string): string {
  const trimmed = value.trim();
  const prefix = `${providerId.trim()}/`;
  return prefix.length > 1 && trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

/**
 * Settings → Modellanbieter: the per-user registry of API keys, base URLs and
 * model lists. Pi, model chat, voice and the Mistral plan usage all read it, so
 * it is managed here once instead of per harness. Keys are write-only.
 */
export function ModelProvidersPanel() {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [editing, setEditing] = useState<ModelProvider | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ProviderTestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ModelProvider | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const { data: providers = [], isLoading } = useQuery({
    queryKey: PROVIDERS_KEY,
    queryFn: async () => {
      const response = await api.get<ApiResponse<ModelProvider[]>>(`${BASE_PATH}/providers`);
      return response.data.data ?? [];
    },
  });

  const { data: catalog = {} } = useQuery({
    queryKey: CATALOG_KEY,
    queryFn: async () => {
      const response = await api.get<ApiResponse<Record<string, CatalogProvider>>>(
        `${BASE_PATH}/available-providers`
      );
      return response.data.data ?? {};
    },
    staleTime: 5 * 60_000,
  });

  const catalogIds = useMemo(
    () => Object.keys(catalog).sort((a, b) => a.localeCompare(b)),
    [catalog]
  );

  const refreshDependents = () => {
    void queryClient.invalidateQueries({ queryKey: PROVIDERS_KEY });
    void queryClient.invalidateQueries({ queryKey: CATALOG_KEY });
    // Setup readiness, Pi's model menu and the session pickers derive from the registry.
    void queryClient.invalidateQueries({ queryKey: ['setup-status'] });
    void queryClient.invalidateQueries({ queryKey: ['provider-diagnostics'] });
    void queryClient.invalidateQueries({ queryKey: ['cli-providers'] });
  };

  const save = useMutation({
    mutationFn: async (state: FormState) => {
      const id = state.id.trim();
      const response = await api.put<ApiResponse<ModelProvider>>(`${BASE_PATH}/providers`, {
        id,
        name: state.name.trim() || catalog[id]?.name || id,
        ...(state.apiKey.trim() ? { apiKey: state.apiKey.trim() } : {}),
        ...(state.baseUrl.trim() ? { baseUrl: state.baseUrl.trim() } : {}),
        enabled: state.enabled,
        pi: state.pi,
        models: state.models,
      });
      return response.data.data;
    },
    onSuccess: () => {
      setEditing(null);
      refreshDependents();
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : 'Speichern fehlgeschlagen.'),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`${BASE_PATH}/providers/${encodeURIComponent(id)}`);
      return id;
    },
    onSuccess: (id) => {
      setRemoving(null);
      setResults((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      refreshDependents();
    },
    onError: (error) =>
      setRemoveError(error instanceof Error ? error.message : 'Entfernen fehlgeschlagen.'),
  });

  const runTest = async (id: string) => {
    setTesting(id);
    try {
      const response = await api.post<ApiResponse<ProviderTestResult>>(
        `${BASE_PATH}/providers/${encodeURIComponent(id)}/test`
      );
      const result = response.data.data ?? {
        connected: false,
        message: 'Keine Antwort vom Server.',
      };
      setResults((current) => ({ ...current, [id]: result }));
    } catch (error) {
      setResults((current) => ({
        ...current,
        [id]: {
          connected: false,
          message: error instanceof Error ? error.message : 'Test fehlgeschlagen.',
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const openForm = (target: ModelProvider | 'new') => {
    setEditing(target);
    setForm(target === 'new' ? emptyForm() : formFrom(target));
    setFormError(null);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const setProviderId = (value: string) =>
    setForm((current) => {
      const known = catalog[value.trim()];
      return {
        ...current,
        id: value,
        name: current.nameTouched ? current.name : (known?.name ?? ''),
      };
    });

  const addModel = () =>
    setForm((current) => {
      const model = normalizeModelId(current.id, current.modelDraft);
      if (!model || current.models.includes(model)) return { ...current, modelDraft: '' };
      return { ...current, models: [...current.models, model], modelDraft: '' };
    });

  const onModelKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addModel();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const id = form.id.trim();
    if (!id) {
      setFormError('Die Anbieter-ID fehlt.');
      return;
    }
    const isNew = editing === 'new';
    if (isNew && providers.some((provider) => provider.id === id)) {
      setFormError(`„${id}“ ist schon eingerichtet.`);
      return;
    }
    if (isNew && !form.apiKey.trim()) {
      setFormError('Gib einen API-Key ein.');
      return;
    }
    const draft = normalizeModelId(id, form.modelDraft);
    save.mutate({
      ...form,
      models: draft && !form.models.includes(draft) ? [...form.models, draft] : form.models,
    });
  };

  const editingProvider = editing && editing !== 'new' ? editing : null;
  const formCatalog = catalog[form.id.trim()];
  const catalogModels = formCatalog?.models ?? [];
  const modelSuggestions = catalogModels.filter((model) => !form.models.includes(model));
  const providerListId = `${fieldId}-providers`;
  const modelListId = `${fieldId}-models`;

  const formNode = (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-card px-3 py-3">
      <p className="text-sm font-medium">
        {editingProvider ? `${editingProvider.name} bearbeiten` : 'Neuer Modellanbieter'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-id`}>Anbieter-ID</Label>
          <Input
            id={`${fieldId}-id`}
            value={form.id}
            onChange={(event) => setProviderId(event.target.value)}
            list={providerListId}
            placeholder="z-ai"
            readOnly={Boolean(editingProvider)}
            autoComplete="off"
            spellCheck={false}
            className={cn('font-mono', editingProvider && 'text-muted-foreground')}
          />
          <datalist id={providerListId}>
            {catalogIds.map((id) => (
              <option key={id} value={id}>
                {catalog[id]?.name}
              </option>
            ))}
          </datalist>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-name`}>Name</Label>
          <Input
            id={`${fieldId}-name`}
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                name: event.target.value,
                nameTouched: true,
              }))
            }
            placeholder={formCatalog?.name || 'Z.AI'}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-key`}>{editingProvider ? 'Neuer API-Key' : 'API-Key'}</Label>
          <Input
            id={`${fieldId}-key`}
            type="password"
            value={form.apiKey}
            onChange={(event) => set('apiKey', event.target.value)}
            placeholder={editingProvider?.hasKey ? 'Gespeicherter Key bleibt' : undefined}
            autoComplete="new-password"
            className="font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-url`}>Base-URL</Label>
          <Input
            id={`${fieldId}-url`}
            value={form.baseUrl}
            onChange={(event) => set('baseUrl', event.target.value)}
            placeholder={formCatalog?.api || 'https://api.example.com/v1'}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label htmlFor={`${fieldId}-model`}>Modelle</Label>
          {catalogModels.length > 0 && (
            <span className="text-xs text-muted-foreground">
              + {catalogModels.length} aus dem Katalog
            </span>
          )}
        </div>
        {form.models.length > 0 && (
          <ul className="flex min-w-0 flex-wrap gap-1.5">
            {form.models.map((model) => (
              <li
                key={model}
                title={model}
                className="flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border bg-muted/50 py-0.5 pl-2 pr-1 font-mono text-xs"
              >
                <span className="min-w-0 truncate">{model}</span>
                <button
                  type="button"
                  aria-label={`${model} entfernen`}
                  onClick={() =>
                    set(
                      'models',
                      form.models.filter((entry) => entry !== model)
                    )
                  }
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            id={`${fieldId}-model`}
            value={form.modelDraft}
            onChange={(event) => set('modelDraft', event.target.value)}
            onKeyDown={onModelKeyDown}
            list={modelListId}
            placeholder={catalogModels[0] ?? 'modell-id'}
            autoComplete="off"
            spellCheck={false}
            className="h-9 font-mono text-xs"
          />
          <datalist id={modelListId}>
            {modelSuggestions.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addModel}
            disabled={!form.modelDraft.trim()}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Hinzufügen
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id={`${fieldId}-enabled`}
          checked={form.enabled}
          onCheckedChange={(checked) => set('enabled', checked)}
        />
        <Label htmlFor={`${fieldId}-enabled`}>Aktiv</Label>
        <Switch
          id={`${fieldId}-pi`}
          className="ml-4"
          checked={form.pi}
          onCheckedChange={(checked) => set('pi', checked)}
        />
        <Label htmlFor={`${fieldId}-pi`}>In Pi</Label>
      </div>

      {formError && (
        <p role="alert" className="text-xs text-destructive">
          {formError}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          <KeyRound className="mr-1 h-3.5 w-3.5" />
          {save.isPending ? 'Speichern …' : 'Speichern'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setEditing(null)}
          disabled={save.isPending}
        >
          Abbrechen
        </Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lade Modellanbieter …
        </p>
      ) : providers.length === 0 && editing === null ? (
        <p className="text-sm text-muted-foreground">Noch kein Modellanbieter eingerichtet.</p>
      ) : null}

      <ul className="space-y-2">
        {providers.map((provider) => {
          const known = catalog[provider.id];
          const modelCount = new Set([...(provider.models ?? []), ...(known?.models ?? [])]).size;
          const result = results[provider.id];
          return (
            <li key={provider.id} className="rounded-lg border border-border px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{provider.name}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{provider.id}</code>
                {!provider.enabled && (
                  <span className="rounded-full border border-border px-2 text-[11px] text-muted-foreground">
                    deaktiviert
                  </span>
                )}
                {provider.enabled && provider.pi === false && (
                  <span className="rounded-full border border-border px-2 text-[11px] text-muted-foreground">
                    nicht in Pi
                  </span>
                )}
                <div className="ml-auto flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void runTest(provider.id)}
                    disabled={testing === provider.id}
                  >
                    {testing === provider.id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="mr-1 h-3.5 w-3.5" />
                    )}
                    Testen
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`${provider.name} bearbeiten`}
                    aria-expanded={editingProvider?.id === provider.id}
                    onClick={() =>
                      editingProvider?.id === provider.id ? setEditing(null) : openForm(provider)
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`${provider.name} entfernen`}
                    onClick={() => {
                      setRemoveError(null);
                      setRemoving(provider);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span
                  className={cn(
                    'inline-flex items-center gap-1',
                    !provider.hasKey && 'text-destructive'
                  )}
                >
                  <KeyRound className="h-3 w-3" />
                  {provider.hasKey ? 'Key hinterlegt' : 'Kein Key'}
                </span>
                <span>{modelCount === 1 ? '1 Modell' : `${modelCount} Modelle`}</span>
                {(provider.baseUrl || known?.api) && (
                  <span className="min-w-0 truncate font-mono">
                    {provider.baseUrl || known?.api}
                  </span>
                )}
              </p>
              {result && (
                <p
                  role="status"
                  className={cn(
                    'mt-1 flex items-start gap-1.5 break-words text-xs',
                    result.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                  )}
                >
                  {result.connected ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>{result.message}</span>
                </p>
              )}
              {editingProvider?.id === provider.id && <div className="mt-3">{formNode}</div>}
            </li>
          );
        })}
      </ul>

      {editing === null ? (
        <Button type="button" size="sm" onClick={() => openForm('new')}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Modellanbieter hinzufügen
        </Button>
      ) : editing === 'new' ? (
        formNode
      ) : null}

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{removing?.name} entfernen?</DialogTitle>
            <DialogDescription>
              Key, Base-URL und Modellliste werden gelöscht. Pi, Chat und Voice verlieren den
              Zugriff auf diesen Anbieter.
            </DialogDescription>
          </DialogHeader>
          {removeError && (
            <p role="alert" className="text-sm text-destructive">
              {removeError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRemoving(null)}
              disabled={remove.isPending}
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => removing && remove.mutate(removing.id)}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Entfernen …' : 'Entfernen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ModelProvidersPanel;
