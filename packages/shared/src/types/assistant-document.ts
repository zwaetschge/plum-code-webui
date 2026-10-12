export interface AssistantDocumentRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  href?: string;
}
export interface AssistantDocumentParagraph {
  type: 'paragraph' | 'heading' | 'list' | 'quote' | 'code';
  level?: number;
  ordered?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  runs: AssistantDocumentRun[];
}
export interface AssistantDocumentTable {
  type: 'table';
  rows: AssistantDocumentRun[][][];
}
export interface AssistantDocumentImage {
  type: 'image';
  assetId: string;
  alt: string;
  caption: string;
}
export type AssistantDocumentBlock =
  | AssistantDocumentParagraph
  | AssistantDocumentTable
  | AssistantDocumentImage;
export interface AssistantDocument {
  type: 'plum-document';
  version: 1;
  blocks: AssistantDocumentBlock[];
}
export interface AssistantDocumentPath {
  block: number;
  row?: number;
  column?: number;
}
export function assistantDocumentRuns(doc: AssistantDocument, path: AssistantDocumentPath) {
  const block = doc.blocks[path.block];
  if (!Number.isInteger(path.block) || !block) invalid();
  if (block.type === 'image') invalid();
  if (block.type !== 'table') {
    if (path.row !== undefined || path.column !== undefined) invalid();
    return block.runs;
  }
  if (!Number.isInteger(path.row) || !Number.isInteger(path.column)) invalid();
  const runs = block.rows[path.row!]?.[path.column!];
  if (!runs) invalid();
  return runs;
}
export function assistantDocumentPassage(content: string, path: AssistantDocumentPath) {
  return assistantDocumentRuns(parseAssistantDocument(content), path)
    .map((run) => run.text)
    .join('');
}
export function replaceAssistantDocumentPassage(
  content: string,
  path: AssistantDocumentPath,
  start: number,
  end: number,
  replacement: string
) {
  const doc = parseAssistantDocument(content),
    runs = assistantDocumentRuns(doc, path);
  const text = runs.map((run) => run.text).join('');
  const splitSurrogate = (at: number) =>
    at > 0 &&
    at < text.length &&
    /[\uD800-\uDBFF]/.test(text[at - 1]!) &&
    /[\uDC00-\uDFFF]/.test(text[at]!);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length ||
    splitSurrogate(start) ||
    splitSurrogate(end)
  )
    invalid();
  const next: AssistantDocumentRun[] = [];
  let offset = 0,
    inserted = false;
  for (const run of runs) {
    const finish = offset + run.text.length;
    const before = Math.min(run.text.length, Math.max(0, start - offset));
    if (before) next.push({ ...run, text: run.text.slice(0, before) });
    if (!inserted && start < finish) {
      if (replacement) next.push({ ...run, text: replacement });
      inserted = true;
    }
    const after = Math.max(0, end - offset);
    if (after < run.text.length) next.push({ ...run, text: run.text.slice(after) });
    offset = finish;
  }
  const merged: AssistantDocumentRun[] = [];
  for (const run of next) {
    const prior = merged.at(-1);
    if (
      prior &&
      prior.bold === run.bold &&
      prior.italic === run.italic &&
      prior.underline === run.underline &&
      prior.href === run.href
    )
      prior.text += run.text;
    else merged.push({ ...run });
  }
  const updated = merged.length ? merged : [{ text: '' }];
  const block = doc.blocks[path.block]!;
  if (block.type === 'image') invalid();
  if (block.type === 'table') block.rows[path.row!]![path.column!] = updated;
  else block.runs = updated;
  return JSON.stringify(parseAssistantDocument(JSON.stringify(doc)));
}
function invalid(): never {
  throw new Error('Ungültiges Plum-Dokument');
}
export function assistantDocumentHref(value: string) {
  // Both supported runtimes provide WHATWG URL; the shared package avoids DOM-wide ambient types.
  const RuntimeURL = (
    globalThis as unknown as {
      URL: new (value: string) => {
        protocol: string;
        username: string;
        password: string;
        href: string;
      };
    }
  ).URL;
  const url = new RuntimeURL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    value.length > 2000
  )
    invalid();
  return url.href;
}
export function parseAssistantDocument(text: string): AssistantDocument {
  if (text.length > 50000) invalid();
  const raw = JSON.parse(text);
  if (
    raw?.type !== 'plum-document' ||
    raw.version !== 1 ||
    !Array.isArray(raw.blocks) ||
    !raw.blocks.length ||
    raw.blocks.length > 200
  )
    invalid();
  let totalRuns = 0,
    totalText = 0;
  const runs = (items: unknown): AssistantDocumentRun[] => {
    if (!Array.isArray(items) || !items.length || items.length > 100) invalid();
    return items.map((item) => {
      if (
        !item ||
        typeof item.text !== 'string' ||
        item.text.length > 20000 ||
        Object.keys(item).some(
          (key) => !['text', 'bold', 'italic', 'underline', 'href'].includes(key)
        )
      )
        invalid();
      totalRuns++;
      totalText += item.text.length;
      if (totalRuns > 2000 || totalText > 40000) invalid();
      for (const key of ['bold', 'italic', 'underline'])
        if (item[key] !== undefined && typeof item[key] !== 'boolean') invalid();
      if (item.href !== undefined && typeof item.href !== 'string') invalid();
      return {
        text: item.text,
        ...(item.bold ? { bold: true } : {}),
        ...(item.italic ? { italic: true } : {}),
        ...(item.underline ? { underline: true } : {}),
        ...(item.href ? { href: assistantDocumentHref(item.href) } : {}),
      };
    });
  };
  const blocks: AssistantDocumentBlock[] = raw.blocks.map((item: Record<string, unknown>) => {
    if (!item || typeof item !== 'object') invalid();
    if (item.type === 'image') {
      if (
        Object.keys(item).some((key) => !['type', 'assetId', 'alt', 'caption'].includes(key)) ||
        typeof item.assetId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.assetId) ||
        typeof item.alt !== 'string' ||
        item.alt.length > 500 ||
        typeof item.caption !== 'string' ||
        item.caption.length > 500
      )
        invalid();
      return { type: 'image', assetId: item.assetId, alt: item.alt, caption: item.caption };
    }
    if (item.type === 'table') {
      if (
        Object.keys(item).some((key) => !['type', 'rows'].includes(key)) ||
        !Array.isArray(item.rows) ||
        !item.rows.length ||
        item.rows.length > 100
      )
        invalid();
      let columns = 0;
      return {
        type: 'table',
        rows: item.rows.map((row: unknown) => {
          if (
            !Array.isArray(row) ||
            !row.length ||
            row.length > 20 ||
            (columns && columns !== row.length)
          )
            invalid();
          columns = row.length;
          return row.map((cell) => runs(cell));
        }),
      };
    }
    if (
      !['paragraph', 'heading', 'list', 'quote', 'code'].includes(String(item.type)) ||
      Object.keys(item).some((key) => !['type', 'runs', 'level', 'ordered', 'align'].includes(key))
    )
      invalid();
    if (
      item.level !== undefined &&
      (!Number.isInteger(item.level) || Number(item.level) < 1 || Number(item.level) > 6)
    )
      invalid();
    if (item.ordered !== undefined && typeof item.ordered !== 'boolean') invalid();
    if (
      item.align !== undefined &&
      !['left', 'center', 'right', 'justify'].includes(String(item.align))
    )
      invalid();
    return {
      type: item.type as AssistantDocumentParagraph['type'],
      runs: runs(item.runs),
      ...(item.level ? { level: Number(item.level) } : {}),
      ...(item.ordered !== undefined ? { ordered: Boolean(item.ordered) } : {}),
      ...(item.align ? { align: item.align as AssistantDocumentParagraph['align'] } : {}),
    };
  });
  return { type: 'plum-document', version: 1, blocks };
}
export function documentFromText(text: string): AssistantDocument {
  return parseAssistantDocument(
    JSON.stringify({
      type: 'plum-document',
      version: 1,
      blocks: text.split('\n').map((line) => {
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        return {
          type: heading ? 'heading' : 'paragraph',
          ...(heading ? { level: heading[1]!.length } : {}),
          runs: [{ text: heading?.[2] ?? line }],
        };
      }),
    })
  );
}
export function assistantDocumentText(doc: AssistantDocument) {
  return doc.blocks
    .map((block) =>
      block.type === 'image'
        ? [block.alt, block.caption].filter(Boolean).join(' · ')
        : block.type === 'table'
          ? block.rows
              .map((row) => row.map((cell) => cell.map((run) => run.text).join('')).join('\t'))
              .join('\n')
          : block.runs.map((run) => run.text).join('')
    )
    .join('\n');
}
export function assistantDocumentMarkdown(doc: AssistantDocument) {
  const escape = (text: string) => text.replace(/([\\`*_[\]<>])/g, '\\$1');
  const runs = (items: AssistantDocumentRun[]) =>
    items
      .map((run) => {
        let text = escape(run.text);
        if (run.bold) text = `**${text}**`;
        if (run.italic) text = `*${text}*`;
        if (run.href) text = `[${text}](${run.href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
        return text;
      })
      .join('');
  return doc.blocks
    .map((block) => {
      if (block.type === 'image')
        return `![${escape(block.alt)}](/assistant-images/${block.assetId})${block.caption ? '\n\n' + escape(block.caption) : ''}`;
      if (block.type === 'table')
        return block.rows
          .map(
            (row, index) =>
              row.map((cell) => runs(cell).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') +
              (index === 0 ? '\n' + row.map(() => '---').join(' | ') : '')
          )
          .join('\n');
      return (
        (block.type === 'heading'
          ? '#'.repeat(block.level ?? 1) + ' '
          : block.type === 'list'
            ? block.ordered
              ? '1. '
              : '- '
            : block.type === 'quote'
              ? '> '
              : '') + runs(block.runs)
      );
    })
    .join('\n\n');
}
