import { slideShapes, slideNotes, slidesHtml } from './slidesDrawing.js';
import { comparisonHtml } from './comparisonDrawing.js';
import archiver from 'archiver';
import ExcelJS from 'exceljs';
import { PassThrough } from 'node:stream';
import {
  parseAssistantDocument,
  assistantDocumentText,
  assistantDocumentMarkdown,
  type AssistantDocument,
  type AssistantDocumentRun,
  parseAssistantCsv,
  parseAssistantSheet,
  evaluateAssistantSheet,
  serializeAssistantCsv,
  parseAssistantNotebook,
  assistantNotebookReport,
  parseAssistantSlides,
  slidesFromText,
  assistantSlidesText,
  parseAssistantComparison,
  assistantComparisonText,
} from '@plum-code-webui/shared';
import { AppError } from '../../middleware/errorHandler.js';
import type { AssistantResource } from '@plum-code-webui/shared';

const xml = (text: string) =>
  text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!
    );
async function zip(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  const archive = archiver('zip', { zlib: { level: 6 } });
  const complete = new Promise<Buffer>((resolve, reject) => {
    output.on('data', (chunk) => chunks.push(chunk));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  for (const [name, content] of Object.entries(entries)) archive.append(content, { name });
  await archive.finalize();
  return complete;
}
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

export function documentHtml(doc: AssistantDocument, images = new Map<string, string>()) {
  const runs = (items: AssistantDocumentRun[]) =>
    items
      .map((run) => {
        let text = xml(run.text).replace(/\n/g, '<br>');
        if (run.bold) text = `<strong>${text}</strong>`;
        if (run.italic) text = `<em>${text}</em>`;
        if (run.underline) text = `<u>${text}</u>`;
        if (run.href) text = `<a href="${xml(run.href)}" rel="noreferrer">${text}</a>`;
        return text;
      })
      .join('');
  return doc.blocks
    .map((block) => {
      if (block.type === 'image') {
        const src = images.get(`/assistant-images/${block.assetId}`);
        return `<figure>${src ? `<img src="${xml(src)}" alt="${xml(block.alt)}" style="max-width:100%;max-height:700px;object-fit:contain">` : `<p>${xml(block.alt)}</p>`}${block.caption ? `<figcaption>${xml(block.caption)}</figcaption>` : ''}</figure>`;
      }
      if (block.type === 'table')
        return `<table border="1">${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${runs(cell)}</td>`).join('')}</tr>`).join('')}</table>`;
      const tag =
        block.type === 'heading'
          ? `h${block.level ?? 1}`
          : block.type === 'quote'
            ? 'blockquote'
            : block.type === 'code'
              ? 'pre'
              : 'p';
      const body = `<${tag} style="text-align:${block.align ?? 'left'}">${runs(block.runs)}</${tag}>`;
      return block.type === 'list'
        ? `<${block.ordered ? 'ol' : 'ul'}><li>${runs(block.runs)}</li></${block.ordered ? 'ol' : 'ul'}>`
        : body;
    })
    .join('');
}
function documentWord(doc: AssistantDocument, drawings: Map<string, string>) {
  const links: string[] = [];
  const runs = (items: AssistantDocumentRun[]) =>
    items
      .map((run) => {
        const properties = [
          run.bold ? '<w:b/>' : '',
          run.italic ? '<w:i/>' : '',
          run.underline ? '<w:u w:val="single"/>' : '',
        ].join('');
        const parts = run.text
          .split(/([\n\t])/)
          .map((part) =>
            part === '\n'
              ? '<w:br/>'
              : part === '\t'
                ? '<w:tab/>'
                : `<w:t xml:space="preserve">${xml(part)}</w:t>`
          )
          .join('');
        const body = `<w:r><w:rPr>${properties}</w:rPr>${parts}</w:r>`;
        if (!run.href) return body;
        links.push(run.href);
        return `<w:hyperlink r:id="link${links.length}">${body}</w:hyperlink>`;
      })
      .join('');
  let listId = 0,
    lastList: string | null = null;
  const numbers: Array<{ id: number; ordered: boolean }> = [];
  let imageNumber = 0;
  const paragraphs = doc.blocks
    .map((block) => {
      if (block.type === 'image') {
        lastList = null;
        const image = drawings.get(`/assistant-images/${block.assetId}`);
        if (!image)
          throw new AppError(
            'Dokumentbild ist nicht an die Ergebnisrevision gebunden',
            409,
            'ORIGINAL_IMAGE_MISSING'
          );
        return (
          image
            .replace(/<wp:docPr id="[0-9]+"/, `<wp:docPr id="${++imageNumber}"`)
            .replace(/name="Bild [0-9]+"/, `name="${xml(block.alt || 'Bild')}"`) +
          (block.caption
            ? `<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t xml:space="preserve">${xml(block.caption)}</w:t></w:r></w:p>`
            : '')
        );
      }
      if (block.type === 'table') {
        lastList = null;
        return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="single" w:sz="4"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${block.rows[0]!.map(() => '<w:gridCol w:w="2400"/>').join('')}</w:tblGrid>${block.rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:p>${runs(cell)}</w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
      }
      const properties = [];
      if (block.type === 'heading')
        properties.push(`<w:pStyle w:val="Heading${block.level ?? 1}"/>`);
      if (block.align)
        properties.push(`<w:jc w:val="${block.align === 'justify' ? 'both' : block.align}"/>`);
      if (block.type === 'quote') properties.push('<w:ind w:left="720"/>');
      if (block.type === 'list') {
        const kind = block.ordered ? 'ordered' : 'bullet';
        if (lastList !== kind) {
          listId++;
          numbers.push({ id: listId, ordered: !!block.ordered });
        }
        lastList = kind;
        properties.push(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${listId}"/></w:numPr>`);
      } else lastList = null;
      return `<w:p><w:pPr>${properties.join('')}</w:pPr>${runs(block.runs)}</w:p>`;
    })
    .join('');
  return { paragraphs, links, numbers };
}

export async function exportArtifact(artifact: AssistantResource, format: string, userId?: string) {
  if (format === 'py') {
    if (
      artifact.body.type !== 'code' ||
      artifact.body.language !== 'python' ||
      artifact.body.format !== 'text'
    )
      throw new AppError(
        'Für Python ein Codeartefakt mit language=python und format=text speichern',
        400,
        'EXPORT_FORMAT_UNSUPPORTED'
      );
    return {
      data: Buffer.from(String(artifact.body.content)),
      mimeType: 'text/x-python; charset=utf-8',
    };
  }
  if (format === 'mp4' || format === 'png' || format === 'svg')
    return (await import('./motionExport.js')).exportMotion(artifact, format, userId);
  if (format === 'pdf') return (await import('./pdfExport.js')).exportPdf(artifact, userId);
  let content = String(artifact.body.content ?? '');
  const comparison = artifact.body.type === 'comparison' ? parseAssistantComparison(content) : null;
  if (comparison && format !== 'json') content = assistantComparisonText(comparison);
  const document =
    artifact.body.type === 'document' && artifact.body.format === 'json'
      ? parseAssistantDocument(content)
      : null;
  if (document && format !== 'json')
    content =
      format === 'md' ? assistantDocumentMarkdown(document) : assistantDocumentText(document);
  if (artifact.body.type === 'notebook' && format !== 'json')
    content = assistantNotebookReport(parseAssistantNotebook(content));
  const deck =
    artifact.body.type === 'slides'
      ? artifact.body.format === 'json'
        ? parseAssistantSlides(String(artifact.body.content))
        : slidesFromText(String(artifact.body.content ?? ''))
      : null;
  if (deck && format !== 'json') content = assistantSlidesText(deck);
  const sheetModel =
    artifact.body.type === 'table' && artifact.body.format === 'json'
      ? parseAssistantSheet(content)
      : null;
  if (format === 'csv' && sheetModel) content = serializeAssistantCsv(sheetModel.cells);
  if (['md', 'txt', 'csv', 'json', 'tex'].includes(format)) {
    if (format === 'csv' && artifact.body.format !== 'csv' && !sheetModel)
      throw new AppError('Dieses Ergebnis ist keine CSV-Tabelle', 400, 'EXPORT_FORMAT_UNSUPPORTED');
    return {
      data: Buffer.from(content),
      mimeType:
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : format === 'json'
            ? 'application/json'
            : 'text/plain; charset=utf-8',
    };
  }
  if (format === 'html') {
    const embedded = new Map<string, string>();
    let imageBytes = 0;
    for (const image of (Array.isArray(artifact.body.images) ? artifact.body.images : []) as Array<{
      assetId: string;
      url: string;
    }>) {
      if (!userId)
        throw new AppError(
          'Bildexport benötigt das eigene angemeldete Konto',
          403,
          'IMAGE_OWNER_REQUIRED'
        );
      const original = await (
        await import('./artifactImages.js')
      ).readArtifactImage(userId, artifact.body, image.assetId);
      imageBytes += original.bytes.length;
      if (imageBytes > 2 * 1024 * 1024)
        throw new AppError(
          'HTML unterstützt zusammen höchstens 2 MB eingebettete Bilder',
          413,
          'HTML_IMAGE_LIMIT'
        );
      embedded.set(
        image.url,
        `data:${original.mimeType};base64,${original.bytes.toString('base64')}`
      );
    }
    const html = comparison
      ? comparisonHtml(comparison)
      : document
        ? documentHtml(document, embedded)
        : deck
          ? slidesHtml(deck, true)
          : artifact.body.format === 'html'
            ? content
            : `<article><h1>${xml(artifact.title)}</h1>${content
                .split('\n')
                .map((line) => {
                  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
                  return heading
                    ? `<h${heading[1]!.length}>${xml(heading[2]!)}</h${heading[1]!.length}>`
                    : `<p>${xml(line)}</p>`;
                })
                .join('')}</article>`;
    return {
      data: Buffer.from(
        `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><title>${xml(artifact.title)}</title><style>body{font-family:system-ui,sans-serif;max-width:72ch;margin:3rem auto;padding:1rem;line-height:1.6}</style></head><body>${html.replace(/(<img\s[^>]*?src=["'])([^"']+)(["'])/gi, (all, before: string, url: string, after: string) => (embedded.has(url) ? `${before}${embedded.get(url)}${after}` : all))}</body></html>`
      ),
      mimeType: 'text/html; charset=utf-8',
    };
  }
  if (format === 'docx') {
    const pictures = await (await import('./wordImages.js')).wordImages(artifact, userId);
    const rich = document ? documentWord(document, pictures.drawings) : null;
    let paragraphs =
      rich?.paragraphs ??
      content
        .split('\n')
        .map((line) => {
          const heading = /^(#{1,6})\s+(.*)$/.exec(line);
          return `<w:p>${heading ? `<w:pPr><w:pStyle w:val="Heading${heading[1]!.length}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xml(heading?.[2] ?? line)}</w:t></w:r></w:p>`;
        })
        .join('');
    if (pictures.drawings.size) {
      const used = new Set<string>(
        document?.blocks
          .filter((block) => block.type === 'image')
          .map((block) => `/assistant-images/${block.assetId}`)
      );
      let drawingId = 0;
      const drawing = (url: string) => {
        used.add(url);
        return pictures.drawings
          .get(url)!
          .replace(/<wp:docPr id="[0-9]+"/, `<wp:docPr id="${++drawingId}"`);
      };
      // Embed only the revision's owned originals. External URLs remain text.
      const paragraph = (value: string) => {
        const heading = /^(#{1,6})\s+(.*)$/.exec(value);
        return `<w:p>${heading ? `<w:pPr><w:pStyle w:val="Heading${heading[1]!.length}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xml(heading?.[2] ?? value)}</w:t></w:r></w:p>`;
      };
      if (!rich) {
        paragraphs = content
          .split('\n')
          .map((line) => {
            let at = 0,
              output = '';
            for (const match of line.matchAll(
              /!\[([^\]\n]*)\]\(\s*((?:\/generated\/[0-9a-f-]{36}\.(?:png|jpg|webp)|\/assistant-images\/[0-9a-f-]{36}))\s*\)/gi
            )) {
              if (!pictures.drawings.has(match[2]!)) continue;
              output +=
                paragraph(line.slice(at, match.index)) +
                drawing(match[2]!) +
                (match[1] ? paragraph(match[1]) : '');
              at = match.index! + match[0].length;
            }
            return output + paragraph(line.slice(at));
          })
          .join('');
      }
      for (const url of pictures.drawings.keys()) if (!used.has(url)) paragraphs += drawing(url);
    }
    const data = await zip({
      '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${pictures.contentTypes}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${rich ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : ''}</Types>`,
      '_rels/.rels': `<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="word/document.xml"/></Relationships>`,
      'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${OFFICE}"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
      'word/_rels/document.xml.rels': `<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE}/styles" Target="styles.xml"/>${rich ? '<Relationship Id="numbering" Type="' + OFFICE + '/numbering" Target="numbering.xml"/>' + rich.links.map((href, index) => `<Relationship Id="link${index + 1}" Type="${OFFICE}/hyperlink" Target="${xml(href)}" TargetMode="External"/>`).join('') : ''}${pictures.relationships}</Relationships>`,
      ...(rich
        ? {
            'word/numbering.xml': `<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${[false, true].map((ordered, index) => `<w:abstractNum w:abstractNumId="${index}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${ordered ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${ordered ? '%1.' : '•'}"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>`).join('')}${rich.numbers.map((item) => `<w:num w:numId="${item.id}"><w:abstractNumId w:val="${item.ordered ? 1 : 0}"/></w:num>`).join('')}</w:numbering>`,
          }
        : {}),
      ...pictures.entries,
      'word/styles.xml': `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/></w:style>${Array.from({ length: 6 }, (_, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${32 - i * 2}"/></w:rPr></w:style>`).join('')}</w:styles>`,
    });
    return {
      data,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  if (format === 'xlsx') {
    if (artifact.body.format !== 'csv' && !sheetModel)
      throw new AppError('Für Excel eine CSV-Tabelle verwenden', 400, 'EXPORT_FORMAT_UNSUPPORTED');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Tabelle');
    if (sheetModel) {
      const values = evaluateAssistantSheet(sheetModel);
      sheetModel.cells.forEach((row, r) =>
        row.forEach((raw, c) => {
          const result = values[r]![c]!;
          sheet.getCell(r + 1, c + 1).value =
            raw.startsWith('=') && !result.error
              ? { formula: raw.slice(1), result: result.value }
              : raw.startsWith('=')
                ? raw
                : result.value;
        })
      );
    } else for (const row of parseAssistantCsv(content)) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    return {
      data: Buffer.from(await workbook.xlsx.writeBuffer()),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  if (format === 'pptx') {
    if (artifact.body.type !== 'slides')
      throw new AppError(
        'Dieses Ergebnis ist keine Präsentation',
        400,
        'EXPORT_FORMAT_UNSUPPORTED'
      );
    const slides = deck!.slides;
    if (slides.length > 200)
      throw new AppError(
        'Für einen Export höchstens 200 Folien verwenden',
        400,
        'EXPORT_TOO_LARGE'
      );
    const entries: Record<string, string> = {
      '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`,
      '_rels/.rels': `<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
      'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${OFFICE}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
      'ppt/_rels/presentation.xml.rels': `<?xml version="1.0"?><Relationships xmlns="${REL}">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${OFFICE}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}<Relationship Id="rIdMaster" Type="${OFFICE}/slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>`,
    };
    for (let i = 0; i < slides.length; i++) {
      entries[`ppt/slides/slide${i + 1}.xml`] =
        `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${slideShapes(slides[i]!)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    }
    entries['[Content_Types].xml'] = entries['[Content_Types].xml']!.replace(
      '</Types>',
      `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`
    );
    const group =
      '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
    const colorMap =
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
    const ns =
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    entries['ppt/slideMasters/slideMaster1.xml'] =
      `<?xml version="1.0"?><p:sldMaster ${ns} xmlns:r="${OFFICE}"><p:cSld name="Plum">${group}</p:cSld>${colorMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
    entries['ppt/slideMasters/_rels/slideMaster1.xml.rels'] =
      `<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rIdLayout" Type="${OFFICE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rIdTheme" Type="${OFFICE}/theme" Target="../theme/theme1.xml"/></Relationships>`;
    entries['ppt/slideLayouts/slideLayout1.xml'] =
      `<?xml version="1.0"?><p:sldLayout ${ns} type="blank" preserve="1"><p:cSld name="Blank">${group}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
    entries['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] =
      `<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rIdMaster" Type="${OFFICE}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
    const colors: Record<string, string> = {
      dk1: '141414',
      lt1: 'FFFFFF',
      dk2: '3A344E',
      lt2: 'F4F4F4',
      accent1: '1856FF',
      accent2: '3A344E',
      accent3: '07CA6B',
      accent4: 'E89558',
      accent5: 'EA2143',
      accent6: '555555',
      hlink: '1856FF',
      folHlink: '3A344E',
    };
    const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
    entries['ppt/theme/theme1.xml'] =
      `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Plum"><a:themeElements><a:clrScheme name="Plum">${Object.entries(
        colors
      )
        .map(([name, color]) => `<a:${name}><a:srgbClr val="${color}"/></a:${name}>`)
        .join(
          ''
        )}</a:clrScheme><a:fontScheme name="System"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Plum"><a:fillStyleLst>${solid.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${Array.from({ length: 3 }, (_, i) => `<a:ln w="${6350 * (i + 1)}">${solid}<a:prstDash val="solid"/></a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${solid.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
    for (let i = 0; i < slides.length; i++)
      entries[`ppt/slides/_rels/slide${i + 1}.xml.rels`] =
        `<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rIdLayout" Type="${OFFICE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
    if (slides.some((slide) => slide.notes)) {
      entries['[Content_Types].xml'] = entries['[Content_Types].xml']!.replace(
        '</Types>',
        `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join('')}</Types>`
      );
      entries['ppt/presentation.xml'] = entries['ppt/presentation.xml']!.replace(
        '<p:sldIdLst',
        '<p:notesMasterIdLst><p:notesMasterId r:id="rIdNotesMaster"/></p:notesMasterIdLst><p:sldIdLst'
      );
      entries['ppt/_rels/presentation.xml.rels'] = entries[
        'ppt/_rels/presentation.xml.rels'
      ]!.replace(
        '</Relationships>',
        `<Relationship Id="rIdNotesMaster" Type="${OFFICE}/notesMaster" Target="notesMasters/notesMaster1.xml"/></Relationships>`
      );
      entries['ppt/notesMasters/notesMaster1.xml'] =
        `<?xml version="1.0"?><p:notesMaster ${ns}><p:cSld>${group}</p:cSld>${colorMap}<p:notesStyle/></p:notesMaster>`;
      entries['ppt/notesMasters/_rels/notesMaster1.xml.rels'] =
        `<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rIdTheme" Type="${OFFICE}/theme" Target="../theme/theme1.xml"/></Relationships>`;
      slides.forEach((slide, i) => {
        entries[`ppt/notesSlides/notesSlide${i + 1}.xml`] =
          `<?xml version="1.0"?><p:notes ${ns}><p:cSld>${group.replace('</p:spTree>', slideNotes(slide) + '</p:spTree>')}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
        entries[`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`] =
          `<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rIdMaster" Type="${OFFICE}/notesMaster" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rIdSlide" Type="${OFFICE}/slide" Target="../slides/slide${i + 1}.xml"/></Relationships>`;
        const rel = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
        entries[rel] = entries[rel]!.replace(
          '</Relationships>',
          `<Relationship Id="rIdNotes" Type="${OFFICE}/notesSlide" Target="../notesSlides/notesSlide${i + 1}.xml"/></Relationships>`
        );
      });
    }
    return {
      data: await zip(entries),
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
  }
  throw new AppError('Exportformat nicht unterstützt', 400, 'EXPORT_FORMAT_UNSUPPORTED');
}
