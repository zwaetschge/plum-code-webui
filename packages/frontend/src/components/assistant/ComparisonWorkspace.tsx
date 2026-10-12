import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  parseAssistantComparison,
  type AssistantResource,
  type AssistantOffer,
} from '@plum-code-webui/shared';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { deliverAssistant } from '@/services/assistantOutbox';
import { Button } from '@/components/ui/button';
import { ResourcePicker } from './ResourcePicker';
export function ComparisonStarter({
  onCreated,
}: {
  onCreated: (artifact: AssistantResource) => void;
}) {
  const [title, setTitle] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <section aria-label="Produktvergleich erstellen" className="space-y-3 rounded-md border p-4">
      <h3 className="font-medium">Produktvergleich</h3>
      <label className="block text-sm">
        Vergleichstitel
        <input
          aria-label="Vergleichstitel"
          className="mt-1 w-full rounded-md border bg-background p-2"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <Button
        disabled={busy || !title.trim()}
        onClick={async () => {
          const owner = useAuthStore.getState().user?.id;
          setBusy(true);
          setError('');
          try {
            const result = (await deliverAssistant(
              '/api/assistant/artifacts/comparison',
              { title: title.trim() },
              'Produktvergleich erstellen'
            )) as { data: { data: AssistantResource } };
            if (useAuthStore.getState().user?.id === owner) {
              onCreated(result.data.data);
              setTitle('');
            }
          } catch (e) {
            if (useAuthStore.getState().user?.id === owner)
              setError(e instanceof Error ? e.message : 'Erstellen fehlgeschlagen');
          } finally {
            if (useAuthStore.getState().user?.id === owner) setBusy(false);
          }
        }}
      >
        {busy ? 'Wird erstellt …' : 'Vergleich erstellen'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Angebote zuerst als Webquelle speichern, dann Preis und Originalauszug in den Vergleich
        übernehmen.
      </p>
    </section>
  );
}
export function ComparisonWorkspace({
  content,
  editing,
  onChange,
}: {
  content: string;
  editing: boolean;
  onChange: (content: string) => void;
}) {
  const [ids, setIds] = useState<string[]>([]),
    [source, setSource] = useState<AssistantResource | null>(null),
    [name, setName] = useState(''),
    [price, setPrice] = useState(''),
    [quote, setQuote] = useState(''),
    [details, setDetails] = useState(''),
    [error, setError] = useState('');
  const owner = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    let current = true;
    setSource(null);
    if (ids[0])
      void api
        .get<{ data: AssistantResource }>(`/api/assistant/sources/${encodeURIComponent(ids[0])}`)
        .then((r) => {
          if (current) setSource(r.data.data);
        })
        .catch((e) => {
          if (current) setError(e instanceof Error ? e.message : 'Quelle nicht gefunden');
        });
    return () => {
      current = false;
    };
  }, [ids, owner]);
  let comparison;
  try {
    comparison = parseAssistantComparison(content);
  } catch {
    return <p role="alert">Vergleichsstruktur konnte nicht gelesen werden.</p>;
  }
  const change = (offers: AssistantOffer[], decision = comparison.decision) => {
    try {
      onChange(
        JSON.stringify(
          parseAssistantComparison(JSON.stringify({ ...comparison, offers, decision }))
        )
      );
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Änderung fehlgeschlagen');
    }
  };
  return (
    <section aria-label="Produktvergleich" className="min-w-0 space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {editing && (
        <div className="space-y-3 rounded-md border p-3">
          <ResourcePicker
            label="Angebotsquelle"
            value={ids}
            onChange={setIds}
            kind="source"
            maximum={1}
          />
          {source && (
            <details>
              <summary className="cursor-pointer text-sm">
                Originaltext · Revision {source.revision}
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
                {String(source.body.text ?? '')}
              </pre>
            </details>
          )}
          {(
            [
              ['Produktname', name, setName],
              ['Preis wie im Original', price, setPrice],
              ['Originalauszug mit Preis', quote, setQuote],
              ['Eigene Kriterien / Notizen', details, setDetails],
            ] as const
          ).map(([label, value, setter]) => (
            <label className="block text-sm" key={label}>
              {label}
              <textarea
                aria-label={label}
                className="mt-1 min-h-16 w-full rounded-md border bg-background p-2"
                value={value}
                maxLength={
                  label === 'Produktname' ? 200 : label === 'Preis wie im Original' ? 120 : 4000
                }
                onChange={(e) => setter(e.target.value)}
              />
            </label>
          ))}
          <Button
            size="sm"
            disabled={
              !source?.body.url ||
              comparison.offers.length >= 50 ||
              !name.trim() ||
              !price.trim() ||
              !quote.trim()
            }
            onClick={() => {
              if (!source) return;
              if (!String(source.body.text ?? '').includes(quote) || !quote.includes(price)) {
                setError('Preis und Auszug müssen exakt im Originaltext stehen.');
                return;
              }
              const next: AssistantOffer = {
                id: crypto.randomUUID(),
                name: name.trim(),
                price,
                url: String(source.body.url),
                asOf: String(source.body.ingestedAt ?? source.updatedAt),
                sourceId: source.id,
                sourceRevision: source.revision,
                quote,
                details,
                favorite: false,
              };
              try {
                parseAssistantComparison(
                  JSON.stringify({ ...comparison, offers: [...comparison.offers, next] })
                );
                change([...comparison.offers, next]);
                setName('');
                setPrice('');
                setQuote('');
                setDetails('');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Angebot konnte nicht übernommen werden');
              }
            }}
          >
            Angebot übernehmen
          </Button>
          {!!source && !source.body.url && (
            <p className="text-sm text-muted-foreground">
              Diese Quelle hat keinen Angebotslink. Eine gespeicherte Webquelle auswählen.
            </p>
          )}
        </div>
      )}
      {!comparison.offers.length && (
        <p className="text-sm text-muted-foreground">
          Noch keine Angebote. Bearbeiten öffnen und Quellenstände übernehmen.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {comparison.offers.map((offer) => (
          <article className="min-w-0 space-y-3 rounded-lg border bg-card p-4" key={offer.id}>
            <h3 className="break-words font-semibold">
              {offer.name}
              {offer.favorite ? ' ★' : ''}
            </h3>
            <p className="text-lg font-semibold">{offer.price}</p>
            <p className="text-xs text-muted-foreground">
              Quellenstand: {new Date(offer.asOf).toLocaleString('de-CH')} · Revision{' '}
              {offer.sourceRevision}
            </p>
            <a
              className="inline-block text-sm underline"
              href={offer.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Originalangebot öffnen
            </a>
            <Link
              className="ml-3 inline-block text-sm underline"
              to={`/assistant/sources?resource=${encodeURIComponent(offer.sourceId)}&revision=${offer.sourceRevision}`}
            >
              Gespeicherter Beleg
            </Link>
            <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">
              {offer.quote}
            </blockquote>
            <p className="whitespace-pre-wrap break-words text-sm">{offer.details}</p>
            {editing && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={offer.favorite}
                  aria-label={`${offer.name} als Favorit`}
                  onClick={() =>
                    change(
                      comparison.offers.map((o) =>
                        o.id === offer.id ? { ...o, favorite: !o.favorite } : o
                      )
                    )
                  }
                >
                  Favorit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${offer.name} entfernen`}
                  onClick={() => change(comparison.offers.filter((o) => o.id !== offer.id))}
                >
                  Entfernen
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
      {editing ? (
        <label className="block text-sm">
          Eigene Entscheidung
          <textarea
            aria-label="Eigene Entscheidung"
            className="mt-1 min-h-24 w-full rounded-md border bg-background p-2"
            maxLength={10000}
            value={comparison.decision}
            onChange={(e) => change(comparison.offers, e.target.value)}
          />
        </label>
      ) : (
        comparison.decision && (
          <div>
            <h3 className="font-medium">Eigene Entscheidung</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{comparison.decision}</p>
          </div>
        )
      )}
      <p className="text-xs text-muted-foreground">
        Preise stammen aus den gespeicherten Quellenständen. Ein neuer Abruf verändert bestehende
        Vergleichsangebote nicht; aktualisierte Stände werden separat übernommen.
      </p>
    </section>
  );
}
