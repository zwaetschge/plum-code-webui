import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
export interface ToolFile {
  id: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  artifactId?: string | null;
}
export function ToolFiles({
  files,
  chatId,
  artifactId,
}: {
  files: ToolFile[];
  chatId?: string;
  artifactId?: string;
}) {
  const owner = useAuthStore((state) => state.user?.id);
  return (
    <div className="grid min-w-0 gap-3">
      {files.map((file) => (
        <File
          key={`${owner}:${file.id}`}
          file={file}
          endpoint={
            chatId
              ? `/api/assistant/api-chats/${chatId}/tool-files/${file.id}`
              : `/api/assistant/artifacts/${artifactId}/tool-files/${file.id}`
          }
        />
      ))}
    </div>
  );
}
function File({ file, endpoint }: { file: ToolFile; endpoint: string }) {
  const owner = useAuthStore((state) => state.user?.id);
  const [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const media = /^(image\/(png|jpeg|gif|webp)|audio\/(wav|flac|ogg|mpeg)|video\/mp4)$/.test(
    file.mimeType
  );
  useEffect(() => {
    if (!media) return;
    const controller = new AbortController();
    let objectUrl = '';
    void api
      .download(endpoint, { signal: controller.signal })
      .then((r) => r.blob())
      .then((blob) => {
        if (controller.signal.aborted || useAuthStore.getState().user?.id !== owner) return;
        objectUrl = URL.createObjectURL(new Blob([blob], { type: file.mimeType }));
        setUrl(objectUrl);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Datei nicht verfügbar');
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endpoint, media, file.mimeType, owner]);
  async function download() {
    setBusy(true);
    setError('');
    try {
      const blob = await (await api.download(endpoint)).blob();
      if (useAuthStore.getState().user?.id !== owner) return;
      const source = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = source;
      link.download = file.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(source), 30000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Download fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }
  return (
    <figure className="min-w-0 space-y-2 rounded-xl border p-3">
      {url &&
        (file.mimeType.startsWith('image/') ? (
          <img
            src={url}
            alt={file.filename}
            className="max-h-96 max-w-full rounded-lg object-contain"
          />
        ) : file.mimeType.startsWith('audio/') ? (
          <audio controls src={url} className="max-w-full" />
        ) : (
          <video controls src={url} className="max-h-96 max-w-full rounded-lg" />
        ))}
      <figcaption className="break-words text-sm font-medium">
        {file.filename} · {Math.max(1, Math.round(file.byteLength / 1024))} KB
      </figcaption>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-foreground hover:text-foreground"
          disabled={busy}
          onClick={() => void download()}
        >
          Datei herunterladen
        </Button>
        {file.artifactId && (
          <Link
            to={`/assistant/artifacts?resource=${file.artifactId}`}
            className="p-2 text-sm underline"
          >
            In Ergebnissen öffnen
          </Link>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </figure>
  );
}
