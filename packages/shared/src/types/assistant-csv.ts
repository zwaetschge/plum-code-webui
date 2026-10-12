/** RFC-style CSV fields, including quoted commas, newlines and escaped quotes. */
export function parseAssistantCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || !field.length) quoted = !quoted;
      else field += c;
    } else if (!quoted && c === ',') {
      row.push(field);
      field = '';
    } else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('Unvollständiges CSV-Anführungszeichen');
  if (field.length || row.length || !rows.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
export function serializeAssistantCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',')
    )
    .join('\r\n');
}
