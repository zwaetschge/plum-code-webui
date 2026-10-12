import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  documentFromText,
  slidesFromText,
  motionFromText,
  parseAssistantCsv,
  parseAssistantSheet,
  serializeAssistantSheet,
  evaluateAssistantSheet,
  sheetColumn,
  type AssistantSheet,
  serializeAssistantCsv,
  type AssistantResource,
  type AssistantArtifactImage,
} from '@plum-code-webui/shared';
import { ArtifactImage } from './ArtifactImage';
import { DocumentImageUpload } from './DocumentImageUpload';
import { MotionAudio } from './MotionAudio';
import { ImageEditTask } from './ImageEditTask';
import { DocumentWorkspace, type DocumentPassageSelection } from './DocumentWorkspace';
import { SlidesWorkspace } from './SlidesWorkspace';
import { ComparisonWorkspace } from './ComparisonWorkspace';
import { TryOnTask } from './TryOnTask';
import { MotionWorkspace } from './MotionWorkspace';
import { AppPreview } from './AppPreview';
import { EvidencePanel } from './EvidencePanel';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { ApiChatStarter } from './ApiChatStarter';
import { CreateNotebook, NotebookWorkspace } from './NotebookWorkspace';

export function ArtifactViewer({
  artifact,
  onSaved,
  readOnly = false,
  shareToken,
}: {
  artifact: AssistantResource;
  onSaved: () => void;
  readOnly?: boolean;
  shareToken?: string;
}) {
  const owner = useAuthStore((state) => state.user?.id);
  const current = useRef({ owner, id: artifact.id, revision: artifact.revision, active: true });
  current.current = {
    owner,
    id: artifact.id,
    revision: artifact.revision,
    active: current.current.active,
  };
  useEffect(() => {
    current.current.active = true;
    return () => {
      current.current.active = false;
    };
  }, []);
  const [text, setText] = useState(String(artifact.body.content ?? ''));
  const [editing, setEditing] = useState(false);
  const [workingFormat, setWorkingFormat] = useState(artifact.body.format);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [slide, setSlide] = useState(0);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [assistedEdit, setAssistedEdit] = useState(false);
  const [documentSelection, setDocumentSelection] = useState<DocumentPassageSelection | null>(null);
  const [editImage, setEditImage] = useState<AssistantArtifactImage | null>(null);
  const [imageTask, setImageTask] = useState<AssistantResource | null>(null);
  useEffect(() => {
    setText(String(artifact.body.content ?? ''));
    setWorkingFormat(artifact.body.format);
    setEditing(false);
    setError('');
    setSlide(0);
    setSelection(null);
    setAssistedEdit(false);
    setDocumentSelection(null);
    setEditImage(null);
    setImageTask(null);
  }, [artifact.id, artifact.revision, artifact.body.content, artifact.body.format]);
  let rows: string[][] | null = null;
  if (workingFormat === 'csv') {
    try {
      rows = parseAssistantCsv(text);
    } catch {
      /* Incomplete drafts can still be edited as text. */
    }
  }
  let sheet: AssistantSheet | null = null;
  if (artifact.body.type === 'table' && workingFormat === 'json') {
    try {
      sheet = parseAssistantSheet(text);
      rows = sheet.cells;
    } catch {
      /* Raw text remains editable. */
    }
  }
  const results = sheet ? evaluateAssistantSheet(sheet) : null;
  const setRows = (cells: string[][]) =>
    setText(sheet ? serializeAssistantSheet(cells) : serializeAssistantCsv(cells));
  const slides = text.split(/^---\s*$/m);
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/api/assistant/artifacts/${artifact.id}`, {
        title: artifact.title,
        expectedRevision: artifact.revision,
        body: { ...artifact.body, content: text, format: workingFormat },
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };
  const download = async (format: string, original?: { path: string; filename: string }) => {
    const captured = { owner, id: artifact.id, revision: artifact.revision };
    try {
      const response = await api.download(
        original?.path ??
          `/api/assistant/artifacts/${artifact.id}/export?format=${format}&revision=${artifact.revision}`
      );
      const blob = await response.blob();
      if (
        !current.current.active ||
        current.current.owner !== captured.owner ||
        current.current.id !== captured.id ||
        current.current.revision !== captured.revision ||
        useAuthStore.getState().user?.id !== captured.owner
      )
        return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download =
        original?.filename ??
        (artifact.title.toLowerCase().endsWith('.' + format)
          ? artifact.title
          : `${artifact.title}.${format}`);
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export fehlgeschlagen');
    }
  };
  const richDocument = artifact.body.type === 'document' && workingFormat === 'json';
  const richSlides = artifact.body.type === 'slides' && workingFormat === 'json';
  const motion = artifact.body.type === 'video' && workingFormat === 'json';
  const preview = artifact.body.format === 'html' && !editing;
  return (
    <section
      className="space-y-4"
      aria-label={readOnly ? 'Geteiltes Ergebnis ansehen' : 'Ergebnis bearbeiten und ansehen'}
    >
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => setEditing(!editing)}
          >
            {editing ? 'Vorschau' : 'Bearbeiten'}
          </Button>
          {(text !== String(artifact.body.content ?? '') ||
            workingFormat !== artifact.body.format) && (
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? 'Wird gespeichert …' : 'Neue Revision speichern'}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void download(
                artifact.body.type === 'code' && artifact.body.format === 'text'
                  ? artifact.body.language === 'python'
                    ? 'py'
                    : 'txt'
                  : artifact.body.format === 'csv'
                    ? 'csv'
                    : artifact.body.format === 'html'
                      ? 'html'
                      : artifact.body.format === 'json'
                        ? 'json'
                        : 'md'
              )
            }
          >
            Datei exportieren
          </Button>
          {[
            'document',
            'research',
            'notebook',
            'latex',
            'table',
            'slides',
            'comparison',
            'image',
          ].includes(String(artifact.body.type)) && (
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => void download('pdf')}
            >
              PDF
            </Button>
          )}
          {['document', 'research'].includes(String(artifact.body.type)) && (
            <Button size="sm" variant="outline" onClick={() => void download('docx')}>
              Word
            </Button>
          )}
          {artifact.body.type === 'table' && (artifact.body.format === 'csv' || sheet) && (
            <Button size="sm" variant="outline" onClick={() => void download('xlsx')}>
              Excel
            </Button>
          )}
          {artifact.body.type === 'slides' && (
            <Button size="sm" variant="outline" onClick={() => void download('pptx')}>
              PowerPoint
            </Button>
          )}
          {artifact.body.type === 'notebook' && (
            <Button size="sm" variant="outline" onClick={() => void download('md')}>
              Analysebericht exportieren
            </Button>
          )}
          {artifact.body.type === 'video' &&
            artifact.body.format === 'json' &&
            ['mp4', 'png', 'svg'].map((format) => (
              <Button
                key={format}
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => void download(format)}
              >
                {format.toUpperCase()}
              </Button>
            ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!readOnly && Array.isArray(artifact.body.images) && artifact.body.images.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(artifact.body.images as AssistantArtifactImage[]).map((image) => (
              <div key={image.url} className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={image.byteLength > 5 * 1024 * 1024}
                  onClick={() => {
                    setEditImage(image);
                    setImageTask(null);
                  }}
                >
                  Bild bearbeiten: {image.filename}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void download('', {
                      path: `/api/assistant/artifacts/${artifact.id}/images/${image.assetId}?revision=${artifact.revision}`,
                      filename: image.filename,
                    })
                  }
                >
                  Originalbild herunterladen
                </Button>
              </div>
            ))}
          </div>
          {editImage && (
            <ImageEditTask
              key={`${artifact.id}:${artifact.revision}:${editImage.assetId}`}
              task={artifact}
              image={{
                id: editImage.assetId,
                filename: editImage.filename,
                mimeType: editImage.mimeType,
                byteLength: editImage.byteLength,
              }}
              onClose={() => setEditImage(null)}
              onCreated={(task) => {
                setEditImage(null);
                setImageTask(task);
              }}
            />
          )}
          {imageTask && (
            <p className="text-sm">
              Bildauftrag vorbereitet:{' '}
              <a className="underline" href={`/assistant/tasks?resource=${encodeURIComponent(imageTask.id)}`}>
                {imageTask.title}
              </a>
              . Die Bearbeitung beginnt beim Starten des Tasks.
            </p>
          )}
          {(artifact.body.images as AssistantArtifactImage[]).some(
            (image) => image.byteLength > 5 * 1024 * 1024
          ) && (
            <p className="text-xs text-muted-foreground">
              Ein Bildoriginal über 5 MB bleibt abrufbar; für die Task-Bearbeitung eine kleinere
              eigene Bildkopie hochladen.
            </p>
          )}
        </div>
      )}
      {!readOnly && ['dataset', 'table'].includes(String(artifact.body.type)) && (
        <CreateNotebook dataset={artifact} />
      )}
      {sheet && (
        <p className="text-xs text-muted-foreground">
          Lokale Formeln: Rechnen, Vergleiche, Zellbezüge, SUM, AVERAGE, MIN, MAX, COUNT und IF.
          Eingaben und Formeln bleiben erhalten; nicht unterstützte Formeln zeigen einen Fehler.
        </p>
      )}
      {!readOnly && rows && !sheet && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setWorkingFormat('json');
            setText(serializeAssistantSheet(rows!));
            setEditing(true);
          }}
        >
          Als rechnende Plum-Tabelle bearbeiten
        </Button>
      )}
      {!readOnly && artifact.body.type === 'document' && !richDocument && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            try {
              setText(JSON.stringify(documentFromText(text)));
              setWorkingFormat('json');
              setEditing(true);
            } catch {
              setError('Für die formatierte Bearbeitung ein kleineres Dokument verwenden.');
            }
          }}
        >
          Als formatiertes Plum-Dokument bearbeiten
        </Button>
      )}
      {!readOnly && artifact.body.type === 'slides' && !richSlides && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            try {
              setText(JSON.stringify(slidesFromText(text)));
              setWorkingFormat('json');
              setEditing(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Umwandlung fehlgeschlagen');
            }
          }}
        >
          Als strukturierte Präsentation bearbeiten
        </Button>
      )}
      {!readOnly && artifact.body.type === 'video' && !motion && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setText(JSON.stringify(motionFromText(text)));
            setWorkingFormat('json');
            setEditing(true);
          }}
        >
          Als Animation gestalten
        </Button>
      )}
      {artifact.body.type === 'comparison' ? (
        <div className="space-y-3">
          <ComparisonWorkspace content={text} editing={editing && !readOnly} onChange={setText} />
          {!readOnly && !editing && !saving && (
            <TryOnTask key={`${artifact.id}:${artifact.revision}:${owner}`} artifact={artifact} />
          )}
        </div>
      ) : motion ? (
        <div className="space-y-3">
          <MotionWorkspace
            content={text}
            editing={editing && !readOnly && !saving}
            onChange={setText}
          />
          <MotionAudio
            key={`${artifact.id}:${artifact.revision}:${owner}`}
            artifact={artifact}
            shareToken={shareToken}
            readOnly={readOnly}
            disabled={
              text !== String(artifact.body.content ?? '') ||
              workingFormat !== artifact.body.format ||
              saving
            }
            onSaved={onSaved}
            onPending={setSaving}
          />
        </div>
      ) : richSlides ? (
        <SlidesWorkspace content={text} editing={editing && !readOnly} onChange={setText} />
      ) : richDocument ? (
        <div className="space-y-4">
          <DocumentWorkspace
            content={text}
            editing={editing && !readOnly && !saving}
            onChange={setText}
            renderImage={(image) => (
              <ArtifactImage
                src={`/assistant-images/${image.assetId}`}
                alt={image.alt}
                artifact={artifact}
                shareToken={shareToken}
              />
            )}
            onPassageSelect={(selected) => {
              setDocumentSelection(selected);
              setAssistedEdit(false);
            }}
          />
          {editing && !readOnly && (
            <DocumentImageUpload
              key={`${artifact.id}:${artifact.revision}:${owner}`}
              artifact={artifact}
              disabled={
                text !== String(artifact.body.content ?? '') ||
                workingFormat !== artifact.body.format
              }
              onSaved={onSaved}
              onPending={setSaving}
            />
          )}
          {editing && !readOnly && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !documentSelection ||
                  documentSelection.end - documentSelection.start > 20000 ||
                  text !== artifact.body.content ||
                  workingFormat !== artifact.body.format
                }
                onClick={() => setAssistedEdit(!assistedEdit)}
              >
                Auswahl mit Plum ändern
              </Button>
              {text !== artifact.body.content && (
                <p className="text-xs text-muted-foreground">
                  Vor einer KI-Änderung die eigene Revision speichern und die Stelle markieren.
                </p>
              )}
              {assistedEdit && documentSelection && (
                <ApiChatStarter
                  key={`${artifact.id}:${artifact.revision}:${JSON.stringify(documentSelection)}`}
                  artifactEdit={{
                    artifactId: artifact.id,
                    revision: artifact.revision,
                    ...documentSelection,
                  }}
                />
              )}
            </>
          )}
        </div>
      ) : rows && editing ? (
        <div className="space-y-3">
          <div className="max-h-[32rem] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              {sheet && (
                <thead>
                  <tr>
                    {rows[0]?.map((_, c) => (
                      <th key={c} className="border bg-muted px-3 py-2 text-left">
                        {sheetColumn(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className="border p-1">
                        <input
                          aria-label={`Zeile ${r + 1}, Spalte ${c + 1}`}
                          className="min-w-24 w-full bg-background p-2"
                          value={cell}
                          onChange={(event) => {
                            const next = rows!.map((line) => [...line]);
                            next[r]![c] = event.target.value;
                            setRows(next);
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setRows([...rows!, Array.from({ length: rows![0]?.length ?? 1 }, () => '')])
            }
          >
            Zeile hinzufügen
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRows(rows!.map((row) => [...row, '']))}
          >
            Spalte hinzufügen
          </Button>
        </div>
      ) : editing ? (
        <div className="space-y-3">
          <textarea
            aria-label="Ergebnisinhalt"
            className="min-h-80 w-full rounded-md border bg-background p-3 font-mono text-sm"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setAssistedEdit(false);
              setSelection(null);
            }}
            onSelect={(event) => {
              const element = event.currentTarget;
              setSelection(
                element.selectionStart < element.selectionEnd
                  ? { start: element.selectionStart, end: element.selectionEnd }
                  : null
              );
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={
              !selection ||
              selection.end - selection.start > 20000 ||
              text !== artifact.body.content ||
              workingFormat !== artifact.body.format
            }
            onClick={() => setAssistedEdit(!assistedEdit)}
          >
            Auswahl mit Plum ändern
          </Button>
          {text !== artifact.body.content && (
            <p className="text-xs text-muted-foreground">
              Vor einer KI-Änderung die eigene Revision speichern und die Stelle markieren.
            </p>
          )}
          {assistedEdit && selection && (
            <ApiChatStarter
              key={`${artifact.id}:${artifact.revision}:${selection.start}:${selection.end}`}
              artifactEdit={{
                artifactId: artifact.id,
                revision: artifact.revision,
                ...selection,
                selectedText: text.slice(selection.start, selection.end),
              }}
            />
          )}
        </div>
      ) : artifact.body.type === 'notebook' ? (
        <NotebookWorkspace artifact={artifact} onSaved={onSaved} readOnly={readOnly} />
      ) : preview ? (
        <AppPreview
          artifact={artifact}
          content={text}
          readOnly={readOnly}
          shareToken={shareToken}
        />
      ) : rows ? (
        <div className="max-h-[32rem] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            {sheet && (
              <thead>
                <tr>
                  {rows[0]?.map((_, c) => (
                    <th key={c} className="border bg-muted px-3 py-2 text-left">
                      {sheetColumn(c)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className="border px-3 py-2"
                      title={sheet ? `${sheetColumn(c)}${r + 1}: ${cell}` : undefined}
                    >
                      {results ? String(results[r]?.[c]?.value ?? '') : cell}
                      {results?.[r]?.[c]?.error && (
                        <span className="sr-only"> Formel kann nicht berechnet werden.</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : artifact.body.type === 'code' ? (
        <pre
          aria-label="Gespeicherter Quellcode"
          className="max-h-[40rem] overflow-auto rounded-md border bg-muted p-3 text-sm"
        >
          <code>{text}</code>
        </pre>
      ) : (
        <div className="prose prose-sm max-w-none overflow-x-auto dark:prose-invert">
          <ReactMarkdown
            components={{
              img: ({ src, alt }) => (
                <ArtifactImage src={src} alt={alt} artifact={artifact} shareToken={shareToken} />
              ),
              table: ({ children }) => (
                <table className="my-4 w-full border-collapse text-left text-sm">{children}</table>
              ),
              th: ({ children }) => (
                <th className="border-b px-3 py-2 font-semibold">{children}</th>
              ),
              td: ({ children }) => <td className="border-b px-3 py-2 align-top">{children}</td>,
              p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
              h1: ({ children }) => <h2 className="mb-3 mt-5 text-xl font-semibold">{children}</h2>,
              h2: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold">{children}</h3>,
              ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
              ol: ({ children }) => (
                <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>
              ),
            }}
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { trust: false, throwOnError: false }]]}
          >
            {artifact.body.type === 'slides'
              ? (slides[slide] ?? '')
              : artifact.body.type === 'latex'
                ? `$$\n${text}\n$$`
                : text}
          </ReactMarkdown>
        </div>
      )}
      <EvidencePanel
        artifact={artifact}
        onReview={
          readOnly
            ? undefined
            : (index, reviewed) => {
                void api
                  .patch(`/api/assistant/artifacts/${artifact.id}`, {
                    title: artifact.title,
                    expectedRevision: artifact.revision,
                    body: {
                      ...artifact.body,
                      evidence: (artifact.body.evidence as Record<string, unknown>[]).map(
                        (entry, i) => (i === index ? { ...entry, reviewed } : entry)
                      ),
                    },
                  })
                  .then(onSaved)
                  .catch((failure) =>
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : 'Prüfung konnte nicht gespeichert werden'
                    )
                  );
              }
        }
      />
      {artifact.body.type === 'slides' && !richSlides && !editing && (
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" disabled={!slide} onClick={() => setSlide(slide - 1)}>
            Zurück
          </Button>
          <span className="text-sm">
            Folie {slide + 1} / {slides.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={slide >= slides.length - 1}
            onClick={() => setSlide(slide + 1)}
          >
            Weiter
          </Button>
        </div>
      )}
    </section>
  );
}
