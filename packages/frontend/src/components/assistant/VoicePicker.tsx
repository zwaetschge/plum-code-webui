import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { ReadAloudButton } from './ReadAloud';

interface VoiceOption {
  id?: string;
  name?: string;
  engine?: string;
}

const SAMPLE = 'Hallo! So klinge ich, wenn ich dir etwas vorlese.';

/** Fixed voice choice with a sample button per voice, grouped by engine (local OmniVoice, Mistral API). */
export function VoicePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (voice: string) => void;
}) {
  const owner = useAuthStore((state) => state.user?.id);
  const voices = useQuery({
    queryKey: ['assistant', 'voices', owner],
    queryFn: async () =>
      (await api.get<{ data: VoiceOption[] }>('/api/assistant/voice/voices')).data.data,
    retry: false,
    staleTime: 60_000,
  });
  const entries = (voices.data ?? []).map((voice) => ({
    key: voice.engine === 'mistral' ? String(voice.id) : String(voice.name ?? voice.id),
    label: String(voice.name ?? voice.id),
    engine: voice.engine === 'mistral' ? 'Mistral (API)' : 'OmniVoice (lokal)',
  }));
  const groups = [...new Set(entries.map((entry) => entry.engine))];
  return (
    <div className="grid gap-4" role="radiogroup" aria-label="Stimme">
      {voices.isError && (
        <p className="text-sm text-muted-foreground">Stimmen konnten nicht geladen werden.</p>
      )}
      {groups.map((group) => (
        <div key={group} className="grid gap-1">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground">{group}</h3>
          {entries
            .filter((entry) => entry.engine === group)
            .map((entry) => {
              const active = entry.key === value;
              return (
                <div
                  key={entry.key}
                  className={`flex items-center gap-2 rounded-xl px-3 py-1 ${active ? 'bg-primary/15' : ''}`}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className="flex min-h-10 flex-1 items-center justify-between text-left"
                    onClick={() => onChange(entry.key)}
                  >
                    <span>{entry.label}</span>
                    {active && <Check size={16} aria-hidden />}
                  </button>
                  <ReadAloudButton text={SAMPLE} voice={entry.key} label="Probe" />
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
