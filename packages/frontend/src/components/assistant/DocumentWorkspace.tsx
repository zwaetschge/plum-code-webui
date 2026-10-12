import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  parseAssistantDocument,
  assistantDocumentHref,
  type AssistantDocument,
  type AssistantDocumentBlock,
  type AssistantDocumentRun,
  type AssistantDocumentPath,
  type AssistantDocumentImage,
} from '@plum-code-webui/shared';
import { Button } from '@/components/ui/button';

export interface DocumentPassageSelection {
  documentPath: AssistantDocumentPath;
  start: number;
  end: number;
  selectedText: string;
}

function slices(runs: AssistantDocumentRun[], start: number, end: number) {
  const result: AssistantDocumentRun[] = [];
  let offset = 0;
  for (const run of runs) {
    const from = Math.max(0, start - offset),
      to = Math.min(run.text.length, end - offset);
    if (to > from) result.push({ ...run, text: run.text.slice(from, to) });
    offset += run.text.length;
  }
  return result;
}
function changedRuns(runs: AssistantDocumentRun[], next: string) {
  const old = runs.map((run) => run.text).join('');
  let start = 0,
    end = 0;
  while (start < old.length && start < next.length && old[start] === next[start]) start++;
  while (
    end < old.length - start &&
    end < next.length - start &&
    old[old.length - 1 - end] === next[next.length - 1 - end]
  )
    end++;
  const before = slices(runs, 0, start),
    after = slices(runs, old.length - end, old.length);
  let offset = 0,
    style: AssistantDocumentRun = runs[0] ?? { text: '' };
  for (const run of runs) {
    if (start <= offset + run.text.length) {
      style = run;
      break;
    }
    offset += run.text.length;
  }
  const insertion = next.slice(start, next.length - end);
  const result = [
    ...before,
    ...(insertion ? [{ ...style, text: insertion }] : []),
    ...after,
  ].filter((run) => run.text);
  const merged: AssistantDocumentRun[] = [];
  for (const run of result) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.bold === run.bold &&
      previous.italic === run.italic &&
      previous.underline === run.underline &&
      previous.href === run.href
    )
      previous.text += run.text;
    else merged.push({ ...run });
  }
  return merged.length ? merged : [{ ...style, text: '' }];
}
export function DocumentWorkspace({
  content,
  editing,
  onChange,
  onPassageSelect,
  renderImage,
}: {
  content: string;
  editing: boolean;
  onChange: (content: string) => void;
  onPassageSelect?: (selection: DocumentPassageSelection | null) => void;
  renderImage?: (image: AssistantDocumentImage) => ReactNode;
}) {
  const [error, setError] = useState(''),
    [selected, setSelected] = useState<{ block: number; start: number; end: number } | null>(null),
    [link, setLink] = useState(''),
    [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef<{ past: string[]; future: string[]; last: string }>({
    past: [],
    future: [],
    last: content,
  });
  useEffect(() => {
    if (history.current.last !== content) {
      history.current = { past: [], future: [], last: content };
      setHistoryVersion((n) => n + 1);
      setSelected(null);
    }
  }, [content]);
  let doc: AssistantDocument;
  try {
    doc = parseAssistantDocument(content);
  } catch {
    return <p role="alert">Dokumentstruktur konnte nicht gelesen werden.</p>;
  }
  const change = (blocks: AssistantDocumentBlock[]) => {
    try {
      const next = JSON.stringify(parseAssistantDocument(JSON.stringify({ ...doc, blocks })));
      if (next === content) return;
      history.current.past.push(content);
      history.current.past = history.current.past.slice(-50);
      history.current.future = [];
      history.current.last = next;
      setError('');
      onChange(next);
      onPassageSelect?.(null);
      setHistoryVersion((n) => n + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Dokument ist zu gross');
    }
  };
  const replace = (index: number, block: AssistantDocumentBlock) =>
    change(doc.blocks.map((item, n) => (n === index ? block : item)));
  const mark = (name: 'bold' | 'italic' | 'underline' | 'href') => {
    if (!selected) return;
    const block = doc.blocks[selected.block];
    if (!block || block.type === 'table' || block.type === 'image') return;
    const all = block.runs.map((run) => run.text).join('');
    const start = selected.start,
      end = selected.end > start ? selected.end : all.length;
    const from = selected.end > start ? start : 0;
    const target = slices(block.runs, from, end);
    if (!target.length) return;
    try {
      const value =
        name === 'href'
          ? link.trim()
            ? assistantDocumentHref(link.trim())
            : undefined
          : !target.every((run) => run[name]);
      const updated = target.map((run) => {
        const next = { ...run };
        delete next[name];
        if (value) Object.assign(next, { [name]: value });
        return next;
      });
      replace(selected.block, {
        ...block,
        runs: [...slices(block.runs, 0, from), ...updated, ...slices(block.runs, end, all.length)],
      });
    } catch {
      setError('Für einen Link eine HTTP-/HTTPS-Adresse ohne Zugangsdaten verwenden.');
    }
  };
  const renderRuns = (runs: AssistantDocumentRun[]) =>
    runs.map((run, index) => {
      let element = <span>{run.text}</span>;
      if (run.bold) element = <strong>{element}</strong>;
      if (run.italic) element = <em>{element}</em>;
      if (run.underline) element = <u>{element}</u>;
      return (
        <span key={index}>
          {run.href ? (
            <a
              href={run.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline focus-visible:outline"
            >
              {element}
            </a>
          ) : (
            element
          )}
        </span>
      );
    });
  const plain = (block: AssistantDocumentBlock) =>
    block.type === 'table' || block.type === 'image'
      ? ''
      : block.runs.map((run) => run.text).join('');
  const imageFigure = (block: AssistantDocumentImage) => (
    <figure className="space-y-2">
      {renderImage ? renderImage(block) : <p>{block.alt || 'Bildoriginal'}</p>}
      {block.caption && <figcaption className="text-sm">{block.caption}</figcaption>}
    </figure>
  );
  return (
    <section aria-label="Plum-Dokument" className="min-w-0 space-y-4">
      {editing && (
        <>
          <div className="flex flex-wrap gap-2" data-history={historyVersion}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!history.current.past.length}
              onClick={() => {
                const previous = history.current.past.pop();
                if (previous !== undefined) {
                  history.current.future.push(content);
                  history.current.last = previous;
                  onChange(previous);
                  setHistoryVersion((n) => n + 1);
                }
              }}
            >
              Rückgängig
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!history.current.future.length}
              onClick={() => {
                const next = history.current.future.pop();
                if (next !== undefined) {
                  history.current.past.push(content);
                  history.current.last = next;
                  onChange(next);
                  setHistoryVersion((n) => n + 1);
                }
              }}
            >
              Wiederholen
            </Button>
            {(['bold', 'italic', 'underline'] as const).map((name, index) => (
              <Button
                type="button"
                key={name}
                variant="outline"
                size="sm"
                disabled={!selected}
                onClick={() => mark(name)}
              >
                {['Fett', 'Kursiv', 'Unterstreichen'][index]}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-0 flex-1 gap-1 text-sm">
              Weblink
              <input
                className="w-full min-w-0 rounded-md border bg-background p-2"
                value={link}
                placeholder="https://…"
                onChange={(event) => setLink(event.target.value)}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!selected}
              onClick={() => mark('href')}
            >
              {link.trim() ? 'Link übernehmen' : 'Link entfernen'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Textstelle in einem Absatz markieren und formatieren. Ohne Markierung gilt die
            Formatierung für den ganzen Absatz. Rückgängig und Wiederholen behalten bis zu 50
            Bearbeitungsschritte.
          </p>
        </>
      )}
      {doc.blocks.map((block, index) =>
        editing ? (
          <div key={index} className="min-w-0 space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Block {index + 1}</span>
              {block.type !== 'table' && block.type !== 'image' && (
                <>
                  <label className="text-sm">
                    Absatztyp
                    <select
                      aria-label={`Absatztyp ${index + 1}`}
                      className="ml-2 rounded-md border bg-background p-2"
                      value={block.type}
                      onChange={(event) =>
                        replace(index, { ...block, type: event.target.value as typeof block.type })
                      }
                    >
                      <option value="paragraph">Absatz</option>
                      <option value="heading">Überschrift</option>
                      <option value="list">Liste</option>
                      <option value="quote">Zitat</option>
                      <option value="code">Code</option>
                    </select>
                  </label>
                  {block.type === 'heading' && (
                    <select
                      aria-label={`Überschriftenebene ${index + 1}`}
                      className="rounded-md border bg-background p-2"
                      value={block.level ?? 1}
                      onChange={(event) =>
                        replace(index, { ...block, level: Number(event.target.value) })
                      }
                    >
                      {[1, 2, 3, 4, 5, 6].map((level) => (
                        <option key={level} value={level}>
                          H{level}
                        </option>
                      ))}
                    </select>
                  )}
                  {block.type === 'list' && (
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={block.ordered ?? false}
                        onChange={(event) =>
                          replace(index, { ...block, ordered: event.target.checked })
                        }
                      />
                      Nummeriert
                    </label>
                  )}
                  <select
                    aria-label={`Ausrichtung ${index + 1}`}
                    className="rounded-md border bg-background p-2"
                    value={block.align ?? 'left'}
                    onChange={(event) =>
                      replace(index, { ...block, align: event.target.value as typeof block.align })
                    }
                  >
                    {[
                      ['left', 'Links'],
                      ['center', 'Mitte'],
                      ['right', 'Rechts'],
                      ['justify', 'Blocksatz'],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={index === 0}
                onClick={() => {
                  const blocks = [...doc.blocks];
                  [blocks[index - 1], blocks[index]] = [blocks[index]!, blocks[index - 1]!];
                  change(blocks);
                  setSelected(null);
                }}
              >
                Nach oben
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={doc.blocks.length === 1}
                onClick={() => {
                  change(doc.blocks.filter((_, n) => n !== index));
                  setSelected(null);
                }}
              >
                Block entfernen
              </Button>
            </div>
            {block.type === 'image' ? (
              <div className="space-y-3">
                {imageFigure(block)}
                <label className="grid gap-1 text-sm">
                  Alternativtext
                  <input
                    aria-label={`Alternativtext ${index + 1}`}
                    maxLength={500}
                    className="w-full rounded-md border bg-background p-2"
                    value={block.alt}
                    onChange={(event) => replace(index, { ...block, alt: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Bildunterschrift
                  <input
                    aria-label={`Bildunterschrift ${index + 1}`}
                    maxLength={500}
                    className="w-full rounded-md border bg-background p-2"
                    value={block.caption}
                    onChange={(event) => replace(index, { ...block, caption: event.target.value })}
                  />
                </label>
              </div>
            ) : block.type === 'table' ? (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c} className="border p-1">
                            <textarea
                              aria-label={`Tabelle ${index + 1}, Zeile ${r + 1}, Spalte ${c + 1}`}
                              className="min-w-28 bg-background p-2"
                              value={cell.map((run) => run.text).join('')}
                              onSelect={(event) => {
                                const field = event.currentTarget;
                                setSelected(null);
                                onPassageSelect?.(
                                  field.selectionEnd > field.selectionStart
                                    ? {
                                        documentPath: { block: index, row: r, column: c },
                                        start: field.selectionStart,
                                        end: field.selectionEnd,
                                        selectedText: field.value.slice(
                                          field.selectionStart,
                                          field.selectionEnd
                                        ),
                                      }
                                    : null
                                );
                              }}
                              onChange={(event) => {
                                const rows = block.rows.map((line) =>
                                  line.map((item) => [...item])
                                );
                                rows[r]![c] = changedRuns(cell, event.target.value);
                                replace(index, { ...block, rows });
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <textarea
                aria-label={`Absatz ${index + 1}`}
                className="min-h-24 w-full rounded-md border bg-background p-3"
                value={plain(block)}
                onChange={(event) =>
                  replace(index, {
                    ...block,
                    runs: changedRuns(block.runs, event.target.value).length
                      ? changedRuns(block.runs, event.target.value)
                      : [{ text: '' }],
                  })
                }
                onFocus={(event) =>
                  setSelected({
                    block: index,
                    start: event.currentTarget.selectionStart,
                    end: event.currentTarget.selectionEnd,
                  })
                }
                onSelect={(event) => {
                  setSelected({
                    block: index,
                    start: event.currentTarget.selectionStart,
                    end: event.currentTarget.selectionEnd,
                  });
                  const field = event.currentTarget;
                  onPassageSelect?.(
                    field.selectionEnd > field.selectionStart
                      ? {
                          documentPath: { block: index },
                          start: field.selectionStart,
                          end: field.selectionEnd,
                          selectedText: field.value.slice(field.selectionStart, field.selectionEnd),
                        }
                      : null
                  );
                }}
              />
            )}
          </div>
        ) : block.type === 'image' ? (
          <div key={index}>{imageFigure(block)}</div>
        ) : block.type === 'table' ? (
          <div key={index} className="max-w-full overflow-auto">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className="whitespace-pre-wrap border p-3">
                        {renderRuns(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            key={index}
            className="whitespace-pre-wrap break-words"
            style={{ textAlign: block.align ?? 'left' }}
          >
            {block.type === 'heading' ? (
              <h2
                role="heading"
                aria-level={block.level ?? 1}
                className="font-semibold"
                style={{ fontSize: `${Math.max(1, 2 - (block.level ?? 1) * 0.15)}rem` }}
              >
                {renderRuns(block.runs)}
              </h2>
            ) : block.type === 'quote' ? (
              <blockquote className="border-l-4 pl-4">{renderRuns(block.runs)}</blockquote>
            ) : block.type === 'code' ? (
              <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-sm">
                {renderRuns(block.runs)}
              </pre>
            ) : block.type === 'list' ? (
              block.ordered ? (
                <ol className="list-decimal pl-6">
                  <li>{renderRuns(block.runs)}</li>
                </ol>
              ) : (
                <ul className="list-disc pl-6">
                  <li>{renderRuns(block.runs)}</li>
                </ul>
              )
            ) : (
              <p>{renderRuns(block.runs) || '\u00a0'}</p>
            )}
          </div>
        )
      )}
      {editing && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => change([...doc.blocks, { type: 'paragraph', runs: [{ text: '' }] }])}
          >
            Absatz hinzufügen
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              change([
                ...doc.blocks,
                {
                  type: 'table',
                  rows: [
                    [[{ text: 'Spalte 1' }], [{ text: 'Spalte 2' }]],
                    [[{ text: '' }], [{ text: '' }]],
                  ],
                },
              ])
            }
          >
            Tabelle hinzufügen
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
