import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { transaction, get } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createResource, findResource, BODY_SCHEMAS } from './resources.js';
import { taskImage } from './taskFiles.js';
import { readArtifactImage } from './artifactImages.js';

const rectangle = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .strict()
  .refine((r) => r.x + r.width <= 1.000000001 && r.y + r.height <= 1.000000001);
export const IMAGE_EDIT_INPUT = z
  .object({
    commandId: z.string().uuid(),
    sourceRevision: z.number().int().positive(),
    assetId: z.string().uuid(),
    prompt: z.string().trim().min(1).max(10000),
    mode: z.enum(['edit', 'inpaint']),
    rectangles: z.array(rectangle).max(50),
  })
  .strict()
  .refine((i) => (i.mode === 'inpaint' ? i.rectangles.length > 0 : i.rectangles.length === 0));
let maskJobs = 0;
async function mask(bytes: Buffer, rectangles: z.infer<typeof rectangle>[]) {
  if (maskJobs >= 2) throw new AppError('Maskenerstellung beschäftigt', 429, 'IMAGE_MASK_BUSY');
  maskJobs++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(path.join(tmpdir(), 'plum-image-mask-'));
    const input = path.join(directory, 'original');
    await writeFile(input, bytes, { mode: 0o600 });
    const result = await promisify(execFile)(
      process.env.PLUM_PYTHON_BIN || '/usr/local/bin/plum-python',
      [path.resolve('scripts/plum-image-mask.py'), input, JSON.stringify(rectangles)],
      { encoding: 'buffer', timeout: 10000, maxBuffer: 5 * 1024 * 1024 }
    );
    return result.stdout;
  } catch (failure) {
    if (failure instanceof AppError) throw failure;
    throw new AppError(
      'Bildmaske konnte nicht erzeugt werden. Unterstütztes Original bis 16 Megapixel wählen.',
      422,
      'IMAGE_MASK_INVALID'
    );
  } finally {
    maskJobs--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
export async function createImageEditTask(
  userId: string,
  sourceTaskId: string,
  input: z.infer<typeof IMAGE_EDIT_INPUT>,
  expectedKind?: 'task' | 'artifact'
) {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        sourceTaskId,
        input.sourceRevision,
        input.assetId,
        input.prompt,
        input.mode,
        input.rectangles,
      ])
    )
    .digest('hex');
  // Read the selected immutable original before creating any permanent result.
  const receipt = await get(
    'SELECT action,payload_hash,result_json FROM assistant_commands WHERE user_id=? AND command_id=?',
    userId,
    input.commandId
  );
  if (receipt) {
    if (receipt.action !== 'image-edit-task' || receipt.payload_hash !== digest)
      throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
    return JSON.parse(receipt.result_json);
  }
  const source = await findResource(userId, sourceTaskId);
  if (expectedKind && source.kind !== expectedKind)
    throw new AppError('Bildquelle nicht gefunden', 404, 'NOT_FOUND');
  const version = await get(
    'SELECT body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
    source.id,
    input.sourceRevision
  );
  if (!version) throw new AppError('Eingaberevision nicht gefunden', 404, 'NOT_FOUND');
  const original =
    source.kind === 'task'
      ? await taskImage(userId, sourceTaskId, input.assetId, undefined, input.sourceRevision)
      : source.kind === 'artifact'
        ? await readArtifactImage(userId, JSON.parse(version.body_json), input.assetId).then(
            (image) => ({ ...image, id: image.assetId })
          )
        : null;
  if (!original) throw new AppError('Bildquelle nicht gefunden', 404, 'NOT_FOUND');
  if (original.bytes.length > 5 * 1024 * 1024)
    throw new AppError(
      'Für die Bearbeitung ein Bild bis 5 MB wählen. Das grössere Original bleibt erhalten.',
      413,
      'IMAGE_SIZE_LIMIT'
    );
  const bytes = input.mode === 'inpaint' ? await mask(original.bytes, input.rectangles) : null;
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const prior = await tx.get(
      'SELECT action,payload_hash,result_json FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (prior.action !== 'image-edit-task' || prior.payload_hash !== digest)
        throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
      return JSON.parse(prior.result_json);
    }
    let maskId: string | undefined;
    if (bytes) {
      const asset = await tx.get(
        'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO UPDATE SET sha256=excluded.sha256 RETURNING id',
        randomUUID(),
        userId,
        'Plum-Maske.png',
        'image/png',
        createHash('sha256').update(bytes).digest('hex'),
        bytes,
        new Date().toISOString()
      );
      maskId = asset.id;
    }
    const source = await findResource(userId, sourceTaskId, tx);
    const task = await createResource(
      userId,
      'task',
      `Bildbearbeitung: ${source.title}`.slice(0, 200),
      {
        ...BODY_SCHEMAS.task.parse({
          goal: input.prompt,
          deliverables: ['Bearbeitetes Bild mit erhaltenem Original und Vorschau in Plum'],
        }),
        inputImageIds: [...new Set([original.id, ...(maskId ? [maskId] : [])])],
        imageEdit: {
          mode: input.mode,
          originalAssetId: original.id,
          maskAssetId: maskId ?? null,
          prompt: input.prompt,
          rectangles: input.rectangles,
          ...(source.kind === 'task' ? { sourceTaskId } : { sourceArtifactId: sourceTaskId }),
          sourceRevision: input.sourceRevision,
        },
      },
      tx
    );
    const now = new Date().toISOString();
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
      userId,
      input.commandId,
      task.id,
      digest,
      'image-edit-task',
      JSON.stringify(task),
      now,
      now
    );
    return task;
  });
}
