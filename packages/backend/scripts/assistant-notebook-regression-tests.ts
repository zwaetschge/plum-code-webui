import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  parseAssistantDataset,
  parseAssistantNotebook,
  evaluateAssistantNotebook,
  assistantNotebookReport,
  type AssistantNotebook,
} from '@plum-code-webui/shared';
process.env.NODE_ENV = 'test';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const { importDataset, createNotebook, runNotebook } =
  await import('../src/services/assistant/notebooks.js');
const { findResource, reviseResource, createResource, BODY_SCHEMAS, checkReferences } =
  await import('../src/services/assistant/resources.js');
const { exportArtifact } = await import('../src/services/assistant/exports.js');
const { createAnalysisTask, analysisTaskContext } =
  await import('../src/services/assistant/analysisTasks.js');
const { executeAssistantTool } = await import('../src/services/assistant/tools.js');
const { buildAssistantContext } = await import('../src/services/assistant/context.js');
const csv =
  'Region,Umsatz,Stück\nZürich,10,1\nBern,20,2\nZürich,,3\nBern,30,4\nBasel,foo,5\nZürich,-5,6\n';
const data = parseAssistantDataset(csv, 'csv');
const notebook: AssistantNotebook = {
  type: 'plum-notebook',
  version: 1,
  datasetId: 'fixture',
  datasetRevision: 1,
  report: 'Eigene Interpretation',
  steps: [
    { id: 'summary', kind: 'summary', column: 'Umsatz' },
    { id: 'group', kind: 'group', column: 'Region', other: 'Umsatz', aggregate: 'sum' },
    { id: 'histogram', kind: 'histogram', column: 'Umsatz', bins: 7 },
    { id: 'filter', kind: 'filter', column: 'Umsatz', operator: 'gt', value: '10' },
    { id: 'filtered', kind: 'summary', column: 'Umsatz' },
  ],
};
const outputs = evaluateAssistantNotebook(data, notebook);
assert.deepEqual(outputs[0]!.rows, [
  ['Zeilen', 6],
  ['Numerische Werte', 4],
  ['Fehlend oder nicht numerisch', 2],
  ['Summe', 55],
  ['Mittelwert', 13.75],
  ['Median', 15],
  ['Minimum', -5],
  ['Maximum', 30],
]);
assert.deepEqual(outputs[1]!.rows, [
  ['Basel', null],
  ['Bern', 50],
  ['Zürich', 5],
]);
assert.equal(
  outputs[2]!.series!.reduce((sum, s) => sum + s.value, 0),
  4
);
assert.equal(outputs[2]!.series!.at(-1)!.value, 1, 'maximum must be included in final bin');
assert.deepEqual(outputs[3]!.rows, [[2]]);
assert.equal(outputs[4]!.rows[3]![1], 50);
assert.equal(data.rows.length, 6, 'filters must not mutate the original');
const correlation = evaluateAssistantNotebook(
  parseAssistantDataset('x,y\n1,2\n2,4\n3,6\n,9', 'csv'),
  { ...notebook, steps: [{ id: 'r', kind: 'correlation', column: 'x', other: 'y' }] }
);
assert.equal(correlation[0]!.rows[0]![1], 3);
assert(Math.abs(Number(correlation[0]!.rows[1]![1]) - 1) < 1e-12);
assert.equal(
  evaluateAssistantNotebook(parseAssistantDataset('x,y\n1,2\n1,3', 'csv'), {
    ...notebook,
    steps: [{ id: 'r', kind: 'correlation', column: 'x', other: 'y' }],
  })[0]!.rows[1]![1],
  null
);
assert.throws(() => parseAssistantDataset('x,x\n1,2', 'csv'), /Spaltennamen/);
assert.throws(() => parseAssistantDataset('x,y\n1', 'csv'), /rechteckige/);
assert.throws(() =>
  parseAssistantDataset(JSON.stringify({ columns: ['x'], rows: [[{ script: 'evil' }]] }), 'json')
);
assert.throws(() =>
  parseAssistantNotebook(
    JSON.stringify({
      ...notebook,
      steps: [
        { id: 'dup', kind: 'summary', column: 'x' },
        { id: 'dup', kind: 'summary', column: 'x' },
      ],
    })
  )
);
assert.throws(() =>
  evaluateAssistantNotebook(data, {
    ...notebook,
    steps: [{ id: 'no', kind: 'summary', column: 'missing' }],
  })
);
assert.throws(() =>
  evaluateAssistantNotebook(data, {
    ...notebook,
    steps: [{ id: 'no', kind: 'filter', column: 'Umsatz', operator: 'gt', value: 'globalThis' }],
  })
);
console.log(
  'PASS: missing values, negative/group aggregates, inclusive histogram maximum, non-mutating ordered filters, correlation/constant columns and bounded typed input'
);
if (!(await databaseReachable())) {
  console.log('NOT RUN: notebook ownership/revision integration');
  await closePool();
  process.exitCode = 2;
} else
  try {
    await createTestSchema();
    for (const user of ['data-alice', 'data-bob'])
      await run(
        'INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,?,?)',
        user,
        `${user}@fixture.invalid`,
        'test',
        user
      );
    const file = { buffer: Buffer.from(csv), originalname: 'Umsätze.csv' },
      importId = randomUUID();
    const dataset = await importDataset('data-alice', file, importId, 'csv');
    assert.deepEqual(await importDataset('data-alice', file, importId, 'csv'), dataset);
    const asset = await get(
      'SELECT bytes FROM assistant_assets WHERE id=?',
      String((dataset.body.importOrigin as Record<string, unknown>).assetId)
    );
    assert.equal(Buffer.from(asset!.bytes).toString(), csv);
    const createId = randomUUID(),
      created = await createNotebook('data-alice', dataset.id, {
        commandId: createId,
        expectedRevision: 1,
      });
    assert.deepEqual(
      await createNotebook('data-alice', dataset.id, { commandId: createId, expectedRevision: 1 }),
      created
    );
    const configured = { ...notebook, datasetId: dataset.id };
    const edited = await reviseResource('data-alice', created.id, 1, created.title, {
      ...created.body,
      content: JSON.stringify(configured),
    });
    await reviseResource('data-alice', dataset.id, 1, dataset.title, {
      ...dataset.body,
      content: 'Region,Umsatz,Stück\nSpäter,999,9',
    });
    const commandId = randomUUID(),
      result = await runNotebook('data-alice', created.id, {
        commandId,
        expectedRevision: edited.revision,
      });
    const calculated = parseAssistantNotebook(String(result.body.content));
    assert.deepEqual(
      calculated.run!.outputs,
      outputs,
      'run must use the pinned historical dataset'
    );
    assert.equal(calculated.run!.inputRows, 6);
    await checkReferences('data-alice', result.body);
    const later = await reviseResource('data-alice', result.id, result.revision, result.title, {
      ...result.body,
      content: JSON.stringify({ ...calculated, report: 'Spätere Interpretation' }),
    });
    assert.equal(later.revision, result.revision + 1);
    assert.deepEqual(
      await runNotebook('data-alice', created.id, { commandId, expectedRevision: edited.revision }),
      result,
      'lost acknowledgement returns exact original run revision'
    );
    await assert.rejects(
      () =>
        runNotebook('data-bob', created.id, {
          commandId: randomUUID(),
          expectedRevision: later.revision,
        }),
      /nicht gefunden/
    );
    await assert.rejects(
      () => runNotebook('data-alice', created.id, { commandId: randomUUID(), expectedRevision: 1 }),
      /inzwischen/
    );
    await assert.rejects(
      () => runNotebook('data-alice', created.id, { commandId, expectedRevision: later.revision }),
      /anderen Lauf/
    );
    const forged = {
      ...calculated,
      run: { ...calculated.run!, outputs: [{ ...outputs[0]!, rows: [['Falsch', 1000000]] }] },
    };
    await assert.rejects(
      () =>
        createResource(
          'data-alice',
          'artifact',
          'Forged',
          BODY_SCHEMAS.artifact.parse({
            type: 'notebook',
            format: 'json',
            content: JSON.stringify(forged),
          })
        ),
      /passt nicht/
    );
    const md = await exportArtifact(result, 'md'),
      raw = await exportArtifact(result, 'json');
    assert(md.data.toString().includes(calculated.run!.datasetHash));
    assert(md.data.toString().includes('Pearson') === false);
    assert.deepEqual(parseAssistantNotebook(raw.data.toString()), calculated);
    assert(assistantNotebookReport(calculated).includes('| Zürich | 5 |'));
    const pythonNotebook = await createNotebook('data-alice', dataset.id, {
      commandId: randomUUID(),
      expectedRevision: 2,
    });
    const pythonInput = await reviseResource(
      'data-alice',
      pythonNotebook.id,
      1,
      pythonNotebook.title,
      { ...pythonNotebook.body, content: JSON.stringify(configured) }
    );
    const pythonCommand = {
      commandId: randomUUID(),
      expectedRevision: pythonInput.revision,
      instructions:
        'Berechne die Umsatzsumme und speichere das tatsächliche Python-Skript und den Bericht.',
    };
    const [pythonTask, duplicateTask] = await Promise.all([
      createAnalysisTask('data-alice', pythonInput.id, pythonCommand),
      createAnalysisTask('data-alice', pythonInput.id, pythonCommand),
    ]);
    assert.deepEqual(pythonTask, duplicateTask);
    assert.equal(pythonTask.body.status, 'draft');
    assert.equal(pythonTask.body.provider, 'codex');
    assert.equal((await findResource('data-alice', pythonInput.id)).revision, 3);
    const analysis = await analysisTaskContext('data-alice', pythonTask.body);
    assert.equal(analysis!.dataset.body.content, csv);
    assert.equal(analysis!.datasetRevision, 1);
    await assert.rejects(
      () => createAnalysisTask('data-bob', pythonInput.id, pythonCommand),
      /nicht gefunden/
    );
    await assert.rejects(
      () =>
        createAnalysisTask('data-alice', pythonInput.id, {
          ...pythonCommand,
          instructions: 'Anderer Inhalt',
        }),
      /anderen Inhalt/
    );
    await assert.rejects(
      () =>
        createAnalysisTask('data-alice', pythonInput.id, {
          ...pythonCommand,
          commandId: randomUUID(),
        }),
      /inzwischen/
    );
    await run(
      "INSERT INTO sessions(id,user_id,name,working_directory,cli_provider,surface) VALUES('python-fixture','data-alice','Fixture','/tmp','codex','task')"
    );
    await reviseResource('data-alice', pythonTask.id, pythonTask.revision, pythonTask.title, {
      ...pythonTask.body,
      sessionId: 'python-fixture',
    });
    const inputResource = (await executeAssistantTool('python-fixture', 'data-alice', {
      name: 'plum_read_resource',
      arguments: { id: dataset.id },
    })) as typeof dataset;
    assert.equal(inputResource.revision, 1);
    assert.equal(inputResource.body.content, csv);
    await assert.rejects(
      () =>
        executeAssistantTool('python-fixture', 'data-alice', {
          name: 'plum_read_resource',
          arguments: { id: dataset.id, revision: 2 },
        }),
      /Auftragsrevision/
    );
    await assert.rejects(
      () =>
        executeAssistantTool('python-fixture', 'data-bob', {
          name: 'plum_read_resource',
          arguments: { id: dataset.id },
        }),
      /nicht gefunden/
    );
    const script =
      'import csv,io,json,sys\nrows=csv.DictReader(io.StringIO(sys.argv[1]))\nvalues=[]\nfor row in rows:\n try: values.append(float(row["Umsatz"]))\n except ValueError: pass\nprint(json.dumps({"sum":sum(values),"valid":len(values)}))\n';
    const actual = JSON.parse(
      execFileSync(
        '/usr/local/bin/plum-python',
        ['-c', script, String(inputResource.body.content)],
        { encoding: 'utf8', timeout: 10000 }
      )
    );
    assert.deepEqual(actual, { sum: 55, valid: 4 });
    const savedScript = (await executeAssistantTool('python-fixture', 'data-alice', {
      name: 'plum_create_artifact',
      arguments: {
        title: 'Umsatzanalyse.py',
        body: {
          type: 'code',
          format: 'text',
          language: 'python',
          content: script,
          taskId: pythonTask.id,
        },
      },
    })) as typeof dataset;
    const savedReport = (await executeAssistantTool('python-fixture', 'data-alice', {
      name: 'plum_create_artifact',
      arguments: {
        title: 'Bestätigte Python-Analyse',
        body: {
          type: 'document',
          format: 'markdown',
          content: `Summe: ${actual.sum}; Eingaberevision: 1; SHA-256: ${analysis!.datasetHash}`,
          taskId: pythonTask.id,
        },
      },
    })) as typeof dataset;
    assert.equal(savedScript.body.taskId, pythonTask.id);
    const pythonFile = await exportArtifact(savedScript, 'py', 'data-alice');
    assert.deepEqual(pythonFile.data, Buffer.from(script));
    assert.equal(pythonFile.mimeType, 'text/x-python; charset=utf-8');
    await assert.rejects(exportArtifact(savedReport, 'py', 'data-alice'));
    const savedData = (await executeAssistantTool('python-fixture', 'data-alice', {
      name: 'plum_create_artifact',
      arguments: {
        title: 'Datenergebnisse',
        body: {
          type: 'dataset',
          format: 'json',
          taskId: pythonTask.id,
          content: JSON.stringify({
            columns: ['sum', 'valid'],
            rows: [[actual.sum, actual.valid]],
          }),
        },
      },
    })) as typeof dataset;
    assert.equal(savedData.body.taskId, pythonTask.id);
    assert.equal(savedReport.body.taskId, pythonTask.id);
    assert(
      (await buildAssistantContext('python-fixture', 'data-alice'))!.includes(analysis!.datasetHash)
    );
    const notebookEdited = await findResource('data-alice', pythonInput.id);
    const manual = await reviseResource(
      'data-alice',
      pythonInput.id,
      notebookEdited.revision,
      notebookEdited.title,
      BODY_SCHEMAS.artifact.parse(notebookEdited.body)
    );
    assert.deepEqual(manual.body.analysisTaskIds, [pythonTask.id]);
    await run('UPDATE assistant_resources SET archived=1 WHERE id=?', pythonInput.id);
    assert.deepEqual(
      await createAnalysisTask('data-alice', pythonInput.id, pythonCommand),
      pythonTask,
      'lost acknowledgement remains replayable after archive'
    );
    console.log(
      'PASS: concurrent Python-task command, immutable old notebook/dataset and SHA, draft-only creation, source pin enforcement, owner/revision/receipt checks, real Python sum and MCP script/report task lineage'
    );
    const invalid = {
      ...calculated,
      steps: [{ id: 'bad', kind: 'summary', column: 'absent' }],
      run: undefined,
    };
    const bad = await reviseResource('data-alice', created.id, later.revision, later.title, {
        ...later.body,
        content: JSON.stringify(invalid),
      }),
      badId = randomUUID();
    await assert.rejects(
      () => runNotebook('data-alice', bad.id, { commandId: badId, expectedRevision: bad.revision }),
      /Spalte nicht gefunden/
    );
    assert.equal((await findResource('data-alice', bad.id)).revision, bad.revision);
    assert.equal(
      await get('SELECT command_id FROM assistant_commands WHERE command_id=?', badId),
      undefined
    );
    console.log(
      'PASS: exact original bytes, import/create/run idempotency, pinned historical dataset, immutable lost-ack receipt, revision/owner checks, forged-run rejection, JSON/report export and transactional failure'
    );
  } finally {
    await dropTestSchema();
    await closePool();
  }
