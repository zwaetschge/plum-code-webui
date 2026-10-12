import { useEffect, useRef, useState } from 'react';
import type { AssistantApiImage, AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { deliverAssistant } from '@/services/assistantOutbox';
import { Button } from '@/components/ui/button';

type Rectangle = { x: number; y: number; width: number; height: number };
export function ImageEditTask({
  task,
  image,
  onCreated,
  onClose,
}: {
  task: AssistantResource;
  image: AssistantApiImage;
  onCreated: (task: AssistantResource) => void;
  onClose: () => void;
}) {
  const owner = useAuthStore((s) => s.user?.id),
    mounted = useRef(true);
  const collection = task.kind === 'artifact' ? 'artifacts' : 'tasks';
  const [url, setUrl] = useState(''),
    [ratio, setRatio] = useState(1),
    [prompt, setPrompt] = useState(''),
    [mode, setMode] = useState<'edit' | 'inpaint'>('inpaint');
  const [rectangles, setRectangles] = useState<Rectangle[]>([]),
    [draft, setDraft] = useState<Rectangle | null>(null);
  const [coordinates, setCoordinates] = useState({ x: '10', y: '10', width: '30', height: '30' });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const origin = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let objectUrl = '';
    void api
      .download(
        `/api/assistant/${collection}/${task.id}/images/${image.id}?revision=${task.revision}`,
        {
          signal: controller.signal,
        }
      )
      .then((r) => r.blob())
      .then((blob) => {
        if (controller.signal.aborted || useAuthStore.getState().user?.id !== owner) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Bild konnte nicht geladen werden');
      });
    return () => {
      mounted.current = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [collection, task.id, task.revision, image.id, owner]);
  const point = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  function finish(event: React.PointerEvent<SVGSVGElement>) {
    const start = origin.current;
    if (start && !busy) {
      const end = point(event),
        rectangle = {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          width: Math.abs(start.x - end.x),
          height: Math.abs(start.y - end.y),
        };
      if (rectangle.width > 0.001 && rectangle.height > 0.001 && rectangles.length < 50)
        setRectangles((rows) => [...rows, rectangle]);
    }
    origin.current = null;
    setDraft(null);
  }
  async function create() {
    setBusy(true);
    setError('');
    try {
      const response = await deliverAssistant(
        `/api/assistant/${collection}/${task.id}/image-edit`,
        {
          sourceRevision: task.revision,
          assetId: image.id,
          prompt,
          mode,
          rectangles: mode === 'inpaint' ? rectangles : [],
        },
        'Bildbearbeitungsauftrag erstellen'
      );
      if (mounted.current && useAuthStore.getState().user?.id === owner)
        onCreated((response as { data: { data: AssistantResource } }).data.data);
    } catch (failure) {
      if (mounted.current && useAuthStore.getState().user?.id === owner)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Auftrag unbestätigt; in der Assistenz-Outbox prüfen.'
        );
    } finally {
      if (mounted.current && useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Bildbearbeitung vorbereiten"
      className="space-y-3 rounded-md border bg-card p-3"
    >
      <h3 className="font-medium">Bild bearbeiten: {image.filename}</h3>
      <label className="block text-sm">
        Bearbeitungsart
        <select
          aria-label="Bearbeitungsart"
          className="mt-1 w-full rounded-md border bg-background p-2"
          value={mode}
          disabled={busy}
          onChange={(e) => setMode(e.target.value as 'edit' | 'inpaint')}
        >
          <option value="inpaint">Nur markierte Bereiche ändern</option>
          <option value="edit">Gesamtes Bild bearbeiten</option>
        </select>
      </label>
      {url && (
        <div className="relative max-w-full" style={{ width: Math.min(576, 420 * ratio) }}>
          <img
            src={url}
            alt="Unverändertes Bildoriginal"
            className="block h-auto w-full"
            onLoad={(event) =>
              setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)
            }
          />
          {mode === 'inpaint' && (
            <svg
              aria-label="Bereiche auf dem Bild markieren"
              className="absolute inset-0 h-full w-full touch-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              onPointerDown={(event) => {
                if (busy || event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                origin.current = point(event);
              }}
              onPointerMove={(event) => {
                if (!origin.current) return;
                const p = point(event),
                  o = origin.current;
                setDraft({
                  x: Math.min(o.x, p.x),
                  y: Math.min(o.y, p.y),
                  width: Math.abs(p.x - o.x),
                  height: Math.abs(p.y - o.y),
                });
              }}
              onPointerUp={finish}
              onPointerCancel={() => {
                origin.current = null;
                setDraft(null);
              }}
            >
              {[...rectangles, ...(draft ? [draft] : [])].map((rect, i) => (
                <rect
                  key={i}
                  x={rect.x * 100}
                  y={rect.y * 100}
                  width={rect.width * 100}
                  height={rect.height * 100}
                  fill="rgba(255,255,255,0.3)"
                  stroke="#000000"
                  strokeWidth="0.5"
                  strokeDasharray="2 1"
                />
              ))}
            </svg>
          )}
        </div>
      )}
      {mode === 'inpaint' && (
        <>
          <p className="text-xs text-muted-foreground">
            Bereiche mit Maus/Finger aufziehen oder Werte in Prozent eingeben. Die weissen
            Maskenflächen werden geändert; das übrige Bild bleibt erhalten.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['x', 'y', 'width', 'height'] as const).map((field) => (
              <label key={field} className="text-sm">
                {{ x: 'Links (%)', y: 'Oben (%)', width: 'Breite (%)', height: 'Höhe (%)' }[field]}
                <input
                  aria-label={
                    { x: 'Links (%)', y: 'Oben (%)', width: 'Breite (%)', height: 'Höhe (%)' }[
                      field
                    ]
                  }
                  className="mt-1 w-full rounded-md border bg-background p-2"
                  type="number"
                  min="0"
                  max="100"
                  value={coordinates[field]}
                  disabled={busy}
                  onChange={(e) => setCoordinates({ ...coordinates, [field]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || rectangles.length >= 50}
              onClick={() => {
                const r = {
                  x: Number(coordinates.x) / 100,
                  y: Number(coordinates.y) / 100,
                  width: Number(coordinates.width) / 100,
                  height: Number(coordinates.height) / 100,
                };
                if (
                  !Object.values(r).every(Number.isFinite) ||
                  r.x < 0 ||
                  r.y < 0 ||
                  r.width <= 0 ||
                  r.height <= 0 ||
                  r.x + r.width > 1 ||
                  r.y + r.height > 1
                ) {
                  setError('Bereich muss vollständig innerhalb des Bildes liegen.');
                  return;
                }
                setError('');
                setRectangles((rows) => [...rows, r]);
              }}
            >
              Bereich hinzufügen
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !rectangles.length}
              onClick={() => setRectangles((rows) => rows.slice(0, -1))}
            >
              Letzten Bereich entfernen
            </Button>
          </div>
          <p className="text-xs" role="status">
            {rectangles.length} markierte Bereiche
          </p>
        </>
      )}
      <label className="block text-sm">
        Gewünschte Änderung
        <textarea
          aria-label="Gewünschte Änderung"
          className="mt-1 min-h-24 w-full rounded-md border bg-background p-2"
          value={prompt}
          maxLength={10000}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !url || !prompt.trim() || (mode === 'inpaint' && !rectangles.length)}
          onClick={() => void create()}
        >
          {busy ? 'Wird vorbereitet …' : 'Als neuen Task vorbereiten'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Schliessen
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Original und pixelgenaue Maske werden im neuen Entwurf gebunden. Erst „Starten“ führt die
        Bearbeitung mit dem gewählten Agenten aus. Ein maskierter Auftrag nutzt Plums vorhandenes
        Inpainting; das Ergebnis wird als eigener Bibliothekseintrag gespeichert.
      </p>
    </section>
  );
}
