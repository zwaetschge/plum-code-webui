import type { UiRow } from '@plum-code-webui/shared';

/** File name from a title: lowercase ASCII, dashes, bounded. */
export function fileName(title: string | undefined, fallback: string, extension: string) {
  const base =
    (title ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || fallback;
  return `${base}.${extension}`;
}

const cell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  // Formula injection: spreadsheet apps must not evaluate a leading =, +, - or @.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV with a header row; semicolons for de-CH spreadsheets, BOM for Excel. */
export function toCsv(rows: UiRow[], columns: Array<{ key: string; label: string }>) {
  const lines = [columns.map((column) => cell(column.label)).join(';')];
  for (const row of rows) lines.push(columns.map((column) => cell(row[column.key])).join(';'));
  return '﻿' + lines.join('\r\n');
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadCsv(name: string, csv: string) {
  downloadBlob(name, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

/**
 * Rasterises a chart's SVG at 2× on the current surface colour, so the PNG
 * matches what the reader sees in light and dark mode.
 */
export async function downloadSvgAsPng(svg: SVGSVGElement, name: string) {
  const box = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const styles = getComputedStyle(svg);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.style.color = styles.color;
  clone.style.fontFamily = styles.fontFamily;
  const token = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  const background = token ? `hsl(${token})` : '#ffffff';
  const source = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG konnte nicht gerendert werden'));
      image.src = url;
    });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(scale, scale);
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) downloadBlob(name, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}
