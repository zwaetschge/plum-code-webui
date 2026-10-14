import { useQuery } from '@tanstack/react-query';
import type {
  ApiResponse,
  SkillLibraryItem,
  StyleLibraryResponse,
  WritingStyleType,
} from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { getDesignDisplayName } from '@/components/session/designPreviewTemplates';

/** Design and writing presets of the shared style library (provider-independent). */
export function useStyleLibrary(enabled = true) {
  return useQuery({
    queryKey: ['style-library', 'codex'],
    enabled,
    staleTime: 60_000,
    queryFn: async () =>
      (
        await api.get<ApiResponse<StyleLibraryResponse>>(
          '/api/claude-config/style-library?provider=codex'
        )
      ).data.data ?? { designStyles: [], writingStyles: [] },
  });
}

export const WRITING_STYLE_GROUPS: Array<{ type: WritingStyleType; label: string }> = [
  { type: 'prose', label: 'Schreibstile' },
  { type: 'author', label: 'Autorenstile' },
  { type: 'persona', label: 'Personas' },
];

export function styleLabel(items: SkillLibraryItem[] | undefined, baseName: string | null) {
  if (!baseName) return null;
  return items?.find((item) => item.baseName === baseName)?.name ?? baseName;
}

/** Readable design preset name („Plum Style") for hints and chips. */
export function designLabel(items: SkillLibraryItem[] | undefined, baseName: string | null) {
  if (!baseName) return null;
  const item = items?.find((entry) => entry.baseName === baseName);
  return item ? getDesignDisplayName(item) : baseName;
}
