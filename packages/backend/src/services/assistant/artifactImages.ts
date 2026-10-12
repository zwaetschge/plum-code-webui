import { createHash, randomUUID } from 'node:crypto';
import { get, type TransactionScope } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import type { AssistantArtifactImage } from '@plum-code-webui/shared';
import { parseAssistantDocument } from '@plum-code-webui/shared';

export async function bindArtifactImages(
  userId: string,
  body: Record<string, unknown>,
  tx: TransactionScope
) {
  const content = String(body.content ?? '');
  const generated =
    '/generated/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:png|jpg|webp)';
  const owned = '/assistant-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const reference = `(?:${generated}|${owned})`;
  const matches = [
    ...content.matchAll(new RegExp(`!\\[[^\\]\\n]*\\]\\(\\s*(${reference})\\s*\\)`, 'gi')),
    ...content.matchAll(new RegExp(`<img\\s[^>]*?src=["'](${reference})["']`, 'gi')),
  ];
  const urls = [
    ...new Set(
      body.type === 'document' && body.format === 'json'
        ? parseAssistantDocument(content)
            .blocks.filter((block) => block.type === 'image')
            .map((block) => `/assistant-images/${block.assetId}`)
        : body.type === 'image'
          ? (content.match(new RegExp(reference, 'gi')) ?? [])
          : matches.map((match) => match[1]!)
    ),
  ];
  if (urls.length > 4)
    throw new AppError(
      'Ein Ergebnis unterstützt höchstens vier Originalbilder',
      413,
      'ARTIFACT_IMAGE_LIMIT'
    );
  const images: AssistantArtifactImage[] = [];
  let total = 0;
  for (const url of urls) {
    const direct = url.startsWith('/assistant-images/');
    const known = direct
      ? await tx.get(
          'SELECT id,filename,mime_type,sha256,bytes FROM assistant_assets WHERE user_id=? AND id=?',
          userId,
          url.slice('/assistant-images/'.length)
        )
      : await tx.get(
          `SELECT a.id,a.filename,a.mime_type,a.sha256,a.bytes FROM assistant_assets a
      JOIN assistant_resources r ON r.user_id=a.user_id JOIN assistant_resource_revisions v ON v.resource_id=r.id
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.body_json::jsonb->'images')='array' THEN v.body_json::jsonb->'images' ELSE '[]'::jsonb END) image
      WHERE a.user_id=? AND r.kind='artifact' AND image->>'assetId'=a.id AND image->>'url'=? LIMIT 1`,
          userId,
          url
        );
    if (
      direct &&
      (!known || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(known.mime_type))
    )
      throw new AppError('Eigenes Bildoriginal nicht gefunden', 404, 'ORIGINAL_IMAGE_MISSING');
    let bytes: Buffer, mime: string, sha: string, id: string, filename: string;
    if (known) {
      bytes = Buffer.from(known.bytes);
      mime = known.mime_type;
      sha = known.sha256;
      id = known.id;
      filename = known.filename;
      if (createHash('sha256').update(bytes).digest('hex') !== sha)
        throw new AppError('Gespeichertes Original ist beschädigt', 409, 'ORIGINAL_IMAGE_CHANGED');
    } else {
      const { comfyui } = await import('../comfyui/index.js');
      try {
        ({ bytes, mime } = await comfyui.readOwnedImage(userId, url));
      } catch {
        throw new AppError(
          'Ergebnisbild gehört nicht zu diesem Konto oder ist nicht mehr vorhanden',
          404,
          'ORIGINAL_IMAGE_MISSING'
        );
      }
      sha = createHash('sha256').update(bytes).digest('hex');
      filename = url.slice('/generated/'.length);
      const asset = await tx.get(
        'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO UPDATE SET sha256=excluded.sha256 RETURNING id',
        randomUUID(),
        userId,
        filename,
        mime,
        sha,
        bytes,
        new Date().toISOString()
      );
      id = asset.id;
    }
    total += bytes.length;
    if (total > 50 * 1024 * 1024)
      throw new AppError(
        'Ergebnisbilder überschreiten zusammen 50 MB',
        413,
        'ARTIFACT_IMAGE_LIMIT'
      );
    images.push({
      url,
      assetId: id,
      filename,
      mimeType: mime,
      byteLength: bytes.length,
      sha256: sha,
    });
  }
  return { ...body, images };
}
export async function readArtifactImage(
  userId: string,
  body: Record<string, unknown>,
  assetId: string
) {
  const image = (Array.isArray(body.images) ? body.images : []).find(
    (item: AssistantArtifactImage) => item.assetId === assetId
  ) as AssistantArtifactImage | undefined;
  if (!image) throw new AppError('Bild ist nicht Teil dieses Ergebnisstands', 404, 'NOT_FOUND');
  const asset = await get(
    'SELECT bytes,mime_type,sha256 FROM assistant_assets WHERE id=? AND user_id=?',
    assetId,
    userId
  );
  if (!asset) throw new AppError('Bildoriginal nicht gefunden', 404, 'NOT_FOUND');
  const bytes = Buffer.from(asset.bytes);
  if (createHash('sha256').update(bytes).digest('hex') !== image.sha256)
    throw new AppError('Bildoriginal wurde verändert', 409, 'ORIGINAL_IMAGE_CHANGED');
  return { ...image, bytes };
}
