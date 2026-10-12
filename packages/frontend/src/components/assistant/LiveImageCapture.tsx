import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/** Preview stays local. Only an explicitly captured frame enters the normal image upload path. */
export function LiveImageCapture({
  scopeKey,
  disabled,
  remaining,
  onCapture,
}: {
  scopeKey: string;
  disabled: boolean;
  remaining: number;
  onCapture: (file: File) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    generation = useRef(0),
    callback = useRef(onCapture);
  callback.current = onCapture;
  const [active, setActive] = useState(false),
    [starting, setStarting] = useState(false),
    [error, setError] = useState('');
  const stop = useCallback(() => {
    generation.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setActive(false);
    setStarting(false);
  }, []);
  useEffect(() => {
    const stopTracks = () => {
      generation.current++;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      if (video.current) video.current.srcObject = null;
    };
    const visibility = () => {
      if (document.hidden) {
        stopTracks();
        setActive(false);
        setStarting(false);
      }
    };
    document.addEventListener('visibilitychange', visibility);
    setActive(false);
    setStarting(false);
    setError('');
    return () => {
      stopTracks();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [scopeKey]);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);
  const start = async (source: 'camera' | 'screen') => {
    stop();
    const version = generation.current;
    setStarting(true);
    setError('');
    try {
      if (!navigator.mediaDevices)
        throw new Error('Die Aufnahme benötigt HTTPS und einen unterstützten Browser.');
      const media =
        source === 'camera'
          ? await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'environment', width: { ideal: 1280 } },
              audio: false,
            })
          : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (generation.current !== version) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      media.getVideoTracks().forEach((track) =>
        track.addEventListener(
          'ended',
          () => {
            if (generation.current === version) stop();
          },
          { once: true }
        )
      );
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      if (generation.current !== version) return;
      setActive(true);
      setStarting(false);
    } catch {
      if (generation.current !== version) return;
      stop();
      setError('Aufnahme nicht verfügbar oder nicht freigegeben. Du kannst ein Bild anhängen.');
    }
  };
  const capture = async () => {
    const element = video.current;
    if (!element || !element.videoWidth || !element.videoHeight || disabled || remaining < 1)
      return;
    const version = generation.current;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1280 / Math.max(element.videoWidth, element.videoHeight));
    canvas.width = Math.max(1, Math.round(element.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(element.videoHeight * scale));
    canvas.getContext('2d')?.drawImage(element, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    );
    if (generation.current !== version || !blob) return;
    callback.current(
      new File([blob], `Aufnahme-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`, {
        type: 'image/jpeg',
      })
    );
    stop();
  };
  return (
    <section aria-label="Kamera und Bildschirm" className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || starting || remaining < 1}
          onClick={() => void start('camera')}
        >
          Kamera öffnen
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            disabled || starting || remaining < 1 || !navigator.mediaDevices?.getDisplayMedia
          }
          onClick={() => void start('screen')}
        >
          Bildschirm auswählen
        </Button>
        {(active || starting) && (
          <Button type="button" variant="outline" size="sm" onClick={stop}>
            Aufnahme beenden
          </Button>
        )}
        {active && (
          <Button
            type="button"
            size="sm"
            disabled={disabled || remaining < 1}
            onClick={() => void capture()}
          >
            Einzelbild übernehmen
          </Button>
        )}
      </div>
      <video
        ref={video}
        muted
        playsInline
        aria-label="Lokale Aufnahmevorschau"
        className={
          active || starting ? 'max-h-64 w-full rounded-md bg-black object-contain' : 'hidden'
        }
      />
      <p className="text-xs text-muted-foreground">
        Die Vorschau bleibt auf diesem Gerät. Ein übernommenes Einzelbild wird erst mit deiner
        Nachricht an die gewählte API-Verbindung gesendet.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
