import { useEffect, useRef, useState } from 'react';
import { Loader2, Square, Volume2 } from 'lucide-react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { splitSpeech } from './voiceSegments';

/** Plays text through the chosen voice, piece by piece; a second click stops it. */
export async function fetchSpeech(
  text: string,
  voice: string,
  language: string,
  signal?: AbortSignal
): Promise<Blob> {
  const response = await api.download('/api/assistant/voice/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, language }),
    signal,
  });
  return response.blob();
}

export function ReadAloudButton({
  text,
  voice,
  language = 'German',
  label = 'Vorlesen',
  onError,
}: {
  text: string;
  voice: string;
  language?: string;
  label?: string;
  onError?: (message: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const run = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const stop = () => {
    run.current += 1;
    controller.current?.abort();
    audio.current?.pause();
    audio.current = null;
    setState('idle');
  };
  useEffect(() => () => stop(), []);
  const play = async () => {
    if (state !== 'idle') return stop();
    const mine = ++run.current;
    const pieces = splitSpeech(text);
    setState('loading');
    try {
      // The next piece is fetched while the current one plays.
      let upcoming: Promise<Blob> | null = null;
      for (let i = 0; i < pieces.length; i++) {
        controller.current = new AbortController();
        const blob = await (upcoming ??
          fetchSpeech(pieces[i]!, voice, language, controller.current.signal));
        if (mine !== run.current) return;
        upcoming =
          i + 1 < pieces.length
            ? fetchSpeech(pieces[i + 1]!, voice, language, controller.current.signal)
            : null;
        const url = URL.createObjectURL(blob);
        const element = new Audio(url);
        audio.current = element;
        setState('playing');
        await new Promise<void>((resolve, reject) => {
          element.onended = () => resolve();
          element.onerror = () => reject(new Error('Wiedergabe fehlgeschlagen'));
          void element.play().catch(reject);
        }).finally(() => URL.revokeObjectURL(url));
        if (mine !== run.current) return;
      }
      setState('idle');
    } catch (failure) {
      if (mine === run.current) {
        onError?.(failure instanceof Error ? failure.message : 'Sprachausgabe fehlgeschlagen');
        setState('idle');
      }
    }
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => void play()}
      aria-pressed={state !== 'idle'}
    >
      {state === 'loading' ? (
        <Loader2 size={13} className="animate-spin" />
      ) : state === 'playing' ? (
        <Square size={13} />
      ) : (
        <Volume2 size={13} />
      )}
      {state === 'idle' ? label : 'Stopp'}
    </Button>
  );
}
