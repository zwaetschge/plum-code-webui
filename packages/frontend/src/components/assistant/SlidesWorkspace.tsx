import { useEffect, useRef, useState } from 'react';
import { parseAssistantSlides, type AssistantSlide } from '@plum-code-webui/shared';
import { Button } from '@/components/ui/button';

export function SlidesWorkspace({
  content,
  editing,
  onChange,
}: {
  content: string;
  editing: boolean;
  onChange: (content: string) => void;
}) {
  const [index, setIndex] = useState(0),
    [error, setError] = useState('');
  const presentation = useRef<HTMLDialogElement>(null);
  const [presenting, setPresenting] = useState(false),
    [showNotes, setShowNotes] = useState(false);
  useEffect(() => {
    presentation.current?.close();
    setPresenting(false);
  }, [content, editing]);
  useEffect(() => {
    setIndex(0);
    setError('');
  }, [editing]);
  let deck;
  try {
    deck = parseAssistantSlides(content);
  } catch {
    return <p role="alert">Präsentationsstruktur konnte nicht gelesen werden.</p>;
  }
  const selected = Math.min(index, deck.slides.length - 1),
    slide = deck.slides[selected]!;
  const change = (slides: AssistantSlide[]) => {
    try {
      const next = JSON.stringify(parseAssistantSlides(JSON.stringify({ ...deck, slides })));
      onChange(next);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Änderung fehlgeschlagen');
    }
  };
  const update = (patch: Partial<AssistantSlide>) =>
    change(deck.slides.map((item, i) => (i === selected ? { ...item, ...patch } : item)));
  const closePresentation = () => {
    if (document.fullscreenElement === presentation.current)
      void document.exitFullscreen().catch(() => {});
    presentation.current?.close();
    setPresenting(false);
  };
  return (
    <div className="min-w-0 space-y-4" aria-label="Folienworkspace">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!selected}
          onClick={() => setIndex(selected - 1)}
        >
          Vorige Folie
        </Button>
        <span className="text-sm" aria-live="polite">
          Folie {selected + 1} / {deck.slides.length}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={selected === deck.slides.length - 1}
          onClick={() => setIndex(selected + 1)}
        >
          Nächste Folie
        </Button>
        {!editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowNotes(false);
              presentation.current?.showModal();
              setPresenting(true);
            }}
          >
            Präsentieren
          </Button>
        )}
        {editing && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={deck.slides.length >= 200}
              onClick={() => {
                change([
                  ...deck.slides,
                  { title: 'Neue Folie', layout: 'bullets', text: '', secondary: '', notes: '' },
                ]);
                setIndex(deck.slides.length);
              }}
            >
              Folie hinzufügen
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={deck.slides.length === 1}
              onClick={() => {
                change(deck.slides.filter((_, i) => i !== selected));
                setIndex(Math.max(0, selected - 1));
              }}
            >
              Folie entfernen
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!selected}
              onClick={() => {
                const slides = [...deck.slides];
                [slides[selected - 1], slides[selected]] = [
                  slides[selected]!,
                  slides[selected - 1]!,
                ];
                change(slides);
                setIndex(selected - 1);
              }}
            >
              Folie nach vorne
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {editing ? (
        <div className="space-y-3">
          <label className="block text-sm">
            Folientitel
            <input
              aria-label="Folientitel"
              className="mt-1 w-full rounded-md border bg-background p-2"
              maxLength={200}
              value={slide.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Folienlayout
            <select
              aria-label="Folienlayout"
              className="mt-1 w-full rounded-md border bg-background p-2"
              value={slide.layout}
              onChange={(e) => update({ layout: e.target.value as AssistantSlide['layout'] })}
            >
              <option value="title">Titel und Text</option>
              <option value="bullets">Aufzählung</option>
              <option value="columns">Zwei Spalten</option>
            </select>
          </label>
          {(['text', 'secondary', 'notes'] as const).map((key) => (
            <label key={key} className="block text-sm">
              {
                {
                  text: 'Folieninhalt',
                  secondary: 'Zweite Spalte / Zusatz',
                  notes: 'Sprechernotizen',
                }[key]
              }
              <textarea
                aria-label={
                  {
                    text: 'Folieninhalt',
                    secondary: 'Zweite Spalte / Zusatz',
                    notes: 'Sprechernotizen',
                  }[key]
                }
                className="mt-1 min-h-24 w-full rounded-md border bg-background p-2"
                maxLength={10000}
                value={slide[key]}
                onChange={(e) => update({ [key]: e.target.value })}
              />
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            Jede Inhaltszeile ergibt einen Aufzählungspunkt. Notizen werden separat im PowerPoint
            gespeichert und in der PDF-Folie ausgeblendet. Importierte Bilder und Speziallayouts
            bleiben im Original.
          </p>
        </div>
      ) : (
        <>
          <SlidePreview slide={slide} number={selected + 1} />
          {slide.notes && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Sprechernotizen</summary>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm">{slide.notes}</p>
            </details>
          )}
        </>
      )}
      <dialog
        ref={presentation}
        aria-label="Präsentation"
        onClose={() => setPresenting(false)}
        onCancel={closePresentation}
        onKeyDown={(event) => {
          if (['ArrowRight', 'PageDown'].includes(event.key)) {
            event.preventDefault();
            setIndex(Math.min(selected + 1, deck.slides.length - 1));
          } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
            event.preventDefault();
            setIndex(Math.max(selected - 1, 0));
          } else if (event.key === 'Home') {
            event.preventDefault();
            setIndex(0);
          } else if (event.key === 'End') {
            event.preventDefault();
            setIndex(deck.slides.length - 1);
          }
        }}
        className="m-auto h-[95dvh] max-h-none w-[96vw] max-w-none overflow-auto rounded-lg border bg-background p-3 font-sans text-foreground backdrop:bg-black/80 sm:p-6"
      >
        {presenting && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!selected}
                onClick={() => setIndex(selected - 1)}
              >
                Zurück
              </Button>
              <span aria-live="polite">
                Folie {selected + 1} / {deck.slides.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={selected === deck.slides.length - 1}
                onClick={() => setIndex(selected + 1)}
              >
                Weiter
              </Button>
              {document.fullscreenEnabled && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const element = presentation.current;
                    if (document.fullscreenElement === element)
                      void document
                        .exitFullscreen()
                        .catch(() => setError('Vollbild konnte nicht beendet werden'));
                    else
                      void element
                        ?.requestFullscreen()
                        .catch(() => setError('Vollbild ist hier nicht verfügbar'));
                  }}
                >
                  Vollbild
                </Button>
              )}
              <Button size="sm" onClick={closePresentation}>
                Präsentation beenden
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Pfeiltasten oder Bild auf/ab wechseln die Folie. Escape schliesst die Ansicht.
            </p>
            <SlidePreview slide={slide} number={selected + 1} />
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={showNotes}
                onChange={(e) => setShowNotes(e.target.checked)}
              />
              Sprechernotizen anzeigen
            </label>
            {showNotes && (
              <p className="whitespace-pre-wrap break-words text-sm">
                {slide.notes || 'Keine Sprechernotizen für diese Folie.'}
              </p>
            )}
          </div>
        )}
      </dialog>
    </div>
  );
}

function SlidePreview({ slide, number }: { slide: AssistantSlide; number: number }) {
  return (
    <article
      aria-label={`Folienvorschau ${number}`}
      className="min-h-60 overflow-hidden rounded-lg border bg-card p-5 sm:p-8"
    >
      <h2 className="mb-5 break-words text-xl font-semibold sm:text-3xl">{slide.title}</h2>
      <div
        className={slide.layout === 'columns' ? 'grid min-w-0 gap-5 sm:grid-cols-2' : 'space-y-5'}
      >
        {slide.layout === 'bullets' ? (
          <ul className="list-disc space-y-2 break-words pl-6">
            {slide.text.split('\n').map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="whitespace-pre-wrap break-words">{slide.text}</p>
        )}
        {slide.secondary && <p className="whitespace-pre-wrap break-words">{slide.secondary}</p>}
      </div>
    </article>
  );
}
