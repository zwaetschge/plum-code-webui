import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AssistantArtifactImage, AssistantResource } from '@plum-code-webui/shared';
import { readArtifactImage } from './artifactImages.js';
import { AppError } from '../../middleware/errorHandler.js';
let active = 0;
export async function wordImages(artifact: AssistantResource, userId?: string) {
  const images = (artifact.body.images ?? []) as AssistantArtifactImage[];
  const entries: Record<string, Buffer> = {},
    drawings = new Map<string, string>();
  if (!images.length) return { entries, drawings, relationships: '', contentTypes: '' };
  if (!userId)
    throw new AppError('Bilder benötigen den angemeldeten Eigentümer', 403, 'IMAGE_OWNER_REQUIRED');
  if (active >= 2) throw new AppError('Bildexport beschäftigt', 429, 'WORD_IMAGE_BUSY');
  active++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(path.join(tmpdir(), 'plum-word-images-'));
    const relationships: string[] = [],
      defaults = new Map<string, string>();
    let total = 0;
    for (const [index, image] of images.entries()) {
      const original = await readArtifactImage(userId, artifact.body, image.assetId);
      if (!['image/png', 'image/jpeg'].includes(original.mimeType))
        throw new AppError(
          'Word-Bildexport unterstützt PNG und JPEG. Das andere Original bleibt separat abrufbar.',
          422,
          'WORD_IMAGE_FORMAT'
        );
      total += original.bytes.length;
      if (total > 25 * 1024 * 1024)
        throw new AppError('Word-Bilder überschreiten zusammen 25 MB', 413, 'WORD_IMAGE_LIMIT');
      const input = path.join(directory, `image-${index}`);
      await writeFile(input, original.bytes, { mode: 0o600 });
      const metadata = await promisify(execFile)(
        process.env.PLUM_PYTHON_BIN || '/usr/local/bin/plum-python',
        [
          '-c',
          'from PIL import Image; import sys,json; im=Image.open(sys.argv[1]); assert im.width*im.height<=16000000; im.verify(); print(json.dumps([im.width,im.height]))',
          input,
        ],
        { timeout: 10000, maxBuffer: 10000 }
      );
      const [width, height] = JSON.parse(metadata.stdout) as [number, number];
      if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0)
        throw new Error('Invalid image dimensions');
      const scale = Math.min(5734050 / width, 7315200 / height),
        cx = Math.round(width * scale),
        cy = Math.round(height * scale),
        number = index + 1;
      const ext = original.mimeType === 'image/png' ? 'png' : 'jpg',
        filename = `image${number}.${ext}`;
      entries[`word/media/${filename}`] = original.bytes;
      defaults.set(ext, original.mimeType);
      relationships.push(
        `<Relationship Id="picture${number}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/>`
      );
      drawings.set(
        image.url,
        `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${number}" name="Bild ${number}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${number}" name="${filename}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="picture${number}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
      );
    }
    return {
      entries,
      drawings,
      relationships: relationships.join(''),
      contentTypes: [...defaults]
        .map(([ext, mime]) => `<Default Extension="${ext}" ContentType="${mime}"/>`)
        .join(''),
    };
  } catch (failure) {
    if (failure instanceof AppError) throw failure;
    throw new AppError(
      'Bild konnte nicht in Word eingebettet werden. Unterstütztes Original bis 16 Megapixel wählen.',
      422,
      'WORD_IMAGE_INVALID'
    );
  } finally {
    active--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
