import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  parseAssistantMotion,
  assistantMotionSvg,
  type AssistantResource,
} from '@plum-code-webui/shared';
import { AppError } from '../../middleware/errorHandler.js';
import { readMotionAudio } from './motionAudio.js';
let active = 0;
export async function exportMotion(
  artifact: AssistantResource,
  format: 'mp4' | 'png' | 'svg',
  userId?: string
) {
  if (artifact.body.type !== 'video' || artifact.body.format !== 'json')
    throw new AppError('Eine gespeicherte Plum-Animation wählen', 400, 'EXPORT_FORMAT_UNSUPPORTED');
  const model = parseAssistantMotion(String(artifact.body.content));
  if (format === 'svg')
    return {
      data: Buffer.from(assistantMotionSvg(model, 0)),
      mimeType: 'image/svg+xml',
    };
  if (active) throw new AppError('Clip-Export ist gerade ausgelastet', 429, 'MOTION_BUSY');
  active++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(path.join(os.tmpdir(), 'plum-motion-'));
    const count = format === 'png' ? 1 : model.duration * model.fps;
    const input = path.join(directory, 'frames.json'),
      output = path.join(directory, `output.${format}`);
    await writeFile(
      input,
      JSON.stringify({
        width: model.width,
        height: model.height,
        fps: model.fps,
        frames: Array.from({ length: count }, (_, frame) =>
          assistantMotionSvg(model, count > 1 ? frame / (count - 1) : 0)
        ),
      }),
      { mode: 0o600 }
    );
    await promisify(execFile)(
      process.env.PLUM_PYTHON_BIN || '/usr/local/bin/plum-python',
      [
        fileURLToPath(new URL('../../../../../scripts/plum-motion-render.py', import.meta.url)),
        input,
        output,
      ],
      { timeout: 90000, maxBuffer: 100000, env: { PATH: process.env.PATH, LANG: 'C.UTF-8' } }
    );
    let finalOutput = output;
    if (format === 'mp4' && artifact.body.audioAssetId) {
      if (!userId) throw new AppError('Audioexport erfordert den Besitzer.', 403, 'OWNER_REQUIRED');
      const audio = await readMotionAudio(userId, artifact.body),
        audioPath = path.join(directory, 'original.wav'),
        joined = path.join(directory, 'with-audio.mp4');
      const { waveFacts } = await import('./motionAudio.js');
      if (waveFacts(audio.bytes).duration > model.duration + 0.001)
        throw new AppError('Audiospur ist länger als die Animation.', 409, 'MOTION_AUDIO_DURATION');
      await writeFile(audioPath, audio.bytes, { mode: 0o600 });
      await promisify(execFile)(
        'ffmpeg',
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          output,
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          audioPath,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-af',
          'apad',
          '-t',
          String(model.duration),
          '-threads',
          '1',
          '-movflags',
          '+faststart',
          joined,
        ],
        { timeout: 30000, maxBuffer: 100000, env: { PATH: process.env.PATH } }
      );
      finalOutput = joined;
    }
    const data = await readFile(finalOutput);
    if (data.length > 32 * 1024 * 1024)
      throw new AppError('Der Clip überschreitet 32 MB', 413, 'MOTION_LIMIT');
    return { data, mimeType: format === 'png' ? 'image/png' : 'video/mp4' };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'Clip konnte nicht gerendert werden. Die Originalrevision bleibt erhalten.',
      422,
      'MOTION_RENDER_FAILED'
    );
  } finally {
    active--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
