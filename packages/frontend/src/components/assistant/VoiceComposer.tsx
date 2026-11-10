import { useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { PlumFace, type FacePhase } from './PlumFace';
import { playbackSegments, recognitionLocale, voiceLanguageCode } from './voiceSegments';
import { usePersonalization } from './usePersonalization';

/** The Web Speech API's recognizer (Chrome, Edge, Safari; not Firefox), minimally typed. */
interface DeviceRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionConstructor = new () => DeviceRecognition;
function deviceRecognizer(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}
/** Errors after which this browser's recognizer is not used again in this conversation. */
const DEVICE_RECOGNITION_FAILURES = new Set([
  'service-not-allowed',
  'network',
  'language-not-supported',
  'bad-grammar',
]);

/**
 * Voice input and spoken answers. Recognition uses the browser's own recognizer
 * when the personalisation allows it (live captions, no upload wait) and
 * Vocarium's Whisper otherwise or as a fallback; answers are spoken with the
 * chosen OmniVoice or Mistral voice.
 */
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
    [piece, setPiece] = useState(0),
    /** Microphone loudness, 0–1: the face breathes with your voice. */
    [level, setLevel] = useState(0);
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
  /** The next spoken piece, requested while the current one plays. */
  const prefetched = useRef<{ text: string; blob: Promise<Blob> } | null>(null);
  const recognizer = useRef<DeviceRecognition | null>(null),
    deviceFailed = useRef(false),
    /** Runs that ended at once without words; three in a row switch to the server. */
    emptyRuns = useRef(0),
    [caption, setCaption] = useState('');
  const { preferences } = usePersonalization();
  const preferDevice = preferences.speechRecognition !== 'server';
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
    speechRequest.current = null;
    prefetched.current = null;
    speechChunks.current = [];
    audioPlayer.current?.pause();
    setReading(false);
    if (!transcribing.current) setBusy(false);
  };
  const discardRecording = () => {
    discarded.current = true;
    recognizer.current?.abort();
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
  /** A recognized utterance: sent in a voice conversation, otherwise put into the composer. */
  const deliver = async (spoken: string, automatic: boolean) => {
    if (!automatic) {
      onTranscription(spoken);
      return;
    }
    if (!liveRef.current || !spoken.trim() || !onSend) return;
    awaitAnswerKey.current = answerKey;
    setAwaiting(true);
    const ack = (await onSend(spoken.trim())) as { status?: string; error?: string } | undefined;
    if (ack?.status === 'rejected')
      throw new Error(ack.error || 'Die Sprachnachricht wurde abgelehnt');
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
      await deliver(result.text, automatic);
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
  /**
   * The browser's recognizer: words appear while speaking and the utterance is
   * ready at the pause, without an upload. In a voice conversation one
   * utterance per run (the recognizer ends at the pause); dictation listens
   * until stopped.
   */
  const startDeviceRecognition = (Recognition: RecognitionConstructor, automatic: boolean) => {
    const epoch = operation.current;
    const recognition = new Recognition();
    recognition.lang = recognitionLocale(language);
    recognition.continuous = !automatic;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    let heard = '',
      failure = '';
    const startedAt = Date.now();
    recognition.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]!;
        if (result.isFinal) heard += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (mounted.current) setCaption(`${heard} ${interim}`.trim());
    };
    recognition.onerror = (event) => {
      failure = event.error;
    };
    recognition.onend = () => {
      if (recognizer.current === recognition) recognizer.current = null;
      if (!mounted.current || epoch !== operation.current) return;
      setRecording(false);
      setCaption('');
      if (discarded.current) return;
      if (failure === 'not-allowed' || failure === 'audio-capture') {
        endLive();
        setError('Mikrofonzugriff ist nicht verfügbar. Du kannst eine Audiodatei auswählen.');
        return;
      }
      if (DEVICE_RECOGNITION_FAILURES.has(failure)) {
        // This browser cannot recognize here: Whisper on Vocarium takes over.
        deviceFailed.current = true;
        setError('Die Spracherkennung des Browsers ist nicht verfügbar. Plum nutzt den Server.');
        if (!automatic) void latest.current.startRecording(false);
        return;
      }
      const spoken = heard.trim();
      // Nothing heard: a voice conversation simply listens again, unless the
      // recognizer keeps ending at once (then Whisper on Vocarium takes over).
      if (!spoken) {
        emptyRuns.current = Date.now() - startedAt < 700 ? emptyRuns.current + 1 : 0;
        if (emptyRuns.current >= 3) deviceFailed.current = true;
        return;
      }
      emptyRuns.current = 0;
      setBusy(true);
      void deliver(spoken, automatic)
        .catch((problem) => {
          if (mounted.current && epoch === operation.current) {
            setError(problem instanceof Error ? problem.message : 'Senden fehlgeschlagen');
            endLive();
          }
        })
        .finally(() => {
          if (mounted.current) setBusy(false);
        });
    };
    recognizer.current = recognition;
    recognition.start();
    setRecording(true);
  };
  const startRecording = async (automatic = false) => {
    if (
      starting.current ||
      recorder.current?.state === 'recording' ||
      recognizer.current ||
      transcribing.current
    )
      return;
    starting.current = true;
    setError('');
    stopSpeech();
    discarded.current = false;
    const Recognition = preferDevice && !deviceFailed.current ? deviceRecognizer() : null;
    if (Recognition) {
      try {
        startDeviceRecognition(Recognition, automatic);
      } catch {
        deviceFailed.current = true;
      } finally {
        starting.current = false;
      }
      if (recognizer.current) return;
      starting.current = true;
    }
    const epoch = operation.current;
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
        setLevel(0);
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
          setLevel(Math.min(1, energy * 6));
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
    const controller = speechRequest.current ?? new AbortController();
    speechRequest.current = controller;
    const request = (piece: string) => {
      const blob = api
        .download('/api/assistant/voice/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: piece, voice, language }),
          signal: controller.signal,
        })
        .then((response) => response.blob());
      blob.catch(() => {});
      return blob;
    };
    const pending = prefetched.current?.text === next ? prefetched.current.blob : request(next);
    // The following piece renders while this one plays: no pause between them.
    const following = speechChunks.current[0];
    prefetched.current = following ? { text: following, blob: request(following) } : null;
    try {
      const blob = await pending;
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
    speechChunks.current = playbackSegments(text);
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

  /**
   * The face's state, derived from the same flags the status line uses: the
   * voice conversation, the recording, the transcription and the spoken
   * answer are one visible act.
   */
  const facePhase: FacePhase = error
    ? 'failed'
    : reading
      ? 'speaking'
      : awaiting
        ? 'thinking'
        : busy
          ? 'transcribing'
          : recording
            ? 'listening'
            : 'idle';
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
      recognizer.current?.abort();

      discarded.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      closeVad();
    };
  }, []);
  return (
    <section className="space-y-2" aria-label="Sprache">
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
        {typeof MediaRecorder !== 'undefined' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || live || modelBusy}
            onClick={() => {
              if (!recording) void startRecording();
              else if (recognizer.current) recognizer.current.stop();
              else recorder.current?.stop();
            }}
          >
            {recording ? 'Aufnahme beenden' : 'Nachricht einsprechen'}
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
            Vorlesen
          </Button>
        )}
      </div>
      {(live || recording || reading) && (
        <div className="plum-voice-presence">
          <PlumFace phase={facePhase} level={level} size={96} title="Plum" />
          <p role="status" className="text-sm">
            {awaiting
              ? 'Wartet auf die Antwort.'
              : reading
                ? 'Plum antwortet.'
                : recording
                  ? 'Plum hört zu.'
                  : 'Sprich nach dem Mikrofonhinweis.'}
          </p>
        </div>
      )}
      {recording && (
        <p role="status" className="text-sm">
          {caption ? `„${caption}“` : 'Das Mikrofon nimmt auf.'}
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm">
          {reading
            ? `Sprachausgabe bereitet Abschnitt ${piece + 1} vor …`
            : 'Die Aufnahme wird erkannt …'}
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
          aria-label="Sprachausgabe"
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
