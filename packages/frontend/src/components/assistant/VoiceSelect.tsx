import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

interface VoiceOption {
  id?: string;
  name?: string;
  engine?: string;
}

/** Voice APIs whose voices are stored as `<engine>:<id>`; OmniVoice stores the name. */
export const API_VOICE_ENGINES: Record<string, string> = {
  mistral: 'Mistral (API)',
  gemini: 'Gemini (API)',
};

function storedApiVoiceLabel(value: string): string | null {
  const engine = Object.keys(API_VOICE_ENGINES).find((id) => value.startsWith(`${id}:`));
  if (!engine) return null;
  return `${engine === 'gemini' ? 'Gemini' : 'Mistral'} · ${value.slice(engine.length + 1)}`;
}

/**
 * Voice choice for a profile: OmniVoice voices (stored by name) and, when a
 * Mistral or Google API connection exists, their voices (stored as
 * `mistral:<id>` / `gemini:<name>`). A stored value that is no longer offered
 * stays selectable.
 */
export function VoiceSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const owner = useAuthStore((state) => state.user?.id);
  const voices = useQuery({
    queryKey: ['assistant', 'voices', owner],
    queryFn: async () =>
      (await api.get<{ data: VoiceOption[] }>('/api/assistant/voice/voices')).data.data,
    retry: false,
    staleTime: 60_000,
  });
  const isApi = (voice: VoiceOption) => !!voice.engine && voice.engine in API_VOICE_ENGINES;
  const omni = (voices.data ?? []).filter((voice) => !isApi(voice));
  const apiGroups = Object.entries(API_VOICE_ENGINES)
    .map(([engine, label]) => ({
      label,
      voices: (voices.data ?? []).filter((voice) => voice.engine === engine),
    }))
    .filter((group) => group.voices.length);
  const known = new Set([
    ...omni.map((voice) => voice.name ?? voice.id ?? ''),
    ...apiGroups.flatMap((group) => group.voices.map((voice) => voice.id ?? '')),
  ]);
  return (
    <label className="grid gap-2 text-sm">
      <span>{label}</span>
      <select
        className="rounded-md border bg-background px-3 py-2"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {value && !known.has(value) && (
          <option value={value}>{storedApiVoiceLabel(value) ?? value}</option>
        )}
        {!!omni.length && (
          <optgroup label="OmniVoice (lokal)">
            {omni.map((voice) => (
              <option key={voice.id ?? voice.name} value={voice.name ?? voice.id ?? ''}>
                {voice.name ?? voice.id}
              </option>
            ))}
          </optgroup>
        )}
        {apiGroups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.voices.map((voice) => (
              <option key={voice.id} value={voice.id ?? ''}>
                {voice.name ?? voice.id}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {voices.isError && (
        <span className="text-xs text-muted-foreground">
          Stimmenliste nicht verfügbar; der gespeicherte Name bleibt erhalten.
        </span>
      )}
    </label>
  );
}
