import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';

/** Push-to-talk dictation. Disabling or changing the conversation releases the mic and discards pending audio. */
export function useVoiceInput(onText: (text: string) => void, enabled = true, scopeKey = '') {
  const [available, setAvailable] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const discard = useCallback(() => {
    generation.current++;
    uploadRef.current?.abort();
    uploadRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
    setBusy(false);
  }, []);
  useEffect(() => {
    if (!enabled) discard();
    return discard;
  }, [enabled, scopeKey, discard]);

  useEffect(() => {
    let cancelled = false;
    const supported =
      typeof window !== 'undefined' &&
      typeof window.MediaRecorder !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia);
    if (!supported || !enabled) return;
    api
      .get<{ success: boolean; data: { available: boolean } }>('/api/transcribe/status')
      .then((response) => {
        if (!cancelled) setAvailable(Boolean(response.data.data?.available));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setRecording(false);
  }, []);
  const start = useCallback(async () => {
    if (!enabledRef.current || busy) return;
    const captured = ++generation.current;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (captured !== generation.current || !enabledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) streamRef.current = null;
        if (captured !== generation.current || !enabledRef.current) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size === 0) return;
        const controller = new AbortController();
        uploadRef.current = controller;
        setBusy(true);
        try {
          const form = new FormData();
          form.append('audio', blob, 'speech.webm');
          const response = await api.post<{ success: boolean; data: { text: string } }>(
            '/api/transcribe',
            form,
            { signal: controller.signal }
          );
          if (captured !== generation.current || !enabledRef.current) return;
          const text = response.data.data?.text?.trim();
          if (text) onText(text);
          else setError('Nothing was recognised.');
        } catch (failure) {
          if (captured === generation.current && !controller.signal.aborted)
            setError(failure instanceof Error ? failure.message : 'Transcription failed');
        } finally {
          if (captured === generation.current) {
            uploadRef.current = null;
            setBusy(false);
          }
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (failure) {
      if (captured === generation.current) {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setError(failure instanceof Error ? failure.message : 'Microphone unavailable');
      }
    }
  }, [onText, busy]);
  const toggle = useCallback(() => {
    if (!enabledRef.current) return;
    if (recording) stop();
    else void start();
  }, [recording, start, stop]);
  return { available: available && enabled, recording, busy, error, toggle };
}
