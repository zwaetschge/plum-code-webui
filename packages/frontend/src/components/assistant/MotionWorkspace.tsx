import { useEffect, useState } from 'react';
import {
  parseAssistantMotion,
  assistantMotionSvg,
  type AssistantMotion,
  type AssistantMotionShape,
} from '@plum-code-webui/shared';
import { Button } from '@/components/ui/button';

function NumberField({
  label,
  value,
  minimum,
  maximum,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="grid min-w-0 gap-1 text-sm">
      {label}
      <input
        className="min-w-0 rounded-md border bg-background p-2"
        type="number"
        min={minimum}
        max={maximum}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const number = Number(draft);
          if (draft.trim() && Number.isFinite(number) && number >= minimum && number <= maximum)
            onChange(number);
          else setDraft(String(value));
        }}
      />
    </label>
  );
}
export function MotionWorkspace({
  content,
  editing,
  onChange,
}: {
  content: string;
  editing: boolean;
  onChange: (content: string) => void;
}) {
  const [frame, setFrame] = useState(0),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState('');
  let model: AssistantMotion | null = null;
  try {
    model = parseAssistantMotion(content);
  } catch {
    /* Report without executing imported code. */
  }
  const frames = model ? model.duration * model.fps : 1;
  const fps = model?.fps ?? 1;
  useEffect(() => {
    setFrame(0);
    setPlaying(false);
  }, [content]);
  useEffect(() => {
    if (!playing) return;
    const next = window.setInterval(
      () =>
        setFrame((current) => {
          if (current + 1 >= frames) {
            setPlaying(false);
            return frames - 1;
          }
          return current + 1;
        }),
      1000 / fps
    );
    const stop = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', stop);
    return () => {
      clearInterval(next);
      document.removeEventListener('visibilitychange', stop);
    };
  }, [playing, frames, fps]);
  if (!model) return <p role="alert">Animation konnte nicht gelesen werden.</p>;
  const update = (next: AssistantMotion) => {
    try {
      onChange(JSON.stringify(parseAssistantMotion(JSON.stringify(next))));
      setError('');
    } catch {
      setError(
        'Bitte die Grenzen der Animation einhalten: gerade Bildmasse, bis zehn Sekunden und 20 Elemente.'
      );
    }
  };
  const changeShape = (index: number, patch: Partial<AssistantMotionShape>) =>
    update({
      ...model!,
      shapes: model!.shapes.map((shape, n) => (n === index ? { ...shape, ...patch } : shape)),
    });
  return (
    <section aria-label="Animation gestalten" className="min-w-0 space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div
        className="w-full overflow-hidden rounded-lg border [&>svg]:h-auto [&>svg]:w-full"
        dangerouslySetInnerHTML={{
          __html: assistantMotionSvg(
            model,
            frames > 1 ? Math.min(frame, frames - 1) / (frames - 1) : 0
          ),
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!playing && frame >= frames - 1) setFrame(0);
            setPlaying(!playing);
          }}
        >
          {playing ? 'Anhalten' : 'Abspielen'}
        </Button>
        <label className="grid min-w-0 flex-1 gap-1 text-sm">
          Zeitpunkt
          <input
            aria-label="Animationszeitpunkt"
            type="range"
            min="0"
            max={frames - 1}
            value={Math.min(frame, frames - 1)}
            onChange={(event) => {
              setPlaying(false);
              setFrame(Number(event.target.value));
            }}
          />
        </label>
        <span className="text-sm">
          {(frame / model.fps).toFixed(1)} / {model.duration} s
        </span>
      </div>
      {editing && (
        <>
          <label className="grid gap-1 text-sm">
            Bewegungsmodell
            <select
              aria-label="Bewegungsmodell"
              className="rounded-md border bg-background p-2"
              value={model.physics ? 'physics' : 'linear'}
              onChange={(event) =>
                update({
                  ...model!,
                  physics:
                    event.target.value === 'physics'
                      ? { gravity: 300, bounce: 0.8, velocityX: 90, velocityY: 0 }
                      : undefined,
                })
              }
            >
              <option value="linear">Start- und Zielposition</option>
              <option value="physics">Schwerkraft und Randkollisionen</option>
            </select>
          </label>
          {model.physics && (
            <fieldset className="grid grid-cols-2 gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm">Simulation</legend>
              {(
                [
                  ['gravity', 'Schwerkraft (px/s²)', -2000, 2000],
                  ['bounce', 'Rückprall (0–1)', 0, 1],
                  ['velocityX', 'Startgeschwindigkeit X (px/s)', -1000, 1000],
                  ['velocityY', 'Startgeschwindigkeit Y (px/s)', -1000, 1000],
                ] as const
              ).map(([key, label, minimum, maximum]) => (
                <NumberField
                  key={key}
                  label={label}
                  minimum={minimum}
                  maximum={maximum}
                  value={model!.physics![key]}
                  onChange={(value) =>
                    update({ ...model!, physics: { ...model!.physics!, [key]: value } })
                  }
                />
              ))}
              <p className="col-span-2 text-xs text-muted-foreground">
                Formen fallen unabhängig voneinander und prallen an den Bildrändern ab. Text bleibt
                an seiner Startposition. Zielpositionen gelten nur für das lineare Modell.
              </p>
            </fieldset>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumberField
              label="Breite"
              value={model.width}
              minimum={240}
              maximum={1280}
              onChange={(width) => update({ ...model!, width })}
            />
            <NumberField
              label="Höhe"
              value={model.height}
              minimum={160}
              maximum={720}
              onChange={(height) => update({ ...model!, height })}
            />
            <NumberField
              label="Dauer (Sekunden)"
              value={model.duration}
              minimum={1}
              maximum={10}
              onChange={(duration) => update({ ...model!, duration })}
            />
            <NumberField
              label="Bilder pro Sekunde"
              value={model.fps}
              minimum={1}
              maximum={12}
              onChange={(fps) => update({ ...model!, fps })}
            />
            <label className="grid gap-1 text-sm">
              Hintergrund
              <input
                type="color"
                value={model.background}
                onChange={(event) => update({ ...model!, background: event.target.value })}
              />
            </label>
          </div>
          {model.shapes.map((shape, index) => (
            <fieldset key={shape.id} className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm">Element {index + 1}</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="grid gap-1 text-sm">
                  Form
                  <select
                    aria-label={`Form ${index + 1}`}
                    className="rounded-md border bg-background p-2"
                    value={shape.kind}
                    onChange={(event) =>
                      changeShape(index, {
                        kind: event.target.value as AssistantMotionShape['kind'],
                      })
                    }
                  >
                    <option value="rectangle">Rechteck</option>
                    <option value="circle">Kreis</option>
                    <option value="text">Text</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  Farbe
                  <input
                    aria-label={`Farbe ${index + 1}`}
                    type="color"
                    value={shape.color}
                    onChange={(event) => changeShape(index, { color: event.target.value })}
                  />
                </label>
                {(['x', 'y', 'toX', 'toY', 'width', 'height', 'fontSize'] as const)
                  .filter((key) =>
                    shape.kind === 'text'
                      ? !['width', 'height'].includes(key)
                      : key !== 'fontSize' && !(shape.kind === 'circle' && key === 'height')
                  )
                  .filter((key) => !model!.physics || !['toX', 'toY'].includes(key))
                  .map((key) => (
                    <NumberField
                      key={key}
                      label={`${{ x: 'Start X', y: 'Start Y', toX: 'Ziel X', toY: 'Ziel Y', width: shape.kind === 'circle' ? 'Durchmesser' : 'Elementbreite', height: 'Elementhöhe', fontSize: 'Textgrösse' }[key]} ${index + 1}`}
                      value={shape[key]}
                      minimum={
                        ['x', 'y', 'toX', 'toY'].includes(key) ? -720 : key === 'fontSize' ? 8 : 1
                      }
                      maximum={key === 'fontSize' ? 200 : key === 'height' ? 720 : 1280}
                      onChange={(value) => changeShape(index, { [key]: value })}
                    />
                  ))}
              </div>
              {shape.kind === 'text' && (
                <label className="grid gap-1 text-sm">
                  Text
                  <textarea
                    aria-label={`Animationstext ${index + 1}`}
                    className="rounded-md border bg-background p-2"
                    maxLength={2000}
                    value={shape.text}
                    onChange={(event) => changeShape(index, { text: event.target.value })}
                  />
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    update({ ...model!, shapes: model!.shapes.filter((_, n) => n !== index) })
                  }
                >
                  Element {index + 1} entfernen
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={index === 0}
                  onClick={() => {
                    const shapes = [...model!.shapes];
                    [shapes[index - 1], shapes[index]] = [shapes[index]!, shapes[index - 1]!];
                    update({ ...model!, shapes });
                  }}
                >
                  Element {index + 1} nach hinten
                </Button>
              </div>
            </fieldset>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={model.shapes.length >= 20}
            onClick={() =>
              update({
                ...model!,
                shapes: [
                  ...model!.shapes,
                  {
                    id: crypto.randomUUID(),
                    kind: 'rectangle',
                    x: 30,
                    y: 80,
                    toX: 300,
                    toY: 80,
                    width: 100,
                    height: 60,
                    color: '#1856FF',
                    text: '',
                    fontSize: 24,
                  },
                ],
              })
            }
          >
            Element hinzufügen
          </Button>
          <p className="text-xs text-muted-foreground">
            {model.physics
              ? 'Reproduzierbare Simulation mit Schwerkraft und Randkollisionen.'
              : 'Lineare Bewegung mit gespeicherten Start- und Zielpositionen.'}{' '}
            PNG/SVG exportieren das erste Bild, MP4 den vollständigen gespeicherten Clip.
          </p>
        </>
      )}
    </section>
  );
}
