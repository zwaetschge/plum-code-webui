import { useMemo, useState } from 'react';
import { Check, RotateCcw, Search, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Chooses which of Pi's runnable models the session pickers offer. The stored
 * list (`cliProviderModelLists.pi`) keeps the default first; an empty list
 * offers every model, including ones a provider adds later. The backend
 * filters `/api/cli-providers` by the same list, so WebUI and app follow it.
 */
export function PiModelMenuPicker({
  models,
  stored,
  providerDefault,
  saving,
  onSave,
  groupLabels,
  searchLabel = 'Pi-Modell suchen',
}: {
  /** Every runnable model, `provider/model`. */
  models: string[];
  /** Display names of the provider groups (default: the provider id). */
  groupLabels?: Record<string, string>;
  searchLabel?: string;
  /** The stored pick; empty means every model. */
  stored: string[];
  providerDefault: string | null;
  saving: boolean;
  onSave: (list: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const available = useMemo(() => new Set(models), [models]);
  const picked = useMemo(() => stored.filter((model) => available.has(model)), [available, stored]);
  const customised = picked.length > 0;
  const visible = useMemo(
    () => new Set(customised ? picked : models),
    [customised, models, picked]
  );
  const defaultModel = customised
    ? picked[0]!
    : providerDefault && available.has(providerDefault)
      ? providerDefault
      : (models[0] ?? null);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byProvider = new Map<string, string[]>();
    for (const model of models) {
      if (needle && !model.toLowerCase().includes(needle)) continue;
      const slash = model.indexOf('/');
      const providerId = slash > 0 ? model.slice(0, slash) : 'other';
      byProvider.set(providerId, [...(byProvider.get(providerId) ?? []), model]);
    }
    return [...byProvider.entries()];
  }, [models, query]);

  /** Saves a selection with its default first, the rest in catalog order. */
  const save = (nextVisible: Set<string>, nextDefault: string | null) => {
    if (nextVisible.size === 0) return;
    const head = nextDefault && nextVisible.has(nextDefault) ? nextDefault : null;
    const rest = models.filter((model) => nextVisible.has(model) && model !== head);
    onSave(head ? [head, ...rest] : rest);
  };

  const toggle = (model: string) => {
    const next = new Set(visible);
    if (next.has(model)) {
      if (next.size === 1) return;
      next.delete(model);
    } else {
      next.add(model);
    }
    save(next, defaultModel && next.has(defaultModel) ? defaultModel : null);
  };

  const setGroup = (groupModels: string[], show: boolean) => {
    const next = new Set(visible);
    for (const model of groupModels) {
      if (show) next.add(model);
      else next.delete(model);
    }
    if (next.size === 0) return;
    save(next, defaultModel && next.has(defaultModel) ? defaultModel : null);
  };

  const makeDefault = (model: string) => {
    const next = new Set(visible);
    next.add(model);
    save(next, model);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium">Modelle im Auswahlmenü</p>
          <p className="text-xs text-muted-foreground">
            {customised
              ? `${visible.size} von ${models.length} Modellen erscheinen beim Anlegen und Wechseln. Der Stern markiert das Standardmodell.`
              : `Alle ${models.length} Modelle erscheinen, auch neu hinzukommende. Abwählen blendet ein Modell aus.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {customised && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => onSave([])}
              className="gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Alle anzeigen
            </Button>
          )}
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Modell suchen"
          className="h-9 pl-8 text-sm"
          aria-label={searchLabel}
        />
      </div>

      <div className="grid max-h-[520px] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
        {groups.map(([providerId, groupModels]) => {
          const shown = groupModels.filter((model) => visible.has(model)).length;
          const allShown = shown === groupModels.length;
          return (
            <div
              key={providerId}
              className="min-w-0 rounded-lg border border-border/70 bg-card/40 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">
                  {groupLabels?.[providerId] ?? providerId}
                </p>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {shown}/{groupModels.length}
                  </span>
                  <button
                    type="button"
                    disabled={saving || (allShown && shown === visible.size)}
                    onClick={() => setGroup(groupModels, !allShown)}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    {allShown ? 'Keine' : 'Alle'}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {groupModels.map((model) => {
                  const on = visible.has(model);
                  const isDefault = model === defaultModel;
                  const name = model.slice(model.indexOf('/') + 1);
                  return (
                    <div
                      key={model}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
                        on ? 'bg-muted/60' : 'bg-transparent opacity-60 hover:opacity-90'
                      )}
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`${model} im Menü ${on ? 'ausblenden' : 'anzeigen'}`}
                        disabled={saving || (on && visible.size === 1)}
                        onClick={() => toggle(model)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                            on
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border'
                          )}
                        >
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="truncate font-mono text-xs" title={model}>
                          {name}
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={saving || isDefault}
                        onClick={() => makeDefault(model)}
                        title={isDefault ? 'Standardmodell' : 'Als Standard setzen'}
                        aria-label={isDefault ? `${model} ist Standard` : `${model} als Standard`}
                        className={cn(
                          'shrink-0 rounded p-0.5',
                          isDefault
                            ? 'text-amber-500'
                            : 'text-muted-foreground/50 hover:text-foreground'
                        )}
                      >
                        <Star className={cn('h-3.5 w-3.5', isDefault && 'fill-current')} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">Kein Modell passt zur Suche.</p>
        )}
      </div>
    </div>
  );
}
