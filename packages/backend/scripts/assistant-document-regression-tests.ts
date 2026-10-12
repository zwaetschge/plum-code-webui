import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  parseAssistantDocument,
  assistantDocumentText,
  documentFromText,
  assistantDocumentMarkdown,
  replaceAssistantDocumentPassage,
  assistantDocumentPassage,
} from '@plum-code-webui/shared';
import { exportArtifact } from '../src/services/assistant/exports.js';
const doc = parseAssistantDocument(
  JSON.stringify({
    type: 'plum-document',
    version: 1,
    blocks: [
      {
        type: 'heading',
        level: 2,
        align: 'center',
        runs: [{ text: 'Übersicht & Belege', bold: true }],
      },
      {
        type: 'paragraph',
        runs: [
          { text: 'Äpfel ', bold: true },
          { text: 'und ', italic: true },
          { text: 'Birnen', underline: true },
          { text: '\nWebseite', href: 'https://example.invalid/path?a=1&b=2' },
        ],
      },
      { type: 'list', ordered: true, runs: [{ text: 'Erstens' }] },
      { type: 'list', ordered: true, runs: [{ text: 'Zweitens' }] },
      { type: 'list', ordered: false, runs: [{ text: 'Punkt' }] },
      {
        type: 'table',
        rows: [
          [[{ text: 'Name', bold: true }], [{ text: 'Wert' }]],
          [[{ text: 'Äpfel' }], [{ text: '10\t€', italic: true }]],
        ],
      },
    ],
  })
);
assert.equal(assistantDocumentText(doc).includes('Äpfel und Birnen'), true);
assert.equal(assistantDocumentMarkdown(doc).includes('## **Übersicht & Belege**'), true);
assert.equal(documentFromText('# Titel\nAbsatz').blocks[0]?.type, 'heading');
const modified = parseAssistantDocument(
  replaceAssistantDocumentPassage(JSON.stringify(doc), { block: 1 }, 3, 12, 'NEU')
);
assert.equal(
  assistantDocumentPassage(JSON.stringify(modified), { block: 1 }),
  'ÄpfNEUrnen\nWebseite'
);
assert.deepEqual(modified.blocks[0], doc.blocks[0]);
assert.deepEqual(modified.blocks[5], doc.blocks[5]);
const runs = modified.blocks[1];
assert(runs?.type === 'paragraph');
assert.deepEqual(runs.runs.slice(0, 2), [
  { text: 'ÄpfNEU', bold: true },
  { text: 'rnen', underline: true },
]);
const tableChange = parseAssistantDocument(
  replaceAssistantDocumentPassage(JSON.stringify(doc), { block: 5, row: 1, column: 1 }, 0, 2, '20')
);
assert.deepEqual(tableChange.blocks.slice(0, 5), doc.blocks.slice(0, 5));
assert.equal(
  assistantDocumentPassage(JSON.stringify(tableChange), { block: 5, row: 1, column: 1 }),
  '20\t€'
);
for (const path of [
  { block: 5 },
  { block: 5, row: 5, column: 0 },
  { block: 1, row: 0, column: 0 },
  { block: 999 },
])
  assert.throws(() => assistantDocumentPassage(JSON.stringify(doc), path));
assert.throws(() =>
  replaceAssistantDocumentPassage(
    JSON.stringify(documentFromText('🍏 Obst')),
    { block: 0 },
    1,
    2,
    'X'
  )
);
for (const href of [
  'javascript:alert(1)',
  'data:text/html,fixture',
  'https://user:fixture@example.invalid/',
])
  assert.throws(() =>
    parseAssistantDocument(
      JSON.stringify({
        type: 'plum-document',
        version: 1,
        blocks: [{ type: 'paragraph', runs: [{ text: 'link', href }] }],
      })
    )
  );
assert.throws(() =>
  parseAssistantDocument(
    JSON.stringify({
      type: 'plum-document',
      version: 1,
      blocks: [{ type: 'table', rows: [[[{ text: '1' }]], [[{ text: '2' }], [{ text: '3' }]]] }],
    })
  )
);
const artifact = {
  id: 'doc-fixture',
  kind: 'artifact' as const,
  title: 'Formatierter Bericht',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  body: { type: 'document', format: 'json', content: JSON.stringify(doc) },
};
const result = await exportArtifact(artifact, 'docx');
const directory = await mkdtemp(path.join(tmpdir(), 'plum-document-test-'));
try {
  const filename = path.join(directory, 'document.docx');
  await writeFile(filename, result.data);
  const imported = JSON.parse(
    (await promisify(execFile)('python3', ['scripts/plum-office-extract.py', filename])).stdout
  );
  assert.deepEqual(
    imported.document,
    doc,
    'supported rich structures roundtrip through actual OOXML'
  );
  const html = (await exportArtifact(artifact, 'html')).data.toString();
  assert(html.includes('<strong>Äpfel </strong>'));
  assert(html.includes('<table'));
  assert(html.includes('a=1&amp;b=2'));
  assert.equal((await exportArtifact(artifact, 'json')).data.toString(), JSON.stringify(doc));
  assert.equal((await exportArtifact(artifact, 'txt')).data.toString(), assistantDocumentText(doc));
  assert((await exportArtifact(artifact, 'md')).data.toString().includes('##'));
  console.log(
    'PASS: actual OOXML rich-document roundtrip: heading/alignment, Unicode runs and direct marks, web hyperlinks, numbered/bullet lists, table cells, tabs/breaks; HTML/Markdown/text/original JSON and hostile link/shape guards'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
