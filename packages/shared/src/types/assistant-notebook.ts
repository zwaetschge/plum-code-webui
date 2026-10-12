import { parseAssistantCsv } from './assistant-csv.js';

export interface AssistantDataset {
  columns: string[];
  rows: string[][];
}
export type AssistantAnalysisStep = {
  id: string;
  kind: 'summary' | 'group' | 'histogram' | 'correlation' | 'filter';
  column: string;
  other?: string;
  aggregate?: 'sum' | 'mean' | 'count';
  bins?: number;
  operator?: 'eq' | 'contains' | 'gt' | 'lt';
  value?: string;
};
export interface AssistantAnalysisOutput {
  stepId: string;
  title: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  series?: Array<{ label: string; value: number }>;
}
export interface AssistantNotebook {
  type: 'plum-notebook';
  version: 1;
  datasetId: string;
  datasetRevision: number;
  steps: AssistantAnalysisStep[];
  report: string;
  run?: {
    id: string;
    notebookId: string;
    at: string;
    datasetHash: string;
    inputRows: number;
    outputs: AssistantAnalysisOutput[];
  };
}
const fail = (message: string): never => {
  throw new Error(message);
};
const numeric = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  const result = Number(trimmed);
  return Number.isFinite(result) ? result : null;
};
export function parseAssistantDataset(content: string, format: string): AssistantDataset {
  if (content.length > 50000) fail('Datensatz überschreitet 50 000 Zeichen.');
  let columns: unknown, rows: unknown;
  if (format === 'csv') {
    const csv = parseAssistantCsv(content);
    columns = csv[0];
    rows = csv.slice(1);
  } else if (format === 'json') {
    const value = JSON.parse(content);
    columns = value.columns;
    rows = value.rows;
  } else fail('Für die Analyse CSV mit Kopfzeile oder JSON mit columns/rows wählen.');
  if (
    !Array.isArray(columns) ||
    !columns.length ||
    columns.length > 100 ||
    !columns.every((c) => typeof c === 'string' && c.trim() && c.length <= 200) ||
    new Set(columns).size !== columns.length
  )
    fail('Eindeutige, nicht leere Spaltennamen erforderlich (höchstens 100).');
  if (
    !Array.isArray(rows) ||
    rows.length > 1000 ||
    !rows.every(
      (r) =>
        Array.isArray(r) &&
        r.length === (columns as unknown[]).length &&
        r.every(
          (v) =>
            v === null ||
            typeof v === 'string' ||
            typeof v === 'boolean' ||
            (typeof v === 'number' && Number.isFinite(v))
        )
    )
  )
    fail('Höchstens 1000 rechteckige Datenzeilen mit einfachen Zellwerten.');
  return {
    columns: columns as string[],
    rows: (rows as Array<Array<string | number | boolean | null>>).map((r) =>
      r.map((v) => (v === null ? '' : String(v)))
    ),
  };
}
export function parseAssistantNotebook(content: string): AssistantNotebook {
  if (content.length > 50000) fail('Notebook überschreitet 50 000 Zeichen.');
  const n = JSON.parse(content) as AssistantNotebook;
  if (
    n.type !== 'plum-notebook' ||
    n.version !== 1 ||
    typeof n.datasetId !== 'string' ||
    !n.datasetId ||
    !Number.isSafeInteger(n.datasetRevision) ||
    n.datasetRevision < 1 ||
    typeof n.report !== 'string' ||
    n.report.length > 10000 ||
    !Array.isArray(n.steps) ||
    n.steps.length > 20
  )
    fail('Ungültiges Plum-Notebook.');
  const ids = new Set<string>();
  for (const s of n.steps) {
    if (
      !s ||
      typeof s.id !== 'string' ||
      !s.id ||
      s.id.length > 100 ||
      ids.has(s.id) ||
      !['summary', 'group', 'histogram', 'correlation', 'filter'].includes(s.kind) ||
      typeof s.column !== 'string' ||
      s.column.length > 200 ||
      (s.other !== undefined && (typeof s.other !== 'string' || s.other.length > 200)) ||
      (s.aggregate !== undefined && !['sum', 'mean', 'count'].includes(s.aggregate)) ||
      (s.bins !== undefined && (!Number.isInteger(s.bins) || s.bins < 1 || s.bins > 30)) ||
      (s.operator !== undefined && !['eq', 'contains', 'gt', 'lt'].includes(s.operator)) ||
      (s.value !== undefined && (typeof s.value !== 'string' || s.value.length > 1000))
    )
      fail('Ungültiger Berechnungsschritt.');
    ids.add(s.id);
  }
  if (n.run) {
    const run = n.run;
    if (
      typeof run.id !== 'string' ||
      typeof run.notebookId !== 'string' ||
      typeof run.at !== 'string' ||
      !Number.isFinite(Date.parse(run.at)) ||
      !/^[a-f0-9]{64}$/.test(run.datasetHash) ||
      !Number.isInteger(run.inputRows) ||
      run.inputRows < 0 ||
      run.inputRows > 1000 ||
      !Array.isArray(run.outputs) ||
      run.outputs.length > 20
    )
      fail('Ungültiger Berechnungslauf.');
    for (const output of run.outputs) {
      if (
        !output ||
        typeof output.stepId !== 'string' ||
        typeof output.title !== 'string' ||
        !Array.isArray(output.columns) ||
        output.columns.length > 100 ||
        !output.columns.every((c) => typeof c === 'string') ||
        !Array.isArray(output.rows) ||
        output.rows.length > 1000 ||
        !output.rows.every(
          (r) =>
            Array.isArray(r) &&
            r.length === output.columns.length &&
            r.every(
              (v) =>
                v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
            )
        ) ||
        (output.series !== undefined &&
          (!Array.isArray(output.series) ||
            output.series.length > 100 ||
            !output.series.every(
              (s) =>
                s &&
                typeof s.label === 'string' &&
                typeof s.value === 'number' &&
                Number.isFinite(s.value)
            )))
      )
        fail('Ungültiges Berechnungsergebnis.');
    }
  }
  return n;
}
function sum(values: number[]): number {
  let result = 0,
    correction = 0;
  for (const value of values) {
    const next = value - correction,
      total = result + next;
    correction = total - result - next;
    result = total;
  }
  if (!Number.isFinite(result)) fail('Berechnung übersteigt den Zahlenbereich.');
  return result;
}
/** Ordered, bounded calculations. Filters affect following cells; analysis cells
 * preserve the current data. No JavaScript/Python from an imported file runs. */
export function evaluateAssistantNotebook(
  dataset: AssistantDataset,
  notebook: AssistantNotebook
): AssistantAnalysisOutput[] {
  let rows = dataset.rows;
  const column = (name: string | undefined) => {
    const index = dataset.columns.indexOf(name ?? '');
    if (index < 0) fail(`Spalte nicht gefunden: ${name ?? ''}`);
    return index;
  };
  const outputs: AssistantAnalysisOutput[] = [];
  for (const step of notebook.steps) {
    const index = column(step.column);
    const output: AssistantAnalysisOutput = {
      stepId: step.id,
      title: `${step.kind}: ${step.column}`,
      columns: [],
      rows: [],
    };
    if (step.kind === 'filter') {
      const value = step.value ?? '',
        operator = step.operator ?? 'eq';
      if (['gt', 'lt'].includes(operator) && numeric(value) === null)
        fail('Numerischer Filterwert erforderlich.');
      rows = rows.filter((r) => {
        const cell = r[index]!;
        if (operator === 'eq') return cell === value;
        if (operator === 'contains') return cell.includes(value);
        const number = numeric(cell);
        return (
          number !== null &&
          (operator === 'gt' ? number > numeric(value)! : number < numeric(value)!)
        );
      });
      output.columns = ['Verbleibende Zeilen'];
      output.rows = [[rows.length]];
    } else if (step.kind === 'summary') {
      const values = rows
        .map((r) => numeric(r[index]!))
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);
      const total = sum(values),
        middle = Math.floor(values.length / 2);
      const median = !values.length
        ? null
        : values.length % 2
          ? values[middle]!
          : values[middle - 1]! / 2 + values[middle]! / 2;
      output.columns = ['Kennzahl', 'Wert'];
      output.rows = [
        ['Zeilen', rows.length],
        ['Numerische Werte', values.length],
        ['Fehlend oder nicht numerisch', rows.length - values.length],
        ['Summe', total],
        ['Mittelwert', values.length ? total / values.length : null],
        ['Median', median],
        ['Minimum', values[0] ?? null],
        ['Maximum', values.at(-1) ?? null],
      ];
    } else if (step.kind === 'group') {
      const aggregate = step.aggregate ?? 'count',
        other = aggregate === 'count' ? null : column(step.other);
      const groups = new Map<string, number[]>();
      for (const row of rows) {
        const name = row[index]!,
          values = groups.get(name) ?? [];
        groups.set(name, values);
        const value = other === null ? 1 : numeric(row[other]!);
        if (value !== null) values.push(value);
      }
      if (groups.size > 100) fail('Mehr als 100 Gruppen. Zuerst filtern oder gröber gruppieren.');
      output.columns = [step.column, aggregate];
      output.rows = [...groups]
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([name, values]) => [
          name,
          aggregate === 'count'
            ? values.length
            : values.length
              ? aggregate === 'sum'
                ? sum(values)
                : sum(values) / values.length
              : null,
        ]);
      output.series = output.rows
        .filter((r) => typeof r[1] === 'number')
        .map((r) => ({ label: String(r[0]), value: r[1] as number }));
    } else if (step.kind === 'histogram') {
      const values = rows.map((r) => numeric(r[index]!)).filter((v): v is number => v !== null);
      const bins = step.bins ?? 10;
      if (values.length) {
        const min = Math.min(...values),
          max = Math.max(...values),
          width = (max - min) / bins;
        if (!Number.isFinite(width)) fail('Histogramm übersteigt den Zahlenbereich.');
        const counts = Array.from({ length: width === 0 ? 1 : bins }, () => 0);
        for (const value of values) {
          const at = width === 0 ? 0 : Math.min(bins - 1, Math.floor((value - min) / width));
          counts[at] = counts[at]! + 1;
        }
        output.series = counts.map((value, i) => ({
          label:
            width === 0
              ? String(min)
              : `[${(min + i * width).toPrecision(5)}, ${(min + (i + 1) * width).toPrecision(5)}${i === bins - 1 ? ']' : ')'}`,
          value,
        }));
        output.columns = ['Intervall', 'Anzahl'];
        output.rows = output.series.map((s) => [s.label, s.value]);
      } else {
        output.columns = ['Intervall', 'Anzahl'];
        output.series = [];
      }
    } else {
      const other = column(step.other),
        pairs = rows
          .map((r) => [numeric(r[index]!), numeric(r[other]!)])
          .filter((p): p is [number, number] => p[0] !== null && p[1] !== null);
      let meanX = 0,
        meanY = 0,
        xx = 0,
        yy = 0,
        xy = 0;
      pairs.forEach(([x, y], i) => {
        const dx = x - meanX,
          dy = y - meanY;
        meanX += dx / (i + 1);
        meanY += dy / (i + 1);
        xx += dx * (x - meanX);
        yy += dy * (y - meanY);
        xy += dx * (y - meanY);
      });
      if (![xx, yy, xy].every(Number.isFinite)) fail('Korrelation übersteigt den Zahlenbereich.');
      const correlation =
        pairs.length >= 2 && xx > 0 && yy > 0
          ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx) / Math.sqrt(yy)))
          : null;
      output.columns = ['Kennzahl', 'Wert'];
      output.rows = [
        ['Gültige Wertepaare', pairs.length],
        ['Pearson r', correlation],
      ];
    }
    outputs.push(output);
  }
  return outputs;
}
export function assistantNotebookReport(n: AssistantNotebook): string {
  const escape = (value: string | number | null) =>
    value === null
      ? '–'
      : String(value)
          .replace(/\|/g, '\\|')
          .replace(/[\r\n]/g, ' ');
  return [
    `# Datenanalyse`,
    `Datensatz: ${n.datasetId}, Revision ${n.datasetRevision}`,
    n.run
      ? `Lauf: ${n.run.id}\nEingabe-SHA-256: ${n.run.datasetHash}\nZeit: ${n.run.at}`
      : 'Noch kein bestätigter Lauf.',
    n.report,
    ...(n.run?.outputs ?? []).map(
      (o) =>
        `## ${o.title}\n\n| ${o.columns.map(escape).join(' | ')} |\n| ${o.columns.map(() => '---').join(' | ')} |\n${o.rows.map((r) => `| ${r.map(escape).join(' | ')} |`).join('\n')}`
    ),
  ].join('\n\n');
}
