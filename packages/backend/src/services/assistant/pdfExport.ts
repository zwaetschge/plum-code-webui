import { slidesHtml } from './slidesDrawing.js';
import { comparisonHtml } from './comparisonDrawing.js';
import katex from 'katex';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  parseAssistantSlides,
  parseAssistantComparison,
  slidesFromText,
  parseAssistantCsv,
  parseAssistantSheet,
  evaluateAssistantSheet,
  parseAssistantDocument,
  parseAssistantNotebook,
  assistantNotebookReport,
  type AssistantResource,
  type AssistantArtifactImage,
} from '@plum-code-webui/shared';
import { readArtifactImage } from './artifactImages.js';
import { AppError } from '../../middleware/errorHandler.js';
import { documentHtml } from './exports.js';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
let fontCss: Promise<string> | null = null;
async function mathCss() {
  fontCss ??= (async () => {
    const cssPath = createRequire(import.meta.url).resolve('katex/dist/katex.min.css');
    const css = (await readFile(cssPath, 'utf8')).replace(
      /,url\(fonts\/[^)]+\.(?:woff|ttf)\) format\("[^"]+"\)/g,
      ''
    );
    const names = [
      ...new Set([...css.matchAll(/url\((fonts\/[A-Za-z0-9_.-]+)\)/g)].map((match) => match[1]!)),
    ];
    const embedded = new Map<string, string>();
    for (const name of names) {
      const bytes = await readFile(path.join(path.dirname(cssPath), name));
      embedded.set(
        name,
        `data:font/${name.endsWith('.woff2') ? 'woff2' : name.endsWith('.woff') ? 'woff' : 'ttf'};base64,${bytes.toString('base64')}`
      );
    }
    return css.replace(
      /url\((fonts\/[A-Za-z0-9_.-]+)\)/g,
      (_all, name: string) => `url(${embedded.get(name)})`
    );
  })().catch((error) => {
    fontCss = null;
    throw error;
  });
  return fontCss;
}
let active = 0;
export async function exportPdf(artifact: AssistantResource, userId?: string) {
  if (
    ![
      'document',
      'research',
      'notebook',
      'latex',
      'table',
      'slides',
      'comparison',
      'image',
    ].includes(String(artifact.body.type))
  )
    throw new AppError(
      'Dieses Ergebnis unterstützt keinen PDF-Export',
      400,
      'EXPORT_FORMAT_UNSUPPORTED'
    );
  if (active >= 2) throw new AppError('PDF-Export ist gerade ausgelastet', 429, 'PDF_BUSY');
  active++;
  let directory: string | undefined;
  try {
    const raw = String(artifact.body.content ?? '');
    const images = new Map<string, { data: string; filename: string }>();
    let imageBytes = 0;
    for (const metadata of (Array.isArray(artifact.body.images)
      ? artifact.body.images
      : []) as AssistantArtifactImage[]) {
      if (!userId)
        throw new AppError(
          'Bildexport benötigt das eigene angemeldete Konto',
          403,
          'IMAGE_OWNER_REQUIRED'
        );
      const image = await readArtifactImage(userId, artifact.body, metadata.assetId);
      imageBytes += image.bytes.length;
      if (imageBytes > 2 * 1024 * 1024)
        throw new AppError(
          'PDF-Bilder überschreiten zusammen 2 MB. Das Original separat herunterladen oder eine kleinere eigene Kopie verwenden.',
          413,
          'PDF_IMAGE_LIMIT'
        );
      images.set(image.url, {
        data: `data:${image.mimeType};base64,${image.bytes.toString('base64')}`,
        filename: image.filename,
      });
    }
    const used = new Set<string>();
    const imageLine = (line: string) => {
      const pattern =
        /!\[([^\]\n]*)\]\(\s*((?:\/generated\/[0-9a-f-]{36}\.(?:png|jpg|webp)|\/assistant-images\/[0-9a-f-]{36}))\s*\)/gi;
      let output = '',
        offset = 0;
      for (const match of line.matchAll(pattern)) {
        const image = images.get(match[2]!);
        if (!image) continue;
        output += escape(line.slice(offset, match.index));
        output += `<img src="${image.data}" alt="${escape(match[1] || image.filename)}" style="max-width:100%;max-height:700px;object-fit:contain;display:block;margin:8px 0;break-inside:avoid">`;
        used.add(match[2]!);
        offset = match.index! + match[0].length;
      }
      return output + escape(line.slice(offset));
    };
    let html = '',
      css = '';
    if (artifact.body.type === 'latex') {
      try {
        html = katex.renderToString(raw, {
          displayMode: true,
          trust: false,
          throwOnError: true,
          strict: 'error',
          maxExpand: 500,
          maxSize: 20,
        });
      } catch {
        throw new AppError(
          'Die Formel enthält ungültige oder nicht unterstützte KaTeX-Syntax. Die Originalrevision bleibt erhalten.',
          422,
          'PDF_MATH_INVALID'
        );
      }
      css = await mathCss();
    } else if (artifact.body.type === 'comparison')
      html = comparisonHtml(parseAssistantComparison(raw));
    else if (artifact.body.type === 'document' && artifact.body.format === 'json')
      html = documentHtml(
        parseAssistantDocument(raw),
        new Map([...images].map(([url, image]) => [url, image.data]))
      );
    else if (artifact.body.type === 'notebook') {
      const notebook = parseAssistantNotebook(raw);
      html = `<p style="white-space:pre-wrap">${escape(assistantNotebookReport({ ...notebook, run: undefined }))}</p>`;
      if (notebook.run) {
        html += `<p>Datensatzrevision ${notebook.datasetRevision} · SHA-256 ${escape(notebook.run.datasetHash)} · Lauf ${escape(notebook.run.id)}</p>`;
        for (const output of notebook.run.outputs) {
          html += `<h2>${escape(output.title)}</h2><table><thead><tr>${output.columns.map((name) => `<th>${escape(name)}</th>`).join('')}</tr></thead><tbody>${output.rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(String(cell ?? '—'))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
          if (output.series?.length) {
            const series = output.series.slice(0, 20),
              min = Math.min(0, ...series.map((item) => item.value)),
              max = Math.max(0, ...series.map((item) => item.value)),
              width = max - min || 1;
            const x = (value: number) => 180 + ((value - min) / width) * 430,
              zero = x(0);
            html += `<svg viewBox="0 0 700 ${series.length * 26 + 30}" role="img" aria-label="${escape(output.title)}" style="width:100%;break-inside:avoid">${series.map((item, index) => `<text x="0" y="${index * 26 + 19}" font-size="12">${escape(item.label.slice(0, 24))}</text><rect x="${Math.min(zero, x(item.value))}" y="${index * 26 + 4}" width="${Math.abs(x(item.value) - zero)}" height="18" fill="${item.value < 0 ? '#B45B24' : '#1856FF'}"/><text x="620" y="${index * 26 + 19}" font-size="12">${escape(String(item.value))}</text>`).join('')}</svg>`;
            if (output.series.length > 20)
              html += `<p>Diagramm: erste 20 von ${output.series.length} Gruppen; alle Werte stehen in der Tabelle.</p>`;
          }
        }
      }
    } else if (
      artifact.body.type === 'table' &&
      ['csv', 'json'].includes(String(artifact.body.format))
    ) {
      const cells =
        artifact.body.format === 'json'
          ? evaluateAssistantSheet(parseAssistantSheet(raw)).map((row) =>
              row.map((cell) => String(cell.value))
            )
          : parseAssistantCsv(raw);
      html = `<table><tbody>${cells.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } else if (artifact.body.type === 'slides') {
      html = slidesHtml(
        artifact.body.format === 'json' ? parseAssistantSlides(raw) : slidesFromText(raw)
      );
    } else
      html = raw
        .split('\n')
        .map((line) => {
          const heading = /^(#{1,6})\s+(.*)$/.exec(line);
          return heading
            ? `<h${heading[1]!.length}>${escape(heading[2]!)}</h${heading[1]!.length}>`
            : `<p style="white-space:pre-wrap">${imageLine(line)}</p>`;
        })
        .join('');
    if (artifact.body.type === 'image')
      for (const [url, image] of images)
        if (!used.has(url))
          html += `<figure><img src="${image.data}" alt="${escape(image.filename)}" style="max-width:100%;max-height:700px;object-fit:contain"><figcaption>${escape(image.filename)}</figcaption></figure>`;
    const document = `<!doctype html><html lang="de-CH"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'unsafe-inline'; script-src 'none'; img-src data:; base-uri 'none'"><title>${escape(artifact.title)}</title><style>${css}\nbody{margin:0;font-family:Arial,sans-serif;font-size:11pt;line-height:1.5;overflow-wrap:anywhere;color:#141414}h1,h2,h3{break-after:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:9pt}th,td{border:1px solid #888;padding:5px;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}pre{white-space:pre-wrap}a{color:#1856ff}.katex-display{overflow:visible}.katex{font-size:1.1em}</style></head><body><h1>${escape(artifact.title)}</h1>${html}</body></html>`;
    directory = await mkdtemp(path.join(os.tmpdir(), 'plum-pdf-'));
    const input = path.join(directory, 'input.html'),
      output = path.join(directory, 'output.pdf');
    await writeFile(input, document, { mode: 0o600 });
    await promisify(execFile)(
      process.env.PLUM_PYTHON_BIN || '/usr/local/bin/plum-python',
      [
        fileURLToPath(new URL('../../../../../scripts/plum-print-pdf.py', import.meta.url)),
        input,
        output,
        artifact.body.type === 'slides' ? 'landscape' : 'portrait',
      ],
      { timeout: 45000, maxBuffer: 100000, env: { PATH: process.env.PATH, LANG: 'C.UTF-8' } }
    );
    const data = await readFile(output);
    if (data.length > 16 * 1024 * 1024 || !data.subarray(0, 5).equals(Buffer.from('%PDF-')))
      throw new Error('Invalid PDF');
    return { data, mimeType: 'application/pdf' };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (String((error as { stderr?: string })?.stderr).includes('Formula exceeds printable width'))
      throw new AppError(
        'Die Formel ist zu breit für eine A4-Seite. Bitte mit aligned oder split in mehrere Zeilen aufteilen.',
        422,
        'PDF_MATH_WIDTH'
      );
    throw new AppError('PDF konnte nicht erstellt werden', 422, 'PDF_EXPORT_FAILED');
  } finally {
    active--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
