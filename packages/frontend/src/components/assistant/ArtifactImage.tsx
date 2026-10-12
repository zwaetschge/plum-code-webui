import { useEffect, useState } from 'react';
import type { AssistantArtifactImage, AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

export function ArtifactImage({
  src,
  alt,
  artifact,
  shareToken,
  documentAccess = false,
}: {
  src?: string;
  alt?: string;
  artifact: AssistantResource;
  shareToken?: string;
  documentAccess?: boolean;
}) {
  const owner = useAuthStore((state) => state.user?.id),
    [url, setUrl] = useState(''),
    [error, setError] = useState('');
  const image = (Array.isArray(artifact.body.images) ? artifact.body.images : []).find(
    (item: AssistantArtifactImage) => item.url === src
  ) as AssistantArtifactImage | undefined;
  const endpoint = image
    ? documentAccess
      ? `/api/assistant/documents/${artifact.id}/images/${image.assetId}?revision=${artifact.revision}`
      : shareToken
        ? `/api/assistant/shared/${encodeURIComponent(shareToken)}/images/${image.assetId}`
        : `/api/assistant/artifacts/${artifact.id}/images/${image.assetId}?revision=${artifact.revision}`
    : '';
  useEffect(() => {
    setUrl('');
    setError('');
    if (!endpoint) return;
    const controller = new AbortController();
    let objectUrl = '';
    void api
      .download(endpoint, { signal: controller.signal })
      .then((r) => r.blob())
      .then((blob) => {
        if (controller.signal.aborted || useAuthStore.getState().user?.id !== owner) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : 'Bildoriginal konnte nicht geladen werden'
          );
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endpoint, owner]);
  if (!image)
    return <img src={src} alt={alt ?? ''} className="max-w-full rounded-md" loading="lazy" />;
  if (error)
    return (
      <span role="alert" className="text-sm text-destructive">
        {error}
      </span>
    );
  if (!url)
    return (
      <span role="status" className="text-sm">
        Bildoriginal wird geladen …
      </span>
    );
  return <img src={url} alt={alt || image.filename} className="max-w-full rounded-md" />;
}
