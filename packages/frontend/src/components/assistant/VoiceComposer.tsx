import { useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { splitSpeech, voiceLanguageCode } from './voiceSegments';

/** All recognition and synthesis use the user's Vocarium service. */
export function VoiceComposer({
  text,
  voice = 'Rufus Beck',
  language = 'German',
  onTranscription,
  onAudioFile,
  onSend,
  modelBusy = false,
  answerKey,
  scopeKey,
}: {
  text: string;
  voice?: string;
  language?: string;
  onTranscription: (text: string) => void;
  onAudioFile?: (file: File) => Promise<void>;
  onSend?: (text: string) => Promise<unknown>;
  modelBusy?: boolean;
  answerKey?: string;
  scopeKey?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [audio, setAudio] = useState('');
  const [recording, setRecording] = useState(false),
    [reading, setReading] = useState(false),
    [live, setLive] = useState(false),
    [awaiting, setAwaiting] = useState(false),
    [piece, setPiece] = useState(0);
  const mounted = useRef(true),
    liveRef = useRef(false),
    starting = useRef(false),
    operation = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null);
  const discarded = useRef(false),
    transcribing = useRef(false),
    awaitAnswerKey = useRef<string | undefined>();
  const vadTimer = useRef<ReturnType<typeof setInterval> | null>(null),
    vadContext = useRef<AudioContext | null>(null);
  const speechGeneration = useRef(0),
    speechRequest = useRef<AbortController | null>(null),
    transcriptionRequest = useRef<AbortController | null>(null);
  const speechChunks = useRef<string[]>([]),
    audioPlayer = useRef<HTMLAudioElement | null>(null);
  const closeVad = () => {
    if (vadTimer.current) clearInterval(vadTimer.current);
    vadTimer.current = null;
    const context = vadContext.current;
    vadContext.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  };
  const stopSpeech = () => {
    speechGeneration.current++;
    speechRequest.current?.abort();
    speechChunks.current = [];
    audioPlayer.current?.pause();
    setReading(false);
    if (!transcribing.current) setBusy(false);
  };
  const discardRecording = () => {
    discarded.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    closeVad();
  };
  const endLive = () => {
    liveRef.current = false;
    setLive(false);
    setAwaiting(false);
    stopSpeech();
    discardRecording();
  };
  const transcribe = async (file: File, automatic = false) => {
    const epoch = operation.current;
    const controller = new AbortController();
    transcriptionRequest.current = controller;
    transcribing.current = true;
    setBusy(true);
    setError('');
    try {
      if (onAudioFile) {
        await onAudioFile(file);
        return;
      }
      const form = new FormData();
      form.append('file', file);
      form.append('language', voiceLanguageCode(language));
      const result = (
        await api.post<{ data: { text: string } }>('/api/assistant/voice/transcribe', form, {
          signal: controller.signal,
        })
      ).data.data;
      if (!mounted.current || epoch !== operation.current || controller.signal.aborted) return;
      if (automatic) {
        if (!liveRef.current || !result.text.trim() || !onSend) return;
        awaitAnswerKey.current = answerKey;
        setAwaiting(true);
        const ack = (await onSend(result.text.trim())) as
          | { status?: string; error?: string }
          | undefined;
        if (ack?.status === 'rejected')
          throw new Error(ack.error || 'Die Sprachnachricht wurde abgelehnt');
      } else onTranscription(result.text);
    } catch (failure) {
      if (mounted.current && epoch === operation.current && !controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : 'Transkription fehlgeschlagen');
        endLive();
      }
    } finally {
      if (transcriptionRequest.current === controller) {
        transcriptionRequest.current = null;
        transcribing.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };
  const startRecording = async (automatic = false) => {
    if (starting.current || recorder.current?.state === 'recording' || transcribing.current) return;
    starting.current = true;
    const epoch = operation.current;
    setError('');
    stopSpeech();
    discarded.current = false;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || epoch !== operation.current || (automatic && !liveRef.current)) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const next = new MediaRecorder(media);
      recorder.current = next;
      const chunks: BlobPart[] = [];
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      next.onstop = () => {
        closeVad();
        media.getTracks().forEach((track) => track.stop());
        if (stream.current === media) stream.current = null;
        if (recorder.current === next) recorder.current = null;
        if (!mounted.current || epoch !== operation.current) return;
        setRecording(false);
        if (!discarded.current)
          void transcribe(new File(chunks, 'Aufnahme.webm', { type: next.mimeType }), automatic);
      };
      next.start();
      setRecording(true);
      if (automatic) {
        const context = new AudioContext();
        vadContext.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(media).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let heard = false,
          lastVoice = Date.now();
        const started = Date.now();
        vadTimer.current = setInterval(() => {
          if (next.state !== 'recording') return;
          analyser.getFloatTimeDomainData(samples);
          const energy = Math.sqrt(
            samples.reduce((sum, value) => sum + value * value, 0) / samples.length
          );
          if (energy > 0.025) {
            heard = true;
            lastVoice = Date.now();
          }
          if (heard && Date.now() - lastVoice > 1300 && Date.now() - started > 1000) next.stop();
          else if (Date.now() - started > 45000) {
            discarded.current = !heard;
            next.stop();
          }
        }, 100);
      }
    } catch {
      if (mounted.current && epoch === operation.current) {
        endLive();
        setError('Mikrofonzugriff ist nicht verfügbar. Du kannst eine Audiodatei auswählen.');
      }
    } finally {
      starting.current = false;
    }
  };
  const nextSpeech = async (generation: number) => {
    if (generation !== speechGeneration.current) return;
    const next = speechChunks.current.shift();
    if (!next) {
      setReading(false);
      return;
    }
    setBusy(true);
    setError('');
    const controller = new AbortController();
    speechRequest.current = controller;
    try {
      const response = await api.download('/api/assistant/voice/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: next, voice, language }),
        signal: controller.signal,
      });
      const blob = await response.blob();
      if (!mounted.current || generation !== speechGeneration.current) return;
      setAudio(URL.createObjectURL(blob));
      setPiece((old) => old + 1);
    } catch (failure) {
      if (
        !controller.signal.aborted &&
        mounted.current &&
        generation === speechGeneration.current
      ) {
        setError(failure instanceof Error ? failure.message : 'Sprachausgabe fehlgeschlagen');
        endLive();
      }
    } finally {
      if (generation === speechGeneration.current && mounted.current) setBusy(false);
    }
  };
  const speak = async () => {
    stopSpeech();
    const generation = speechGeneration.current;
    setPiece(0);
    setAudio('');
    speechChunks.current = splitSpeech(text);
    setReading(true);
    await nextSpeech(generation);
  };
  const latest = useRef({ startRecording, speak, endLive, stopSpeech, discardRecording });
  latest.current = { startRecording, speak, endLive, stopSpeech, discardRecording };
  useEffect(() => {
    if (modelBusy) {
      latest.current.stopSpeech();
      latest.current.discardRecording();
    }
  }, [modelBusy]);
  useEffect(() => {
    if (live && awaiting && !modelBusy && answerKey && answerKey !== awaitAnswerKey.current) {
      setAwaiting(false);
      void latest.current.speak();
    }
  }, [live, awaiting, modelBusy, answerKey]);
  useEffect(() => {
    if (live && !modelBusy && !busy && !reading && !recording && !awaiting)
      void latest.current.startRecording(true);
  }, [live, modelBusy, busy, reading, recording, awaiting]);
  useEffect(() => {
    if (!awaiting) return;
    const timer = setTimeout(() => {
      latest.current.endLive();
      setError(
        'Noch keine fertige Antwort. Das Sprachgespräch wurde beendet; der Chat läuft weiter.'
      );
    }, 300000);
    return () => clearTimeout(timer);
  }, [awaiting]);
  useEffect(() => {
    operation.current++;
    transcriptionRequest.current?.abort();
    latest.current.endLive();
    setAudio('');
    setRecording(false);
  }, [scopeKey]);
  useEffect(() => {
    const player = audioPlayer.current,
      generation = speechGeneration.current;
    if (audio && reading && player)
      void player.play().catch(() => {
        if (mounted.current && generation === speechGeneration.current)
          setError('Der Browser wartet auf deine Freigabe: Starte die Wiedergabe im Audioplayer.');
      });
    return () => {
      player?.pause();
    };
  }, [audio, reading]);
  useEffect(
    () => () => {
      if (audio) URL.revokeObjectURL(audio);
    },
    [audio]
  );

  useEffect(() => {
    mounted.current = true;
    const counters = { operation, speechGeneration };
    return () => {
      mounted.current = false;
      liveRef.current = false;
      counters.operation.current++;
      transcriptionRequest.current?.abort();
      counters.speechGeneration.current++;
      speechRequest.current?.abort();

      discarded.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      closeVad();
    };
  }, []);
  return (
    <section className="space-y-2" aria-label="Sprache mit Vocarium">
      <div className="flex flex-wrap gap-2">
        {onSend && (
          <Button
            type="button"
            variant={live ? 'default' : 'outline'}
            size="sm"
            disabled={!live && (busy || modelBusy || recording)}
            onClick={() => {
              if (live) latest.current.endLive();
              else {
                stopSpeech();
                liveRef.current = true;
                setLive(true);
                setAwaiting(false);
              }
            }}
          >
            {live ? 'Sprachgespräch beenden' : 'Sprachgespräch starten'}
          </Button>
        )}
        {live && (
          <p role="status" className="text-xs text-muted-foreground">
            Erkannte Beiträge werden automatisch im aktuellen Chat gesendet.{' '}
            {awaiting
              ? 'Wartet auf die Antwort.'
              : reading
                ? 'OmniVoice antwortet.'
                : 'Sprich nach dem Mikrofonhinweis.'}
          </p>
        )}
        {typeof MediaRecorder !== 'undefined' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || live || modelBusy}
            onClick={() => (recording ? recorder.current?.stop() : void startRecording())}
          >
            {recording ? 'Aufnahme beenden und transkribieren' : 'Nachricht einsprechen'}
          </Button>
        )}
        {recording && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (live) endLive();
              else discardRecording();
            }}
          >
            Aufnahme verwerfen
          </Button>
        )}
        {(reading || audio) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (live) endLive();
              else stopSpeech();
            }}
          >
            Vorlesen stoppen
          </Button>
        )}
        <label className="cursor-pointer rounded-md border px-3 py-2 text-sm">
          Audiodatei
          <input
            type="file"
            accept="audio/*"
            className="sr-only"
            disabled={busy || recording || live}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void transcribe(file);
              event.target.value = '';
            }}
          />
        </label>
        {text.trim() && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || recording || modelBusy || live}
            onClick={() => void speak()}
          >
            Mit OmniVoice vorlesen
          </Button>
        )}
      </div>
      {recording && (
        <p role="status" className="text-sm">
          Das Mikrofon nimmt auf.
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm">
          {reading
            ? `OmniVoice bereitet Abschnitt ${piece + 1} vor …`
            : 'Vocarium verarbeitet die Aufnahme …'}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {audio && (
        <audio
          ref={audioPlayer}
          aria-label="OmniVoice-Ausgabe"
          controls
          src={audio}
          className="max-w-full"
          onEnded={() => {
            if (reading) void nextSpeech(speechGeneration.current);
          }}
        />
      )}
    </section>
  );
}
