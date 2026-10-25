import { useEffect, useState } from 'react';
import type { AssistantApiImage } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';

export async function uploadChatAttachments(id: string, files: File[]) {
  const owner = useAuthStore.getState().user?.id,
    result: string[] = [],
    documents: string[] = [];
  for (const file of files) {
    if (useAuthStore.getState().user?.id !== owner) throw new Error('Das Konto wurde gewechselt');
    const form = new FormData();
    form.append('file', file);
    const isImage = file.type.startsWith('image/');
    const image = (
      await api.post<{ data: AssistantApiImage }>(
        `/api/assistant/api-chats/${id}/${isImage ? 'images' : 'documents'}`,
        form
      )
    ).data.data;
    if (useAuthStore.getState().user?.id !== owner) throw new Error('Das Konto wurde gewechselt');
    (isImage ? result : documents).push(image.id);
  }
  return { imageAssetIds: result, documentSourceIds: documents };
}
export function ChatImageInput({
  files,
  onChange,
  disabled,
  remaining = 4,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
  remaining?: number;
}) {
  const [error, setError] = useState('');
  return (
    <div className="space-y-2">
      <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">
        Dateien anhängen
        <input
          disabled={disabled}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.ts,.py,.html,.css,.js"
          className="sr-only"
          aria-label="Dateien anhängen"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length + chosen.length > remaining) {
              setError('Höchstens vier Dateien pro Nachricht auswählen');
              return;
            }
            if (
              chosen.some(
                (file) => file.size > (file.type.startsWith('image/') ? 5 : 25) * 1024 * 1024
              )
            ) {
              setError('Bilder: höchstens 5 MB. Dokumente: höchstens 25 MB.');
              return;
            }
            setError('');
            onChange([...files, ...chosen]);
          }}
        />
      </label>
      {files.map((file, index) => (
        <div key={`${file.name}:${index}`} className="flex min-w-0 items-center gap-2 text-sm">
          <span className="min-w-0 break-all">{file.name}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange(files.filter((_, n) => n !== index))}
            aria-label={`${file.name} entfernen`}
          >
            Entfernen
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
export function ChatImageStrip({
  chatId,
  ids,
  source = 'chat',
  revision,
}: {
  chatId: string;
  ids: string[];
  source?: 'chat' | 'task';
  revision?: number;
}) {
  const owner = useAuthStore((state) => state.user?.id),
    encoded = JSON.stringify(ids),
    [images, setImages] = useState<string[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    const urls: string[] = [];
    let active = true;
    setImages([]);
    setError('');
    void (async () => {
      for (const id of JSON.parse(encoded) as string[]) {
        const response = await api.download(
            `/api/assistant/${source === 'task' ? 'tasks' : 'api-chats'}/${chatId}/images/${id}${revision === undefined ? '' : '?revision=' + revision}`
          ),
          blob = await response.blob();
        if (!active) return;
        urls.push(URL.createObjectURL(blob));
      }
      if (active) setImages([...urls]);
    })().catch(() => {
      if (active) setError('Bildanhang konnte nicht geladen werden');
    });
    return () => {
      active = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [chatId, encoded, owner, source, revision]);
  if (!ids.length) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {images.map((url, index) => (
        <a
          key={url}
          href={url}
          download={`Bild-${index + 1}`}
          className="max-w-full rounded-md focus-visible:outline focus-visible:outline-2"
        >
          <img
            src={url}
            alt={`Bildanhang ${index + 1}`}
            className="max-h-40 max-w-full rounded-md object-contain"
          />
        </a>
      ))}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
