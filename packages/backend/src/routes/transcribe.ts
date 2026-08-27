import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Speech-to-text for the composers. The heavy lifting happens in an external
 * Whisper-compatible service (Vocarium by default) so no model ships with the
 * WebUI; without `TRANSCRIBE_URL` the clients simply do not offer the button.
 *
 * Contract: multipart upload under the field name `audio`, answering
 * `{ success, data: { text } }`.
 */
const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const TRANSCRIBE_URL = () => process.env.TRANSCRIBE_URL?.replace(/\/$/, '') || '';

router.get('/status', requireAuth, async (_req: Request, res: Response) => {
  res.json({ success: true, data: { available: Boolean(TRANSCRIBE_URL()) } });
});

router.post('/', requireAuth, upload.single('audio'), async (req: Request, res: Response) => {
  const endpoint = TRANSCRIBE_URL();
  if (!endpoint) {
    throw new AppError(
      'Transcription is not configured — set TRANSCRIBE_URL.',
      503,
      'TRANSCRIBE_UNAVAILABLE'
    );
  }
  if (!req.file) throw new AppError('Missing audio upload', 400, 'MISSING_AUDIO');

  const form = new FormData();
  form.append(
    'file',
    new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }),
    req.file.originalname || 'speech.webm'
  );
  if (process.env.TRANSCRIBE_MODEL) form.append('model', process.env.TRANSCRIBE_MODEL);
  if (req.body?.language) form.append('language', String(req.body.language).slice(0, 10));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      headers: process.env.TRANSCRIBE_TOKEN
        ? { Authorization: `Bearer ${process.env.TRANSCRIBE_TOKEN}` }
        : undefined,
    });
    if (!upstream.ok) {
      throw new AppError(
        `Transcription service answered ${upstream.status}`,
        502,
        'TRANSCRIBE_FAILED'
      );
    }
    const payload = (await upstream.json()) as { text?: string; transcript?: string };
    const text = (payload.text ?? payload.transcript ?? '').trim();
    res.json({ success: true, data: { text } });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      (error as Error).name === 'AbortError'
        ? 'Transcription timed out'
        : `Transcription failed: ${(error as Error).message}`,
      502,
      'TRANSCRIBE_FAILED'
    );
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
