import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

interface VoiceOption {
  id?: string;
  name?: string;
  engine?: string;
}

const MISTRAL_PREFIX = 'mistral:';

/**
 * Voice choice for a profile: OmniVoice voices (stored by name) and, when a
 * Mistral API connection exists, Mistral voices (stored as `mistral:<id>`).
 * A stored value that is no longer offered stays selectable.
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
  const omni = (voices.data ?? []).filter((voice) => voice.engine !== 'mistral');
  const mistral = (voices.data ?? []).filter((voice) => voice.engine === 'mistral');
  const known = new Set([
    ...omni.map((voice) => voice.name ?? voice.id ?? ''),
    ...mistral.map((voice) => voice.id ?? ''),
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
          <option value={value}>
            {value.startsWith(MISTRAL_PREFIX) ? `Mistral · ${value.slice(8)}` : value}
          </option>
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
        {!!mistral.length && (
          <optgroup label="Mistral (API)">
            {mistral.map((voice) => (
              <option key={voice.id} value={voice.id ?? ''}>
                {voice.name ?? voice.id}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {voices.isError && (
        <span className="text-xs text-muted-foreground">
          Stimmenliste nicht verfügbar; der gespeicherte Name bleibt erhalten.
        </span>
      )}
    </label>
  );
}
