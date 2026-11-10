import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { nativeShell } from '@/lib/nativeShell';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { PlumFace, type FacePhase } from './PlumFace';

/** Full-duplex PCM; recognition, audio generation and interruption stay in one model session. */
export function RealtimeVoice({ chatId, onSaved }: { chatId: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(false),
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
          auth: { token, chatId },
          transports: ['websocket'],
          reconnection: false,
        });
        resources.current.socket = socket;
        socket.on('connect_error', () => {
          setError('Sprachverbindung nicht möglich');
          setStatus('Verbindung beendet');
          setPhase('failed');
          close();
        });
        socket.on('problem', (message: string) => {
          setError(message);
          setStatus('Verbindung beendet');
          setPhase('failed');
          close();
        });
        socket.on('ready', () => {
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
  }, [open, chatId]);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Realtime-Sprache
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Realtime-Sprache</DialogTitle>
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
