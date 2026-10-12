import { createHash, randomUUID } from 'node:crypto';
import {
  parseAssistantDataset,
  parseAssistantNotebook,
  evaluateAssistantNotebook,
} from '@plum-code-webui/shared';
import { transaction } from '../../db/pg.js';
import { findResource, reviseResource, createResource, BODY_SCHEMAS } from './resources.js';
import { AppError } from '../../middleware/errorHandler.js';

export async function importDataset(
  userId: string,
  file: { buffer: Buffer; originalname: string },
  commandId: string,
  format: 'csv' | 'json'
) {
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    parseAssistantDataset(content, format);
  } catch (failure) {
    throw new AppError(
      failure instanceof Error ? failure.message : 'Ungültiger Datensatz',
      400,
      'DATASET_INVALID'
    );
  }
  const filename =
    file.originalname.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200) || `dataset.${format}`;
  const sha = createHash('sha256').update(file.buffer).digest('hex');
  const hash = createHash('sha256')
    .update(JSON.stringify([sha, filename, format]))
    .digest('hex');
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const prior = await tx.get(
      'SELECT * FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      commandId
    );
    if (prior) {
      if (prior.action !== 'dataset-import' || prior.payload_hash !== hash)
        throw new AppError('Importkennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
      return JSON.parse(String(prior.result_json));
    }
    const now = new Date().toISOString(),
      mime = format === 'csv' ? 'text/csv' : 'application/json';
    const asset = await tx.get(
      'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO UPDATE SET sha256=excluded.sha256 RETURNING id',
      randomUUID(),
      userId,
      filename,
      mime,
      sha,
      file.buffer,
      now
    );
    const source = await createResource(
      userId,
      'source',
      filename,
      {
        ...BODY_SCHEMAS.source.parse({ text: content, citation: filename, mimeType: mime }),
        assetId: asset.id,
        filename,
        sha256: sha,
        ingestion: 'ready',
        ingestedAt: now,
        truncated: false,
        pages: [],
      },
      tx
    );
    const artifact = await createResource(
      userId,
      'artifact',
      filename,
      {
        ...BODY_SCHEMAS.artifact.parse({
          type: 'dataset',
          format,
          content,
          sourceIds: [source.id],
        }),
        importOrigin: {
          sourceId: source.id,
          sourceRevision: 1,
          assetId: asset.id,
          filename,
          sha256: sha,
          kind: format,
        },
      },
      tx
    );
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
      userId,
      commandId,
      artifact.id,
      hash,
      'dataset-import',
      JSON.stringify(artifact),
      now,
      now
    );
    return artifact;
  });
}

export async function createNotebook(
  userId: string,
  datasetId: string,
  input: { commandId: string; expectedRevision: number }
) {
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const hash = createHash('sha256')
      .update(JSON.stringify([datasetId, input.expectedRevision]))
      .digest('hex');
    const prior = await tx.get(
      'SELECT * FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (prior.action !== 'notebook-create' || prior.payload_hash !== hash)
        throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
      return JSON.parse(String(prior.result_json));
    }
    const dataset = await findResource(userId, datasetId, tx);
    if (dataset.kind !== 'artifact' || !['dataset', 'table'].includes(String(dataset.body.type)))
      throw new AppError('Datensatz nicht gefunden', 404, 'NOT_FOUND');
    if (dataset.revision !== input.expectedRevision)
      throw new AppError('Datensatz wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
    let parsed;
    try {
      parsed = parseAssistantDataset(String(dataset.body.content), String(dataset.body.format));
    } catch (failure) {
      throw new AppError(
        failure instanceof Error ? failure.message : 'Ungültiger Datensatz',
        400,
        'DATASET_INVALID'
      );
    }
    const content = JSON.stringify({
      type: 'plum-notebook',
      version: 1,
      datasetId,
      datasetRevision: dataset.revision,
      steps: [{ id: 'summary', kind: 'summary', column: parsed.columns[0] }],
      report: '',
    });
    const result = await createResource(
      userId,
      'artifact',
      `${dataset.title.slice(0, 180)} · Analyse`,
      BODY_SCHEMAS.artifact.parse({ type: 'notebook', format: 'json', content }),
      tx
    );
    const now = new Date().toISOString();
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
      userId,
      input.commandId,
      result.id,
      hash,
      'notebook-create',
      JSON.stringify(result),
      now,
      now
    );
    return result;
  });
}

export async function runNotebook(
  userId: string,
  id: string,
  input: { commandId: string; expectedRevision: number }
) {
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const hash = createHash('sha256')
      .update(JSON.stringify([id, input.expectedRevision]))
      .digest('hex');
    const prior = await tx.get(
      'SELECT * FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (
        prior.resource_id !== id ||
        prior.action !== 'notebook-run' ||
        prior.payload_hash !== hash
      )
        throw new AppError('Befehlskennung gehört zu einem anderen Lauf', 409, 'COMMAND_CONFLICT');
      return JSON.parse(String(prior.result_json));
    }
    const artifact = await findResource(userId, id, tx);
    if (artifact.kind !== 'artifact' || artifact.body.type !== 'notebook')
      throw new AppError('Notebook nicht gefunden', 404, 'NOT_FOUND');
    if (artifact.revision !== input.expectedRevision)
      throw new AppError('Notebook wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
    let notebook;
    try {
      notebook = parseAssistantNotebook(String(artifact.body.content));
    } catch (failure) {
      throw new AppError(
        failure instanceof Error ? failure.message : 'Ungültiges Notebook',
        400,
        'NOTEBOOK_INVALID'
      );
    }
    const dataset = await findResource(userId, notebook.datasetId, tx);
    if (dataset.kind !== 'artifact')
      throw new AppError('Datensatz nicht gefunden', 404, 'NOT_FOUND');
    const version = await tx.get(
      'SELECT body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
      dataset.id,
      notebook.datasetRevision
    );
    if (!version) throw new AppError('Eingaberevision nicht gefunden', 404, 'NOT_FOUND');
    const source = JSON.parse(String(version.body_json));
    if (!['dataset', 'table'].includes(source.type))
      throw new AppError(
        'Als Eingabe einen Datensatz oder eine Tabelle wählen',
        400,
        'DATASET_INVALID'
      );
    try {
      const data = parseAssistantDataset(String(source.content), String(source.format));
      const outputs = evaluateAssistantNotebook(data, notebook);
      notebook.run = {
        id: input.commandId,
        notebookId: id,
        at: new Date().toISOString(),
        datasetHash: createHash('sha256')
          .update(JSON.stringify([source.format, source.content]))
          .digest('hex'),
        inputRows: data.rows.length,
        outputs,
      };
    } catch (failure) {
      throw new AppError(
        failure instanceof Error ? failure.message : 'Berechnung fehlgeschlagen',
        400,
        'ANALYSIS_FAILED'
      );
    }
    const content = JSON.stringify(notebook);
    if (content.length > 50000)
      throw new AppError(
        'Ergebnis zu gross; weniger Schritte oder Gruppen wählen',
        400,
        'ANALYSIS_TOO_LARGE'
      );
    const result = await reviseResource(
      userId,
      id,
      artifact.revision,
      artifact.title,
      { ...artifact.body, format: 'json', content },
      tx
    );
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
      userId,
      input.commandId,
      id,
      hash,
      'notebook-run',
      JSON.stringify(result),
      notebook.run.at,
      notebook.run.at
    );
    return result;
  });
}
