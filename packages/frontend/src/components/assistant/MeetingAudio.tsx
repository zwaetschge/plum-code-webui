import { useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import type { AssistantResource } from '@plum-code-webui/shared';
import { Button } from '@/components/ui/button';
export function MeetingAudio({ meeting }: { meeting: AssistantResource }) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [limit, setLimit] = useState(100);
  const player = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    let active = true,
      objectUrl = '';
    setUrl('');
    setError('');
    setLimit(100);
    if (typeof meeting.body.audioAssetId === 'string')
      void api
        .download(`/api/assistant/meetings/${meeting.id}/audio`)
        .then((response) => response.blob())
        .then((blob) => {
          objectUrl = URL.createObjectURL(blob);
          if (active) setUrl(objectUrl);
          else URL.revokeObjectURL(objectUrl);
        })
        .catch(() => {
          if (active) setError('Audiooriginal ist nicht verfügbar');
        });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [meeting.id, meeting.body.audioAssetId]);
  const words = Array.isArray(meeting.body.words)
    ? (meeting.body.words as Array<{ word: string; start: number; end: number }>)
    : [];
  return (
    <section className="space-y-3" aria-label="Originalaufnahme und Zeitmarken">
      {url && (
        <audio
          ref={player}
          src={url}
          controls
          aria-label="Originale Meetingaufnahme"
          className="w-full"
        />
      )}
      {words.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            Zeitmarken beziehen sich auf die Originaltranskription. Korrigierter Text kann davon
            abweichen.
          </p>
          <div className="max-h-56 overflow-y-auto rounded-md border p-3">
            {words.slice(0, limit).map((word, index) => (
              <button
                key={index}
                type="button"
                className="mr-1 inline-block rounded px-1 py-1 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2"
                title={`${word.start.toFixed(2)} s`}
                onClick={() => {
                  if (player.current) {
                    player.current.currentTime = word.start;
                    void player.current.play().catch(() => {});
                  }
                }}
              >
                {word.word}
              </button>
            ))}
          </div>
          {limit < words.length && (
            <Button size="sm" variant="outline" onClick={() => setLimit(limit + 100)}>
              Weitere Wörter
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
