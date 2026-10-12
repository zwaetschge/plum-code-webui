import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createResource, findResource, reviseResource } from './resources.js';

const exec = promisify(execFile);
const PDF_EXTRACT = `import fitz,json,sys
doc=fitz.open(sys.argv[1]); result=[]; budget=48000
for index in range(min(len(doc),500)):
 text=doc[index].get_text(); usable=text[:budget]; budget-=len(usable)
 if usable.strip(): result.append({"page":index+1,"text":usable})
 if budget<=0: break
print(json.dumps({"pages":result,"pageCount":len(doc),"truncated":budget<=0 or len(doc)>500},ensure_ascii=False))`;

export async function ingestSource(
  userId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string },
  projectId?: string,
  replacement?: { id: string; expectedRevision: number }
) {
  const current = replacement ? await findResource(userId, replacement.id) : null;
  if (current && current.kind !== 'source')
    throw new AppError('Quelle nicht gefunden', 404, 'NOT_FOUND');
  if (current && current.revision !== replacement!.expectedRevision)
    throw new AppError('Quelle wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
  if (current && !projectId)
    projectId = typeof current.body.projectId === 'string' ? current.body.projectId : undefined;
  if (projectId && (await findResource(userId, projectId)).kind !== 'project')
    throw new AppError('Wissensprojekt nicht gefunden', 404, 'NOT_FOUND');
  const filename = file.originalname.slice(0, 200);
  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  let text = '';
  let pageCount: number | undefined;
  let truncated = false;
  let pages: Array<{ page: number; text: string }> = [];
  let office: Record<string, unknown> | undefined;
  let detectedMime = 'text/plain';
  if (file.buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    detectedMime = 'application/pdf';
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'plum-source-'));
    try {
      const input = path.join(temporary, 'input.pdf');
      await writeFile(input, file.buffer, { mode: 0o600 });
      const extracted = await exec(
        process.env.PLUM_PYTHON_BIN || '/usr/local/bin/plum-python',
        ['-c', PDF_EXTRACT, input],
        { timeout: 45000, maxBuffer: 1024 * 1024 }
      );
      const result = JSON.parse(extracted.stdout) as {
        pages: typeof pages;
        pageCount: number;
        truncated: boolean;
      };
      pages = result.pages;
      pageCount = result.pageCount;
      truncated = result.truncated;
      const combined = pages.map((page) => `[Seite ${page.page}]\n${page.text}`).join('\n\n');
      truncated ||= combined.length > 50000;
      text = combined.slice(0, 50000);
      if (!text.trim())
        throw new AppError(
          'Das PDF enthält keinen auslesbaren Text; OCR ist für diese Quelle erforderlich',
          422,
          'SOURCE_OCR_REQUIRED'
        );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('PDF konnte nicht gelesen werden', 422, 'SOURCE_IMPORT_FAILED');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  } else if (file.buffer.subarray(0, 2).toString('ascii') === 'PK') {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'plum-office-'));
    try {
      const input = path.join(temporary, 'input.zip');
      await writeFile(input, file.buffer, { mode: 0o600 });
      const extracted = await exec(
        process.env.PLUM_PYTHON_BIN || '/usr/local/bin/plum-python',
        [
          fileURLToPath(new URL('../../../../../scripts/plum-office-extract.py', import.meta.url)),
          input,
        ],
        { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }
      );
      office = JSON.parse(extracted.stdout);
      if (
        !office ||
        typeof office.text !== 'string' ||
        !['docx', 'xlsx', 'pptx'].includes(String(office.kind))
      )
        throw new Error('Invalid Office extraction');
      text = office.text.slice(0, 50000);
      truncated = office.truncated === true || office.text.length > 50000;
      detectedMime = `application/vnd.openxmlformats-officedocument.${office.kind === 'docx' ? 'wordprocessingml.document' : office.kind === 'xlsx' ? 'spreadsheetml.sheet' : 'presentationml.presentation'}`;
    } catch {
      throw new AppError(
        'Office-Datei konnte nicht gelesen werden. DOCX, XLSX und PPTX ohne Verschlüsselung werden unterstützt; alte binäre Office-Formate benötigen eine Konvertierung.',
        422,
        'SOURCE_IMPORT_FAILED'
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch {
      throw new AppError(
        'Bitte PDF, DOCX, XLSX, PPTX oder eine UTF-8-Textdatei verwenden',
        415,
        'SOURCE_TYPE_UNSUPPORTED'
      );
    }
    if (text.includes('\0'))
      throw new AppError('Binäre Datei ist keine Textquelle', 415, 'SOURCE_TYPE_UNSUPPORTED');
    truncated = text.length > 50000;
    text = text.slice(0, 50000);
  }
  if (!text.trim()) throw new AppError('Die Quelle enthält keinen Text', 422, 'SOURCE_EMPTY');
  return transaction(async (tx) => {
    const asset = await tx.get(
      `INSERT INTO assistant_assets (id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id,sha256) DO UPDATE SET sha256 = excluded.sha256 RETURNING id`,
      randomUUID(),
      userId,
      filename,
      detectedMime,
      sha256,
      file.buffer,
      new Date().toISOString()
    );
    const body = {
      text,
      citation: filename,
      mimeType: detectedMime,
      ...(office ? { office } : {}),
      ...(projectId ? { projectId } : {}),
      sha256,
      filename,
      pageCount,
      truncated,
      pages,
      ingestedAt: new Date().toISOString(),
      ingestion: 'ready',
      assetId: asset.id,
    };
    if (current?.body.capture === 'public-web')
      await tx.run(
        'UPDATE assistant_source_watches SET enabled=0,revision=revision+1,error=NULL,updated_at=? WHERE source_id=? AND user_id=?',
        new Date().toISOString(),
        current.id,
        userId
      );
    return current
      ? reviseResource(userId, current.id, replacement!.expectedRevision, current.title, body, tx)
      : createResource(userId, 'source', filename, body, tx);
  });
}
