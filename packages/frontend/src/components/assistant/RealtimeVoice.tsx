import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { api } from '@/services/api';
import { nativeShell } from '@/lib/nativeShell';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { PlumFace, type FacePhase } from './PlumFace';

export interface LiveOptions {
  gemini: string[];
  openai: boolean;
  defaultModel: string | null;
}

const LIVE_MODEL_KEY = 'plum:voice:live-model';
export const LIVE_MODEL_LABELS: Record<string, string> = {
  'gemini-3.8-live': 'Gemini Live',
  'gemini-3.8-live-extended-thinking': 'Gemini Live · Extended Thinking',
};

/** Which live engines the account has (Gemini first); shared by the chat page. */
export function useLiveOptions() {
  return useQuery({
    queryKey: ['assistant', 'voice', 'live'],
    queryFn: async () =>
      (await api.get<{ data: LiveOptions }>('/api/assistant/voice/live')).data.data,
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Full-duplex PCM; recognition, audio generation and interruption stay in one
 * model session. The voice mode's first choice: Gemini Live (or OpenAI
 * Realtime without a Google key). A failure before the session is ready hands
 * over to the classic voice mode (`onFallback`).
 */
export function RealtimeVoice({
  chatId,
  onSaved,
  autoStart = false,
  voice,
  onFallback,
}: {
  chatId: string;
  onSaved?: () => void;
  autoStart?: boolean;
  /** Stored profile voice; a `gemini:<name>` voice is used for Gemini Live. */
  voice?: string;
  onFallback?: (reason: string) => void;
}) {
  const options = useLiveOptions();
  const [model, setModel] = useState<string>(
    () => window.localStorage.getItem(LIVE_MODEL_KEY) ?? 'gemini-3.8-live'
  );
  const usable = options.data?.gemini.includes(model)
    ? model
    : (options.data?.defaultModel ?? model);
  const [open, setOpen] = useState(autoStart),
    [status, setStatus] = useState('Verbindet …'),
    [error, setError] = useState('');
  const [heard, setHeard] = useState(''),
    [answer, setAnswer] = useState(''),
    [muted, setMuted] = useState(false);
  /** What the face shows; follows the same steps as the status line. */
  const [phase, setPhase] = useState<FacePhase>('idle'),
    [level, setLevel] = useState(0);
  const loud = useRef(0);
  const resources = useRef<{
    socket?: Socket;
    media?: MediaStream;
    context?: AudioContext;
    input?: ScriptProcessorNode;
    output?: AudioBufferSourceNode[];
  }>({});
  useEffect(() => {
    if (!open) return;
    let active = true,
      next = 0;
    const pending: AudioBufferSourceNode[] = [];
    const close = () => {
      active = false;
      const r = resources.current;
      r.socket?.emit('stop');
      r.socket?.disconnect();
      r.media?.getTracks().forEach((t) => t.stop());
      r.input?.disconnect();
      r.context?.close().catch(() => {});
      resources.current = {};
    };
    const clear = () => {
      for (const source of pending.splice(0))
        try {
          source.stop();
        } catch {
          /* already ended */
        }
      next = 0;
    };
    const connect = async () => {
      try {
        const native = nativeShell(),
          token = native?.token ?? useAuthStore.getState().token;
        const context = new AudioContext({ sampleRate: 24000 });
        resources.current.context = context;
        await context.resume();
        const media = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (!active) {
          media.getTracks().forEach((t) => t.stop());
          await context.close();
          return;
        }
        resources.current.media = media;
        const origin = native ? new URL(native.apiBase).origin : window.location.origin;
        const socket = io(origin + '/realtime', {
          path: native
            ? new URL(native.apiBase).pathname.replace(/\/$/, '') + '/socket.io'
            : '/socket.io',
          auth: { token, chatId, model: usable, voice },
          transports: ['websocket'],
          reconnection: false,
        });
        resources.current.socket = socket;
        let ready = false;
        const fail = (message: string) => {
          setError(message);
          setStatus('Verbindung beendet');
          setPhase('failed');
          close();
          // Not even started: the classic voice mode (Mistral, then Vocarium) takes over.
          if (!ready && onFallback) {
            setOpen(false);
            onFallback(message);
          }
        };
        socket.on('connect_error', () => fail('Sprachverbindung nicht möglich'));
        socket.on('problem', (message: string) => fail(message));
        socket.on('ready', () => {
          ready = true;
          setStatus('Hört zu');
          setPhase('listening');
          const input = context.createScriptProcessor(4096, 1, 1);
          resources.current.input = input;
          const source = context.createMediaStreamSource(media),
            silent = context.createGain();
          silent.gain.value = 0;
          source.connect(input);
          input.connect(silent);
          silent.connect(context.destination);
          input.onaudioprocess = (e) => {
            if (!active || media.getAudioTracks()[0]?.enabled === false) return;
            const samples = e.inputBuffer.getChannelData(0),
              ratio = context.sampleRate / 24000;
            let energy = 0;
            for (const sample of samples) energy += sample * sample;
            loud.current = Math.min(1, Math.sqrt(energy / samples.length) * 6);
            const bytes = new Uint8Array(Math.floor(samples.length / ratio) * 2),
              view = new DataView(bytes.buffer);
            for (let i = 0; i < bytes.length / 2; i++)
              view.setInt16(
                i * 2,
                Math.max(-32768, Math.min(32767, samples[Math.floor(i * ratio)]! * 32767)),
                true
              );
            let binary = '';
            for (const b of bytes) binary += String.fromCharCode(b);
            socket.emit('audio', btoa(binary));
          };
        });
        socket.on('audio', (encoded: string) => {
          if (!active) return;
          const data = atob(encoded),
            buffer = context.createBuffer(1, Math.floor(data.length / 2), 24000),
            values = buffer.getChannelData(0);
          for (let i = 0; i < values.length; i++) {
            let sample = data.charCodeAt(i * 2) | (data.charCodeAt(i * 2 + 1) << 8);
            if (sample > 32767) sample -= 65536;
            values[i] = sample / 32768;
          }
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          pending.push(source);
          source.onended = () => {
            const i = pending.indexOf(source);
            if (i >= 0) pending.splice(i, 1);
          };
          next = Math.max(next, context.currentTime + 0.02);
          source.start(next);
          next += buffer.duration;
          let energy = 0;
          for (const value of values) energy += value * value;
          loud.current = Math.min(1, Math.sqrt(energy / values.length) * 6);
          setStatus('Spricht');
          setPhase('speaking');
        });
        socket.on('speech', () => {
          clear();
          setAnswer('');
          setStatus('Hört zu');
          setPhase('listening');
        });
        socket.on('transcript', (t: { role: string; text: string }) => {
          if (t.role === 'user') setHeard(t.text);
          else setAnswer(t.text);
        });
        socket.on('saved', () => onSaved?.());
        socket.on('disconnect', () => {
          if (active) {
            setStatus('Verbindung beendet');
            setPhase('paused');
            close();
          }
        });
      } catch {
        if (active) {
          setError('Mikrofon oder Audioverbindung nicht verfügbar');
          setPhase('failed');
          close();
        }
      }
    };
    setError('');
    setHeard('');
    setAnswer('');
    setMuted(false);
    setStatus('Verbindet …');
    setPhase('idle');
    loud.current = 0;
    // The blob breathes with whatever is loud right now: your voice or Plum's.
    const meter = setInterval(() => setLevel(loud.current), 120);
    void connect();
    return () => {
      clearInterval(meter);
      clear();
      close();
    };
    // onFallback and voice are read when the session connects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chatId, usable]);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          {LIVE_MODEL_LABELS[usable] ?? 'Realtime-Sprache'} starten
        </Button>
        {(options.data?.gemini.length ?? 0) > 1 && (
          <select
            aria-label="Live-Modell"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={usable}
            onChange={(event) => {
              setModel(event.target.value);
              window.localStorage.setItem(LIVE_MODEL_KEY, event.target.value);
            }}
          >
            {options.data!.gemini.map((id) => (
              <option key={id} value={id}>
                {LIVE_MODEL_LABELS[id] ?? id}
              </option>
            ))}
          </select>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{LIVE_MODEL_LABELS[usable] ?? 'Realtime-Sprache'}</DialogTitle>
          <div className="plum-voice-presence">
            <PlumFace phase={muted ? 'paused' : phase} level={level} size={112} title="Plum" />
            <p role="status">{status}</p>
          </div>
          {heard && <p>{heard}</p>}
          {answer && <p aria-live="polite">{answer}</p>}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!!error}
              onClick={() => {
                const value = !muted;
                setMuted(value);
                resources.current.media?.getAudioTracks().forEach((t) => {
                  t.enabled = !value;
                });
              }}
            >
              {muted ? 'Mikrofon einschalten' : 'Stummschalten'}
            </Button>
            <Button onClick={() => setOpen(false)}>Beenden</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
