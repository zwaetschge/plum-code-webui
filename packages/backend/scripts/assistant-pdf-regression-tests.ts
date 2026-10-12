import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exportArtifact } from '../src/services/assistant/exports.js';
import { documentFromText, type AssistantResource } from '@plum-code-webui/shared';

const directory = await mkdtemp(path.join(tmpdir(), 'plum-pdf-test-'));
const python = process.env.PLUM_PYTHON_BIN || '/usr/local/bin/plum-python';
async function inspect(type: string, format: string, content: string) {
  const artifact: AssistantResource = {
    id: 'pdf-fixture',
    kind: 'artifact',
    title: 'Übersicht Äpfel',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    body: { type, format, content },
  };
  const result = await exportArtifact(artifact, 'pdf');
  assert.equal(result.mimeType, 'application/pdf');
  assert.equal(result.data.subarray(0, 5).toString(), '%PDF-');
  const filename = path.join(directory, `${type}.pdf`);
  await writeFile(filename, result.data);
  const script =
    'import pymupdf,json,sys\nd=pymupdf.open(sys.argv[1])\nprint(json.dumps({"pages":len(d),"text":"\\n".join(p.get_text() for p in d),"landscape":d[0].rect.width>d[0].rect.height,"links":[l.get("uri") for p in d for l in p.get_links()]}))';
  return JSON.parse((await promisify(execFile)(python, ['-c', script, filename])).stdout);
}
try {
  const doc = documentFromText('# Bericht\nÄpfel und Birnen\n<script>window.alert(1)</script>');
  doc.blocks.push({
    type: 'paragraph',
    runs: [{ text: 'Originalbeleg', href: 'https://example.invalid/fruit' }],
  });
  const rich = await inspect('document', 'json', JSON.stringify(doc));
  assert(rich.text.includes('Äpfel und Birnen'));
  assert(
    rich.text.includes('<script>window.alert(1)</script>'),
    'untrusted markup is literal text'
  );
  assert(rich.links.includes('https://example.invalid/fruit'));
  const sheet = await inspect(
    'table',
    'json',
    JSON.stringify({
      type: 'plum-sheet',
      version: 1,
      cells: [
        ['Anzahl', 'Summe'],
        ['3', '=A2*7'],
      ],
    })
  );
  assert(sheet.text.includes('21'));
  const csv = await inspect('table', 'csv', 'Name,Preis\nÄpfel,12\nBirnen,10');
  assert(csv.text.includes('Birnen'));
  const slides = await inspect(
    'slides',
    'markdown',
    'Erste Folie\nÄpfel\n---\nZweite Folie\nBirnen'
  );
  assert.equal(slides.pages, 2);
  assert(slides.landscape);
  assert(slides.text.includes('Zweite Folie'));
  const math = await inspect('latex', 'tex', '\\frac{a^2+b^2}{c}=\\sqrt{x}');
  assert.equal(math.pages, 1);
  assert(math.text.includes('a'));
  const notebook = await inspect(
    'notebook',
    'json',
    JSON.stringify({
      type: 'plum-notebook',
      version: 1,
      datasetId: 'data-fixture',
      datasetRevision: 7,
      steps: [],
      report: 'Auswertung',
      run: {
        id: 'run-fixture',
        notebookId: 'pdf-fixture',
        at: '2026-10-10T10:00:00Z',
        datasetHash: 'a'.repeat(64),
        inputRows: 2,
        outputs: [
          {
            stepId: 'group',
            title: 'Gruppenvergleich',
            columns: ['Name', 'Wert'],
            rows: [
              ['Äpfel', 12],
              ['Birnen', -3],
            ],
            series: [
              { label: 'Äpfel', value: 12 },
              { label: 'Birnen', value: -3 },
            ],
          },
        ],
      },
    })
  );
  assert(notebook.text.includes('Datensatzrevision 7'));
  assert(notebook.text.includes('run-fixture'));
  assert(notebook.text.includes('Gruppenvergleich'));
  assert(notebook.text.includes('-3'));
  await assert.rejects(
    inspect('latex', 'tex', '\\unsupportedFixture{a}'),
    (e: unknown) => (e as { code: string }).code === 'PDF_MATH_INVALID'
  );
  await assert.rejects(
    inspect('latex', 'tex', 'x+'.repeat(400) + 'y'),
    (e: unknown) => (e as { code: string }).code === 'PDF_MATH_WIDTH'
  );
  await assert.rejects(
    inspect('app', 'html', '<script>fixture</script>'),
    (e: unknown) => (e as { code: string }).code === 'EXPORT_FORMAT_UNSUPPORTED'
  );
  console.log(
    'PASS: actual Chromium PDFs independently read by PyMuPDF: Unicode/rich text/safe links/literal hostile markup, evaluated spreadsheet/CSV, two landscape slides, embedded math fonts, notebook metadata/table/vector bars, invalid/oversized formulas and unsupported types'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
