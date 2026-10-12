import { parseAssistantSlides } from '@plum-code-webui/shared';
import { createHash } from 'node:crypto';
import { transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { BODY_SCHEMAS, createResource, findResource } from './resources.js';
import { importWordImages } from './officeImages.js';

/** A text/table copy of an explicit original version, never a destructive Office roundtrip. */
export async function officeArtifact(
  userId: string,
  sourceId: string,
  input: { commandId: string; expectedRevision: number; sheet?: number }
) {
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const source = await findResource(userId, sourceId, tx);
    if (source.kind !== 'source') throw new AppError('Quelle nicht gefunden', 404, 'NOT_FOUND');
    const hash = createHash('sha256')
      .update(JSON.stringify([sourceId, input.expectedRevision, input.sheet ?? 0]))
      .digest('hex');
    const prior = await tx.get(
      'SELECT payload_hash,action,result_json FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (prior.payload_hash !== hash || prior.action !== 'office-import')
        throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
      return findResource(userId, JSON.parse(prior.result_json).artifactId, tx);
    }
    if (source.revision !== input.expectedRevision)
      throw new AppError('Quelle wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
    const office = source.body.office as
      | {
          kind?: string;
          text?: string;
          document?: unknown;
          presentation?: unknown;
          sheets?: Array<{ name: string; grid: string[][] }>;
          slides?: Array<{ text: string; notes: string }>;
          warnings?: string[];
        }
      | undefined;
    if (!office || !['docx', 'xlsx', 'pptx'].includes(office.kind ?? ''))
      throw new AppError(
        'Diese Quelle besitzt kein importiertes Office-Modell',
        400,
        'OFFICE_IMPORT_REQUIRED'
      );
    let content = String(office.text ?? ''),
      type = 'document',
      format = 'text',
      title = source.title;
    if (office.kind === 'docx' && office.document) {
      try {
        const imported = await importWordImages(userId, source, tx);
        content = JSON.stringify(imported.document);
        office.warnings = imported.warnings;
        format = 'json';
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          'Die formatierte Word-Kopie überschreitet die Bearbeitungsgrenzen. Das Original bleibt erhalten.',
          422,
          'OFFICE_EDIT_LIMIT'
        );
      }
    } else if (office.kind === 'xlsx') {
      const sheet = office.sheets?.[input.sheet ?? 0];
      if (!sheet) throw new AppError('Tabellenblatt nicht gefunden', 404, 'NOT_FOUND');
      content = JSON.stringify({ type: 'plum-sheet', version: 1, cells: sheet.grid });
      type = 'table';
      format = 'json';
      title = `${source.title} · ${sheet.name}`;
    } else if (office.kind === 'pptx') {
      type = 'slides';
      format = 'json';
      content = JSON.stringify(
        parseAssistantSlides(
          JSON.stringify(
            office.presentation ?? {
              type: 'plum-slides',
              version: 1,
              slides: (office.slides ?? []).map((slide) => {
                const lines = slide.text.split('\n');
                return {
                  title: (lines.shift() ?? '').slice(0, 200),
                  layout: 'bullets',
                  text: lines.join('\n'),
                  secondary: '',
                  notes: slide.notes,
                };
              }),
            }
          )
        )
      );
    }
    if (content.length > 50000)
      throw new AppError(
        'Die bearbeitbare Kopie überschreitet 50 000 Zeichen. Ein kleineres Tabellenblatt oder Dokument importieren; das Original bleibt erhalten.',
        422,
        'OFFICE_EDIT_LIMIT'
      );
    const artifact = await createResource(
      userId,
      'artifact',
      title.slice(0, 200),
      {
        ...BODY_SCHEMAS.artifact.parse({ type, format, content, sourceIds: [source.id] }),
        importOrigin: {
          sourceId: source.id,
          sourceRevision: source.revision,
          kind: office.kind,
          sheet: input.sheet ?? 0,
          warnings: office.warnings ?? [],
          truncated: source.body.truncated === true,
        },
      },
      tx
    );
    const now = new Date().toISOString();
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
      userId,
      input.commandId,
      source.id,
      hash,
      'office-import',
      JSON.stringify({ artifactId: artifact.id }),
      now,
      now
    );
    return artifact;
  });
}
