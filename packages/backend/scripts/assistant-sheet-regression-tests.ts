import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  evaluateAssistantSheet,
  parseAssistantSheet,
  serializeAssistantSheet,
  sheetColumn,
} from '@plum-code-webui/shared';
import { exportArtifact } from '../src/services/assistant/exports.js';
const cells = [
  ['10', '20', '=SUM(A1:B1)', '=AVERAGE(A1:B1)'],
  ['3', '=A1+B1*A2', '=IF(A2>2,"ja","nein")', '=IF(TRUE,42,1/0)'],
  ['=B3', '=A3', '=1/0', '=WEBSERVICE("https://example.invalid")'],
  ['=2^3^2', '=-2^2', '=COUNT(A1:B2)', '=SUM(A1:A2)'],
  ['=MAX(A1:B2)', '=MIN(A1:B2)', '=IF(FALSE,1/0,7)', "'=not a formula"],
];
const sheet = parseAssistantSheet(serializeAssistantSheet(cells)),
  values = evaluateAssistantSheet(sheet);
assert.deepEqual(
  values[0]!.map((cell) => cell.value),
  [10, 20, 30, 15]
);
assert.deepEqual(
  values[1]!.map((cell) => cell.value),
  [3, 70, 'ja', 42]
);
assert.deepEqual(
  values[2]!.map((cell) => cell.value),
  ['#CYCLE!', '#CYCLE!', '#DIV/0!', '#NAME?']
);
assert.deepEqual(
  values[3]!.map((cell) => cell.value),
  [512, -4, 4, 13]
);
assert.deepEqual(
  values[4]!.map((cell) => cell.value),
  [70, 3, 7, '=not a formula']
);
assert.deepEqual(sheet.cells, cells);
assert.equal(sheetColumn(27), 'AB');
assert.throws(() => parseAssistantSheet('{"type":"plum-sheet","version":1,"cells":[[9]]}'));
const adversarial = parseAssistantSheet(
  serializeAssistantSheet([['=A1001', '=((((((1)', '=globalThis', '=1+;2']])
);
assert.deepEqual(
  evaluateAssistantSheet(adversarial)[0]!.map((cell) => cell.error),
  ['#REF!', '#PARSE!', '#NAME?', '#PARSE!']
);
const artifact = {
  id: 'fixture',
  kind: 'artifact' as const,
  title: 'Sheet',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  body: { type: 'table', format: 'json', content: serializeAssistantSheet(cells) },
};
const output = await exportArtifact(artifact, 'xlsx'),
  workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(output.data);
const exported = workbook.getWorksheet(1)!;
assert.deepEqual(exported.getCell('C1').value, { formula: 'SUM(A1:B1)', result: 30 });
assert.equal(exported.getCell('D3').value, cells[2]![3]);
assert.equal(exported.getCell('D5').value, '=not a formula');
const csv = await exportArtifact(artifact, 'csv');
assert.ok(csv.data.toString().includes('=SUM(A1:B1)'));
console.log(
  'PASS: arithmetic precedence, ranges, lazy IF, cycles/errors, unchanged raw formulas and XLSX formula/result export without external execution'
);
